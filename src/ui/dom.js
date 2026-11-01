// Small helpers for building the screens. Text always goes in as text, never as HTML, so
// a merchant name on a statement can never become code running in the app.
import { formatPence } from '../core/money.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function build(el, props, kids) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'open') el[k] = v;
    else el.setAttribute(k === 'className' ? 'class' : k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid);
  }
  return el;
}

export const h = (tag, props, ...kids) => build(document.createElement(tag), props, kids);
export const svg = (tag, props, ...kids) => build(document.createElementNS(SVG_NS, tag), props, kids);

const MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const FULL_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const monthName = (ym) => MONTH_FORMAT.format(new Date(`${ym}-01T00:00:00Z`));
export const dayName = (iso) => DAY_FORMAT.format(new Date(`${iso}T00:00:00Z`));
export const fullDate = (iso) => FULL_FORMAT.format(new Date(`${iso}T00:00:00Z`));

export const money = (pence) => h('span', { className: 'money' }, formatPence(pence));
export const percent = (share) => `${Math.round(share * 100)}%`;
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Every figure says how it was arrived at.
export const calculated = () => h('span', { className: 'tag' }, 'calculated');
export const estimated = () => h('span', { className: 'tag' }, 'estimate');

// Today in your own time zone, as yyyy-mm-dd.
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A notice names its status in words, with an icon, so colour is never the only signal.
const NOTICE = {
  attention: { icon: '⚠', className: 'notice' },
  refused: { icon: '✕', className: 'notice refused' },
  done: { icon: '✓', className: 'notice done' },
};
export function notice(kind, title, ...body) {
  const { icon, className } = NOTICE[kind];
  return h('div', { className, role: kind === 'refused' ? 'alert' : null },
    h('strong', null, h('span', { 'aria-hidden': 'true' }, `${icon} `), title), body);
}

export function row(label, value, ...extra) {
  return h('div', { className: 'row' }, h('div', null, label), h('div', { className: 'right' }, value, extra));
}

// A category picker, grouped by kind. Picking one calls onPick with its name.
export function categorySelect(state, { label, value = '', placeholder = 'Choose a category', onPick }) {
  const groups = { spend: 'Spending', saving: 'Saving and investing', income: 'Income', transfer: 'Transfers (not spending)' };
  return h('select', {
    'aria-label': label,
    onChange: (e) => { if (e.target.value) onPick(e.target.value); },
  },
  !value && h('option', { value: '' }, placeholder),
  Object.entries(groups).map(([kind, title]) => h('optgroup', { label: title },
    Object.entries(state.categories).filter(([, c]) => c.kind === kind)
      .map(([name]) => h('option', { value: name, selected: name === value }, name)))));
}

// An iPhone or iPad has no downloads folder to save straight into, so it uses the share sheet.
// Everything else, including a Mac, downloads directly, even if it could offer sharing.
// iPads can report themselves as Macs, so a touch screen is what tells them apart.
export function usesShareSheet(nav) {
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  return ios && Boolean(nav.canShare);
}

// Returns false if you cancelled, so nothing is recorded as saved.
export async function deliver(file) {
  if (usesShareSheet(navigator) && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: file.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

// White by default. A remembered preference, so it is fine if storage is unavailable.
export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* it just will not be remembered */ }
}
export function loadTheme() {
  let theme = 'light';
  try { theme = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; } catch { /* stay white */ }
  document.documentElement.dataset.theme = theme;
}
