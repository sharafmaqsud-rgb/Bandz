// All data here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { balancesAsOf, categoryChanges, inMonth, lastDayOfMonth, leftOver, monthGaps, monthsWithData, netWorth, savingsRate, shiftMonth, summarise, uncategorisedMerchants } from '../src/core/analysis.js';
import { applyRules } from '../src/core/categorise.js';
import { addTransactions, createState, setBalance } from '../src/core/model.js';

const tx = (date, description, amountPence, account = 'lloyds-club', currency = 'GBP') => ({ account, date, description, amountPence, currency });

function sample() {
  const s = createState();
  addTransactions(s, [
    tx('2026-09-28', 'EXAMPLE SALARY', 300000),
    tx('2026-09-05', 'TESCO STORES 1', -5000),
    tx('2026-10-28', 'EXAMPLE SALARY', 300000),
    tx('2026-10-05', 'TESCO STORES 2', -8000),
    tx('2026-10-06', 'NETFLIX.COM', -1000),
    tx('2026-10-07', 'VANGUARD ISA', -150000),
    tx('2026-10-08', 'REVOLUT TOP-UP', -5000),
    tx('2026-10-09', 'WIDGETCO 1', -2000),
    tx('2026-10-10', 'WIDGETCO 2', -3000),
    tx('2026-10-11', 'CAFE DE EXAMPLE', -1200, 'lloyds-club', 'EUR'),
  ]);
  applyRules(s);
  return s;
}

test('v1: savings rate and left over', () => {
  const s = sample();
  const cur = summarise(inMonth(s, '2026-10'), s.categories);
  assert.deepEqual([cur.income, cur.spend, cur.saved], [300000, 14000, 150000]);
  assert.equal(savingsRate(cur), 0.5);
  assert.equal(leftOver(cur), 136000);
  assert.equal(savingsRate(summarise([], s.categories)), null);
});

test('v1: non-GBP rows stay out of the totals', () => {
  const s = sample();
  assert.ok(!inMonth(s, '2026-10').some((t) => t.currency === 'EUR'));
});

test('v1: uncategorised money counts and is reported', () => {
  const s = sample();
  const cur = summarise(inMonth(s, '2026-10'), s.categories);
  assert.equal(cur.spendByCat.Uncategorised, 5000);
  assert.equal(cur.uncatCount, 2);
  assert.deepEqual(uncategorisedMerchants(s).find((m) => m.merchant === 'WIDGETCO'), { merchant: 'WIDGETCO', count: 2, pence: 5000 });
});

test('a refund reduces spend rather than counting as income', () => {
  const s = createState();
  addTransactions(s, [tx('2026-10-01', 'TESCO 1', -5000), tx('2026-10-02', 'TESCO 2', 1000)]);
  applyRules(s);
  const cur = summarise(inMonth(s, '2026-10'), s.categories);
  assert.deepEqual([cur.spend, cur.income], [4000, 0]);
});

test('month-on-month changes, and a first month shows no change', () => {
  const s = sample();
  const prev = summarise(inMonth(s, '2026-09'), s.categories);
  const cur = summarise(inMonth(s, '2026-10'), s.categories);
  const changes = categoryChanges(cur, prev);
  assert.deepEqual(changes[0], { name: 'Groceries', pence: 8000, change: 3000 });
  assert.equal(changes.find((c) => c.name === 'Subscriptions').change, 1000);
  assert.equal(categoryChanges(cur, null)[0].change, null);
});

test('month helpers', () => {
  assert.deepEqual(monthsWithData(sample()), ['2026-09', '2026-10']);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(lastDayOfMonth('2028-02'), '2028-02-29');
});

test('v1: net worth adds assets and subtracts cards, and groups them', () => {
  const s = createState();
  setBalance(s, '2026-10-31', 'lloyds-club', '3000');
  setBalance(s, '2026-10-31', 'amex-gold', '200');
  setBalance(s, '2026-10-31', 'vanguard-isa', '50000');
  setBalance(s, '2026-10-31', 'coinbase', '500');
  setBalance(s, '2026-10-31', 'lg-pension', '1000');
  const nw = netWorth(s);
  assert.equal(nw.total, 300000 - 20000 + 5000000 + 50000 + 100000);
  assert.deepEqual(nw.groups, { cash: 300000, investments: 5050000, pension: 100000, cards: -20000 });
  assert.ok(nw.missing.includes('revolut'));
});

test('the latest balance wins, and earlier dates can still be asked for', () => {
  const s = createState();
  setBalance(s, '2026-09-30', 'revolut', '100');
  setBalance(s, '2026-10-31', 'revolut', '150');
  assert.equal(balancesAsOf(s).revolut.balancePence, 15000);
  assert.equal(balancesAsOf(s, '2026-10-01').revolut.balancePence, 10000);
  assert.equal(netWorth(s, '2026-09-01').total, 0);
});

test('a month is flagged when a statement stops before its end', () => {
  const s = createState();
  s.statements['amex-gold|2026-10-20'] = { account: 'amex-gold', date: '2026-10-20' };
  s.statements['lloyds-club|2026-10-31'] = { account: 'lloyds-club', date: '2026-10-31' };
  const gaps = monthGaps(s, '2026-10');
  assert.deepEqual(gaps.find((g) => g.account === 'amex-gold').through, '2026-10-20');
  assert.equal(gaps.find((g) => g.account === 'lloyds-ultra').through, null);
  assert.ok(!gaps.some((g) => g.account === 'lloyds-club' || g.account === 'revolut'));
});
