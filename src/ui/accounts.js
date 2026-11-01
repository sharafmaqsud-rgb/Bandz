// Accounts: every account's latest balance, with a way to update it by hand.
import { balancesAsOf } from '../core/analysis.js';
import { applyRules } from '../core/categorise.js';
import { FUNDING_PATTERNS } from '../core/defaults.js';
import { addAccount, removeAccount, renameAccount, setBalance, setRule } from '../core/model.js';
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
        .map(([key, account]) => accountRow(app, key, account, latest[key])),
      title === 'Pension' && addPension(app))),
  ];
}

// Marking an account as an ISA changes what payments into it count as, past and future.
function setIsa(app, key, account, isIsa) {
  account.isIsa = isIsa;
  account.updatedAt = Date.now();
  for (const pattern of FUNDING_PATTERNS[key] ?? []) {
    setRule(app.state, pattern, isIsa ? 'ISA contribution' : 'Investing & crypto');
  }
  applyRules(app.state);
  app.commit();
}

function addPension(app) {
  const { state, view } = app;
  const open = view.openAccount === 'new-pension';
  return h('details', {
    className: 'more',
    open,
    onToggle: (e) => {
      if (e.target.open && view.openAccount !== 'new-pension') { view.openAccount = 'new-pension'; view.accountError = null; app.render(); }
      else if (!e.target.open && view.openAccount === 'new-pension') view.openAccount = null;
    },
  },
  h('summary', null, h('span', null, '+ Add a pension provider')),
  open && h('form', {
    className: 'account-form',
    novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        const key = addAccount(state, form.get('name'), 'pension');
        if (String(form.get('amount')).trim()) {
          try {
            setBalance(state, form.get('date'), key, form.get('amount'));
          } catch (err) {
            removeAccount(state, key); // all or nothing, so a typo leaves no half-made account
            throw err;
          }
        }
        view.openAccount = null;
        view.accountError = null;
      } catch (err) {
        view.accountError = err.message;
      }
      app.commit();
    },
  },
  h('label', null, 'Provider name', h('input', { name: 'name', type: 'text', autocomplete: 'off' })),
  h('label', null, 'Balance (£), optional', h('input', { name: 'amount', type: 'text', inputmode: 'decimal', autocomplete: 'off' })),
  h('label', null, 'As of', h('input', { name: 'date', type: 'date', value: today(), max: today(), required: true })),
  view.accountError && h('p', { role: 'alert' }, `✕ ${view.accountError}`),
  h('button', { className: 'primary', type: 'submit' }, 'Add provider')));
}

function accountRow(app, key, account, balance) {
  const { state, view } = app;
  const isCard = account.class === 'credit';
  const isPension = account.class === 'pension';
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
        if (isPension) renameAccount(state, key, form.get('name'));
        setBalance(state, form.get('date'), key, form.get('amount'));
        view.openAccount = null;
        view.accountError = null;
      } catch (err) {
        view.accountError = err.message;
      }
      app.commit();
    },
  },
  isPension && h('label', null, 'Provider name', h('input', { name: 'name', type: 'text', autocomplete: 'off', value: account.name })),
  h('label', { for: fieldId }, isCard ? 'Amount you owe (£)' : 'Balance (£)',
    h('input', {
      id: fieldId, name: 'amount', type: 'text', inputmode: 'decimal', autocomplete: 'off',
      value: balance ? formatPence(isCard ? -balance.balancePence : balance.balancePence).replace('£', '') : '',
    })),
  h('label', null, 'As of', h('input', { name: 'date', type: 'date', value: today(), max: today(), required: true })),
  view.accountError && h('p', { role: 'alert' }, `✕ ${view.accountError}`),
  h('button', { className: 'primary', type: 'submit' }, 'Save'),
  account.class === 'investment' && h('label', { className: 'check' },
    h('input', {
      type: 'checkbox',
      checked: account.isIsa,
      onChange: (e) => setIsa(app, key, account, e.target.checked),
    }),
    'This is an ISA'),
  isPension && h('button', {
    className: 'danger',
    type: 'button',
    onClick: () => {
      if (!window.confirm(`Remove ${account.name} and its balance history? This cannot be undone.`)) return;
      removeAccount(state, key);
      view.openAccount = null;
      app.commit();
    },
  }, 'Remove provider')));
}
