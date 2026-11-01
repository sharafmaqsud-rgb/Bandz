// Accounts: every account's latest balance, with a way to update it by hand.
import { balancesAsOf } from '../core/analysis.js';
import { setBalance } from '../core/model.js';
import { formatPence } from '../core/money.js';
import { fullDate, h, money, today } from './dom.js';

const SECTIONS = [
  ['Cash', ['cash']],
  ['Cards', ['credit']],
  ['Investments', ['investment', 'crypto']],
  ['Pension', ['pension']],
];

export function renderAccounts(app) {
  const { state } = app;
  const latest = balancesAsOf(state);
  return [
    h('h1', null, 'Accounts'),
    SECTIONS.map(([title, classes]) => h('section', null,
      h('h2', null, title),
      Object.entries(state.accounts).filter(([, a]) => classes.includes(a.class))
        .map(([key, account]) => accountRow(app, key, account, latest[key])))),
  ];
}

function accountRow(app, key, account, balance) {
  const { state, view } = app;
  const isCard = account.class === 'credit';
  const fieldId = `balance-${key}`;
  const open = view.openAccount === key;
  return h('details', {
    className: 'more',
    open,
    onToggle: (e) => {
      if (e.target.open) { if (view.openAccount !== key) { view.openAccount = key; view.accountError = null; app.render(); } }
      else if (view.openAccount === key) view.openAccount = null;
    },
  },
  h('summary', null,
    h('span', null, account.name,
      h('div', { className: 'muted' }, balance ? `Updated ${fullDate(balance.date)}` : 'No balance yet')),
    balance ? money(balance.balancePence) : h('span', { className: 'muted' }, 'Add')),
  open && h('form', {
    className: 'account-form',
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        setBalance(state, form.get('date'), key, form.get('amount'));
        view.openAccount = null;
        view.accountError = null;
      } catch (err) {
        view.accountError = err.message;
      }
      app.commit();
    },
  },
  h('label', { for: fieldId }, isCard ? 'Amount you owe (£)' : 'Balance (£)',
    h('input', {
      id: fieldId, name: 'amount', type: 'text', inputmode: 'decimal', autocomplete: 'off',
      value: balance ? formatPence(isCard ? -balance.balancePence : balance.balancePence).replace('£', '') : '',
    })),
  h('label', null, 'As of', h('input', { name: 'date', type: 'date', value: today(), max: today(), required: true })),
  view.accountError && h('p', { role: 'alert' }, `✕ ${view.accountError}`),
  h('button', { className: 'primary', type: 'submit' }, 'Save balance'),
  (account.class === 'investment') && h('label', { className: 'check' },
    h('input', {
      type: 'checkbox',
      checked: account.isIsa,
      onChange: (e) => { account.isIsa = e.target.checked; app.commit(); },
    }),
    'This is an ISA')));
}
