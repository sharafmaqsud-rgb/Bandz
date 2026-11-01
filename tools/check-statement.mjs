// Try the importers on real PDF statements, on this device, and print a report with no
// personal content: only check results, counts, category names and masked descriptions.
//
//   node tools/check-statement.mjs statement1.pdf statement2.pdf ...
import { existsSync, readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPages } from '../src/core/pdf-text.js';
import { parseStatement, importStatement } from '../src/core/pdf-statements.js';
import { createState, applySeed } from '../src/core/model.js';
import { classify } from '../src/core/analysis.js';
import { reviewQueue } from '../src/core/review.js';
import { availablePeriods, balanceSheet, cashFlow } from '../src/core/statements.js';
import { maskText } from './mask.js';

const seedPath = new URL('../local/seed.json', import.meta.url);
const state = createState();
if (existsSync(seedPath)) applySeed(state, JSON.parse(readFileSync(seedPath, 'utf8')));

const printQueue = () => {
  const q = reviewQueue(state);
  console.log(`\n=== all statements: ${Object.keys(state.transactions).length} rows, asks about ${q.merchants.length} merchants and ${q.unusual.length} unusual rows`);
  const reasons = {};
  for (const t of Object.values(state.transactions)) if (t.reason) reasons[t.reason.replace(/\(.*\)/, '')] = (reasons[t.reason.replace(/\(.*\)/, '')] ?? 0) + 1;
  console.log(reasons);
  for (const p of availablePeriods(state).filter((x) => x.kind === 'month')) {
    const c = cashFlow(state, p), b = balanceSheet(state, p);
    console.log(`${p.label}: cash flow reconciled ${c.reconciled}, balance sheet adds up ${b.netWorth === b.totalAssets - b.totalDebts}, missing balances ${b.missing.length}`);
  }
};

for (const path of process.argv.slice(2)) {
  console.log('\n---');
  try {
    const pages = await extractPages({ getDocument }, new Uint8Array(readFileSync(path)));
    const parsed = parseStatement(pages);
    console.log(`${parsed.account}: ${parsed.rows.length} rows, reconciled: ${parsed.reconciled}`);
    for (const c of parsed.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
    for (const w of parsed.warnings) console.log(`  WARN ${w}`);
    if (!parsed.reconciled) continue;
    const before = new Set(Object.keys(state.transactions));
    console.log(' ', importStatement(state, parsed));
    const added = Object.values(state.transactions).filter((t) => !before.has(t.key));
    const tally = {};
    for (const t of added) {
      const { kind, name } = classify(t, state.categories);
      const label = `${kind}/${name}`;
      tally[label] = (tally[label] ?? 0) + 1;
    }
    console.log('  rows by category:', tally);
    const unknown = added.filter((t) => !t.category).length;
    console.log(`  uncategorised: ${unknown} of ${added.length}`);
    const paired = Object.values(state.transactions).filter((t) => t.catSource === 'paired').length;
    console.log(`  current-account rows paired as card repayments so far: ${paired}`);
    const sources = {};
    for (const t of added) {
      const label = t.category ? `${t.catSource}/${t.confidence}` : 'asks you';
      sources[label] = (sources[label] ?? 0) + 1;
    }
    console.log('  how rows were filed:', sources);
  } catch (e) {
    // Only a FormatError quotes statement text. A TypeError is a bug in this code and is safe to show.
    console.log(e instanceof TypeError ? e.stack : `ERROR ${maskText(e.message)}`);
  }
}
printQueue();
