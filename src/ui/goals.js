// Goals: where you stand on each measure. Until you set a target, a measure is simply shown,
// with no pass or fail.
import { monthsWithData, netWorth } from '../core/analysis.js';
import { bufferStatus, isaStatus, meets, monthlyMeasures, netWorthSeries, taxYear } from '../core/insights.js';
import { formatPence, parseMoney } from '../core/money.js';
import { lineChart } from './chart.js';
import { calculated, estimated, fullDate, h, money, monthName, notice, percent, row, svg, today } from './dom.js';

// Status is always an icon and a word, never colour alone.
function status(met, { yes = 'On target', no = 'Below target' } = {}) {
  if (met === null) return h('span', { className: 'status muted' }, 'No target set');
  return h('span', { className: 'status' }, met ? `✓ ${yes}` : `✕ ${no}`);
}

function progress(share, markShare = null) {
  const width = Math.min(100, Math.max(0, share * 100));
  return svg('svg', { className: 'progress', viewBox: '0 0 100 12', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svg('rect', { className: 'track', width: 100, height: 12, rx: 1 }),
    svg('rect', { className: 'fill', width, height: 12, rx: 1 }),
    markShare !== null && svg('line', { className: 'mark', x1: markShare * 100, x2: markShare * 100, y1: 0, y2: 12 }));
}

function isaSection(state, ym) {
  const isa = isaStatus(state, ym);
  const months = monthlyMeasures(state, ym);
  const scale = Math.max(1, isa.target ?? 0, ...months.map((m) => m.isa));
  return h('section', null,
    h('h2', null, `ISA allowance ${isa.label}`, calculated()),
    h('div', { className: 'big' }, money(isa.paid), h('span', { className: 'muted' }, ` of ${formatPence(isa.allowance)}`)),
    progress(isa.paid / isa.allowance),
    h('div', { className: 'rows' },
      row('Allowance left', money(isa.remaining)),
      row('Full months left before 5 April', String(isa.monthsLeft)),
      isa.neededPerMonth !== null && row('Monthly amount to use it all', money(isa.neededPerMonth), calculated()),
      isa.projected !== null && row('Paid in by 5 April at your target', money(isa.projected), estimated())),
    isa.overBy > 0 && notice('attention', 'Over the allowance at this pace', h('p', null, `Your target would go ${formatPence(isa.overBy)} over by 5 April.`)),
    isa.startsLate && notice('attention', 'Earlier payments are missing',
      h('p', null, `Your statements start on ${fullDate(isa.startsLate)}, so payments between 6 April and then are not counted. Add them under Set your targets.`)),
    months.length > 0 && h('div', null,
      h('h2', null, 'Paid in each month', calculated()),
      months.map((m) => h('div', { className: 'month-bar' },
        h('div', { className: 'bar-head' }, h('span', null, monthName(m.month)), money(m.isa)),
        progress(m.isa / scale, isa.target ? isa.target / scale : null),
        h('div', { className: 'bar-foot' }, status(meets(m.isa, isa.target), { yes: 'Met', no: 'Below target' }))))));
}

function ratesSection(state, ym) {
  const goals = state.goals;
  const months = monthlyMeasures(state, ym);
  const cur = months[months.length - 1];
  return h('section', null,
    h('h2', null, 'Savings and investing rate', calculated()),
    h('div', { className: 'big' }, cur.rate === null ? 'No income yet' : percent(cur.rate)),
    h('p', null, status(meets(cur.rate, goals.savingsRateTarget))),
    h('div', { className: 'rows' }, months.map((m) => row(monthName(m.month), m.rate === null ? 'n/a' : percent(m.rate)))),
    goals.monthlySpendCapPence !== null && h('p', null),
    goals.monthlySpendCapPence !== null && row(`Spent, against your ${formatPence(goals.monthlySpendCapPence)} limit`,
      money(cur.spend), ' ', status(meets(cur.spend, goals.monthlySpendCapPence, false), { yes: 'Within limit', no: 'Over limit' })));
}

function bufferSection(state, ym) {
  const b = bufferStatus(state, ym);
  return h('section', null,
    h('h2', null, 'Cash buffer', calculated()),
    h('div', { className: 'big' }, b.months === null ? 'Not enough data' : `${b.months.toFixed(1)} months`),
    h('p', null, status(b.met)),
    h('p', { className: 'muted' }, 'Months of essential spending your cash could cover, after paying off cards.'),
    h('div', { className: 'rows' },
      row('Cash after cards', money(b.available)),
      row('Essential spending a month', money(b.essentials)),
      b.shortfall > 0 && row('Short of your target by', money(b.shortfall))));
}

function netWorthSection(state) {
  const points = netWorthSeries(state);
  const target = state.goals.netWorthTargetPence;
  const total = netWorth(state).total;
  return h('section', null,
    h('h2', null, 'Net worth trend', calculated()),
    target !== null && h('p', null, `${formatPence(total)} of ${formatPence(target)} `, status(meets(total, target), { yes: 'Reached', no: 'Not yet' })),
    points.length >= 2
      ? lineChart(points, `Net worth from ${fullDate(points[0].date)} to ${fullDate(points[points.length - 1].date)}`)
      : h('p', { className: 'muted' }, points.length ? 'The trend appears once balances are recorded on a second date.' : 'Add balances on Accounts to start a trend.'));
}

// Blank means no target. A value that makes no sense is refused rather than guessed.
function pounds(text, what) {
  const pence = parseMoney(text);
  if (pence !== null && pence < 0) throw new Error(`${what} cannot be negative`);
  return pence;
}
function plainNumber(text, what) {
  const t = String(text).trim();
  if (!t) return null;
  const n = Number(t.replace('%', ''));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${what} must be a positive number`);
  return n;
}
const asPounds = (pence) => (pence === null || pence === undefined ? '' : formatPence(pence).replace('£', '').replace(/,/g, ''));

function targetsSection(app, ym) {
  const { state, view } = app;
  const g = state.goals;
  const label = taxYear(ym ? `${ym}-28` : today()).label;
  const field = (text, name, value, mode = 'decimal') => h('label', null, text,
    h('input', { name, type: 'text', inputmode: mode, autocomplete: 'off', value }));
  return h('section', null,
    h('details', {
      className: 'more',
      open: view.targetsOpen,
      onToggle: (e) => { view.targetsOpen = e.target.open; },
    },
    h('summary', null, h('span', null, 'Set your targets')),
    h('form', {
      className: 'goal-form',
      novalidate: true,
      onSubmit: (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          const rate = plainNumber(f.get('rate'), 'Savings rate');
          if (rate !== null && rate > 100) throw new Error('Savings rate cannot be over 100%');
          const next = {
            monthlyIsaTargetPence: pounds(f.get('isa'), 'ISA target'),
            savingsRateTarget: rate === null ? null : rate / 100,
            monthlySpendCapPence: pounds(f.get('cap'), 'Spending limit'),
            bufferMonthsTarget: plainNumber(f.get('buffer'), 'Buffer target'),
            netWorthTargetPence: pounds(f.get('networth'), 'Net worth target'),
          };
          const before = pounds(f.get('before'), 'Earlier ISA payments');
          Object.assign(state.goals, next);
          state.goalsUpdatedAt = Date.now();
          state.settings.isaPaidBeforeImportByTaxYear[label] = before ?? 0;
          view.targetsError = null;
          view.targetsSaved = true;
        } catch (err) {
          view.targetsError = err.message;
          view.targetsSaved = false;
        }
        app.commit();
      },
    },
    h('p', { className: 'muted' }, 'Leave a box blank for no target.'),
    field('ISA contribution each month (£)', 'isa', asPounds(g.monthlyIsaTargetPence)),
    field('Savings and investing rate (%)', 'rate', g.savingsRateTarget === null ? '' : String(Math.round(g.savingsRateTarget * 1000) / 10)),
    field('Cash buffer (months)', 'buffer', g.bufferMonthsTarget ?? ''),
    field('Monthly spending limit (£)', 'cap', asPounds(g.monthlySpendCapPence)),
    field('Net worth target (£)', 'networth', asPounds(g.netWorthTargetPence)),
    field(`ISA paid in ${label} before your first statement (£)`, 'before', asPounds(state.settings.isaPaidBeforeImportByTaxYear[label] ?? null)),
    view.targetsError && h('p', { role: 'alert' }, `✕ ${view.targetsError}`),
    view.targetsSaved && h('p', { role: 'status' }, '✓ Saved'),
    h('button', { className: 'primary', type: 'submit' }, 'Save targets'))));
}

export function renderGoals(app) {
  const { state } = app;
  const months = monthsWithData(state);
  const ym = months[months.length - 1];
  return [
    h('h1', null, 'Goals'),
    ym
      ? [isaSection(state, ym), ratesSection(state, ym), bufferSection(state, ym)]
      : h('p', { className: 'muted' }, 'Import a statement to see your ISA, savings rate and cash buffer.'),
    netWorthSection(state),
    targetsSection(app, ym),
  ];
}
