// PDF statement import, on invented statements in the real page layouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPages } from '../src/core/pdf-text.js';
import { parseStatement, importStatement } from '../src/core/pdf-statements.js';
import { applyRules, pairCardRepayments } from '../src/core/categorise.js';
import { addTransactions, createState, setBalance, setRule } from '../src/core/model.js';
import { inMonth, summarise } from '../src/core/analysis.js';
import { FormatError } from '../src/core/money.js';
import { makePdf } from './fixtures/make-pdf.js';
import { generate, clubPages, ultraPages, amexPages, toItems } from './fixtures/synthetic.js';

const months = generate();
const OCT = { start: '2026-10-01', end: '2026-10-31' };
const club = (rows = months[10].club, opts = {}) => clubPages(rows, { ...OCT, ...opts });
const ultra = (rows = months[10].ultra, opts = {}) => ultraPages(rows, { statementDate: '2026-10-31', ...opts });
const amex = (rows = months[10].amex, opts = {}) => amexPages(rows, { statementDate: '2026-10-31', ...opts });

const viaPdf = async (cells) => parseStatement(await extractPages({ getDocument }, makePdf(cells)));

// Change one printed cell, as a misread would.
const tamper = (cells, find, to) => {
  const copy = cells.map((p) => p.map((c) => ({ ...c })));
  const cell = copy.flat().find((c) => c.s === find);
  assert.ok(cell, `No cell '${find}' to change`);
  cell.s = to;
  return copy;
};

test('each bank is recognised and every row is read, through a real PDF', async () => {
  for (const [cells, account, source] of [
    [club(), 'lloyds-club', months[10].club],
    [ultra(), 'lloyds-ultra', months[10].ultra],
    [amex(), 'amex-gold', months[10].amex],
  ]) {
    const parsed = await viaPdf(cells);
    assert.equal(parsed.account, account);
    assert.equal(parsed.rows.length, source.length);
    assert.deepEqual(parsed.checks.filter((c) => !c.ok), []);
    assert.equal(parsed.reconciled, true);
  }
});

test('v1: Lloyds sign - money in is positive, money out is negative', async () => {
  const { rows } = await viaPdf(club());
  assert.equal(rows.find((r) => r.description === 'EXAMPLE EMPLOYER SALARY').amountPence, 265000);
  assert.equal(rows.find((r) => r.description === 'VANGUARD ASSET MGMT ISA').amountPence, -150000);
  assert.ok(rows.every((r) => r.balancePence !== null));
});

test('v1: Amex sign - charges are negative, payments positive, and so on Ultra too', async () => {
  for (const cells of [amex(), ultra()]) {
    const { rows } = await viaPdf(cells);
    assert.ok(rows.find((r) => r.description.startsWith('PAYMENT RECEIVED')).amountPence > 0);
    assert.ok(rows.filter((r) => !r.description.startsWith('PAYMENT RECEIVED')).every((r) => r.amountPence < 0));
  }
});

test('dates are read correctly on each statement', async () => {
  assert.equal((await viaPdf(club())).rows[0].date.slice(0, 7), '2026-10');
  assert.equal((await viaPdf(ultra())).rows[0].date, '2026-10-01');
  assert.equal((await viaPdf(amex())).rows[0].date, '2026-10-06');
});

test('card rows with no year: December on a January statement is last year', async () => {
  const rows = [{ date: '2026-12-30', description: 'SHOP A', charge: 1000 }, { date: '2027-01-02', description: 'SHOP B', charge: 500 }];
  for (const cells of [ultra(rows, { statementDate: '2027-01-20' }), amex(rows, { statementDate: '2027-01-20' })]) {
    const parsed = await viaPdf(cells);
    assert.deepEqual(parsed.rows.map((r) => r.date), ['2026-12-30', '2027-01-02']);
  }
});

test('Ultra: the foreign rate line is left out, and the sterling amount is used', async () => {
  const row = (await viaPdf(ultra())).rows.find((r) => r.description.startsWith('SPOTIFY'));
  assert.equal(row.description, 'SPOTIFY P12A3B');
  assert.equal(row.amountPence, -1199);
});

test('Amex: wrapped descriptions join, the amount sits off-line, foreign column is ignored', async () => {
  const rows = [
    { date: '2026-10-08', description: 'ZARA UK ONLINE', charge: 4500, wrap: 'LONDON GB' },
    { date: '2026-10-09', description: 'HOTEL EXAMPLE', charge: 9000, foreign: '105.00 EUR' },
    { date: '2026-10-10', description: 'REFUND EXAMPLE', credit: 700 },
  ];
  const parsed = await viaPdf(amex(rows));
  assert.deepEqual(parsed.rows.map((r) => [r.description, r.amountPence]), [
    ['ZARA UK ONLINE LONDON GB', -4500], ['HOTEL EXAMPLE', -9000], ['REFUND EXAMPLE', 700],
  ]);
  assert.equal(parsed.reconciled, true);
});

test('Amex: text below the table does not join the last row', async () => {
  const { rows } = await viaPdf(amex());
  assert.ok(!rows.some((r) => /Total new|Example/.test(r.description)));
});

test('Club: text below the table does not join the last row', async () => {
  const { rows } = await viaPdf(club());
  assert.ok(!rows.some((r) => /Transaction Types|Bank Giro|Continued/.test(r.description)));
});

test('invisible zero-width labels are ignored, as on real Lloyds statements', () => {
  const pages = toItems(club());
  for (const p of pages) {
    const rowY = p.items.filter((i) => /^\d\d Oct 26$/.test(i.s)).map((i) => i.y);
    for (const y of rowY) {
      p.items.push({ x: 57, y: y + 9, w: 0, s: 'Date' }, { x: 375, y: y + 5, w: 0, s: 'Money In (£)' }, { x: 375, y, w: 0, s: 'blank.' });
    }
  }
  const parsed = parseStatement(pages);
  assert.equal(parsed.rows.length, months[10].club.length);
  assert.equal(parsed.reconciled, true);
});

test('Club: an opening balance printed after the first row is accepted, as on a real statement', async () => {
  const parsed = await viaPdf(club(months[10].club, { openingAfterFirst: true }));
  assert.equal(parsed.reconciled, true);
});

test('Card statements with a balance carried in reconcile', async () => {
  const rows = months[10].amex;
  for (const cells of [amex(rows, { opening: 12345 }), ultra(months[10].ultra, { opening: 12345 })]) {
    const parsed = await viaPdf(cells);
    assert.equal(parsed.reconciled, true);
    assert.equal(parsed.statement.closingBalancePence, -12345);
  }
});

test('a misread amount is caught on every statement type', async () => {
  const clubRow = months[10].club.find((r) => r.description === 'VODAFONE LTD DD');
  assert.equal(clubRow.out, 2200);
  const misreads = [
    tamper(club(), '22.00', '32.00'),
    tamper(ultra(), '10.99', '19.99'),
    tamper(amex(), '182.40', '132.40'),
  ];
  for (const cells of misreads) assert.equal((await viaPdf(cells)).reconciled, false);
});

test('a dropped row is caught on every statement type', () => {
  const dropRow = (pages, rowDate) => pages.map((p) => ({
    items: p.items.filter((i) => {
      const y = p.items.find((c) => c.s === rowDate)?.y;
      return y === undefined || Math.abs(i.y - y) > 2;
    }),
  }));
  assert.equal(parseStatement(dropRow(toItems(club()), '03 Oct 26')).reconciled, false);
  assert.equal(parseStatement(dropRow(toItems(ultra()), '12 OCTOBER')).reconciled, false);
  assert.equal(parseStatement(dropRow(toItems(amex()), 'Oct 21')).reconciled, false);
});

test('a statement that fails its checks is refused and changes nothing', async () => {
  const s = createState();
  const parsed = await viaPdf(tamper(amex(), '182.40', '132.40'));
  assert.throws(() => importStatement(s, parsed), /did not add up/);
  assert.deepEqual(s.transactions, {});
  assert.deepEqual(s.balances, {});
});

test('a statement with no rows is refused, even though its sums agree', () => {
  const parsed = parseStatement(toItems(amex([], {})));
  assert.equal(parsed.reconciled, false);
});

test('an unrecognised PDF is rejected', async () => {
  await assert.rejects(viaPdf([[{ x: 50, y: 700, s: 'Some other document' }]]), FormatError);
});

test('v1: re-importing a statement adds nothing, and true repeats are kept', async () => {
  const s = createState();
  const parsed = await viaPdf(ultra());
  assert.equal(importStatement(s, parsed).inserted, months[10].ultra.length);
  const again = importStatement(s, parsed);
  assert.deepEqual([again.inserted, again.skipped], [0, months[10].ultra.length]);
  assert.equal(Object.values(s.transactions).filter((t) => t.description === 'DELIVEROO 5521').length, 2);
});

test('the closing balance is recorded, without replacing one you entered', async () => {
  const s = createState();
  setBalance(s, '2026-10-31', 'lloyds-ultra', '999');
  importStatement(s, await viaPdf(ultra()));
  importStatement(s, await viaPdf(club()));
  assert.equal(s.balances['2026-10-31|lloyds-ultra'].balancePence, -99900);
  const lastClub = (await viaPdf(club())).rows.at(-1).balancePence;
  assert.equal(s.balances['2026-10-31|lloyds-club'].balancePence, lastClub);
});

test('v1: one month reconciles against the raw inputs, using separate logic', async () => {
  const s = createState();
  setRule(s, 'EXAMPLE EMPLOYER', 'Salary');
  for (const m of [8, 9, 10]) {
    const start = `2026-${String(m).padStart(2, '0')}-01`, end = `2026-${String(m).padStart(2, '0')}-${m === 9 ? 30 : 31}`;
    for (const cells of [
      clubPages(months[m].club, { start, end }),
      ultraPages(months[m].ultra, { statementDate: end }),
      amexPages(months[m].amex, { statementDate: end }),
    ]) importStatement(s, await viaPdf(cells));
  }
  const cur = summarise(inMonth(s, '2026-10'), s.categories);

  // Deliberately plain: works from the raw lists with word checks and no shared code.
  const words = (d, list) => list.some((w) => d.includes(w));
  const SKIP = ['REVOLUT TOP-UP', 'LLOYDS BANK CREDIT CARD', 'AMEX PAYMENT', 'PAYMENT RECEIVED'];
  let income = 0, spend = 0, saved = 0;
  for (const r of months[10].club) {
    if (words(r.description, SKIP)) continue;
    if (words(r.description, ['SALARY', 'COMMISSION', 'INTEREST PAID'])) income += r.in;
    else if (words(r.description, ['VANGUARD', 'TRADING 212'])) saved += r.out;
    else spend += r.out - r.in;
  }
  for (const r of [...months[10].ultra, ...months[10].amex]) {
    if (!words(r.description, SKIP)) spend += r.charge;
  }
  assert.deepEqual([cur.income, cur.spend, cur.saved], [income, spend, saved]);
  assert.ok(income > 0 && spend > 0 && saved > 0);
});

test('a card repayment is recognised by its amount, however the bank words it', () => {
  const s = createState();
  const row = (account, date, description, amountPence) => ({ account, date, description, amountPence, currency: 'GBP' });
  addTransactions(s, [
    row('amex-gold', '2026-10-20', 'PAYMENT RECEIVED - THANK YOU', 45000),
    row('lloyds-ultra', '2026-10-21', 'PAYMENT RECEIVED - THANK YOU', 8000),
    row('lloyds-ultra', '2026-10-21', 'PAYMENT RECEIVED - THANK YOU', 7000),
    row('lloyds-club', '2026-10-18', 'XYZ CARD SERVICES', -45000),  // same amount, close date: paired
    row('lloyds-club', '2026-10-18', 'XYZ OTHER THING', -45000),    // only one payment to pair with
    row('lloyds-club', '2026-10-21', 'TESCO STORES 123', -8000),    // a known shop is never claimed
    row('lloyds-club', '2026-09-01', 'XYZ OLD THING', -7000),       // too far away in time
  ]);
  applyRules(s);
  assert.equal(pairCardRepayments(s).length, 2);
  const cat = (d) => Object.values(s.transactions).find((t) => t.description === d).category;
  const paired = Object.values(s.transactions).filter((t) => t.account === 'lloyds-club' && t.category === 'Card repayment');
  assert.equal(paired.length, 1);
  assert.equal(cat('TESCO STORES 123'), 'Groceries');
  assert.equal(cat('XYZ OLD THING'), null);

  // The pairing survives rules being re-run, and it stops counting as spend.
  applyRules(s);
  assert.equal(paired[0].category, 'Card repayment');
  assert.equal(summarise([paired[0]], s.categories).spend, 0);
});

test('v1: transfers and card repayments are not spend', async () => {
  const s = createState();
  for (const cells of [club(), ultra(), amex()]) importStatement(s, await viaPdf(cells));
  const { spendByCat } = summarise(inMonth(s, '2026-10'), s.categories);
  assert.equal(spendByCat['Card repayment'], undefined);
  assert.equal(spendByCat['Internal transfer'], undefined);
});
