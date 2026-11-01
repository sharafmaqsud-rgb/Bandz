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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    if (!state.accounts[r.account]) throw new Error(`Unknown account '${r.account}'`);
    if (!ISO_DATE.test(r.date)) throw new Error(`Date is not ISO: '${r.date}'`);
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
  if (!state.accounts[account]) throw new Error(`Unknown account '${account}'`);
  if (!ISO_DATE.test(date)) throw new Error(`Date is not ISO: '${date}'`);
  const typed = parseMoney(text);
  if (typed === null) throw new FormatError('Balance is blank');
  const balancePence = state.accounts[account].class === 'credit' ? -typed : typed;
  state.balances[`${date}|${account}`] = { date, account, balancePence, updatedAt: now };
}

// Add or replace a rule; there is only ever one rule per pattern.
export function setRule(state, pattern, category, now = Date.now()) {
  const pat = pattern.trim().toUpperCase();
  if (!pat) throw new Error('Rule pattern is blank');
  if (!state.categories[category]) throw new Error(`Unknown category '${category}'`);
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
    if (!(name in state.goals)) throw new Error(`Unknown goal '${name}'`);
    state.goals[name] = value;
  }
}
