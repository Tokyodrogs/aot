import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatMoney, formatPercent, parseMoney, parseQty, round2 } from '../js/money.js';

test('round2 keeps centavo precision and handles the classic 1.005 case', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(NaN), 0);
  assert.equal(round2('12.345'), 12.35);
});

test('formatMoney uses peso sign and thousand separators', () => {
  assert.equal(formatMoney(1234.5), '\u20B11,234.50');
  assert.equal(formatMoney(0), '\u20B10.00');
  assert.equal(formatMoney(1000000), '\u20B11,000,000.00');
});

test('formatMoney puts the minus before the currency symbol', () => {
  assert.equal(formatMoney(-50), '-\u20B150.00');
  assert.ok(!formatMoney(-50).includes('\u20B1-'));
});

test('formatMoney never prints NaN', () => {
  assert.equal(formatMoney(undefined), '\u20B10.00');
  assert.equal(formatMoney('abc'), '\u20B10.00');
});

test('parseMoney strips currency symbols and separators', () => {
  assert.equal(parseMoney('\u20B11,234.50'), 1234.5);
  assert.equal(parseMoney('  12 '), 12);
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney(null), 0);
  assert.equal(parseMoney(42), 42);
});

test('parseQty only accepts positive integers', () => {
  assert.equal(parseQty('3'), 3);
  assert.equal(parseQty('2.9'), 2);
  assert.equal(parseQty('-4'), 0);
  assert.equal(parseQty('abc'), 0);
});

test('formatPercent renders fixed decimals', () => {
  assert.equal(formatPercent(12.3456), '12.3%');
  assert.equal(formatPercent(60), '60.0%');
  assert.equal(formatPercent('nope'), '0%');
});
