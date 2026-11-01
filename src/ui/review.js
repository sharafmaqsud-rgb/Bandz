// The short list of things the app needs you to decide.
import { applyRules, pairCardRepayments, setManualCategory } from '../core/categorise.js';
import { setRule } from '../core/model.js';
import { markReviewed, reviewCount, reviewQueue } from '../core/review.js';
import { categorySelect, dayName, h, money, plural } from './dom.js';

function fileMerchant(app, name, category) {
  setRule(app.state, name, category);
  applyRules(app.state);
  pairCardRepayments(app.state);
  app.commit();
}

function merchantCard(app, m) {
  return h('div', { className: 'review' },
    h('div', { className: 'review-head' },
      h('span', null, m.merchant, h('span', { className: 'muted' }, ` · ${plural(m.count, 'payment', 'payments')}${m.moneyIn ? ', money in' : ''}`)),
      money(m.pence)),
    m.reason && h('div', { className: 'muted' }, m.reason),
    m.suggestion && h('button', {
      className: 'primary',
      onClick: () => fileMerchant(app, m.merchant, m.suggestion),
    }, `Yes, ${m.suggestion}`),
    categorySelect(app.state, {
      label: `Category for ${m.merchant}`,
      placeholder: m.suggestion ? 'Or choose another' : 'Choose a category',
      onPick: (category) => fileMerchant(app, m.merchant, category),
    }));
}

function unusualCard(app, { tx, why }) {
  const { state } = app;
  return h('div', { className: 'review' },
    h('div', { className: 'review-head' },
      h('span', null, tx.description, h('div', { className: 'muted' }, `${dayName(tx.date)}, ${state.accounts[tx.account].name}`)),
      money(tx.amountPence)),
    h('div', { className: 'muted' }, why),
    h('button', {
      className: 'primary',
      onClick: () => { markReviewed(state, tx.key); app.commit(); },
    }, `Looks right: ${tx.category}`),
    categorySelect(state, {
      label: `Category for ${tx.description}`,
      placeholder: 'Or move it to',
      onPick: (category) => {
        setManualCategory(state, tx.key, category);
        markReviewed(state, tx.key);
        app.commit();
      },
    }));
}

// Optional, so it stays closed and never counts as something you must do.
function tidySection(app, tidy) {
  if (!tidy.length) return null;
  const { view } = app;
  return h('details', {
    className: 'more',
    open: view.tidyOpen,
    onToggle: (e) => { if (e.target.open !== Boolean(view.tidyOpen)) { view.tidyOpen = e.target.open; app.render(); } },
  },
  h('summary', null, h('span', null, 'Optional: sort your Other spend'), h('span', { className: 'num muted' }, String(tidy.length))),
  view.tidyOpen && h('div', null,
    h('p', { className: 'muted' }, 'Small purchases at merchants the app does not know. Sorting them makes your categories more accurate.'),
    tidy.map((m) => h('div', { className: 'review' },
      h('div', { className: 'review-head' },
        h('span', null, m.merchant, h('span', { className: 'muted' }, ` · ${plural(m.count, 'payment', 'payments')}`)),
        money(m.pence)),
      categorySelect(app.state, {
        label: `Category for ${m.merchant}`,
        onPick: (category) => fileMerchant(app, m.merchant, category),
      })))));
}

export function renderReview(app) {
  const queue = reviewQueue(app.state);
  if (!reviewCount(queue)) {
    return Object.keys(app.state.transactions).length
      ? h('section', null,
        h('h2', null, 'Your review'),
        h('p', { className: 'muted' }, '✓ Nothing needs you. Every payment is filed.'),
        tidySection(app, queue.tidy))
      : null;
  }
  return h('section', null,
    queue.merchants.length > 0 && h('div', null,
      h('h2', null, `Couldn't place these (${queue.merchants.length})`),
      h('p', { className: 'muted' }, 'Your choice also applies to future payments, and helps the app with similar ones.'),
      queue.merchants.map((m) => merchantCard(app, m))),
    queue.unusual.length > 0 && h('div', null,
      h('h2', null, `Worth a look (${queue.unusual.length})`),
      h('p', { className: 'muted' }, 'These are filed already, but they stand out.'),
      queue.unusual.map((u) => unusualCard(app, u))),
    tidySection(app, queue.tidy));
}
