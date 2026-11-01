// Reports: the story of any month or tax year as a dashboard, with statements a tap away.
import { monthGaps } from '../core/analysis.js';
import { buildHighlights, pounds, spendingPace, topMerchants } from '../core/highlights.js';
import { formatPence } from '../core/money.js';
import { buildReportPdf } from '../core/report-pdf.js';
import { buildReportXlsx } from '../core/report-xlsx.js';
import { availablePeriods, balanceSheet, cashFlow, incomeStatement } from '../core/statements.js';
import { calculated, dayName, deliver, estimated, h, notice, percent, plural, today } from './dom.js';
import { card, countUp, donut, highlightGroups, kpi, monthBars, paceChart, rankBars } from './viz.js';

const TABS = [['story', 'Highlights'], ['income', 'Income'], ['balance', 'Balance'], ['cash', 'Cash flow']];
const tagFor = (label) => (label === 'estimate' ? estimated() : calculated());

const show = (pence) => (pence === null ? 'Not entered' : formatPence(pence));
const sectionRow = (title) => h('tr', { className: 'section' }, h('th', { colSpan: 2, scope: 'colgroup' }, title));
const line = (label, pence, ...extra) => h('tr', { className: 'line' }, h('td', null, label, extra), h('td', null, show(pence)));
const total = (label, pence, className = 'total') => h('tr', { className }, h('td', null, label), h('td', null, show(pence)));

function storyView(app, period) {
  const { state } = app;
  const story = buildHighlights(state, period);
  const k = story.kpis;
  const i = incomeStatement(state, period);
  const merchants = topMerchants(state, period);
  const pace = period.kind === 'month' ? spendingPace(state, period.id.slice(2)) : null;
  return h('div', { className: 'dash' },
    h('section', { className: 'card span-2' },
      h('p', { className: 'lead' }, story.headline),
      highlightGroups(story, tagFor)),
    h('div', { className: 'kpis span-2' },
      kpi('Spent', countUp(k.spend, app)),
      kpi('Saved and invested', countUp(k.saved, app)),
      kpi('Savings rate', k.savingsRate === null ? 'n/a' : percent(k.savingsRate)),
      kpi('Net worth', pounds(k.netWorth))),
    card('Where it went', donut([...i.essential, ...i.other], k.spend)),
    merchants.length > 0 && card('Biggest merchants', rankBars(merchants, 1)),
    story.series.length > 0 && card('The last six months', monthBars(story.series)),
    pace && card('Spending through the month', paceChart(pace),
      pace.projected !== null && h('p', { className: 'muted' }, `On this pace, about ${pounds(pace.projected)} by month end.`, estimated())));
}

function incomeView(state, period) {
  const s = incomeStatement(state, period);
  return h('section', { className: 'card' },
    h('table', { className: 'statement' },
      h('tbody', null,
        sectionRow('Income'), s.income.map((l) => line(l.name, l.pence)), total('Total income', s.totalIncome),
        sectionRow('Essential spending'), s.essential.map((l) => line(l.name, l.pence)), total('Total essential spending', s.totalEssential),
        sectionRow('Other spending'), s.other.map((l) => line(l.name, l.pence)), total('Total other spending', s.totalOther),
        total('Total spending', s.totalSpend),
        total('Surplus before saving', s.surplus, 'grand'),
        sectionRow('Saved and invested'), s.saved.map((l) => line(l.name, l.pence)), total('Total saved and invested', s.totalSaved),
        total('Left over', s.leftOver, 'grand'))),
    s.savingsRate !== null && h('p', null, `You saved or invested ${percent(s.savingsRate)} of your income.`),
    h('p', { className: 'muted' }, 'Payroll pension contributions never reach your bank, so they are not shown here.'),
    s.uncategorisedCount > 0 && notice('attention', `${plural(s.uncategorisedCount, 'payment has', 'payments have')} no category`, h('p', null, 'They are included, but may be on the wrong line. ', h('a', { href: '#import' }, 'Take a look'))));
}

function balanceView(state, period) {
  const b = balanceSheet(state, period);
  const group = (g, suffix = '') => [
    sectionRow(`${g.name}${suffix}`),
    g.items.map((l) => line(l.name, l.pence, l.stale ? h('div', { className: 'muted' }, '⚠ Older than 35 days') : null)),
    total(`Total ${g.name.toLowerCase()}`, g.total),
  ];
  return h('section', { className: 'card' },
    h('table', { className: 'statement' },
      h('tbody', null,
        b.assets.map((g) => group(g)),
        total('Total assets', b.totalAssets, 'grand'),
        b.debts.map((g) => group(g, ' owed')),
        total('Total owed', b.totalDebts, 'grand'),
        total('Net worth', b.netWorth, 'grand'),
        b.change !== null && line('Change over the period', b.change),
        b.growthEstimate !== null && line('Investment growth', b.growthEstimate, estimated()))),
    b.missing.length > 0 && notice('attention', 'Missing balances', h('p', null, `${b.missing.join(', ')} counted as nothing. `, h('a', { href: '#accounts' }, 'Add balances'))),
    h('p', { className: 'muted' }, `Uses each account's latest balance up to ${b.asOf}.`));
}

function cashView(state, period) {
  const c = cashFlow(state, period);
  return h('section', { className: 'card' },
    h('table', { className: 'statement' },
      h('tbody', null,
        sectionRow('Day to day'),
        line('Income received', c.received),
        line('Spending paid from the account', -c.paid),
        line('Credit cards paid off', -c.cardsPaid),
        total('Net from day to day', c.operating),
        sectionRow('Saving and investing'),
        line('Paid into savings and investments', -c.investing),
        sectionRow('Between your own accounts'),
        line('Moved to other accounts of yours', -c.moved),
        total('Net change in cash', c.netCash, 'grand'),
        c.opening !== null && [
          sectionRow('Check against your statements'),
          line('Opening cash', c.opening),
          line('Expected closing cash', c.opening + c.netCash),
          line('Closing cash on the statement', c.closing),
        ],
        sectionRow('For reference'),
        line('Spending on credit cards in this period', c.cardSpend))),
    c.reconciled === true && notice('done', 'Matches your statements', h('p', null, 'Every pound through your current account is accounted for.')),
    c.reconciled === false && notice('attention', `Does not match: ${formatPence(c.difference)} difference`,
      h('p', null, 'This usually means a statement is missing for part of this period.')),
    h('p', { className: 'muted' }, `Actual money through ${c.accounts.join(', ') || 'your accounts'}. Card purchases only count here once the card is paid. Revolut is balance only, so what you spend there is not shown.`));
}

async function exportFile(app, period, kind) {
  const { view, state } = app;
  // An exported file is not encrypted, so it is outside the app's protection.
  if (!window.confirm('This file will not be encrypted. Anyone who can open it can read your financial details. Continue?')) return;
  const stem = `finance-report-${period.id.replace(':', '-')}`;
  const file = kind === 'pdf'
    ? new File([buildReportPdf(state, period)], `${stem}.pdf`, { type: 'application/pdf' })
    : new File([buildReportXlsx(state, period)], `${stem}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  try {
    view.exportMessage = (await deliver(file)) ? { kind: 'done', text: `${file.name} is ready. It is not encrypted, so keep it somewhere safe.` } : null;
  } catch (err) {
    view.exportMessage = { kind: 'refused', text: err.message };
  }
  app.render();
}

export function renderReports(app) {
  const { state, view } = app;
  const periods = availablePeriods(state);
  if (!periods.length) {
    return [h('h1', null, 'Reports'), card(null, h('p', null, 'Import a statement to see your reports.'), h('a', { className: 'button primary', href: '#import' }, 'Go to Import'))];
  }
  const period = periods.find((p) => p.id === view.reportPeriod) ?? periods[0];
  const tab = view.reportTab ?? 'story';
  const gaps = period.kind === 'month' ? monthGaps(state, period.id.slice(2)) : [];
  const isFuture = period.end > today();

  return [
    h('h1', null, 'Reports'),
    h('label', null, h('span', { className: 'visually-hidden' }, 'Period'),
      h('select', {
        onChange: (e) => { view.reportPeriod = e.target.value; view.exportMessage = null; app.render(); },
      }, periods.map((p) => h('option', { value: p.id, selected: p.id === period.id }, p.label)))),
    h('p', null),
    h('div', { className: 'segments', role: 'group', 'aria-label': 'View' },
      TABS.map(([id, label]) => h('button', {
        type: 'button',
        'aria-pressed': String(id === tab),
        onClick: () => { view.reportTab = id; app.render(); },
      }, label))),
    gaps.length > 0 && notice('attention', 'Incomplete period',
      h('ul', null, gaps.map((g) => h('li', null, g.through ? `${g.name} runs to ${dayName(g.through)}.` : `${g.name} has no statement yet.`)))),
    period.kind === 'taxYear' && isFuture && notice('attention', 'This tax year is still running', h('p', null, 'It only includes statements imported so far.')),
    tab === 'story' && storyView(app, period),
    tab === 'income' && incomeView(state, period),
    tab === 'balance' && balanceView(state, period),
    tab === 'cash' && cashView(state, period),
    h('p', null),
    card('Export this period',
      h('div', { className: 'export-row' },
        h('button', { onClick: () => exportFile(app, period, 'pdf') }, 'PDF report'),
        h('button', { onClick: () => exportFile(app, period, 'xlsx') }, 'Excel statements')),
      h('p', { className: 'muted' }, 'The PDF is a designed summary. The Excel workbook holds the statements and every transaction. Exported files are not encrypted.'),
      view.exportMessage && notice(view.exportMessage.kind, view.exportMessage.kind === 'done' ? 'Exported' : 'Not exported', h('p', null, view.exportMessage.text))),
  ];
}
