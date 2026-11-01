// Overview: your whole position at a glance, the latest month and anything needing attention.
// Everything is worked out afresh each time it is drawn, so it is always up to date.
import { inMonth, monthGaps, monthsWithData, netWorth, savingsRate, summarise } from '../core/analysis.js';
import { pairCardRepayments } from '../core/categorise.js';
import { buildHighlights, monthlySeries, pounds, spendingPace } from '../core/highlights.js';
import { bufferStatus, isaStatus, netWorthSeries } from '../core/insights.js';
import { reviewCount, reviewQueue } from '../core/review.js';
import { availablePeriods } from '../core/statements.js';
import { lineChart } from './chart.js';
import { calculated, dayName, estimated, fullDate, h, monthName, notice, percent, plural, today } from './dom.js';
import { card, change, countUp, donut, highlightGroups, kpi, monthBars, paceChart, ring, stacked } from './viz.js';

const STALE_DAYS = 35;
const BACKUP_REMINDER_DAYS = 30;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const tagFor = (label) => (label === 'estimate' ? estimated() : calculated());

export function renderOverview(app) {
  const { state } = app;
  if (!Object.keys(state.balances).length && !Object.keys(state.transactions).length) {
    return [card('Welcome',
      h('p', null, 'Nothing here yet. Import a statement or add your balances, and this fills with your picture.'),
      h('p', { className: 'muted' }, 'Everything stays on this device.'),
      h('a', { className: 'button primary', href: '#import' }, 'Go to Import'))];
  }

  const nw = netWorth(state);
  const months = monthsWithData(state);
  const ym = months[months.length - 1];
  const series = netWorthSeries(state);
  const before = series.length >= 2 ? series[series.length - 2].pence : null;

  return [
    h('div', { className: 'dash' },
      h('section', { className: 'card hero span-2' },
        h('div', { className: 'hero-text' },
          h('div', { className: 'label' }, 'Net worth', calculated()),
          h('div', { className: 'value' }, countUp(nw.total, app)),
          before !== null && h('div', { className: 'kpi-note' }, change(nw.total - before, { suffix: 'since your last update' }))),
        stacked([
          { name: 'Cash', pence: nw.groups.cash, hue: 0 },
          { name: 'Investments', pence: nw.groups.investments, hue: 2 },
          { name: 'Pensions', pence: nw.groups.pension, hue: 4 },
        ]),
        nw.groups.cards !== 0 && h('p', { className: 'muted' }, `After ${pounds(Math.abs(nw.groups.cards))} owed on cards.`),
        pensionLines(state, nw)),
      ym && monthDash(app, ym),
      series.length >= 2 && h('section', { className: 'card span-2' },
        h('h2', null, 'Net worth trend', calculated()),
        lineChart(series, `Net worth from ${fullDate(series[0].date)} to ${fullDate(series[series.length - 1].date)}`)),
      attention(app, nw, ym)),
  ];
}

function pensionLines(state, nw) {
  const pensions = Object.entries(state.accounts).filter(([key, a]) => a.class === 'pension' && nw.latest[key]);
  if (pensions.length < 2) return null;
  return h('details', { className: 'more' },
    h('summary', null, h('span', null, 'Pensions by provider')),
    pensions.map(([key, a]) => h('div', { className: 'row' }, h('div', null, a.name), h('div', { className: 'right money' }, pounds(nw.latest[key].balancePence)))));
}

const prevMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

function monthDash(app, ym) {
  const { state } = app;
  const s = summarise(inMonth(state, ym), state.categories);
  const prev = monthsWithData(state).includes(prevMonth(ym)) ? summarise(inMonth(state, prevMonth(ym)), state.categories) : null;
  const rate = savingsRate(s);
  const buffer = bufferStatus(state, ym);
  const isa = isaStatus(state, ym);
  const pace = spendingPace(state, ym);
  const period = availablePeriods(state).find((p) => p.id === `m:${ym}`);
  const highlights = buildHighlights(state, period);
  const lines = Object.entries(s.spendByCat).map(([name, pence]) => ({ name, pence }));

  return [
    h('div', { className: 'kpis span-2' },
      kpi(`Spent, ${monthName(ym)}`, countUp(s.spend, app), prev && change(s.spend - prev.spend)),
      kpi('Saved and invested', countUp(s.saved, app), prev && change(s.saved - prev.saved)),
      kpi('Savings rate', rate === null ? 'n/a' : percent(rate), 'Of income received'),
      kpi('Cash buffer', buffer.months === null ? 'n/a' : `${buffer.months.toFixed(1)} mths`, 'Of essential spending')),
    h('section', { className: 'card span-2' },
      h('h2', null, 'The story so far'),
      h('p', { className: 'lead' }, highlights.headline),
      highlightGroups(highlights, tagFor),
      h('p', null, h('a', { href: '#reports' }, 'See the full report'))),
    card('Where it went', donut(lines, s.spend), h('p', null, h('a', { href: '#spending' }, 'Explore your spending'))),
    h('section', { className: 'card' },
      h('h2', null, `ISA allowance ${isa.label}`, calculated()),
      h('div', { className: 'ring-row' },
        ring(isa.paid / isa.allowance, percent(isa.paid / isa.allowance), `ISA allowance ${percent(isa.paid / isa.allowance)} used`),
        h('div', null,
          h('div', { className: 'kpi-value' }, pounds(isa.paid)),
          h('div', { className: 'muted' }, `of ${pounds(isa.allowance)}, with ${pounds(isa.remaining)} left`),
          h('div', { className: 'muted' }, `${isa.monthsLeft} full ${isa.monthsLeft === 1 ? 'month' : 'months'} to go`))),
      h('p', null, h('a', { href: '#goals' }, 'See your goals'))),
    card('Spending through the month', paceChart(pace),
      pace.projected !== null && h('p', { className: 'muted' }, `On this pace, about ${pounds(pace.projected)} by month end.`, estimated())),
    card('The last six months', monthBars(monthlySeries(state, ym))),
  ];
}

function attention(app, nw, ym) {
  const { state } = app;
  const items = [];

  const queue = reviewCount(reviewQueue(state));
  if (queue) {
    items.push(notice('attention', `Needs your eye: ${plural(queue, 'item', 'items')}`,
      h('p', null, 'Everything else was filed for you. ', h('a', { href: '#import' }, 'Take a look'))));
  }

  const unpaired = pairCardRepayments(state);
  if (unpaired.length) {
    items.push(notice('attention', `Needs attention: ${plural(unpaired.length, 'card payment has', 'card payments have')} no match`,
      h('p', null, 'The current-account side may be counting as spending. ', h('a', { href: '#import' }, 'See details'))));
  }

  const lastBackup = state.meta.lastBackupAt;
  if (!lastBackup || daysBetween(new Date(lastBackup).toISOString().slice(0, 10), today()) > BACKUP_REMINDER_DAYS) {
    items.push(notice('attention', lastBackup ? 'Time for a backup' : 'No backup yet',
      h('p', null, 'This device could lose its data, and your other device only updates from a backup. ', h('a', { href: '#import' }, 'Create a backup'))));
  }

  if (ym) {
    const gaps = monthGaps(state, ym);
    if (gaps.length) {
      items.push(notice('attention', `Incomplete: ${monthName(ym)}`,
        h('ul', null, gaps.map((g) => h('li', null,
          g.through ? `${g.name} runs to ${dayName(g.through)}.` : `${g.name} has no statement yet.`)))));
    }
  }

  const missing = nw.missing.map((k) => state.accounts[k].name);
  if (missing.length) {
    items.push(notice('attention', 'Missing from net worth',
      h('p', null, `${missing.join(', ')}. `, h('a', { href: '#accounts' }, 'Add balances'))));
  }

  const now = today();
  const newest = Object.values(state.balances).reduce((latest, b) => {
    if (!latest[b.account] || latest[b.account] < b.date) latest[b.account] = b.date;
    return latest;
  }, {});
  const old = Object.entries(newest).filter(([, d]) => daysBetween(d, now) > STALE_DAYS);
  if (old.length) {
    items.push(notice('attention', 'Out of date balances',
      h('ul', null, old.map(([k, d]) => h('li', null, `${state.accounts[k].name}: last updated ${fullDate(d)}`)))));
  }

  return items.length ? h('div', { className: 'span-2' }, items) : null;
}
