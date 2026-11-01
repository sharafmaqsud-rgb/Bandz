// Spending: one month, with categories biggest first and the change on the month before.
import { categoryChanges, classify, inMonth, leftOver, monthGaps, monthsWithData, savingsRate, shiftMonth, summarise } from '../core/analysis.js';
import { setManualCategory } from '../core/categorise.js';
import { formatPence } from '../core/money.js';
import { buildInsights } from '../core/insights.js';
import { monthlySummary } from '../core/summary.js';
import { calculated, categorySelect, dayName, estimated, h, money, monthName, notice, percent, row, svg } from './dom.js';

// The change is written in words with an arrow, never shown by colour alone.
function changeText(change) {
  if (change === null) return 'First month of data';
  if (change === 0) return '● Same as last month';
  const amount = formatPence(Math.abs(change));
  return change > 0 ? `▲ ${amount} more than last month` : `▼ ${amount} less than last month`;
}

function bar(share) {
  // A viewBox of 0-100 makes the width a percentage, and it needs no inline style,
  // which the content policy forbids.
  const width = Math.max(share * 100, share > 0 ? 1 : 0);
  return svg('svg', { className: 'bar-track', viewBox: '0 0 100 8', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svg('rect', { x: 0, y: 0, width, height: 8, rx: 1 }));
}

function txList(app, rows) {
  const { state } = app;
  return h('ul', { className: 'txs' }, rows.map((t) => h('li', { className: 'tx' },
    h('div', { className: 'tx-head' },
      h('div', null, t.description, h('div', { className: 'muted' }, `${dayName(t.date)}, ${state.accounts[t.account].name}`)),
      money(t.amountPence)),
    categorySelect(state, {
      label: `Category for ${t.description}`,
      value: t.category ?? '',
      onPick: (category) => {
        setManualCategory(state, t.key, category);
        app.commit();
      },
    }))));
}

const byDate = (a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key);

export function renderSpending(app) {
  const { state, view } = app;
  const months = monthsWithData(state);
  if (!months.length) {
    return [
      h('h1', null, 'Spending'),
      h('p', null, 'No transactions yet.'),
      h('a', { className: 'button primary', href: '#import' }, 'Go to Import'),
    ];
  }
  if (!months.includes(view.month)) view.month = months[months.length - 1];
  const ym = view.month;
  const at = months.indexOf(ym);
  const rows = inMonth(state, ym);
  const s = summarise(rows, state.categories);

  // Only compare with the month directly before, and only if there is data for it.
  const prevYm = shiftMonth(ym, -1);
  const prev = months.includes(prevYm) ? summarise(inMonth(state, prevYm), state.categories) : null;
  const changes = categoryChanges(s, prev);
  const largest = Math.max(1, ...changes.map((c) => c.pence));
  const rate = savingsRate(s);

  const go = (step) => () => { view.month = months[at + step]; view.openCategory = null; app.render(); };
  const ofKind = (kind) => rows.filter((t) => classify(t, state.categories).kind === kind).sort(byDate);
  const gaps = monthGaps(state, ym);

  return [
    h('div', { className: 'month-switch' },
      h('button', { 'aria-label': 'Previous month', disabled: at === 0, onClick: go(-1) }, '‹'),
      h('h1', null, monthName(ym)),
      h('button', { 'aria-label': 'Next month', disabled: at === months.length - 1, onClick: go(1) }, '›')),
    h('section', { className: 'hero' },
      h('div', { className: 'label' }, 'Spent', calculated()),
      h('div', { className: 'value' }, money(s.spend))),
    gaps.length > 0 && notice('attention', 'Incomplete month',
      h('ul', null, gaps.map((g) => h('li', null,
        g.through ? `${g.name} runs to ${dayName(g.through)}.` : `${g.name} has no statement yet.`)))),
    h('section', null,
      h('h2', null, 'By category'),
      changes.length === 0 ? h('p', { className: 'muted' }, 'No spending this month.') : null,
      h('ul', { className: 'bars' }, changes.map((c) => h('li', null,
        h('details', {
          open: view.openCategory === c.name,
          onToggle: (e) => {
            // The transactions are only drawn once opened. The check stops a redraw of an
            // already open section from firing this again, forever.
            if (e.target.open && view.openCategory !== c.name) { view.openCategory = c.name; app.render(); }
            else if (!e.target.open && view.openCategory === c.name) view.openCategory = null;
          },
        },
        h('summary', null,
          h('div', { className: 'bar-head' }, h('span', null, c.name), money(c.pence)),
          bar(c.pence / largest),
          h('div', { className: 'bar-foot' },
            h('span', null, changeText(c.change)),
            h('span', { className: 'num' }, s.spend > 0 ? percent(c.pence / s.spend) : ''))),
        view.openCategory === c.name && txList(app, rows
          .filter((t) => classify(t, state.categories).kind === 'spend' && classify(t, state.categories).name === c.name)
          .sort(byDate))))))),
    h('section', null,
      h('h2', null, 'Where to optimise'),
      buildInsights(state, ym).map((i) => h('div', { className: 'insight' },
        h('h3', null, i.title, i.label === 'estimate' ? estimated() : calculated()),
        h('p', null, i.detail),
        i.items.length > 0 && h('ul', null, i.items.map((item) => h('li', null, item)))))),
    h('section', null,
      h('h2', null, 'The month in total', calculated()),
      h('div', { className: 'rows' },
        row('Income', money(s.income)),
        row('Spent', money(s.spend)),
        row('Saved and invested', money(s.saved)),
        row('Left over', money(leftOver(s))),
        rate !== null && row('Savings and investing rate', percent(rate)),
        row('Essential spending', money(s.essentialSpend)))),
    h('section', null,
      h('h2', null, 'Everything else'),
      moreSection(app, 'Income', ofKind('income')),
      moreSection(app, 'Saved and invested', ofKind('saving')),
      moreSection(app, 'Transfers and card repayments, not counted as spending', ofKind('transfer'))),
    summarySection(app, ym),
  ];
}

// Plain text to paste into a Claude chat. The app only prepares it, and sends nothing.
function summarySection(app, ym) {
  const { state, view } = app;
  if (view.summaryMonth !== ym) {
    return h('section', null,
      h('button', { onClick: () => { view.summaryMonth = ym; view.summaryCopied = false; app.render(); } }, 'Prepare summary for Claude'));
  }
  const text = monthlySummary(state, ym);
  const box = h('textarea', { className: 'summary', readonly: true, 'aria-label': 'Monthly summary', value: text });
  return h('section', null,
    h('h2', null, 'Summary for Claude'),
    h('p', { className: 'muted' }, 'Read this, then paste it into a chat yourself. It holds totals and merchant names, which can include people you pay, but no account numbers.'),
    box,
    h('p', null),
    h('button', {
      className: 'primary',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          view.summaryCopied = true;
        } catch {
          box.select(); // the clipboard can be refused, so leave it ready to copy by hand
          view.summaryCopied = false;
          return;
        }
        app.render();
      },
    }, view.summaryCopied ? '✓ Copied' : 'Copy summary'));
}

function moreSection(app, title, rows) {
  const key = title;
  const { view } = app;
  return h('details', {
    className: 'more',
    open: view.openSection === key,
    onToggle: (e) => {
      if (e.target.open) { if (view.openSection !== key) { view.openSection = key; app.render(); } }
      else if (view.openSection === key) { view.openSection = null; }
    },
  },
  h('summary', null, h('span', null, title), h('span', { className: 'num muted' }, `${rows.length}`)),
  view.openSection === key && txList(app, rows));
}
