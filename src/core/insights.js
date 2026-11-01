// Goals and insights: fixed rules and arithmetic, ported from v1's analysis. Each insight
// says whether its figure is "calculated" (exact from your data) or an "estimate" (assumes
// something continues). Nothing here judges or predicts beyond what is written.
import { balancesAsOf, classify, inMonth, lastDayOfMonth, monthsWithData, netWorth, savingsRate, shiftMonth, summarise } from './analysis.js';
import { merchant } from './categorise.js';
import { formatPence as money } from './money.js';

const GRACE_DAYS = 7; // balances up to a week after month end still belong to that month
const RECURRING_TOLERANCE = 0.15;
const DUPLICATE_MIN_PENCE = 500;

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
const daysBetween = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;

const isSpend = (state) => (t) => classify(t, state.categories).kind === 'spend';

// Money-out spend rows from one month up to another, inclusive.
function spendBetween(state, fromYm, toYm) {
  return Object.values(state.transactions).filter((t) => {
    const ym = t.date.slice(0, 7);
    return t.currency === 'GBP' && ym >= fromYm && ym <= toYm && t.amountPence < 0 && isSpend(state)(t);
  });
}

// Summaries of up to the three months before this one, oldest first.
function trailing(state, ym) {
  const from = shiftMonth(ym, -3);
  return monthsWithData(state).filter((m) => m < ym && m >= from)
    .map((m) => summarise(inMonth(state, m), state.categories));
}

// ---------- Leaks ----------

// Same merchant, a steady amount (within 15% of its middle value), in at least 3 of the
// last 6 months, and seen this month or last. More than 2 charges in any month means
// everyday spending, such as a weekly shop, rather than a subscription.
export function recurringCharges(state, ym) {
  const perMerchant = new Map();
  for (const t of spendBetween(state, shiftMonth(ym, -5), ym)) {
    const name = merchant(t.description);
    if (!perMerchant.has(name)) perMerchant.set(name, new Map());
    const months = perMerchant.get(name);
    const key = t.date.slice(0, 7);
    const cell = months.get(key) ?? { pence: 0, count: 0 };
    cell.pence -= t.amountPence;
    cell.count++;
    months.set(key, cell);
  }
  const out = [];
  for (const [name, months] of perMerchant) {
    const cells = [...months.values()];
    if (months.size < 3 || Math.max(...cells.map((c) => c.count)) > 2) continue;
    if (!months.has(ym) && !months.has(shiftMonth(ym, -1))) continue;
    const mid = median(cells.map((c) => c.pence));
    if (mid > 0 && cells.every((c) => Math.abs(c.pence - mid) <= RECURRING_TOLERANCE * mid)) {
      const monthly = Math.trunc(mid);
      out.push({ merchant: name, monthly, months: months.size, annualEstimate: monthly * 12 });
    }
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

// Many small non-essential purchases can add up to more than they feel like.
export function smallPurchases(state, ym) {
  const { smallSpendThresholdPence: limit, smallSpendMinCount: minCount } = state.settings;
  const rows = inMonth(state, ym).filter((t) => {
    const c = classify(t, state.categories);
    return c.kind === 'spend' && t.amountPence < 0 && -t.amountPence <= limit && !state.categories[c.name]?.essential;
  });
  const byMerchant = new Map();
  for (const t of rows) byMerchant.set(merchant(t.description), (byMerchant.get(merchant(t.description)) ?? 0) - t.amountPence);
  return {
    count: rows.length,
    total: rows.reduce((sum, t) => sum - t.amountPence, 0),
    threshold: limit,
    flagged: rows.length >= minCount,
    top: [...byMerchant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, pence]) => ({ merchant: name, pence })),
  };
}

// Same account, merchant and amount within a couple of days. These are only "possible"
// duplicates: two identical purchases can be genuine.
export function duplicateCharges(state, ym) {
  const groups = new Map();
  for (const t of inMonth(state, ym)) {
    if (!isSpend(state)(t) || t.amountPence > -DUPLICATE_MIN_PENCE) continue;
    const key = [t.account, t.amountPence, merchant(t.description)].join('|');
    if (!groups.has(key)) groups.set(key, { account: t.account, amount: -t.amountPence, merchant: merchant(t.description), dates: [] });
    groups.get(key).dates.push(t.date);
  }
  const out = [];
  for (const g of groups.values()) {
    g.dates.sort();
    for (let i = 1; i < g.dates.length; i++) {
      if (daysBetween(g.dates[i - 1], g.dates[i]) <= state.settings.duplicateWindowDays) {
        out.push({ merchant: g.merchant, account: g.account, amount: g.amount, dates: [g.dates[i - 1], g.dates[i]] });
        break;
      }
    }
  }
  return out.slice(0, 10);
}

// At least £75 and three times the typical purchase in its own category, judged against
// the previous 6 months. A category needs 5 past purchases before anything counts as unusual.
export function largePurchases(state, ym) {
  const history = new Map();
  for (const t of spendBetween(state, shiftMonth(ym, -6), shiftMonth(ym, -1))) {
    const { name } = classify(t, state.categories);
    if (!history.has(name)) history.set(name, []);
    history.get(name).push(-t.amountPence);
  }
  const { anomalyMinPence, anomalyMultiple } = state.settings;
  const out = [];
  for (const t of inMonth(state, ym)) {
    const c = classify(t, state.categories);
    const past = history.get(c.name) ?? [];
    if (c.kind !== 'spend' || -t.amountPence < anomalyMinPence || past.length < 5) continue;
    const typical = median(past);
    if (-t.amountPence >= anomalyMultiple * typical) {
      out.push({ date: t.date, merchant: merchant(t.description), amount: -t.amountPence, category: c.name, typical: Math.trunc(typical) });
    }
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 8);
}

// Categories at least 30% and £50 above their average over the previous three months.
export function overspentCategories(state, ym, cur = summarise(inMonth(state, ym), state.categories)) {
  const trail = trailing(state, ym);
  if (!trail.length) return [];
  const { overshootRatio, overshootMinPence } = state.settings;
  const out = [];
  for (const [category, current] of Object.entries(cur.spendByCat)) {
    const average = Math.round(trail.reduce((sum, t) => sum + (t.spendByCat[category] ?? 0), 0) / trail.length);
    if (average && current >= overshootRatio * average && current - average >= overshootMinPence) {
      out.push({ category, current, average, extra: current - average });
    }
  }
  return out.sort((a, b) => b.extra - a.extra);
}

// ---------- Goals ----------

// The UK tax year starts on 6 April.
export function taxYear(iso) {
  const year = Number(iso.slice(0, 4));
  const startYear = iso >= `${year}-04-06` ? year : year - 1;
  return { startYear, start: `${startYear}-04-06`, end: `${startYear + 1}-04-05`, label: `${startYear}/${String(startYear + 1).slice(2)}` };
}

// ISA contributions this tax year against the allowance and your monthly target.
export function isaStatus(state, ym) {
  const monthEnd = lastDayOfMonth(ym);
  const ty = taxYear(monthEnd);
  const rows = Object.values(state.transactions).filter((t) => t.category === 'ISA contribution' && t.currency === 'GBP');
  const fromStatements = rows.filter((t) => t.date >= ty.start && t.date <= monthEnd).reduce((sum, t) => sum - t.amountPence, 0);
  const offset = state.settings.isaPaidBeforeImportByTaxYear[ty.label] ?? 0;
  const allowance = state.settings.isaAllowancePence;
  const paid = fromStatements + offset;
  const [ey, em] = ty.end.split('-').map(Number);
  const [y, m] = monthEnd.split('-').map(Number);
  const monthsLeft = Math.max(0, (ey * 12 + em) - (y * 12 + m) - 1);
  const target = state.goals.monthlyIsaTargetPence;
  const projected = target === null ? null : paid + monthsLeft * target;
  const firstDate = Object.values(state.transactions).map((t) => t.date).sort()[0] ?? null;
  const remaining = allowance - paid;
  return {
    label: ty.label, paid, fromStatements, offset, allowance, remaining, monthsLeft, target, projected,
    overBy: projected === null ? 0 : Math.max(0, projected - allowance),
    neededPerMonth: monthsLeft > 0 && remaining > 0 ? Math.ceil(remaining / monthsLeft) : null,
    // Statements starting after 6 April mean earlier payments are not in the total.
    startsLate: firstDate !== null && firstDate > ty.start && offset === 0 ? firstDate : null,
  };
}

// (Cash minus card balances) divided by average essential spend over up to three months.
export function bufferStatus(state, ym) {
  const latest = balancesAsOf(state, addDays(lastDayOfMonth(ym), GRACE_DAYS));
  let cash = 0, cards = 0;
  for (const [key, b] of Object.entries(latest)) {
    if (state.accounts[key]?.class === 'cash') cash += b.balancePence;
    if (state.accounts[key]?.class === 'credit') cards += b.balancePence;
  }
  const cur = summarise(inMonth(state, ym), state.categories);
  const recent = [cur.essentialSpend, ...trailing(state, ym).slice(-2).map((t) => t.essentialSpend)];
  const essentials = Math.trunc(recent.reduce((a, b) => a + b, 0) / recent.length);
  const available = cash + cards;
  const target = state.goals.bufferMonthsTarget;
  const months = essentials > 0 && Object.keys(latest).length ? available / essentials : null;
  return {
    cash, cards, available, essentials, months, target,
    met: months === null || target === null ? null : months >= target,
    shortfall: months === null || target === null ? null : Math.max(0, Math.trunc(target * essentials - available)),
  };
}

// Net worth at each date a balance was recorded, carrying other accounts forward. Accounts
// only join the total from their first balance, so an early jump can just mean a new entry.
export function netWorthSeries(state) {
  const dates = [...new Set(Object.values(state.balances).map((b) => b.date))].sort();
  return dates.map((date) => ({ date, pence: netWorth(state, date).total }));
}

// A target of null means none is set, so nothing can pass or fail.
export const meets = (value, target, higherIsBetter = true) => {
  if (target === null || target === undefined || value === null) return null;
  return higherIsBetter ? value >= target : value <= target;
};

// The last six months with data, up to this one, for the measures tracked over time.
export function monthlyMeasures(state, ym) {
  return monthsWithData(state).filter((m) => m <= ym).slice(-6).map((month) => {
    const s = summarise(inMonth(state, month), state.categories);
    return { month, isa: s.savedByCat['ISA contribution'] ?? 0, rate: savingsRate(s), spend: s.spend };
  });
}

// ---------- Insights ----------

const pct = (share) => `${Math.round(share * 100)}%`;

// One month's rule-based insights, most useful first. Each has a title, a detail line, any
// list items, and a label saying whether the figure is calculated or an estimate.
export function buildInsights(state, ym) {
  const out = [];
  const add = (title, detail, label = 'calculated', items = []) => out.push({ title, detail, label, items });
  const cur = summarise(inMonth(state, ym), state.categories);
  const prevYm = shiftMonth(ym, -1);
  const hasPrev = monthsWithData(state).includes(prevYm);
  const prev = hasPrev ? summarise(inMonth(state, prevYm), state.categories) : null;

  const moved = cur.spend + cur.income;
  if (moved > 0 && cur.uncatPence / moved > 0.1) {
    add('Category figures are incomplete', `${pct(cur.uncatPence / moved)} of the money moved has no category yet. Choose categories on Import.`);
  }

  const top = Object.entries(cur.spendByCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) {
    add('Biggest categories', `${money(top.reduce((sum, [, p]) => sum + p, 0))} across your top ${top.length}.`, 'calculated',
      top.map(([name, p]) => `${name}: ${money(p)}${cur.spend > 0 ? ` (${pct(p / cur.spend)})` : ''}`));
  }

  if (prev) {
    const diff = cur.spend - prev.spend;
    const changes = [...new Set([...Object.keys(cur.spendByCat), ...Object.keys(prev.spendByCat)])]
      .map((c) => ({ c, change: (cur.spendByCat[c] ?? 0) - (prev.spendByCat[c] ?? 0) }))
      .filter((x) => x.change !== 0)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3);
    add('Change on last month',
      diff === 0 ? 'Spending was the same as last month.' : `Spending was ${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than last month.`,
      'calculated', changes.map((x) => `${x.change > 0 ? '▲' : '▼'} ${x.c}: ${money(Math.abs(x.change))} ${x.change > 0 ? 'more' : 'less'}`));
  }

  const over = overspentCategories(state, ym, cur);
  if (over.length) {
    add('Above your recent average', 'At least 30% and £50 above the average of the previous months.', 'calculated',
      over.map((o) => `${o.category}: ${money(o.current)}, usually ${money(o.average)}`));
  }

  const recurring = recurringCharges(state, ym);
  if (recurring.length) {
    const monthly = recurring.reduce((sum, r) => sum + r.monthly, 0);
    add('Recurring charges', `${recurring.length} found, about ${money(monthly)} a month or ${money(monthly * 12)} a year.`, 'estimate',
      recurring.map((r) => `${r.merchant}: ${money(r.monthly)} a month, ${money(r.annualEstimate)} a year`));
  }

  const dups = duplicateCharges(state, ym);
  if (dups.length) {
    add('Possible duplicate charges', 'Same merchant and amount within two days. They may be genuine, so check them.', 'calculated',
      dups.map((d) => `${d.merchant}: ${money(d.amount)} on ${d.dates[0]} and ${d.dates[1]}`));
  }

  const large = largePurchases(state, ym);
  if (large.length) {
    add('Unusually large purchases', 'At least £75 and three times the usual purchase in that category.', 'calculated',
      large.map((a) => `${a.merchant}: ${money(a.amount)}, usually ${money(a.typical)} in ${a.category}`));
  }

  const fees = cur.spendByCat['Fees & interest'] ?? 0;
  if (fees > 0) add('Fees and interest', `${money(fees)} this month. Check whether any could be avoided.`);

  const small = smallPurchases(state, ym);
  if (small.flagged) {
    add('Small purchases add up', `${small.count} non-essential purchases of ${money(small.threshold)} or less came to ${money(small.total)}.`, 'calculated',
      small.top.map((t) => `${t.merchant}: ${money(t.pence)}`));
  }

  const buffer = bufferStatus(state, ym);
  if (buffer.months !== null) {
    const base = `Cash after cards covers ${buffer.months.toFixed(1)} months of essential spending, at ${money(buffer.essentials)} a month.`;
    add(buffer.shortfall ? 'Cash buffer shortfall' : 'Cash buffer',
      buffer.shortfall ? `${base} That is ${money(buffer.shortfall)} short of your ${buffer.target}-month target.` : base);
  }

  const isa = isaStatus(state, ym);
  if (isa.overBy > 0) {
    add('ISA allowance pace', `At your monthly target you would pay in ${money(isa.projected)} by 5 April, ${money(isa.overBy)} over the allowance.`, 'estimate');
  } else if (isa.projected !== null) {
    add('ISA allowance pace', `At your monthly target you would pay in ${money(isa.projected)} by 5 April, leaving ${money(isa.allowance - isa.projected)} of the allowance unused.`, 'estimate');
  } else {
    add('ISA allowance pace', `${money(isa.paid)} paid in ${isa.label}, with ${money(isa.remaining)} of the allowance left.`);
  }
  return out;
}
