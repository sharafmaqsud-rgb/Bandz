// Combining the copies on two devices, with no server. Each record merges on its own and the
// newest edit wins, so a balance entered on your phone and a statement imported on your laptop
// both survive. Rules that apply after a merge run in syncFrom below.
import { applyRules, pairCardRepayments } from './categorise.js';
import { KINDS, SCHEMA_VERSION, isIsoDate, migrate } from './model.js';

// 'loan' only appears in backups from a test build. migrate removes it after the merge.
const CLASSES = ['cash', 'credit', 'investment', 'crypto', 'pension', 'loan'];
const COLLECTIONS = ['accounts', 'transactions', 'balances', 'statements'];

// Keys are checked because JSON can hold a key such as __proto__, which would change how
// objects behave if copied across.
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string';
const stamp = (r) => (Number.isFinite(r.updatedAt) ? r.updatedAt : 0);

function fail(what) {
  throw new Error(`This backup is not valid (${what}), so nothing was changed.`);
}
function checkKeys(obj, what) {
  if (!isObject(obj)) fail(what);
  for (const k of Object.keys(obj)) if (UNSAFE.has(k)) fail(what);
}

// A backup is checked in full before any of it is used. It is encrypted, but it could still
// come from an older version or a damaged copy.
export function validateState(s) {
  if (!isObject(s)) fail('not a data file');
  if (!Number.isInteger(s.schemaVersion)) fail('no version');
  if (s.schemaVersion > SCHEMA_VERSION) throw new Error('This backup came from a newer version of the app. Update this device first.');
  for (const name of [...COLLECTIONS, 'categories', 'goals', 'settings']) checkKeys(s[name] ?? {}, name);
  if (!Array.isArray(s.rules)) fail('rules');
  checkKeys(s.deleted ?? {}, 'deleted');

  for (const c of Object.values(s.categories)) {
    if (!isObject(c) || !KINDS.includes(c.kind)) fail('categories');
  }
  for (const a of Object.values(s.accounts)) {
    if (!isObject(a) || !isText(a.name) || !CLASSES.includes(a.class)) fail('accounts');
  }
  const hasAccount = (key) => Object.hasOwn(s.accounts, key);
  for (const [key, t] of Object.entries(s.transactions)) {
    const ok = isObject(t) && t.key === key && isText(t.description) && isText(t.currency) && isIsoDate(t.date)
      && Number.isSafeInteger(t.amountPence) && hasAccount(t.account)
      && (t.category === null || Object.hasOwn(s.categories, t.category));
    if (!ok) fail('transactions');
  }
  for (const b of Object.values(s.balances)) {
    if (!isObject(b) || !isIsoDate(b.date) || !Number.isSafeInteger(b.balancePence) || !hasAccount(b.account)) fail('balances');
  }
  for (const st of Object.values(s.statements ?? {})) {
    if (!isObject(st) || !isIsoDate(st.date) || !hasAccount(st.account)) fail('statements');
  }
  const number = (v) => Number.isFinite(v) && v >= 0;
  for (const v of Object.values(s.goals)) if (v !== null && !number(v)) fail('goals');
  for (const [k, v] of Object.entries(s.settings)) {
    if (k === 'isaPaidBeforeImportByTaxYear') {
      checkKeys(v, k);
      if (!Object.values(v).every(number)) fail(k);
    } else if (!number(v)) fail('settings');
  }
  if (!Object.values(s.deleted ?? {}).every(number)) fail('deleted');
  for (const r of s.rules) {
    // A blank pattern would match every transaction.
    if (!isObject(r) || !isText(r.pattern) || !r.pattern.trim() || !Object.hasOwn(s.categories, r.category)) fail('rules');
  }
  return s;
}

// A category you chose by hand beats one from a rule, whichever is newer. Otherwise a later
// rule change on one device could quietly undo a choice made on the other.
function pick(collection, local, incoming) {
  if (collection === 'transactions') {
    const lm = local.catSource === 'manual', im = incoming.catSource === 'manual';
    if (lm !== im) return lm ? local : incoming;
  }
  return stamp(incoming) > stamp(local) ? incoming : local;
}

export function mergeStates(local, incoming) {
  validateState(incoming);
  const out = structuredClone(local);
  const counts = { added: 0, updated: 0, unchanged: 0, removed: 0 };

  for (const [k, when] of Object.entries(incoming.deleted ?? {})) {
    out.deleted[k] = Math.max(out.deleted[k] ?? 0, when);
  }

  for (const collection of COLLECTIONS) {
    const mine = out[collection];
    for (const [key, theirs] of Object.entries(incoming[collection] ?? {})) {
      const current = mine[key];
      if (!current) { mine[key] = structuredClone(theirs); counts.added++; continue; }
      const chosen = pick(collection, current, theirs);
      if (chosen === current) counts.unchanged++;
      else { mine[key] = structuredClone(theirs); counts.updated++; }
    }
    // Removed on either device, unless it was edited again after the removal.
    for (const [key, record] of Object.entries(mine)) {
      const when = out.deleted[`${collection}/${key}`];
      if (when !== undefined && when >= stamp(record)) { delete mine[key]; counts.removed++; }
    }
  }

  // A transaction's account can only have been removed if it had no transactions, but keep
  // this honest across two devices: an account still in use is put back.
  for (const t of Object.values(out.transactions)) {
    if (!out.accounts[t.account] && incoming.accounts[t.account]) {
      out.accounts[t.account] = structuredClone(incoming.accounts[t.account]);
    }
    if (!out.accounts[t.account]) fail('an account is missing');
  }

  for (const r of incoming.rules) {
    const current = out.rules.find((m) => m.pattern === r.pattern);
    if (!current) out.rules.push(structuredClone(r));
    else if (stamp(r) > stamp(current)) Object.assign(current, structuredClone(r));
  }
  for (const [name, c] of Object.entries(incoming.categories)) {
    if (!Object.hasOwn(out.categories, name)) out.categories[name] = structuredClone(c);
  }
  if ((incoming.goalsUpdatedAt ?? 0) > (out.goalsUpdatedAt ?? 0)) {
    out.goals = structuredClone(incoming.goals);
    out.settings = structuredClone(incoming.settings);
    out.goalsUpdatedAt = incoming.goalsUpdatedAt;
  }
  return { state: migrate(out), counts };
}

// Merge a backup into this device's copy, then re-run the rules so both sides agree.
export function syncFrom(local, incoming, now = Date.now()) {
  const { state, counts } = mergeStates(local, incoming);
  applyRules(state, now);
  pairCardRepayments(state, now);
  return { state, counts };
}
