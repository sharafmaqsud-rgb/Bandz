// The Excel report: the three statements plus every transaction behind them. Totals and
// category lines are live formulas over the Transactions sheet, so you can check or change
// anything in Excel and the statements follow.
import { classify } from './analysis.js';
import { balanceSheet, cashFlow, incomeStatement } from './statements.js';
import { buildXlsx } from './xlsx.js';

const pounds = (pence) => (pence ?? 0) / 100;
const m = (pence, style = 'money') => ({ v: pounds(pence), style });
const sumF = (from, to, pence, style = 'moneyTotal') => ({ f: `SUM(B${from}:B${to})`, v: pounds(pence), style });
// Excel counts days from 30 December 1899.
const excelDate = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000 + 25569;
const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;

const TX_SHEET = 'Transactions';

function transactionsSheet(state, period) {
  const rows = Object.values(state.transactions)
    .filter((t) => t.currency === 'GBP' && t.date >= period.start && t.date <= period.end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const body = rows.map((t) => {
    const c = classify(t, state.categories);
    return [{ v: excelDate(t.date), style: 'date' }, t.description, state.accounts[t.account].name, c.name, c.kind, m(t.amountPence), t.reason ?? ''];
  });
  return {
    name: TX_SHEET,
    frozenRows: 1,
    widths: [13, 44, 28, 26, 10, 13, 42],
    rows: [['Date', 'Description', 'Account', 'Category', 'Kind', 'Amount', 'Why it was filed here'].map((v) => ({ v, style: 'section' })), ...body],
  };
}

// A category line is the sum of that category's rows on the Transactions sheet, with money
// out shown as a positive amount, so it can be traced and recalculated.
const catLine = (name, pence, sign) => ({
  f: `${sign < 0 ? '-' : ''}SUMIFS(${TX_SHEET}!F:F,${TX_SHEET}!D:D,${quote(name)})`, v: pounds(pence), style: 'money',
});

function incomeSheet(state, period) {
  const s = incomeStatement(state, period);
  const rows = [[{ v: 'Income statement', style: 'title' }], [{ v: `${period.label}. All figures calculated.`, style: 'note' }], []];
  const block = (title, lines, total, sign, totalLabel) => {
    rows.push([{ v: title, style: 'section' }, { v: '', style: 'section' }]);
    const from = rows.length + 1;
    for (const l of lines) rows.push([l.name, catLine(l.name, l.pence, sign)]);
    const to = rows.length;
    const at = rows.length + 1;
    rows.push([{ v: totalLabel, style: 'bold' }, lines.length ? sumF(from, to, total) : m(total, 'moneyTotal')]);
    rows.push([]);
    return at;
  };
  const income = block('Income', s.income, s.totalIncome, 1, 'Total income');
  const ess = block('Essential spending', s.essential, s.totalEssential, -1, 'Total essential spending');
  const other = block('Other spending', s.other, s.totalOther, -1, 'Total other spending');
  const spendAt = rows.length + 1;
  rows.push([{ v: 'Total spending', style: 'bold' }, { f: `B${ess}+B${other}`, v: pounds(s.totalSpend), style: 'moneyTotal' }]);
  const surplusAt = rows.length + 1;
  rows.push([{ v: 'Surplus before saving', style: 'bold' }, { f: `B${income}-B${spendAt}`, v: pounds(s.surplus), style: 'moneyTotal' }], []);
  const saved = block('Saved and invested', s.saved, s.totalSaved, -1, 'Total saved and invested');
  rows.push([{ v: 'Left over', style: 'bold' }, { f: `B${surplusAt}-B${saved}`, v: pounds(s.leftOver), style: 'moneyTotal' }]);
  if (s.savingsRate !== null) {
    rows.push([{ v: 'Savings and investing rate' }, { f: `IF(B${income}>0,B${saved}/B${income},0)`, v: s.savingsRate, style: 'percent' }]);
  }
  rows.push([], [{ v: 'Payroll pension contributions never reach your bank, so they are not shown.', style: 'note' }]);
  return { name: 'Income statement', widths: [40, 16], rows };
}

function balanceSheetTab(state, period) {
  const b = balanceSheet(state, period);
  const rows = [[{ v: 'Balance sheet', style: 'title' }], [{ v: `Latest balances up to ${b.asOf}. All figures calculated.`, style: 'note' }], []];
  const groupBlock = (g) => {
    rows.push([{ v: g.name, style: 'section' }, { v: '', style: 'section' }, { v: 'As of', style: 'section' }]);
    const from = rows.length + 1;
    for (const l of g.items) {
      rows.push([l.name, l.pence === null ? 'No balance entered' : m(l.pence), l.date ? { v: excelDate(l.date), style: 'date' } : '']);
    }
    const at = rows.length + 1;
    rows.push([{ v: `Total ${g.name.toLowerCase()}`, style: 'bold' }, sumF(from, rows.length, g.total)]);
    rows.push([]);
    return at;
  };
  const assets = b.assets.map(groupBlock);
  const assetsAt = rows.length + 1;
  rows.push([{ v: 'Total assets', style: 'bold' }, { f: assets.map((r) => `B${r}`).join('+'), v: pounds(b.totalAssets), style: 'moneyTotal' }], []);
  const debts = b.debts.map(groupBlock);
  const debtsAt = rows.length + 1;
  rows.push([{ v: 'Total owed', style: 'bold' }, { f: debts.map((r) => `B${r}`).join('+'), v: pounds(b.totalDebts), style: 'moneyTotal' }], []);
  rows.push([{ v: 'Net worth', style: 'bold' }, { f: `B${assetsAt}-B${debtsAt}`, v: pounds(b.netWorth), style: 'moneyTotal' }]);
  if (b.missing.length) rows.push([], [{ v: `No balance entered, so counted as nothing: ${b.missing.join(', ')}`, style: 'note' }]);
  if (b.growthEstimate !== null) rows.push([], ['Investment growth (estimate)', m(b.growthEstimate)], [{ v: 'Rise in value not explained by money paid in.', style: 'note' }]);
  return { name: 'Balance sheet', widths: [40, 18, 14], rows };
}

function cashFlowTab(state, period) {
  const c = cashFlow(state, period);
  const rows = [[{ v: 'Cash flow', style: 'title' }], [{ v: `${period.label}. Money through: ${c.accounts.join(', ') || 'no accounts'}. All figures calculated.`, style: 'note' }], []];
  const section = (t) => rows.push([{ v: t, style: 'section' }, { v: '', style: 'section' }]);
  section('Day to day');
  rows.push(['Income received', m(c.received)]);
  const a = rows.length;
  rows.push(['Spending paid from the account', m(-c.paid)], ['Credit cards paid off', m(-c.cardsPaid)]);
  const opAt = rows.length + 1;
  rows.push([{ v: 'Net from day to day', style: 'bold' }, sumF(a, rows.length, c.operating)], []);
  section('Saving and investing');
  const invAt = rows.length + 1;
  rows.push(['Paid into savings and investments', m(-c.investing)], []);
  section('Between your own accounts');
  const movAt = rows.length + 1;
  rows.push(['Moved to other accounts of yours', m(-c.moved)], []);
  const netAt = rows.length + 1;
  rows.push([{ v: 'Net change in cash', style: 'bold' }, { f: `B${opAt}+B${invAt}+B${movAt}`, v: pounds(c.netCash), style: 'moneyTotal' }], []);
  section('Check against your statements');
  if (c.opening === null) {
    rows.push(['Balances were not available to check against.']);
  } else {
    const openAt = rows.length + 1;
    rows.push(['Opening cash', m(c.opening)]);
    const expAt = rows.length + 1;
    rows.push(['Expected closing cash', { f: `B${openAt}+B${netAt}`, v: pounds(c.opening + c.netCash), style: 'money' }]);
    const closeAt = rows.length + 1;
    rows.push(['Closing cash on the statement', m(c.closing)]);
    rows.push([{ v: 'Difference', style: 'bold' }, { f: `B${closeAt}-B${expAt}`, v: pounds(c.difference), style: 'moneyTotal' }]);
  }
  rows.push([], ['Memo: spending on credit cards in this period', m(c.cardSpend)], [{ v: 'Not cash until the card is paid.', style: 'note' }]);
  return { name: 'Cash flow', widths: [46, 16], rows };
}

export function buildReportXlsx(state, period) {
  return buildXlsx([incomeSheet(state, period), balanceSheetTab(state, period), cashFlowTab(state, period), transactionsSheet(state, period)]);
}
