// The numbers. Everything here is pure arithmetic on the data, and the screens only display
// the results. v1's goals and insights analysis arrives with those screens in Phase 3.
import { merchant } from './categorise.js';

// Uncategorised money out counts as spend and money in as income, and both are counted
// separately so they cannot hide.
export function classify(tx, categories) {
  const c = categories[tx.category];
  if (c) return { kind: c.kind, name: tx.category };
  return tx.amountPence < 0
    ? { kind: 'spend', name: 'Uncategorised' }
    : { kind: 'income', name: 'Uncategorised income' };
}

// GBP transactions in a month ('2026-10'), newest categories included as they appear.
export const inMonth = (state, ym) => Object.values(state.transactions)
  .filter((t) => t.currency === 'GBP' && t.date.startsWith(`${ym}-`));

export function summarise(rows, categories) {
  const s = {
    income: 0, spend: 0, saved: 0, essentialSpend: 0,
    spendByCat: {}, incomeByCat: {}, savedByCat: {},
    uncatCount: 0, uncatPence: 0, count: rows.length,
  };
  const addTo = (bucket, name, pence) => { bucket[name] = (bucket[name] ?? 0) + pence; };
  for (const tx of rows) {
    const { kind, name } = classify(tx, categories);
    const a = tx.amountPence;
    // A refund is money in against a spend category, so it reduces spend rather than
    // counting as income. Transfers fall through all of these, so nothing double counts.
    if (kind === 'income') { s.income += a; addTo(s.incomeByCat, name, a); }
    else if (kind === 'spend') {
      s.spend -= a;
      addTo(s.spendByCat, name, -a);
      if (categories[name]?.essential) s.essentialSpend -= a;
    } else if (kind === 'saving') { s.saved -= a; addTo(s.savedByCat, name, -a); }
    if (name.startsWith('Uncategorised')) { s.uncatCount++; s.uncatPence += Math.abs(a); }
  }
  return s;
}

// ---------- Months ----------

export const monthsWithData = (state) => [...new Set(Object.values(state.transactions)
  .filter((t) => t.currency === 'GBP').map((t) => t.date.slice(0, 7)))].sort();

export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function lastDayOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

// Saved as a share of income. Payroll pension contributions never reach your bank, so
// they are not included. null when there is no income to divide by.
export const savingsRate = (s) => (s.income > 0 ? s.saved / s.income : null);

// Income not accounted for by spending or saving. Negative means more went out than came in.
export const leftOver = (s) => s.income - s.spend - s.saved;

// Each spend category with its change on the previous month, biggest first. change is
// null when the previous month has no data, so a first month never looks like a rise.
export function categoryChanges(cur, prev) {
  return Object.entries(cur.spendByCat)
    .map(([name, pence]) => {
      const before = prev ? prev.spendByCat[name] ?? 0 : null;
      return { name, pence, change: before === null ? null : pence - before };
    })
    .sort((a, b) => b.pence - a.pence);
}

// ---------- Balances and net worth ----------

// Latest balance per account on or before asOf, carried forward from its last entry.
export function balancesAsOf(state, asOf = '9999-12-31') {
  const out = {};
  const records = Object.values(state.balances).filter((b) => b.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const b of records) out[b.account] = b;
  return out;
}

const GROUP_OF_CLASS = { cash: 'cash', investment: 'investments', crypto: 'investments', pension: 'pension', credit: 'cards' };

// Everything you own minus what you owe. Card balances are stored negative, so simply
// adding every balance gives the right answer. Accounts with no balance yet are listed
// in missing rather than silently counted as zero.
export function netWorth(state, asOf) {
  const latest = balancesAsOf(state, asOf);
  const groups = { cash: 0, investments: 0, pension: 0, cards: 0 };
  let total = 0;
  const missing = [];
  for (const [key, account] of Object.entries(state.accounts)) {
    const b = latest[key];
    if (!b) { missing.push(key); continue; }
    groups[GROUP_OF_CLASS[account.class]] += b.balancePence;
    total += b.balancePence;
  }
  return { total, groups, missing, latest };
}

// ---------- Data quality ----------

// Merchants with uncategorised rows, biggest first, so one choice can settle many rows.
export function uncategorisedMerchants(state) {
  const groups = new Map();
  for (const t of Object.values(state.transactions)) {
    if (t.category) continue;
    const name = merchant(t.description);
    const g = groups.get(name) ?? { merchant: name, count: 0, pence: 0 };
    g.count++;
    g.pence += Math.abs(t.amountPence);
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.pence - a.pence);
}

// Statement accounts whose data stops before the end of this month, with where it stops.
// Card statements rarely end on the last day, so a recent month is often incomplete.
export function monthGaps(state, ym) {
  const end = lastDayOfMonth(ym);
  const gaps = [];
  for (const [key, account] of Object.entries(state.accounts)) {
    if (!account.hasStatements) continue;
    const dates = Object.values(state.statements).filter((s) => s.account === key).map((s) => s.date).sort();
    const through = dates[dates.length - 1] ?? null;
    if (!through || through < end) gaps.push({ account: key, name: account.name, through });
  }
  return gaps;
}
