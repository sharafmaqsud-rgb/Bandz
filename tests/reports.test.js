// The three statements and both exports, on invented statements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPages } from '../src/core/pdf-text.js';
import { importStatement, parseStatement } from '../src/core/pdf-statements.js';
import { addTransactions, createState, migrate, setBalance, setRule } from '../src/core/model.js';
import { applyRules } from '../src/core/categorise.js';
import { netWorth } from '../src/core/analysis.js';
import { buildHighlights, monthlySeries, pounds, spendingPace, topMerchants } from '../src/core/highlights.js';
import { toSlices } from '../src/core/palette.js';
import { usesShareSheet } from '../src/ui/dom.js';
import { availablePeriods, balanceSheet, cashFlow, incomeStatement } from '../src/core/statements.js';
import { buildXlsx } from '../src/core/xlsx.js';
import { buildReportXlsx } from '../src/core/report-xlsx.js';
import { buildReportPdf } from '../src/core/report-pdf.js';
import { makePdf } from './fixtures/make-pdf.js';
import { amexPages, clubPages, generate, ultraPages } from './fixtures/synthetic.js';

const months = generate();
async function loaded() {
  const s = createState(1);
  setRule(s, 'EXAMPLE EMPLOYER', 'Salary', 1);
  for (const m of [8, 9, 10]) {
    const mm = String(m).padStart(2, '0'), start = `2026-${mm}-01`, end = `2026-${mm}-${m === 9 ? 30 : 31}`;
    // The opening balance carries on from the month before, as on real statements.
    const prior = months[m - 1]?.club ?? [];
    const opening = 100000 + [8, 9].filter((x) => x < m).reduce((t, x) => t + months[x].club.reduce((a, r) => a + r.in - r.out, 0), 0) + (prior.length ? 0 : 0);
    for (const cells of [clubPages(months[m].club, { start, end, opening }), ultraPages(months[m].ultra, { statementDate: end }), amexPages(months[m].amex, { statementDate: end })]) {
      importStatement(s, parseStatement(await extractPages({ getDocument }, makePdf(cells))));
    }
  }
  setBalance(s, '2026-10-31', 'vanguard-isa', '40000');
  setBalance(s, '2026-10-31', 'lg-pension', '2000');
  setBalance(s, '2026-10-31', 'amex-gold', '300');
  return s;
}
const S = await loaded();
const OCT = availablePeriods(S).find((p) => p.id === 'm:2026-10');

test('periods list each month and tax year, newest first', () => {
  const ids = availablePeriods(S).map((p) => p.id);
  assert.deepEqual(ids, ['m:2026-10', 'm:2026-09', 'm:2026-08', 't:2026']);
  const ty = availablePeriods(S).at(-1);
  assert.deepEqual([ty.start, ty.end, ty.label], ['2026-04-06', '2027-04-05', 'Tax year 2026/27']);
  assert.equal(OCT.label, 'October 2026');
});

test('the removed student loan disappears from data saved by a test build', () => {
  const s = createState(1);
  s.accounts['student-loan'] = { name: 'Plan 2 student loan', class: 'loan', hasStatements: false, isIsa: false };
  s.balances['2026-10-31|student-loan'] = { date: '2026-10-31', account: 'student-loan', balancePence: -3000000 };
  migrate(s);
  assert.equal(s.accounts['student-loan'], undefined);
  assert.deepEqual(s.balances, {});
  assert.equal(netWorth(s).total, 0);
  assert.equal(createState(1).accounts['student-loan'], undefined);
});

test('income statement adds up, by hand from the raw lists', () => {
  const i = incomeStatement(S, OCT);
  const raw = months[10];
  const income = raw.club.filter((r) => /SALARY|COMMISSION|INTEREST PAID/.test(r.description)).reduce((t, r) => t + r.in, 0);
  assert.equal(i.totalIncome, income);
  assert.equal(i.totalSaved, 165000);
  const sum = (l) => l.reduce((t, x) => t + x.pence, 0);
  assert.equal(sum(i.income), i.totalIncome);
  assert.equal(sum(i.essential), i.totalEssential);
  assert.equal(sum(i.other), i.totalOther);
  assert.equal(i.totalEssential + i.totalOther, i.totalSpend);
  assert.equal(i.surplus, i.totalIncome - i.totalSpend);
  assert.equal(i.leftOver, i.surplus - i.totalSaved);
  assert.equal(i.savingsRate, i.totalSaved / i.totalIncome);
});

test('balance sheet: assets minus debts equals net worth, and matches Overview', () => {
  const b = balanceSheet(S, OCT);
  assert.equal(b.netWorth, b.totalAssets - b.totalDebts);
  assert.equal(b.netWorth, netWorth(S, b.asOf).total);
  assert.equal(b.debts.find((g) => g.name === 'Credit cards').total, 30000);
  assert.ok(b.missing.includes('Coinbase'));
});

test('balance sheet shows debts as positive amounts, and a card in credit as negative', () => {
  const s = createState(1);
  addTransactions(s, [{ account: 'lloyds-club', date: '2026-10-01', description: 'X', amountPence: -1, currency: 'GBP' }], 1);
  setBalance(s, '2026-10-31', 'amex-gold', '-50'); // £50 in credit
  setBalance(s, '2026-10-31', 'lloyds-ultra', '200');
  const b = balanceSheet(s, availablePeriods(s)[0]);
  const items = b.debts.find((g) => g.name === 'Credit cards').items;
  assert.equal(items.find((l) => l.name === 'Amex Gold').pence, -5000);
  assert.equal(items.find((l) => l.name.startsWith('Lloyds Ultra')).pence, 20000);
  assert.equal(b.netWorth, 5000 - 20000);
});

test('investment growth is the rise in value not explained by payments in', () => {
  const s = createState(1);
  addTransactions(s, [{ account: 'lloyds-club', date: '2026-10-05', description: 'VANGUARD ISA', amountPence: -150000, currency: 'GBP' }], 1);
  applyRules(s, 2);
  setBalance(s, '2026-09-30', 'vanguard-isa', '10000');
  setBalance(s, '2026-10-31', 'vanguard-isa', '11700');
  assert.equal(balanceSheet(s, availablePeriods(s)[0]).growthEstimate, 20000);
});

test('cash flow reconciles to the statement balances, every month', () => {
  for (const p of availablePeriods(S).filter((x) => x.kind === 'month')) {
    const c = cashFlow(S, p);
    assert.equal(c.reconciled, true, p.label);
    assert.equal(c.difference, 0);
    assert.equal(c.closing, c.opening + c.netCash);
  }
  const whole = cashFlow(S, availablePeriods(S).at(-1));
  assert.equal(whole.reconciled, true);
});

test('cash flow sums to the raw movement, and treats card spending as not yet cash', () => {
  const c = cashFlow(S, OCT);
  const raw = months[10].club.reduce((t, r) => t + r.in - r.out, 0);
  assert.equal(c.netCash, raw);
  assert.equal(c.cardsPaid, months[10].club.filter((r) => /CREDIT CARD|AMEX PAYMENT/.test(r.description)).reduce((t, r) => t + r.out, 0));
  assert.equal(c.moved, 5000); // the Revolut top-up
  assert.ok(c.cardSpend > 0);
  assert.equal(c.received + (-c.paid) + (-c.cardsPaid), c.operating);
});

test('cash flow reports a missing month rather than hiding it', () => {
  const s = structuredClone(S);
  const victim = Object.values(s.transactions).find((t) => t.account === 'lloyds-club' && t.date.startsWith('2026-10') && t.amountPence === -2200);
  delete s.transactions[victim.key];
  const c = cashFlow(s, OCT);
  assert.equal(c.reconciled, false);
  assert.equal(c.difference, -2200);
});

test('cash flow says so when balances are unavailable', () => {
  const s = createState(1);
  addTransactions(s, [{ account: 'lloyds-club', date: '2026-10-01', description: 'X', amountPence: -100, currency: 'GBP' }], 1);
  const c = cashFlow(s, availablePeriods(s)[0]);
  assert.equal(c.reconciled, null);
  assert.equal(c.opening, null);
});

// ---------- Reading our own Excel file back ----------

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true), nameLen = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen;
    files[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
    at = start + size;
  }
  return files;
}
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function readSheet(xml) {
  const cells = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/gs)) {
    const f = /<f>(.*?)<\/f>/s.exec(m[3]);
    const v = /<v>(.*?)<\/v>/s.exec(m[3]);
    const t = /<t[^>]*>(.*?)<\/t>/s.exec(m[3]);
    cells[m[1]] = { f: f && unescape(f[1]), v: v ? Number(v[1]) : null, t: t && unescape(t[1]) };
  }
  return cells;
}
// A small evaluator for the formulas the report uses, so stored values are really checked.
function evaluate(f, cells, tx) {
  const num = (ref) => { const c = cells[ref]; return c ? (c.f ? evaluate(c.f, cells, tx) : c.v ?? 0) : 0; };
  let m;
  if ((m = /^SUM\(B(\d+):B(\d+)\)$/.exec(f))) {
    let t = 0;
    for (let r = +m[1]; r <= +m[2]; r++) t += num(`B${r}`);
    return t;
  }
  if ((m = /^(-?)SUMIFS\(Transactions!F:F,Transactions!D:D,"(.*)"\)$/.exec(f))) {
    let t = 0;
    for (const k of Object.keys(tx)) if (k.startsWith('D') && tx[k].t === m[2]) t += tx[`F${k.slice(1)}`].v;
    return m[1] ? -t : t;
  }
  if ((m = /^IF\(B(\d+)>0,B(\d+)\/B\1,0\)$/.exec(f))) return num(`B${m[1]}`) > 0 ? num(`B${m[2]}`) / num(`B${m[1]}`) : 0;
  if (/^B\d+([+-]B\d+)*$/.test(f)) {
    return [...f.matchAll(/([+-]?)B(\d+)/g)].reduce((t, x) => t + (x[1] === '-' ? -1 : 1) * num(`B${x[2]}`), 0);
  }
  throw new Error(`Formula not understood: ${f}`);
}

test('the Excel file is a proper workbook with four sheets', () => {
  const files = readZip(buildReportXlsx(S, OCT));
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet4.xml']) assert.ok(files[n], n);
  assert.match(files['xl/workbook.xml'], /name="Income statement".*name="Balance sheet".*name="Cash flow".*name="Transactions"/s);
});

test('every Excel formula recalculates to the value stored, and the statements agree', () => {
  const files = readZip(buildReportXlsx(S, OCT));
  const tx = readSheet(files['xl/worksheets/sheet4.xml']);
  let formulas = 0;
  for (const n of [1, 2, 3]) {
    const cells = readSheet(files[`xl/worksheets/sheet${n}.xml`]);
    for (const [ref, c] of Object.entries(cells)) {
      if (!c.f) continue;
      formulas++;
      assert.ok(Math.abs(evaluate(c.f, cells, tx) - c.v) < 0.005, `Sheet ${n} ${ref}: ${c.f}`);
    }
  }
  assert.ok(formulas >= 25, `${formulas} formulas`);

  const income = readSheet(files['xl/worksheets/sheet1.xml']);
  const find = (cells, label) => {
    const key = Object.keys(cells).find((k) => cells[k].t === label);
    return cells[`B${key.slice(1)}`].v;
  };
  const i = incomeStatement(S, OCT);
  assert.equal(Math.round(find(income, 'Total income') * 100), i.totalIncome);
  assert.equal(Math.round(find(income, 'Left over') * 100), i.leftOver);
  const bal = readSheet(files['xl/worksheets/sheet2.xml']);
  assert.equal(Math.round(find(bal, 'Net worth') * 100), balanceSheet(S, OCT).netWorth);
  const cash = readSheet(files['xl/worksheets/sheet3.xml']);
  assert.equal(Math.round(find(cash, 'Difference') * 100), 0);
});

test('text can never become a formula, or break the file', () => {
  const bytes = buildXlsx([{ name: 'A & B', rows: [['=HYPERLINK("http://evil")', '<script>&', 'a\u0001b']] }]);
  const xml = readZip(bytes)['xl/worksheets/sheet1.xml'];
  assert.ok(!xml.includes('<f>'));
  assert.ok(xml.includes('t="inlineStr"'));
  assert.ok(!xml.includes('<script>'));
  assert.ok(!xml.includes('\u0001'));
  assert.match(readZip(bytes)['xl/workbook.xml'], /name="A &amp; B"/);
});

test('the same data always gives an identical Excel file', () => {
  assert.deepEqual(buildReportXlsx(S, OCT), buildReportXlsx(S, OCT));
});

// ---------- Reading our own PDF back ----------

const pdfPages = (bytes) => extractPages({ getDocument }, bytes);
const pdfText = async (bytes) => (await pdfPages(bytes)).map((p) => p.items.map((i) => i.s).join(' ')).join(' \n ');

test('the PDF is a highlights report, not a set of statements', async () => {
  const text = await pdfText(buildReportPdf(S, OCT));
  for (const part of ['Your money', 'October 2026', 'Where it went', 'The last six months', 'Going well', 'Worth watching', 'What to do next', 'Biggest merchants', 'Page 1 of 2']) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(!text.includes('Total essential spending'), 'statements belong in Excel');
  assert.ok(!text.includes('student loan'));
});

test('the PDF figures match the calculations', async () => {
  const text = await pdfText(buildReportPdf(S, OCT));
  const story = buildHighlights(S, OCT);
  for (const v of [story.kpis.spend, story.kpis.saved, story.kpis.netWorth]) assert.ok(text.includes(pounds(v)), pounds(v));
  assert.ok(text.includes(`${Math.round(story.kpis.savingsRate * 100)}%`));
  for (const i of [...story.wins, ...story.watch, ...story.next]) {
    assert.ok(text.replace(/\s+/g, ' ').includes(i.text.slice(0, 18)), i.text);
  }
});

test('the PDF stays on the page with long text and awkward characters', async () => {
  const s = structuredClone(S);
  s.accounts['pension-long'] = { name: `Provider ${'Very Long Name '.repeat(30)}Café — Zoë’s \\ (test)`, class: 'pension', hasStatements: false, isIsa: false };
  const pages = await pdfPages(buildReportPdf(s, OCT));
  for (const p of pages) for (const it of p.items) {
    assert.ok(it.y >= 30 && it.y <= 842, `${it.s} at y ${it.y}`);
    assert.ok(it.x >= 30 && it.x + it.w <= 575, `${it.s.slice(0, 30)} runs to ${it.x + it.w}`);
  }
});

test('reports work for an empty period and a whole tax year', async () => {
  const ty = availablePeriods(S).at(-1);
  assert.ok((await pdfText(buildReportPdf(S, ty))).includes('Tax year'));
  assert.ok(readZip(buildReportXlsx(S, ty))['xl/workbook.xml']);
  const empty = { id: 'm:2020-01', kind: 'month', label: 'January 2020', start: '2020-01-01', end: '2020-01-31' };
  assert.ok((await pdfText(buildReportPdf(S, empty))).includes('January 2020'));
  assert.ok(readZip(buildReportXlsx(S, empty))['xl/worksheets/sheet4.xml']);
});

// ---------- Saving files ----------

test('a Mac downloads directly, even when its browser offers sharing', () => {
  const canShare = () => true;
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
  assert.equal(usesShareSheet({ userAgent: mac, maxTouchPoints: 0, canShare }), false);
  assert.equal(usesShareSheet({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5, canShare }), true);
  assert.equal(usesShareSheet({ userAgent: mac, maxTouchPoints: 5, canShare }), true); // an iPad reports itself as a Mac
  assert.equal(usesShareSheet({ userAgent: 'Mozilla/5.0 (iPhone)', maxTouchPoints: 5 }), false);
  assert.equal(usesShareSheet({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', maxTouchPoints: 0, canShare }), false);
});

// ---------- Highlights ----------

test('highlights tell the story, with labelled figures', () => {
  const h = buildHighlights(S, OCT);
  assert.match(h.headline, /^October 2026: £[\d,]+ came in, you spent £[\d,]+/);
  assert.ok(h.wins.length && h.watch.length && h.next.length);
  for (const i of [...h.wins, ...h.watch, ...h.next]) assert.ok(['calculated', 'estimate'].includes(i.label), i.text);
  assert.ok(h.watch.some((i) => /Shopping/.test(i.text)));
  assert.ok(h.next.some((i) => /recurring/.test(i.text) && i.label === 'estimate'));
});

test('no target is judged until you have set one', () => {
  const s = structuredClone(S);
  const without = buildHighlights(s, OCT);
  assert.ok(![...without.wins, ...without.watch].some((i) => /target/.test(i.text)));
  s.goals.monthlyIsaTargetPence = 150000;
  assert.ok(buildHighlights(s, OCT).wins.some((i) => /hit your ISA target/.test(i.text)));
  s.goals.monthlyIsaTargetPence = 200000;
  assert.ok(buildHighlights(s, OCT).watch.some((i) => /against your £2,000 target/.test(i.text)));
});

test('building highlights changes nothing in your data', () => {
  const s = structuredClone(S);
  const before = JSON.stringify(s);
  buildHighlights(s, OCT);
  assert.equal(JSON.stringify(s), before);
});

test('spending pace builds up day by day, and projects an unfinished month', () => {
  const s = createState(1);
  addTransactions(s, [
    { account: 'amex-gold', date: '2026-10-02', description: 'TESCO 1', amountPence: -1000, currency: 'GBP' },
    { account: 'amex-gold', date: '2026-10-10', description: 'TESCO 2', amountPence: -500, currency: 'GBP' },
  ], 1);
  applyRules(s, 2);
  const p = spendingPace(s, '2026-10');
  assert.equal(p.through, 10);
  assert.equal(p.current.length, 10);
  assert.deepEqual([p.current[0], p.current[1], p.current[9]], [0, 1000, 1500]);
  assert.equal(p.projected, Math.round((1500 / 10) * 31));
  assert.equal(p.previous, null);
});

test('monthly series and biggest merchants', () => {
  assert.deepEqual(monthlySeries(S, '2026-10').map((m) => m.month), ['2026-08', '2026-09', '2026-10']);
  const top = topMerchants(S, OCT);
  assert.ok(top.length <= 5);
  assert.ok(top[0].pence >= top[1].pence);
});

test('chart slices keep to six colours, and each slice is different', () => {
  const lines = ['Groceries', 'Transport', 'Shopping', 'Bills & phone', 'Subscriptions', 'Eating out & takeaway', 'Travel & holidays', 'Other spend'].map((name, i) => ({ name, pence: 1000 - i }));
  const slices = toSlices(lines);
  const coloured = slices.filter((x) => x.hue >= 0);
  assert.equal(coloured.length, 6);
  assert.equal(new Set(coloured.map((x) => x.hue)).size, 6);
  assert.equal(slices.at(-1).name, 'Everything else');
  assert.equal(slices.reduce((t, x) => t + x.pence, 0), lines.reduce((t, x) => t + x.pence, 0));
  assert.equal(toSlices([{ name: 'Groceries', pence: 5 }])[0].hue, toSlices([{ name: 'Groceries', pence: 900 }, { name: 'Transport', pence: 1 }])[0].hue);
});

test('a first balance is not reported as a rise in net worth', () => {
  const s = createState(1);
  addTransactions(s, [
    { account: 'lloyds-club', date: '2026-09-05', description: 'X', amountPence: -1, currency: 'GBP' },
    { account: 'lloyds-club', date: '2026-10-05', description: 'Y', amountPence: -1, currency: 'GBP' },
  ], 1);
  const period = availablePeriods(s).find((p) => p.id === 'm:2026-10');
  setBalance(s, '2026-09-30', 'lloyds-club', '1000');
  setBalance(s, '2026-10-31', 'lloyds-club', '1200');
  setBalance(s, '2026-10-31', 'vanguard-isa', '50000'); // existing savings, entered for the first time
  const b = balanceSheet(s, period);
  assert.equal(b.change, 20000);
  assert.ok(buildHighlights(s, period).wins.some((i) => /rose by £200\b/.test(i.text)));
  assert.ok(!buildHighlights(s, period).wins.some((i) => /£50,/.test(i.text)));
});

test('with balances from one date only, no change is claimed', () => {
  const s = createState(1);
  addTransactions(s, [{ account: 'lloyds-club', date: '2026-10-05', description: 'Y', amountPence: -1, currency: 'GBP' }], 1);
  setBalance(s, '2026-10-31', 'lloyds-club', '1200');
  assert.equal(balanceSheet(s, availablePeriods(s)[0]).change, null);
});

test('long capitals wrap inside the PDF story, with room to spare', async () => {
  const s = structuredClone(S);
  const key = Object.keys(s.transactions).find((k) => s.transactions[k].description === 'NETFLIX.COM');
  for (const t of Object.values(s.transactions)) if (t.description === 'NETFLIX.COM') t.description = 'WWWWWWWW MMMMMMMM QQQQQQQQ';
  assert.ok(key);
  for (const p of await pdfPages(buildReportPdf(s, OCT))) for (const it of p.items) {
    assert.ok(it.x + it.w <= 556, `${it.s.slice(0, 40)} runs to ${it.x + it.w}`);
  }
});
