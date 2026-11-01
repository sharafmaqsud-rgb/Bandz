// The three financial statements, applied to a person. Everything is calculated from your
// statements and balances, and each one states what it cannot see rather than hiding a gap.
import { balancesAsOf, classify, lastDayOfMonth, monthsWithData, savingsRate, summarise } from './analysis.js';
import { taxYear } from './insights.js';

const GRACE_DAYS = 7;
const STALE_DAYS = 35;
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;

const MONTH_NAME = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// The months and tax years you have data for, newest first.
export function availablePeriods(state) {
  const months = monthsWithData(state);
  const periods = [];
  const years = [...new Set(months.map((m) => taxYear(`${m}-15`).startYear))].sort((a, b) => b - a);
  for (const m of [...months].reverse()) {
    periods.push({ id: `m:${m}`, kind: 'month', label: MONTH_NAME.format(new Date(`${m}-01T00:00:00Z`)), start: `${m}-01`, end: lastDayOfMonth(m) });
  }
  for (const y of years) {
    const ty = taxYear(`${y}-06-01`);
    periods.push({ id: `t:${y}`, kind: 'taxYear', label: `Tax year ${ty.label}`, start: ty.start, end: ty.end });
  }
  return periods;
}

const inPeriod = (state, { start, end }) => Object.values(state.transactions)
  .filter((t) => t.currency === 'GBP' && t.date >= start && t.date <= end);

const toLines = (byCat) => Object.entries(byCat)
  .map(([name, pence]) => ({ name, pence }))
  .sort((a, b) => b.pence - a.pence);

// ---------- Income statement ----------

// What came in, what was spent, and what that left. Saving is shown after the surplus,
// because it is a use of money rather than a cost.
export function incomeStatement(state, period) {
  const s = summarise(inPeriod(state, period), state.categories);
  const spend = toLines(s.spendByCat);
  const isEssential = (l) => Boolean(state.categories[l.name]?.essential);
  const surplus = s.income - s.spend;
  return {
    income: toLines(s.incomeByCat),
    totalIncome: s.income,
    essential: spend.filter(isEssential),
    totalEssential: s.essentialSpend,
    other: spend.filter((l) => !isEssential(l)),
    totalOther: s.spend - s.essentialSpend,
    totalSpend: s.spend,
    surplus,
    saved: toLines(s.savedByCat),
    totalSaved: s.saved,
    leftOver: surplus - s.saved,
    savingsRate: savingsRate(s),
    uncategorisedCount: s.uncatCount,
  };
}

// ---------- Balance sheet ----------

const ASSET_GROUPS = [['Cash', ['cash']], ['Investments', ['investment', 'crypto']], ['Pensions', ['pension']]];
const DEBT_GROUPS = [['Credit cards', ['credit']]];

// What you own and owe on a date, using each account's latest balance up to then. Debts are
// shown as positive amounts owed. Compared with the end of the period before when possible.
export function balanceSheet(state, period) {
  const asOf = addDays(period.end, GRACE_DAYS);
  const latest = balancesAsOf(state, asOf);
  const before = balancesAsOf(state, addDays(period.start, -1 + GRACE_DAYS));
  const lines = (classes) => Object.entries(state.accounts)
    .filter(([, a]) => classes.includes(a.class))
    .map(([key, a]) => {
      const b = latest[key];
      return {
        key, name: a.name, pence: b ? Math.abs(b.balancePence) * Math.sign(b.balancePence) : null, date: b?.date ?? null,
        stale: b ? daysBetween(b.date, asOf) > STALE_DAYS : false,
      };
    });
  const group = ([name, classes], sign) => {
    const items = lines(classes).map((l) => ({ ...l, pence: l.pence === null ? null : l.pence * sign }));
    return { name, items, total: items.reduce((t, l) => t + (l.pence ?? 0), 0) };
  };
  const assets = ASSET_GROUPS.map((g) => group(g, 1));
  const debts = DEBT_GROUPS.map((g) => group(g, -1));
  const totalAssets = assets.reduce((t, g) => t + g.total, 0);
  const totalDebts = debts.reduce((t, g) => t + g.total, 0);
  const netWorth = totalAssets - totalDebts;

  // The change compares like with like: only accounts with a balance at both ends. An account
  // entered for the first time is not a rise in your wealth.
  const compared = Object.keys(latest).filter((k) => before[k]);
  const moved = compared.some((k) => before[k].date !== latest[k].date);
  const change = moved ? compared.reduce((t, k) => t + latest[k].balancePence - before[k].balancePence, 0) : null;

  // Investment growth is an estimate: the rise in value not explained by money paid in.
  const growing = Object.entries(state.accounts).filter(([, a]) => ['investment', 'crypto', 'pension'].includes(a.class)).map(([k]) => k);
  const measured = growing.filter((k) => latest[k] && before[k] && latest[k].date !== before[k].date);
  let growthEstimate = null;
  if (measured.length) {
    const rise = measured.reduce((t, k) => t + latest[k].balancePence - before[k].balancePence, 0);
    const paidIn = inPeriod(state, period).filter((t) => classify(t, state.categories).kind === 'saving').reduce((sum, t) => sum - t.amountPence, 0);
    growthEstimate = rise - paidIn;
  }

  return {
    asOf, assets, debts, totalAssets, totalDebts, netWorth,
    missing: [...assets, ...debts].flatMap((g) => g.items).filter((l) => l.pence === null).map((l) => l.name),
    stale: [...assets, ...debts].flatMap((g) => g.items).filter((l) => l.stale).map((l) => l.name),
    change,
    growthEstimate,
  };
}

// ---------- Cash flow ----------

// Actual money through the accounts you import statements for. Card purchases are not cash
// until the card is paid, so this differs from spending, and the card lines show by how much.
export function cashFlow(state, period) {
  const cashKeys = Object.entries(state.accounts).filter(([, a]) => a.class === 'cash' && a.hasStatements).map(([k]) => k);
  const all = inPeriod(state, period);
  const cash = all.filter((t) => cashKeys.includes(t.account));
  const sum = (rows) => rows.reduce((t, r) => t + r.amountPence, 0);
  const ofKind = (kind) => cash.filter((t) => classify(t, state.categories).kind === kind);
  const isRepayment = (t) => t.category === 'Card repayment';
  const transfers = ofKind('transfer');

  const received = sum(ofKind('income'));
  const paid = sum(ofKind('spend'));
  const cardsPaid = sum(transfers.filter(isRepayment));
  const operating = received + paid + cardsPaid;
  const investing = sum(ofKind('saving'));
  const moved = sum(transfers.filter((t) => !isRepayment(t)));
  const netCash = operating + investing + moved;

  // Opening and closing come from the balance printed on each statement row. Each account's
  // rows keep the order they were printed in, so only the date needs sorting.
  let opening = 0, closing = 0, known = cash.length > 0;
  for (const key of cashKeys) {
    const rows = cash.filter((t) => t.account === key).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) continue;
    const first = rows[0], last = rows[rows.length - 1];
    if (first.balancePence === null || first.balancePence === undefined || last.balancePence === null || last.balancePence === undefined) {
      known = false;
      continue;
    }
    opening += first.balancePence - first.amountPence;
    closing += last.balancePence;
  }

  const cards = all.filter((t) => state.accounts[t.account].class === 'credit');
  const cardSpend = -sum(cards.filter((t) => classify(t, state.categories).kind === 'spend'));

  return {
    received, paid: -paid, cardsPaid: -cardsPaid, operating, investing: -investing, moved: -moved, netCash,
    opening: known ? opening : null,
    closing: known ? closing : null,
    difference: known ? closing - (opening + netCash) : null,
    reconciled: known ? closing === opening + netCash : null,
    cardSpend,
    accounts: cashKeys.filter((k) => cash.some((t) => t.account === k)).map((k) => state.accounts[k].name),
  };
}
