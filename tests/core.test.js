// Ported from v1's tests/test_all.py where a test name says "v1:"; the rest are new.
// All data here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMoney, formatPence, FormatError } from '../src/core/money.js';
import { parseDate } from '../src/core/dates.js';
import { parseCsv } from '../src/core/csv.js';
import { compileRules, matchCategory, merchant, applyRules, setManualCategory } from '../src/core/categorise.js';
import { createState, addTransactions, setBalance, setRule, applySeed, KINDS } from '../src/core/model.js';

test('v1: money and dates', () => {
  assert.equal(parseMoney('£1,234.50'), 123450);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('0.10'), 10); // no float rounding
  assert.equal(parseDate('05/10/2026'), '2026-10-05');
  assert.equal(parseDate('2026-10-05 12:30:45'), '2026-10-05');
});

test('money is exact where floats are not', () => {
  assert.equal(parseMoney('1.15'), 115);    // 1.15 * 100 is 114.99999... as a float
  assert.equal(parseMoney('19.99'), 1999);
  assert.equal(parseMoney('-5'), -500);
  assert.equal(parseMoney('-£5.5'), -550);
  assert.equal(parseMoney('.5'), 50);
  assert.equal(parseMoney('-'), null);
  assert.equal(parseMoney('-0.00'), 0);
});

test('money beyond two decimals rounds half to even, as v1 did', () => {
  assert.equal(parseMoney('1.005'), 100);
  assert.equal(parseMoney('1.015'), 102);
  assert.equal(parseMoney('1.0051'), 101);
});

test('bad money is rejected rather than guessed', () => {
  for (const bad of ['abc', '1.2.3', '12abc', '.']) assert.throws(() => parseMoney(bad), FormatError);
});

test('formatPence', () => {
  assert.equal(formatPence(123450), '£1,234.50');
  assert.equal(formatPence(-500), '-£5.00');
  assert.equal(formatPence(5), '£0.05');
  assert.equal(formatPence(100000000), '£1,000,000.00');
});

test('dates: every v1 format, and impossible dates fail', () => {
  assert.equal(parseDate('2026-10-05'), '2026-10-05');
  assert.equal(parseDate('05-10-2026'), '2026-10-05');
  assert.equal(parseDate('5 Oct 2026'), '2026-10-05');
  assert.equal(parseDate('05 October 2026'), '2026-10-05');
  assert.equal(parseDate('05/10/26'), '2026-10-05');
  assert.equal(parseDate('29/02/2028'), '2028-02-29');
  for (const bad of ['31/02/2026', '29/02/2026', '13/13/2026', '5 Foo 2026', '', '10/5']) {
    assert.throws(() => parseDate(bad), FormatError);
  }
});

test('csv: BOM, CRLF, quotes, commas, newlines, short rows, blank lines', () => {
  const text = '﻿Date, Note ,Amount\r\n01/10/2026,"A, ""quoted"" one",1.00\r\n\r\n02/10/2026,"two\nlines"\r\n';
  const { headers, rows } = parseCsv(text);
  assert.deepEqual(headers, ['Date', 'Note', 'Amount']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Note, 'A, "quoted" one');
  assert.equal(rows[1].Note, 'two\nlines');
  assert.equal(rows[1].Amount, '');
});

test('csv: no trailing newline, empty file, cut-off file', () => {
  assert.deepEqual(parseCsv('A,B\n1,2').rows, [{ A: '1', B: '2' }]);
  assert.deepEqual(parseCsv(''), { headers: [], rows: [] });
  assert.throws(() => parseCsv('A,B\n"1,2'), FormatError);
});

const R = compileRules([
  { pattern: 'FEE', category: 'Fees' }, { pattern: 'UBER', category: 'Transport' },
  { pattern: 'UBER EATS', category: 'Eating' }, { pattern: 'NANDO*', category: 'Eating' },
]);

test('v1: whole word and longest match', () => {
  const m = (s) => matchCategory(s, R);
  assert.equal(m('COFFEE SHOP'), null);
  assert.equal(m('FOREIGN FEE'), 'Fees');
  assert.equal(m('UBER EATS LONDON'), 'Eating');
  assert.equal(m('UBER *TRIP'), 'Transport');
  assert.equal(m('NANDOS MK'), 'Eating');
});

test('patterns with regex characters match literally', () => {
  const r = compileRules([{ pattern: 'M&S SIMPLY FOOD', category: 'A' }, { pattern: 'APPLE.COM/BILL', category: 'B' },
    { pattern: 'CO-OP', category: 'C' }]);
  assert.equal(matchCategory('APPLE.COM/BILL 0800', r), 'B');
  assert.equal(matchCategory('APPLEXCOM/BILL', r), null);
  assert.equal(matchCategory('m&s simply food', r), 'A');
  assert.equal(matchCategory('CO-OP GROUP 123', r), 'C');
  assert.equal(matchCategory('COOP', r), null);
});

test('v1: merchant name stops at reference numbers', () => {
  assert.equal(merchant('TESCO STORES 3214'), 'TESCO STORES');
  assert.equal(merchant('AMAZON.CO.UK*2K9XD'), 'AMAZON.CO.UK');
  assert.equal(merchant('UBER *TRIP HELP.UBER.COM'), 'UBER');
  assert.equal(merchant('4412 COFFEE'), '4412');
  assert.equal(merchant(''), 'UNKNOWN');
});

const tx = (over = {}) => ({ account: 'lloyds-club', date: '2026-10-01', description: 'X', amountPence: -100, currency: 'GBP', ...over });

test('v1: manual category survives rule changes', () => {
  const s = createState();
  addTransactions(s, [tx({ description: 'TESCO STORES 1', amountPence: -500 })]);
  applyRules(s);
  const key = Object.keys(s.transactions)[0];
  assert.equal(s.transactions[key].category, 'Groceries');
  setManualCategory(s, key, 'Shopping');
  applyRules(s);
  assert.equal(s.transactions[key].category, 'Shopping');
  assert.equal(s.transactions[key].catSource, 'manual');
});

test('v1: re-import and overlap add nothing, genuine repeats are kept', () => {
  const s = createState();
  assert.deepEqual(addTransactions(s, [tx(), tx()]), { inserted: 2, skipped: 0 });
  assert.deepEqual(addTransactions(s, [tx(), tx()]), { inserted: 0, skipped: 2 });
  assert.deepEqual(addTransactions(s, [tx()]), { inserted: 0, skipped: 1 });
  assert.equal(Object.keys(s.transactions).length, 2);
});

test('applyRules: a rule change reaches old rows, and counts changes', () => {
  const s = createState();
  addTransactions(s, [tx({ description: 'WIDGETCO 1' })]);
  assert.equal(applyRules(s), 0);
  setRule(s, 'widgetco', 'Shopping');
  assert.equal(applyRules(s), 1);
  assert.equal(applyRules(s), 0);
  setRule(s, 'WIDGETCO', 'Gifts & charity'); // same pattern replaces rather than duplicates
  assert.equal(applyRules(s), 1);
  assert.equal(s.rules.filter((r) => r.pattern === 'WIDGETCO').length, 1);
});

test('v1 sign rule: card balances are typed as owed and stored negative', () => {
  const s = createState();
  setBalance(s, '2026-10-31', 'amex-gold', '250');
  assert.equal(s.balances['2026-10-31|amex-gold'].balancePence, -25000);
  setBalance(s, '2026-10-31', 'lloyds-club', '-25.00'); // overdraft keeps its sign
  assert.equal(s.balances['2026-10-31|lloyds-club'].balancePence, -2500);
  setBalance(s, '2026-10-31', 'amex-gold', '-10'); // card in credit
  assert.equal(s.balances['2026-10-31|amex-gold'].balancePence, 1000);
});

test('bad input fails loudly', () => {
  const s = createState();
  assert.throws(() => addTransactions(s, [tx({ account: 'nope' })]), /Unknown account/);
  assert.throws(() => addTransactions(s, [tx({ date: '01/10/2026' })]), /not ISO/);
  assert.throws(() => addTransactions(s, [tx({ amountPence: 1.5 })]), /whole pence/);
  assert.throws(() => setRule(s, 'X', 'Nope'), /Unknown category/);
  assert.throws(() => setBalance(s, '2026-10-31', 'revolut', ''), FormatError);
});

test('defaults are consistent, and card interest is a cost rather than income', () => {
  const s = createState();
  for (const c of Object.values(s.categories)) assert.ok(KINDS.includes(c.kind));
  for (const r of s.rules) assert.ok(s.categories[r.category], r.pattern);
  assert.equal(new Set(s.rules.map((r) => r.pattern)).size, s.rules.length);
  const compiled = compileRules(s.rules);
  assert.equal(matchCategory('INTEREST CHARGED', compiled), 'Fees & interest');
  assert.equal(matchCategory('INTEREST PAID', compiled), 'Interest & cashback');
  assert.equal(matchCategory('REVOLUT TOP-UP', compiled), 'Internal transfer');
  assert.equal(matchCategory('REVOLUT**1234*', compiled), 'Internal transfer');
  assert.equal(parseDate('05 Oct 26'), '2026-10-05');
  assert.equal(matchCategory('PAYMENT RECEIVED - THANK YOU', compiled), 'Card repayment');
});

test('no targets are set by default, so nothing can show pass or fail', () => {
  assert.ok(Object.values(createState().goals).every((v) => v === null));
});

test('applySeed loads the example file, and rejects a misspelt goal', () => {
  const s = createState();
  applySeed(s, JSON.parse(readFileSync(new URL('../seed.example.json', import.meta.url), 'utf8')));
  assert.equal(s.balances['2026-01-01|amex-gold'].balancePence, -12000);
  assert.equal(s.goals.monthlyIsaTargetPence, 100000);
  assert.ok(s.rules.some((r) => r.pattern === 'EXAMPLE EMPLOYER LTD'));
  assert.throws(() => applySeed(createState(), { goals: { monthlyTypo: 1 } }), /Unknown goal/);
});

test('state survives a JSON round trip, which backup and storage rely on', () => {
  const s = createState();
  addTransactions(s, [tx()]);
  applyRules(s);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});
