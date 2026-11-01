// Import: read statements on this device, say exactly what happened to each, and settle
// anything the rules could not.
import { uncategorisedMerchants } from '../core/analysis.js';
import { applyRules, pairCardRepayments } from '../core/categorise.js';
import { applySeed, setRule } from '../core/model.js';
import { formatPence } from '../core/money.js';
import { parseStatement, importStatement } from '../core/pdf-statements.js';
import { extractPages } from '../core/pdf-text.js';
import { categorySelect, fullDate, h, money, notice, plural } from './dom.js';
import { renderSecurity } from './security.js';

// pdf.js is large, so it only loads when a statement is actually being read. Its worker
// comes from this app's own files, which the content policy allows.
async function loadPdfJs() {
  const pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;

async function importPdf(app, file) {
  const pages = await extractPages(await loadPdfJs(), new Uint8Array(await file.arrayBuffer()));
  const parsed = parseStatement(pages, file.name);
  const accountName = app.state.accounts[parsed.account].name;
  if (!parsed.reconciled) {
    return {
      kind: 'refused',
      title: `Refused: ${accountName}`,
      lines: ['It did not match the totals printed on the statement, so nothing was imported.',
        ...parsed.checks.filter((c) => !c.ok).map((c) => `Failed: ${c.name}`)],
    };
  }
  const { inserted, skipped } = importStatement(app.state, parsed);
  return {
    kind: 'done',
    title: `Imported: ${accountName}`,
    lines: [`${inserted} new, ${skipped} already here. Matches the statement's totals.`, ...parsed.warnings],
  };
}

async function importSeed(app, file) {
  applySeed(app.state, JSON.parse(await file.text()));
  applyRules(app.state);
  return { kind: 'done', title: 'Loaded your starting file', lines: ['Balances, rules and targets are in place.'] };
}

async function handleFiles(app, files) {
  const { view } = app;
  view.importing = true;
  view.importResults = [];
  app.render();
  for (const file of files) {
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large to be a statement.');
      const isSeed = file.name.toLowerCase().endsWith('.json');
      view.importResults.push(await (isSeed ? importSeed(app, file) : importPdf(app, file)));
    } catch (err) {
      view.importResults.push({ kind: 'refused', title: `Could not read ${file.name}`, lines: [err.message] });
    }
  }
  view.importing = false;
  await app.commit();
}

export function renderImport(app) {
  const { state, view } = app;
  const merchants = uncategorisedMerchants(state);
  const unpaired = pairCardRepayments(state);
  const statements = Object.values(state.statements).sort((a, b) => b.date.localeCompare(a.date));
  return [
    h('h1', null, 'Import'),
    h('section', null,
      h('div', { className: 'file-pick' },
        h('p', null, 'Add PDF statements from Club Lloyds, Lloyds Ultra or Amex Gold. You can add several at once, and adding one twice is safe.'),
        h('label', { className: 'button primary' }, view.importing ? 'Reading…' : 'Choose files',
          h('input', {
            id: 'file-input',
            className: 'visually-hidden',
            type: 'file',
            multiple: true,
            accept: '.pdf,.json,application/pdf,application/json',
            disabled: view.importing,
            onChange: (e) => { const files = [...e.target.files]; if (files.length) handleFiles(app, files); },
          })),
        h('p', { className: 'muted' }, 'Files are read on this device and are not sent anywhere.'))),
    view.importResults?.length > 0 && h('section', { 'aria-live': 'polite' },
      view.importResults.map((r) => notice(r.kind, r.title, r.lines.map((l) => h('p', null, l))))),
    unpaired.length > 0 && h('section', null,
      notice('attention', `Needs attention: ${plural(unpaired.length, 'card payment has', 'card payments have')} no match`,
        h('p', null, 'No current-account payment of the same amount was found within 10 days. Importing the statement for that month usually fixes this. Until then, if the payment did leave your current account, it may be counting as spending as well as the purchases it paid for.'),
        h('ul', null, unpaired.map((p) => h('li', null,
          `${state.accounts[p.account].name}: ${formatPence(p.amountPence)} on ${fullDate(p.date)}`))))),
    merchants.length > 0 && h('section', null,
      h('h2', null, `Choose categories (${merchants.length})`),
      h('p', { className: 'muted' }, 'Each choice also applies to future statements. To change a single transaction, use Spending.'),
      merchants.map((m) => h('div', { className: 'review' },
        h('div', { className: 'review-head' },
          h('span', null, m.merchant, h('span', { className: 'muted' }, ` · ${plural(m.count, 'row', 'rows')}`)),
          money(m.pence)),
        categorySelect(state, {
          label: `Category for ${m.merchant}`,
          onPick: (category) => {
            setRule(state, m.merchant, category);
            applyRules(state);
            app.commit();
          },
        })))),
    statements.length > 0 && h('section', null,
      h('h2', null, 'Statements on this device'),
      h('div', { className: 'rows' }, statements.map((s) => h('div', { className: 'row' },
        h('div', null, state.accounts[s.account].name, h('div', { className: 'muted' }, `to ${fullDate(s.date)}`)),
        h('div', { className: 'right muted' }, `${s.rows} rows`))))),
    renderSecurity(app),
    h('section', null,
      h('h2', null, 'Delete data'),
      h('p', { className: 'muted' }, 'Removes everything this app holds on this device. It cannot be undone.'),
      h('button', {
        className: 'danger',
        onClick: () => {
          if (window.confirm('Delete all finance data on this device? This cannot be undone.')) app.reset();
        },
      }, 'Delete all data')),
  ];
}
