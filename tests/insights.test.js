// Goals, insights and accounts. Tests marked v1: are ported. All data here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPages } from '../src/core/pdf-text.js';
import { importStatement, parseStatement } from '../src/core/pdf-statements.js';
import { netWorth } from '../src/core/analysis.js';
import { bufferStatus, buildInsights, duplicateCharges, isaStatus, largePurchases, meets, monthlyMeasures, netWorthSeries, overspentCategories, recurringCharges, smallPurchases, taxYear } from '../src/core/insights.js';
import { monthlySummary } from '../src/core/summary.js';
import { addAccount, addTransactions, createState, migrate, removeAccount, renameAccount, setBalance, setRule } from '../src/core/model.js';
import { applyRules } from '../src/core/categorise.js';
import { makePdf } from './fixtures/make-pdf.js';
import { amexPages, clubPages, generate, ultraPages } from './fixtures/synthetic.js';

const months = generate();

async function loaded() {
  const s = createState();
  setRule(s, 'EXAMPLE EMPLOYER', 'Salary');
  for (const m of [8, 9, 10]) {
    const mm = String(m).padStart(2, '0'), start = `2026-${mm}-01`, end = `2026-${mm}-${m === 9 ? 30 : 31}`;
    for (const cells of [clubPages(months[m].club, { start, end }), ultraPages(months[m].ultra, { statementDate: end }), amexPages(months[m].amex, { statementDate: end })]) {
      importStatement(s, parseStatement(await extractPages({ getDocument }, makePdf(cells))));
    }
  }
  return s;
}
const S = await loaded();

test('v1: leaks are detected', () => {
  const dups = duplicateCharges(S, '2026-10');
  assert.equal(dups.length, 1);
  assert.equal(dups[0].amount, 2450);
  assert.ok(largePurchases(S, '2026-10').some((a) => a.amount === 18999));
  const names = recurringCharges(S, '2026-10').map((r) => r.merchant);
  assert.ok(names.includes('NETFLIX.COM') && names.includes('SPOTIFY'));
  assert.ok(!names.includes('TFL TRAVEL CH')); // four charges a month is not a subscription
});

test('recurring charges carry an annual estimate', () => {
  const netflix = recurringCharges(S, '2026-10').find((r) => r.merchant === 'NETFLIX.COM');
  assert.deepEqual(netflix, { merchant: 'NETFLIX.COM', monthly: 1099, months: 3, annualEstimate: 13188 });
});

test('a recurring charge that varies too much does not count', () => {
  const s = createState();
  for (const [m, p] of [['08', 1000], ['09', 1000], ['10', 2000]]) {
    addTransactions(s, [{ account: 'lloyds-club', date: `2026-${m}-01`, description: 'WIDGETCO', amountPence: -p, currency: 'GBP' }]);
  }
  applyRules(s);
  assert.deepEqual(recurringCharges(s, '2026-10'), []);
});

test('v1: small purchases and categories above average', () => {
  const small = smallPurchases(S, '2026-10');
  assert.ok(small.flagged && small.count >= 8);
  assert.ok(small.top.length <= 3);
  const over = overspentCategories(S, '2026-10').map((o) => o.category);
  assert.ok(over.includes('Shopping'));
  assert.ok(!over.includes('Travel & holidays')); // no earlier spending to be above, as in v1
});

test('v1: tax year boundaries', () => {
  assert.equal(taxYear('2027-04-05').startYear, 2026);
  assert.equal(taxYear('2027-04-06').startYear, 2027);
  assert.equal(taxYear('2026-11-01').label, '2026/27');
});

test('v1: ISA total, months left and allowance', () => {
  const isa = isaStatus(S, '2026-10');
  assert.equal(isa.paid, 450000); // Aug, Sep and Oct at £1,500
  assert.equal(isa.monthsLeft, 5);
  assert.equal(isa.remaining, 1550000);
  assert.equal(isa.neededPerMonth, 310000);
  assert.equal(isa.target, null);
  assert.equal(isa.projected, null);
  assert.equal(isa.startsLate, '2026-08-01');
});

test('ISA: a target gives a projection, earlier payments count, and going over is flagged', () => {
  const s = structuredClone(S);
  s.goals.monthlyIsaTargetPence = 150000;
  s.settings.isaPaidBeforeImportByTaxYear['2026/27'] = 900000;
  const isa = isaStatus(s, '2026-10');
  assert.equal(isa.paid, 1350000);
  assert.equal(isa.projected, 1350000 + 5 * 150000);
  assert.equal(isa.overBy, 100000);
  assert.equal(isa.startsLate, null);
});

test('marking an account as an ISA moves its payments into the ISA total', () => {
  const s = structuredClone(S);
  setRule(s, 'TRADING 212', 'ISA contribution');
  applyRules(s);
  assert.equal(isaStatus(s, '2026-10').paid, 450000 + 3 * 15000);
});

test('v1: cash buffer uses cash minus cards', () => {
  const s = structuredClone(S);
  setBalance(s, '2026-10-31', 'lloyds-club', '3000');
  setBalance(s, '2026-10-31', 'lloyds-ultra', '200');
  const b = bufferStatus(s, '2026-10');
  assert.equal(b.cash, 300000);
  assert.equal(b.available, 280000);
  assert.ok(b.essentials > 0);
  assert.equal(b.months, b.available / b.essentials);
});

test('the buffer has no pass or fail until a target is set', () => {
  const s = structuredClone(S);
  assert.equal(bufferStatus(s, '2026-10').met, null);
  assert.equal(bufferStatus(s, '2026-10').shortfall, null);
  s.goals.bufferMonthsTarget = 1000;
  const b = bufferStatus(s, '2026-10');
  assert.equal(b.met, false);
  assert.ok(b.shortfall > 0);
  assert.ok(buildInsights(s, '2026-10').some((i) => i.title === 'Cash buffer shortfall'));
});

test('meets: no target means neither pass nor fail', () => {
  assert.equal(meets(5, null), null);
  assert.equal(meets(null, 5), null);
  assert.equal(meets(5, 5), true);
  assert.equal(meets(6, 5, false), false);
});

test('every insight carries a calculated or estimate label', () => {
  const list = buildInsights(S, '2026-10');
  assert.ok(list.length >= 6);
  for (const i of list) assert.ok(['calculated', 'estimate'].includes(i.label), i.title);
  assert.equal(list.find((i) => i.title === 'Recurring charges').label, 'estimate');
  for (const title of ['Biggest categories', 'Change on last month', 'Possible duplicate charges', 'Unusually large purchases', 'Fees and interest', 'Small purchases add up', 'Cash buffer', 'ISA allowance pace']) {
    assert.ok(list.some((i) => i.title === title), title);
  }
});

test('monthly measures hold the last six months in order', () => {
  const m = monthlyMeasures(S, '2026-10');
  assert.deepEqual(m.map((x) => x.month), ['2026-08', '2026-09', '2026-10']);
  assert.equal(m[2].isa, 150000);
});

test('the net worth trend is like for like', () => {
  const s = createState();
  setBalance(s, '2026-09-30', 'revolut', '100');
  setBalance(s, '2026-10-31', 'vanguard-isa', '1000');
  setBalance(s, '2026-10-31', 'amex-gold', '50');
  // Entering an account for the first time is not a rise, so both points include all three.
  assert.deepEqual(netWorthSeries(s), [{ date: '2026-09-30', pence: 105000 }, { date: '2026-10-31', pence: 105000 }]);
  setBalance(s, '2026-11-30', 'vanguard-isa', '1100');
  assert.equal(netWorthSeries(s).at(-1).pence, 115000);
});

test('the summary is plain text, labelled, and leaves out private detail', () => {
  const s = structuredClone(S);
  const key = addAccount(s, 'Secret Pension Co', 'pension');
  setBalance(s, '2026-10-31', key, '1234');
  const text = monthlySummary(s, '2026-10');
  assert.match(text, /^MONTHLY SUMMARY 2026-10/);
  assert.match(text, /\(c\)/);
  assert.match(text, /\(e\)/);
  assert.match(text, /pension £1,234\.00/);
  assert.ok(!text.includes('Secret Pension Co'));
  assert.ok(!text.includes('00-00-00'));
  assert.ok(!/TESCO STORES \d/.test(text));
  assert.ok(text.length < 4000, `${text.length} characters`);
});

test('pension providers: add several, and they all count', () => {
  const s = createState();
  const a = addAccount(s, 'Provider One', 'pension');
  const b = addAccount(s, 'Provider Two', 'pension');
  assert.notEqual(a, b);
  setBalance(s, '2026-10-31', 'lg-pension', '100');
  setBalance(s, '2026-10-31', a, '200');
  setBalance(s, '2026-10-31', b, '300');
  assert.equal(netWorth(s).groups.pension, 60000);
  assert.equal(netWorth(s).total, 60000);
});

test('pension providers: names must be real and unique, and renaming works', () => {
  const s = createState();
  assert.throws(() => addAccount(s, '  ', 'pension'), /enter a name/);
  const a = addAccount(s, 'Provider One', 'pension');
  assert.throws(() => addAccount(s, 'provider one', 'pension'), /already/);
  assert.throws(() => renameAccount(s, a, 'Revolut'), /already/);
  renameAccount(s, a, 'Provider Uno');
  assert.equal(s.accounts[a].name, 'Provider Uno');
  renameAccount(s, a, 'Provider Uno'); // keeping its own name is fine
});

test('removing an account removes its balances, but one with transactions is refused', () => {
  const s = createState();
  const a = addAccount(s, 'Provider One', 'pension');
  setBalance(s, '2026-10-31', a, '200');
  removeAccount(s, a);
  assert.equal(s.accounts[a], undefined);
  assert.equal(netWorth(s).total, 0);
  addTransactions(s, [{ account: 'lloyds-club', date: '2026-10-01', description: 'X', amountPence: -1, currency: 'GBP' }]);
  assert.throws(() => removeAccount(s, 'lloyds-club'), /transactions/);
});

test('data saved by an earlier version gains new fields and keeps its own', () => {
  const old = createState();
  delete old.goals.netWorthTargetPence;
  old.goals.monthlyIsaTargetPence = 150000;
  const s = migrate(old);
  assert.equal(s.goals.netWorthTargetPence, null);
  assert.equal(s.goals.monthlyIsaTargetPence, 150000);
});
