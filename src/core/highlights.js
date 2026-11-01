// The story of a period: what went well, what is worth watching and what to do next, in plain
// sentences. These are fixed rules and arithmetic, with no model, and every figure says
// whether it is calculated or an estimate. A target you have not set is never judged against.
import { classify, inMonth, lastDayOfMonth, monthsWithData, netWorth, shiftMonth, summarise } from './analysis.js';
import { merchant, pairCardRepayments } from './categorise.js';
import { bufferStatus, duplicateCharges, isaStatus, largePurchases, overspentCategories, recurringCharges, smallPurchases } from './insights.js';
import { reviewCount, reviewQueue } from './review.js';
import { balanceSheet, incomeStatement } from './statements.js';

// Whole pounds read better in a sentence. Exact figures are in the statements.
export const pounds = (pence) => {
  const whole = Math.round(Math.abs(pence) / 100).toString().replace(/\B(?=(\d{3})+$)/g, ',');
  return `${pence < 0 ? '-' : ''}£${whole}`;
};
const pct = (share) => `${Math.round(share * 100)}%`;
const MAX_ITEMS = 4;

const lastMonthIn = (state, period) => monthsWithData(state)
  .filter((m) => m >= period.start.slice(0, 7) && m <= period.end.slice(0, 7)).pop() ?? null;

// Income, spending and saving for the last few months, oldest first.
export function monthlySeries(state, upTo, count = 6) {
  return monthsWithData(state).filter((m) => m <= upTo).slice(-count).map((month) => {
    const s = summarise(inMonth(state, month), state.categories);
    return { month, income: s.income, spend: s.spend, saved: s.saved };
  });
}

// Spending built up day by day, against last month, with a projection while a month is
// still incomplete. The projection simply assumes the same daily pace, so it is an estimate.
export function spendingPace(state, ym) {
  const days = Number(lastDayOfMonth(ym).slice(8));
  const running = (month) => {
    const byDay = Array(days).fill(0);
    for (const t of inMonth(state, month)) {
      if (classify(t, state.categories).kind !== 'spend') continue;
      const d = Number(t.date.slice(8)) - 1;
      if (d < days) byDay[d] -= t.amountPence;
    }
    let total = 0;
    return byDay.map((v) => (total += v));
  };
  const rows = inMonth(state, ym).map((t) => Number(t.date.slice(8)));
  const through = rows.length ? Math.max(...rows) : 0;
  const current = running(ym).slice(0, through);
  const hasPrevious = monthsWithData(state).includes(shiftMonth(ym, -1));
  const spent = current[current.length - 1] ?? 0;
  return {
    days, through, current,
    previous: hasPrevious ? running(shiftMonth(ym, -1)) : null,
    spent,
    projected: through > 0 && through < days ? Math.round((spent / through) * days) : null,
  };
}

export function topMerchants(state, period, count = 5) {
  const totals = new Map();
  for (const t of Object.values(state.transactions)) {
    if (t.currency !== 'GBP' || t.date < period.start || t.date > period.end) continue;
    if (classify(t, state.categories).kind !== 'spend') continue;
    const name = merchant(t.description);
    totals.set(name, (totals.get(name) ?? 0) - t.amountPence);
  }
  return [...totals].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]).slice(0, count)
    .map(([name, pence]) => ({ name, pence }));
}

export function buildHighlights(state, period) {
  const ym = lastMonthIn(state, period);
  const i = incomeStatement(state, period);
  const wins = [], watch = [], next = [];
  const item = (list, text, label = 'calculated') => list.push({ text, label });

  const isMonth = period.kind === 'month';
  const headline = i.totalIncome === 0 && i.totalSpend === 0
    ? `No activity to report for ${period.label}.`
    : `${period.label}: ${pounds(i.totalIncome)} came in, you spent ${pounds(i.totalSpend)} and put ${pounds(i.totalSaved)} towards saving and investing, leaving ${pounds(i.leftOver)}.`;

  const prevYm = isMonth ? shiftMonth(ym ?? period.start.slice(0, 7), -1) : null;
  const prev = prevYm && monthsWithData(state).includes(prevYm)
    ? summarise(inMonth(state, prevYm), state.categories) : null;
  const prevRate = prev && prev.income > 0 ? prev.saved / prev.income : null;

  if (i.savingsRate !== null && i.totalSaved > 0) {
    const target = state.goals.savingsRateTarget;
    const compare = prevRate === null ? '' : i.savingsRate >= prevRate ? `, up from ${pct(prevRate)} last month` : `, down from ${pct(prevRate)} last month`;
    const text = `You saved or invested ${pct(i.savingsRate)} of your income${compare}.`;
    if (target !== null && i.savingsRate < target) item(watch, `${text} Your target is ${pct(target)}.`);
    else if (prevRate !== null && i.savingsRate < prevRate) item(watch, text);
    else item(wins, text);
  }
  if (prev) {
    const diff = i.totalSpend - prev.spend;
    if (diff < 0) item(wins, `You spent ${pounds(-diff)} less than last month.`);
    else if (diff > 0 && prev.spend > 0 && diff / prev.spend >= 0.1) item(watch, `You spent ${pounds(diff)} more than last month, a rise of ${pct(diff / prev.spend)}.`);
  }
  if (i.leftOver < 0) item(watch, `More went out than came in, by ${pounds(-i.leftOver)}.`);
  else if (i.totalIncome > 0 && i.leftOver > 0) item(wins, `Your income covered everything, with ${pounds(i.leftOver)} left over.`);

  const b = balanceSheet(state, period);
  if (b.change !== null && b.change > 0) item(wins, `Your net worth rose by ${pounds(b.change)}.`);
  if (b.change !== null && b.change < 0) item(watch, `Your net worth fell by ${pounds(-b.change)}.`);
  if (b.growthEstimate !== null && b.growthEstimate > 0) item(wins, `Your investments grew by about ${pounds(b.growthEstimate)}, beyond what you paid in.`, 'estimate');

  if (ym) {
    const m = summarise(inMonth(state, ym), state.categories);
    const isaTarget = state.goals.monthlyIsaTargetPence;
    const paidIn = m.savedByCat['ISA contribution'] ?? 0;
    if (isaTarget !== null && isMonth) {
      if (paidIn >= isaTarget) item(wins, `You hit your ISA target with ${pounds(paidIn)} paid in.`);
      else item(watch, `You paid ${pounds(paidIn)} into your ISA against your ${pounds(isaTarget)} target.`);
    }
    for (const o of overspentCategories(state, ym, m).slice(0, 2)) {
      item(watch, `${o.category} came to ${pounds(o.current)}, against a usual ${pounds(o.average)}.`);
    }
    const dups = duplicateCharges(state, ym);
    if (dups.length) item(watch, `${dups.length === 1 ? 'A possible duplicate charge' : `${dups.length} possible duplicate charges`}, including ${pounds(dups[0].amount)} at ${dups[0].merchant}.`);
    const large = largePurchases(state, ym);
    if (large.length) item(watch, `${pounds(large[0].amount)} at ${large[0].merchant} was far above your usual ${large[0].category} purchase.`);
    const fees = m.spendByCat['Fees & interest'] ?? 0;
    if (fees > 0) item(watch, `Fees and interest cost you ${pounds(fees)}.`);

    const recurring = recurringCharges(state, ym);
    if (recurring.length) {
      const monthly = recurring.reduce((t, r) => t + r.monthly, 0);
      item(next, `Review your ${recurring.length} recurring ${recurring.length === 1 ? 'charge' : 'charges'}, worth about ${pounds(monthly * 12)} a year. The largest is ${recurring[0].merchant}, at ${pounds(recurring[0].annualEstimate)}.`, 'estimate');
    }
    const small = smallPurchases(state, ym);
    if (small.flagged) item(next, `${small.count} small purchases came to ${pounds(small.total)}. Halving these would keep about ${pounds(small.total * 6)} a year.`, 'estimate');
    const isa = isaStatus(state, ym);
    if (isa.overBy > 0) item(watch, `At your monthly target you would go ${pounds(isa.overBy)} over your ISA allowance by 5 April.`, 'estimate');
    else if (isa.neededPerMonth !== null) item(next, `${pounds(isa.remaining)} of your ISA allowance is left, or ${pounds(isa.neededPerMonth)} a month to use it all by 5 April.`);
    const buffer = bufferStatus(state, ym);
    if (buffer.shortfall > 0) item(next, `Add ${pounds(buffer.shortfall)} to reach your ${buffer.target}-month cash buffer.`);
    else if (buffer.met) item(wins, `Your cash buffer covers ${buffer.months.toFixed(1)} months of essentials.`);
  }

  const asks = reviewCount(reviewQueue(state));
  if (asks) item(next, `Check ${asks} ${asks === 1 ? 'item' : 'items'} on Import, so these figures are as accurate as possible.`);
  const unpaired = pairCardRepayments(structuredClone(state)).length;
  if (unpaired) item(next, `${unpaired} card ${unpaired === 1 ? 'payment has' : 'payments have'} no match yet. Import that month's current account statement to avoid counting it twice.`);
  if (b.missing.length) item(next, `Add balances for ${b.missing.join(', ')}.`);

  return {
    headline,
    wins: wins.slice(0, MAX_ITEMS),
    watch: watch.slice(0, MAX_ITEMS),
    next: next.slice(0, MAX_ITEMS),
    kpis: {
      income: i.totalIncome, spend: i.totalSpend, saved: i.totalSaved, leftOver: i.leftOver,
      savingsRate: i.savingsRate, netWorth: b.netWorth,
    },
    series: ym ? monthlySeries(state, ym) : [],
    netWorthNow: netWorth(state).total,
  };
}
