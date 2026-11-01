// Overview: your whole position, the latest month, and anything that needs attention.
import { inMonth, leftOver, monthGaps, monthsWithData, netWorth, savingsRate, summarise } from '../core/analysis.js';
import { reviewCount, reviewQueue } from '../core/review.js';
import { pairCardRepayments } from '../core/categorise.js';
import { calculated, dayName, fullDate, h, money, monthName, notice, percent, plural, row, today } from './dom.js';

const STALE_DAYS = 35;
const BACKUP_REMINDER_DAYS = 30;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function renderOverview(app) {
  const { state } = app;
  const hasBalances = Object.keys(state.balances).length > 0;
  const hasTransactions = Object.keys(state.transactions).length > 0;

  if (!hasBalances && !hasTransactions) {
    return [
      h('h1', null, 'Overview'),
      h('p', null, 'Nothing here yet. Import a statement or add your balances to get started.'),
      h('p', { className: 'muted' }, 'Everything stays on this device.'),
      h('a', { className: 'button primary', href: '#import' }, 'Go to Import'),
    ];
  }

  const nw = netWorth(state);
  const months = monthsWithData(state);
  const ym = months[months.length - 1];
  return [
    h('section', { className: 'hero' },
      h('div', { className: 'label' }, 'Net worth', calculated()),
      h('div', { className: 'value' }, money(nw.total))),
    h('section', { className: 'rows' },
      row('Cash', money(nw.groups.cash)),
      row('Investments', money(nw.groups.investments)),
      row('Pension', money(nw.groups.pension)),
      pensionLines(state, nw),
      row('Cards owed', money(nw.groups.cards))),
    ym && latestMonth(state, ym),
    attention(app, nw, ym),
  ];
}

// With more than one provider, show each under the pension total.
function pensionLines(state, nw) {
  const pensions = Object.entries(state.accounts).filter(([key, a]) => a.class === 'pension' && nw.latest[key]);
  if (pensions.length < 2) return null;
  return pensions.map(([key, a]) => h('div', { className: 'row sub' },
    h('div', null, a.name), h('div', { className: 'right' }, money(nw.latest[key].balancePence))));
}

function latestMonth(state, ym) {
  const s = summarise(inMonth(state, ym), state.categories);
  const rate = savingsRate(s);
  return h('section', null,
    h('h2', null, monthName(ym), calculated()),
    h('div', { className: 'rows' },
      row('Income', money(s.income)),
      row('Spent', money(s.spend)),
      row('Saved and invested', money(s.saved)),
      row('Left over', money(leftOver(s))),
      rate !== null && row('Savings and investing rate', percent(rate))),
    h('p', { className: 'muted' }, h('a', { href: '#spending' }, 'See where it went and what to optimise')));
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
      h('p', null, 'This device could lose its data, and the other device only updates from a backup. ', h('a', { href: '#import' }, 'Create a backup'))));
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
  const stale = Object.values(state.balances).reduce((latest, b) => {
    if (!latest[b.account] || latest[b.account] < b.date) latest[b.account] = b.date;
    return latest;
  }, {});
  const old = Object.entries(stale).filter(([, d]) => daysBetween(d, now) > STALE_DAYS);
  if (old.length) {
    items.push(notice('attention', 'Out of date balances',
      h('ul', null, old.map(([k, d]) => h('li', null, `${state.accounts[k].name}: last updated ${fullDate(d)}`)))));
  }

  return items.length ? h('section', null, items) : null;
}
