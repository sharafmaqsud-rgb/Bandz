// The masking tool is the only thing standing between a real statement and the
// conversation used to build this app, so it gets its own tests. All data is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskText } from '../tools/mask.js';

test('names, merchants and addresses are hidden, including their length', () => {
  assert.equal(maskText('JANE EXAMPLE'), 'x x');
  assert.equal(maskText('WIDGETCO STORES'), 'x x');
  assert.equal(maskText('12 Sample Road'), '99 x x');
  assert.equal(maskText('Café Zoë'), 'x x');
  assert.equal(maskText('jane@example.com'), 'x@x.x');
});

test('numbers show their format but not their value', () => {
  assert.equal(maskText('£1,234.56'), '£9,999.99');
  assert.equal(maskText('£123.45'), '£999.99');
  assert.equal(maskText('12345678'), '999');
  assert.equal(maskText('30-99-50'), '99-99-99');
  assert.equal(maskText('٣٤٥'), '999');
});

test('generic statement words stay readable', () => {
  assert.equal(maskText('Transaction Date'), 'Transaction Date');
  assert.equal(maskText('MONEY IN'), 'MONEY IN');
  assert.equal(maskText('05 Oct 26'), '99 Oct 99');
});

test('a word containing a kept word is still hidden', () => {
  assert.equal(maskText('GOLDSMITHS'), 'x');
  assert.equal(maskText('Banksy'), 'x');
});
