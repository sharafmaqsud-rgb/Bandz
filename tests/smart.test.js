// Automatic categorising, and what the app chooses to ask about. All data here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, pairCardRepayments, setManualCategory } from '../src/core/categorise.js';
import { CATEGORIES } from '../src/core/defaults.js';
import { CATEGORY_WORDS, KNOWN_MERCHANTS } from '../src/core/merchants.js';
import { addTransactions, createState, setRule } from '../src/core/model.js';
import { markReviewed, reviewCount, reviewQueue } from '../src/core/review.js';

const CLUB = 'lloyds-club', AMEX = 'amex-gold';
const row = (description, amountPence, over = {}) => ({ account: CLUB, date: '2026-10-10', description, amountPence, currency: 'GBP', ...over });
function state(rows) {
  const s = createState(1);
  addTransactions(s, rows, 1);
  applyRules(s, 2);
  return s;
}
const only = (s, d) => Object.values(s.transactions).find((t) => t.description === d);

test('the merchant lists only use real categories', () => {
  for (const r of [...KNOWN_MERCHANTS, ...CATEGORY_WORDS]) assert.ok(Object.hasOwn(CATEGORIES, r.category), r.pattern);
  assert.ok(KNOWN_MERCHANTS.length > 300);
});

test('a known merchant is filed with high confidence, and says why', () => {
  const t = only(state([row('GREGGS PLC 123', -400, { account: AMEX })]), 'GREGGS PLC 123');
  assert.deepEqual([t.category, t.confidence], ['Eating out & takeaway', 'high']);
  assert.ok(t.reason);
  assert.equal(only(state([row('HOTELS.COM 1', -9000)]), 'HOTELS.COM 1').category, 'Travel & holidays');
  assert.equal(only(state([row('OCTOPUS ENERGY', -9000)]), 'OCTOPUS ENERGY').category, 'Bills & phone');
});

test('whole words only: an unrelated name is not swept up', () => {
  assert.equal(only(state([row('NEXTGEN WIDGETS', -9000)]), 'NEXTGEN WIDGETS').category, null);
  assert.equal(only(state([row('SKYLINE WIDGETS', -9000)]), 'SKYLINE WIDGETS').category, null);
});

test('your rule beats the built-in list, even when the built-in pattern is longer', () => {
  const s = createState(1);
  addTransactions(s, [row('AMAZON PRIME UK', -900)], 1);
  setRule(s, 'AMAZON', 'Gifts & charity', 2);
  applyRules(s, 3);
  assert.equal(Object.values(s.transactions)[0].category, 'Subscriptions'); // the older default rule is longer
  setRule(s, 'AMAZON PRIME UK', 'Gifts & charity', 4);
  applyRules(s, 5);
  assert.equal(Object.values(s.transactions)[0].category, 'Gifts & charity');
});

test('a word in the name files it with medium confidence', () => {
  const t = only(state([row('THE ROSE TAVERN', -9000)]), 'THE ROSE TAVERN');
  assert.deepEqual([t.category, t.catSource, t.confidence], ['Eating out & takeaway', 'auto', 'medium']);
});

test('it learns from your choices for similar merchants', () => {
  const s = createState(1);
  addTransactions(s, [row('BLUEWATER WIDGETS 1', -9000), row('BLUEWATER GADGETS', -9000)], 1);
  applyRules(s, 2);
  assert.equal(only(s, 'BLUEWATER GADGETS').category, null);
  setRule(s, 'BLUEWATER WIDGETS', 'Shopping', 3);
  applyRules(s, 4);
  const t = only(s, 'BLUEWATER GADGETS');
  assert.deepEqual([t.category, t.confidence], ['Shopping', 'medium']);
  assert.match(t.reason, /BLUEWATER/);
});

test('it does not learn from common words, or from choices that disagree', () => {
  const s = createState(1);
  addTransactions(s, [row('REDWOOD ONE', -9000), row('REDWOOD TWO', -9000), row('REDWOOD THREEX', -9000), row('ONLINE PAYMENTS LTD', -9000)], 1);
  setRule(s, 'REDWOOD ONE', 'Shopping', 2);
  setRule(s, 'REDWOOD TWO', 'Entertainment', 2);
  setRule(s, 'ONLINEX LTD', 'Gifts & charity', 2);
  applyRules(s, 3);
  assert.equal(only(s, 'REDWOOD THREEX').category, null);
});

test('money back on a card is a refund, not income', () => {
  const t = only(state([row('UNHEARD OF LTD', 2500, { account: AMEX })]), 'UNHEARD OF LTD');
  assert.equal(t.category, 'Other spend');
});

test('a large monthly payment in is treated as salary, but a one-off asks', () => {
  const s = state([
    row('ZEDCO', 260000, { date: '2026-09-28' }), row('ZEDCO', 260000, { date: '2026-10-28' }),
    row('ONE OFF', 90000),
  ]);
  assert.equal(only(s, 'ZEDCO').category, 'Salary');
  const once = only(s, 'ONE OFF');
  assert.equal(once.category, null);
  assert.equal(once.suggestion, 'Other income');
});

test('small unknown card purchases are filed without asking', () => {
  const s = state([row('UNHEARD OF LTD', -1200, { account: AMEX }), row('UNHEARD DEB', -1200, { bankType: 'DEB' })]);
  assert.equal(only(s, 'UNHEARD OF LTD').category, 'Other spend');
  assert.equal(only(s, 'UNHEARD DEB').category, 'Other spend');
  assert.equal(reviewQueue(s).merchants.length, 0);
  assert.equal(reviewCount(reviewQueue(s)), 0);
  assert.equal(reviewQueue(s).tidy.length, 2); // listed optionally, and never counted as a question
});

test('but small purchases that keep adding up do get asked about', () => {
  const rows = Array.from({ length: 5 }, (_, i) => row('UNHEARD OF LTD', -2500, { account: AMEX, date: `2026-10-1${i}` }));
  const q = reviewQueue(state(rows));
  assert.equal(q.merchants.length, 1);
  assert.equal(q.merchants[0].count, 5);
});

test('unclear payments ask, with a useful suggestion', () => {
  const s = state([
    row('NORTHERN WIDGETS', -9000, { bankType: 'DD' }),
    row('J EXAMPLE', -40000, { bankType: 'FPO' }),
    row('MYSTERY', -9000, { account: AMEX }),
  ]);
  assert.equal(only(s, 'NORTHERN WIDGETS').suggestion, 'Bills & phone');
  assert.equal(only(s, 'J EXAMPLE').suggestion, 'Family & household');
  assert.equal(only(s, 'MYSTERY').suggestion, 'Other spend');
  assert.equal(reviewQueue(s).merchants.length, 3);
});

test('the same amount repeating to an unknown payee asks, and suggests a subscription', () => {
  const s = state([row('QUIETCO', -1500, { date: '2026-09-10' }), row('QUIETCO', -1500, { date: '2026-10-10' })]);
  assert.equal(only(s, 'QUIETCO').suggestion, 'Subscriptions');
});

test('the bank\'s own fee marking is used', () => {
  assert.equal(only(state([row('ACCOUNT ITEM', -300, { bankType: 'CHG' })]), 'ACCOUNT ITEM').category, 'Fees & interest');
});

test('answering once settles the whole merchant and leaves the queue', () => {
  const s = state([row('QUIETCO', -9000, { date: '2026-09-10' }), row('QUIETCO', -9500, { date: '2026-10-10' })]);
  assert.equal(reviewCount(reviewQueue(s)), 1);
  setRule(s, 'QUIETCO', 'Entertainment', 3);
  applyRules(s, 4);
  assert.equal(reviewCount(reviewQueue(s)), 0);
  assert.equal(only(s, 'QUIETCO').catSource, 'rule');
});

test('a large automatic filing is shown to you once', () => {
  const s = state([row('THE ROSE TAVERN', -40000)]);
  const q = reviewQueue(s);
  assert.equal(q.unusual.length, 1);
  assert.match(q.unusual[0].why, /large/i);
  markReviewed(s, q.unusual[0].tx.key, 5);
  assert.equal(reviewQueue(s).unusual.length, 0);
  applyRules(s, 6); // re-running must not ask again when nothing changed
  assert.equal(reviewQueue(s).unusual.length, 0);
});

test('an unusually large purchase is flagged against your own history', () => {
  const rows = [10, 11, 12, 13, 14, 15].map((d) => row(`TESCO ${d}`, -2000, { date: `2026-09-${d}` }));
  rows.push(row('TESCO BIG', -12000, { date: '2026-10-05' }));
  const q = reviewQueue(state(rows));
  assert.equal(q.unusual.length, 1);
  assert.match(q.unusual[0].why, /usual Groceries/);
});

test('your hand-set category is never replaced, and teaches similar merchants', () => {
  const s = state([row('LANTERN WIDGETS 1', -9000), row('LANTERN GOODS', -9000)]);
  setManualCategory(s, only(s, 'LANTERN WIDGETS 1').key, 'Entertainment', 3);
  applyRules(s, 4);
  assert.equal(only(s, 'LANTERN WIDGETS 1').category, 'Entertainment');
  assert.equal(only(s, 'LANTERN GOODS').category, 'Entertainment');
});

test('a card payment pairs even when the app could not name it', () => {
  const s = state([
    row('PAYMENT RECEIVED - THANK YOU', 45000, { account: AMEX, date: '2026-10-20' }),
    row('XYZ SERVICES', -45000, { date: '2026-10-18', bankType: 'DD' }),
  ]);
  pairCardRepayments(s, 5);
  assert.equal(only(s, 'XYZ SERVICES').catSource, 'paired');
  assert.equal(reviewQueue(s).merchants.length, 0);
});

test('learning respects the direction of the money', () => {
  const s = createState(1);
  addTransactions(s, [row('ACMEWORKS LTD', 260000), row('ACMEWORKS CANTEEN', -900), row('ACMEWORKS BONUS', 50000), row('BRIGHTON WIDGETS', 5000), row('BRIGHTON GADGETS', -9000)], 1);
  setRule(s, 'ACMEWORKS LTD', 'Salary', 2);
  setRule(s, 'BRIGHTON GADGETS', 'Shopping', 2);
  applyRules(s, 3);
  assert.notEqual(only(s, 'ACMEWORKS CANTEEN').category, 'Salary');
  assert.equal(only(s, 'ACMEWORKS BONUS').category, 'Salary');
  assert.notEqual(only(s, 'BRIGHTON WIDGETS').category, 'Shopping');
});
