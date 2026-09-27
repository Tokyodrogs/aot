import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, saleTotals } from '../js/calc.js';
import { SAMPLE_PRODUCTS, buildSampleState } from '../js/seed.js';

test('buildSampleState returns products, sales and a counter', () => {
  const { products, sales, counter } = buildSampleState(DEFAULT_SETTINGS);
  assert.equal(products.length, SAMPLE_PRODUCTS.length);
  assert.ok(sales.length > 20, `expected a fortnight of sales, got ${sales.length}`);
  assert.ok(counter > sales.length);
});

test('every sampled product has a complete record', () => {
  const { products } = buildSampleState(DEFAULT_SETTINGS);
  for (const p of products) {
    assert.ok(p.id, 'product has an id');
    assert.ok(p.name);
    assert.ok(p.category);
    assert.ok(p.unit);
    assert.equal(typeof p.cost, 'number');
    assert.equal(typeof p.price, 'number');
    assert.ok(p.stock >= 0, `${p.name} stock must not go negative, got ${p.stock}`);
  }
});

test('sampled sales are internally consistent with saleTotals', () => {
  const { sales } = buildSampleState(DEFAULT_SETTINGS);
  for (const s of sales) {
    assert.ok(s.receipt.startsWith(`${DEFAULT_SETTINGS.receiptPrefix}-`));
    assert.ok(s.items.length > 0);
    for (const i of s.items) assert.ok(i.qty > 0);
    const expected = saleTotals(s, DEFAULT_SETTINGS);
    assert.equal(s.totals.total, expected.total, `${s.receipt} total mismatch`);
    assert.equal(s.totals.profit, expected.profit, `${s.receipt} profit mismatch`);
  }
});

test('receipt numbers are sequential and unique', () => {
  const { sales } = buildSampleState(DEFAULT_SETTINGS);
  const numbers = sales.map((s) => s.receipt);
  assert.equal(new Set(numbers).size, numbers.length);
  const sorted = [...numbers].sort();
  assert.equal(sorted[0], 'SI-000001');
  assert.equal(sorted[sorted.length - 1], `SI-${String(sales.length).padStart(6, '0')}`);
});

test('the same seed always produces the same demo data', () => {
  const a = buildSampleState(DEFAULT_SETTINGS, { seed: 7 });
  const b = buildSampleState(DEFAULT_SETTINGS, { seed: 7 });
  assert.equal(a.sales.length, b.sales.length);
  assert.equal(
    a.sales.map((s) => s.items.map((i) => `${i.name}:${i.qty}`).join(',')).join('|'),
    b.sales.map((s) => s.items.map((i) => `${i.name}:${i.qty}`).join(',')).join('|'),
  );
});

test('sales never exceed the stock the shop started with', () => {
  const { products, sales } = buildSampleState(DEFAULT_SETTINGS);
  const sold = new Map();
  for (const s of sales) {
    for (const i of s.items) sold.set(i.id, (sold.get(i.id) ?? 0) + i.qty);
  }
  for (const p of products) {
    const start = SAMPLE_PRODUCTS.find((s) => s.name === p.name).stock;
    assert.ok(
      (sold.get(p.id) ?? 0) <= start,
      `${p.name}: sold ${sold.get(p.id) ?? 0} but only stocked ${start}`,
    );
    assert.equal(start - (sold.get(p.id) ?? 0), p.stock, `${p.name} closing stock does not reconcile`);
  }
});
