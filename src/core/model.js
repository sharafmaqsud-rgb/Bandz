// The data model: one plain JSON-friendly object holding everything the app knows.
// It lives in memory while the app is open and is saved whole, which is simple and
// fast at this size (a few thousand rows a year) and makes encryption and backup easy.
//
// Records carry updatedAt (ms since epoch) so the phone and laptop copies can later be
// merged record by record, with the newest edit winning. Nothing here does any I/O.
import { ACCOUNTS, CATEGORIES, GOALS, RULES, SETTINGS } from './defaults.js';
import { parseMoney, FormatError } from './money.js';

export const SCHEMA_VERSION = 1;
export const KINDS = ['income', 'spend', 'saving', 'transfer'];

// A date that could not be displayed would break a screen every time it opened.
export const isIsoDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
// Own keys only: a plain object also answers to names such as 'constructor'.
const known = (obj, key) => Object.hasOwn(obj, key);

export function createState(now = Date.now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    accounts: structuredClone(ACCOUNTS),
    categories: structuredClone(CATEGORIES),
    rules: RULES.map((r) => ({ ...r, updatedAt: now })),
    settings: structuredClone(SETTINGS),
    goals: structuredClone(GOALS),
    transactions: {}, // fingerprint key -> transaction
    balances: {},     // 'date|account' -> balance record
    statements: {},   // 'account|date' -> which statements have been imported
    deleted: {},      // 'accounts/key' -> when it was removed, so a sync does not bring it back
    goalsUpdatedAt: 0,
    meta: { lastBackupAt: null }, // about this device only, and never synced
  };
}

// Insert parsed rows; returns { inserted, skipped }. Call once per imported file.
//
// Two genuine purchases can look identical (same day, shop, amount), so the fingerprint
// includes a running count of identical rows within the file. Re-importing the same or
// an overlapping file then adds nothing, while a file's true repeats are all kept.
export function addTransactions(state, rows, now = Date.now()) {
  const seen = new Map();
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    if (!known(state.accounts, r.account)) throw new Error(`Unknown account '${r.account}'`);
    if (!isIsoDate(r.date)) throw new Error(`Date is not ISO: '${r.date}'`);
    if (!Number.isInteger(r.amountPence)) throw new Error(`Amount is not whole pence: '${r.amountPence}'`);
    const currency = r.currency ?? 'GBP';
    const base = [r.account, r.date, r.description, r.amountPence, currency].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = `${base}|${n}`;
    if (state.transactions[key]) { skipped++; continue; }
    state.transactions[key] = {
      key,
      account: r.account,
      date: r.date,
      description: r.description,
      amountPence: r.amountPence,
      currency,
      balancePence: r.balancePence ?? null,
      category: null,   // null = not categorised yet
      catSource: null,  // 'rule' or 'manual'
      sourceFile: r.sourceFile ?? null,
      updatedAt: now,
    };
    inserted++;
  }
  return { inserted, skipped };
}

// Record a balance as a person would type it. Credit cards: enter what you OWE as a
// positive number; it is stored negative, because it reduces net worth. A negative
// entry on a card means it is in credit. Other accounts keep the sign as typed, so an
// overdraft can be recorded (v1 could not).
export function setBalance(state, date, account, text, now = Date.now()) {
  if (!known(state.accounts, account)) throw new Error(`Unknown account '${account}'`);
  if (!isIsoDate(date)) throw new Error(`Date is not ISO: '${date}'`);
  const typed = parseMoney(text);
  if (typed === null) throw new FormatError('Balance is blank');
  const balancePence = state.accounts[account].class === 'credit' ? -typed : typed;
  state.balances[`${date}|${account}`] = { date, account, balancePence, updatedAt: now };
}

// Add an account of your own, such as another pension provider. Its name stays in your
// data and never in the code.
export function addAccount(state, name, accountClass, now = Date.now()) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('Please enter a name');
  const exists = Object.values(state.accounts).some((a) => a.name.toLowerCase() === clean.toLowerCase());
  if (exists) throw new Error(`There is already an account called ${clean}`);
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account';
  let key = `${accountClass}-${slug}`;
  for (let n = 2; state.accounts[key]; n++) key = `${accountClass}-${slug}-${n}`;
  state.accounts[key] = { name: clean, class: accountClass, hasStatements: false, isIsa: false, updatedAt: now };
  return key;
}

export function renameAccount(state, key, name, now = Date.now()) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('Please enter a name');
  const taken = Object.entries(state.accounts).some(([k, a]) => k !== key && a.name.toLowerCase() === clean.toLowerCase());
  if (taken) throw new Error(`There is already an account called ${clean}`);
  Object.assign(state.accounts[key], { name: clean, updatedAt: now });
}

// Remove an account and its balances. An account with transactions is refused, because
// removing it would rewrite past months.
export function removeAccount(state, key, now = Date.now()) {
  if (Object.values(state.transactions).some((t) => t.account === key)) {
    throw new Error('This account has transactions, so it cannot be removed');
  }
  delete state.accounts[key];
  state.deleted[`accounts/${key}`] = now;
  for (const [k, b] of Object.entries(state.balances)) {
    if (b.account === key) { delete state.balances[k]; state.deleted[`balances/${k}`] = now; }
  }
}

// Bring data saved by an earlier version of the app up to date with new fields.
export function migrate(state) {
  state.goals = { ...GOALS, ...state.goals };
  state.settings = { ...SETTINGS, ...state.settings };
  state.statements ??= {};
  state.deleted ??= {};
  state.goalsUpdatedAt ??= 0;
  state.meta ??= { lastBackupAt: null };
  return state;
}

// Add or replace a rule; there is only ever one rule per pattern.
export function setRule(state, pattern, category, now = Date.now()) {
  const pat = pattern.trim().toUpperCase();
  if (!pat) throw new Error('Rule pattern is blank');
  if (!known(state.categories, category)) throw new Error(`Unknown category '${category}'`);
  const existing = state.rules.find((r) => r.pattern === pat);
  if (existing) Object.assign(existing, { category, updatedAt: now });
  else state.rules.push({ pattern: pat, category, updatedAt: now });
}

// Load the private starting file (shape: see seed.example.json). Unknown goal names
// are rejected so a typo cannot silently leave a target unset.
export function applySeed(state, seed, now = Date.now()) {
  for (const b of seed.balances ?? []) setBalance(state, b.date, b.account, b.balance, now);
  for (const r of seed.rules ?? []) setRule(state, r.pattern, r.category, now);
  for (const [name, value] of Object.entries(seed.goals ?? {})) {
    if (!known(state.goals, name)) throw new Error(`Unknown goal '${name}'`);
    if (value !== null && !(Number.isFinite(value) && value >= 0)) throw new Error(`Goal '${name}' must be a number`);
    state.goals[name] = value;
    state.goalsUpdatedAt = now;
  }
}
