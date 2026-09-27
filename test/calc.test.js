import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  applySaleToStock,
  dailyAggregates,
  discountAmount,
  lineTotal,
  localDateKey,
  lowStock,
  nextReceiptNumber,
  saleTotals,
  stockValue,
  subtotal,
  topProducts,
  vatBreakdown,
} from '../js/calc.js';

const SETTINGS = { ...DEFAULT_SETTINGS };

test('lineTotal and subtotal multiply and sum in centavos', () => {
  assert.equal(lineTotal(45, 3), 135);
  assert.equal(lineTotal(0.1, 3), 0.3);
  assert.equal(subtotal([{ price: 45, qty: 2 }, { price: 10, qty: 1 }]), 100);
  assert.equal(subtotal([]), 0);
});

test('discountAmount is capped between 0 and 100 percent', () => {
  assert.equal(discountAmount(100, 10), 10);
  assert.equal(discountAmount(100, 0), 0);
  assert.equal(discountAmount(100, 150), 100);
  assert.equal(discountAmount(100, -20), 0);
  assert.equal(discountAmount(100, undefined), 0);
});

test('VAT-inclusive: VAT is total x 12/112 and the total is unchanged', () => {
  const b = vatBreakdown(112, { vatEnabled: true, vatRate: 0.12, vatInclusive: true });
  assert.equal(b.vatableSales, 100);
  assert.equal(b.vat, 12);
  assert.equal(b.total, 112);
  assert.equal(b.vatableSales + b.vat, b.total);
});

test('VAT-exclusive: VAT is added on top of the posted price', () => {
  const b = vatBreakdown(100, { vatEnabled: true, vatRate: 0.12, vatInclusive: false });
  assert.equal(b.vatableSales, 100);
  assert.equal(b.vat, 12);
  assert.equal(b.total, 112);
});

test('VAT disabled means the whole amount is the total', () => {
  const b = vatBreakdown(100, { vatEnabled: false });
  assert.deepEqual(b, { vatableSales: 100, vat: 0, total: 100 });
});

test('saleTotals produces a full, internally consistent set of numbers', () => {
  const sale = {
    items: [
      { id: 'a', name: 'Milk tea', price: 45, cost: 18, qty: 2 },
      { id: 'b', name: 'Pearls', price: 10, cost: 3, qty: 1 },
    ],
    discountPct: 0,
  };
  const t = saleTotals(sale, SETTINGS);

  assert.equal(t.gross, 100);
  assert.equal(t.discount, 0);
  assert.equal(t.net, 100);
  assert.equal(t.vatableSales, 89.29); // 100 / 1.12
  assert.equal(t.vat, 10.71);
  assert.equal(t.total, 100);
  assert.equal(t.cost, 39); // 18*2 + 3
  assert.equal(t.profit, 61); // net - cost
  assert.equal(t.marginPct, 61);
  assert.equal(t.unitCount, 3);
  assert.equal(t.itemCount, 2);
  assert.equal(t.vatableSales + t.vat, t.total);
});

test('saleTotals applies the discount before VAT', () => {
  const sale = { items: [{ id: 'a', name: 'X', price: 100, cost: 50, qty: 1 }], discountPct: 10 };
  const t = saleTotals(sale, SETTINGS);
  assert.equal(t.gross, 100);
  assert.equal(t.discount, 10);
  assert.equal(t.net, 90);
  assert.equal(t.total, 90);
  assert.equal(t.profit, 40); // discount reduces profit, not cost
});

test('saleTotals ignores empty lines and never divides by zero', () => {
  const t = saleTotals({ items: [{ id: '', name: '', price: 0, cost: 0, qty: 0 }], discountPct: 0 }, SETTINGS);
  assert.equal(t.gross, 0);
  assert.equal(t.total, 0);
  assert.equal(t.marginPct, 0);
});

test('saleTotals tolerates a null sale', () => {
  const t = saleTotals(null, SETTINGS);
  assert.equal(t.total, 0);
  assert.equal(t.profit, 0);
});

test('nextReceiptNumber zero pads and respects the prefix', () => {
  assert.equal(nextReceiptNumber(1), 'SI-000001');
  assert.equal(nextReceiptNumber(142, { receiptPrefix: 'OR' }), 'OR-000142');
  assert.equal(nextReceiptNumber(undefined), 'SI-000000');
  assert.equal(nextReceiptNumber(-5), 'SI-000000');
});

test('localDateKey uses the local calendar day', () => {
  const d = new Date(2026, 8, 27, 23, 30); // Sept 27 2026, 11:30pm local
  assert.equal(localDateKey(d), '2026-09-27');
});

test('dailyAggregates buckets by local date and sums totals', () => {
  const sales = [
    { at: new Date(2026, 8, 26, 10, 0).toISOString(), totals: { total: 100, profit: 40 } },
    { at: new Date(2026, 8, 26, 18, 0).toISOString(), totals: { total: 50, profit: 20 } },
    { at: new Date(2026, 8, 27, 9, 0).toISOString(), totals: { total: 75, profit: 30 } },
    { at: 'not-a-date', totals: { total: 999, profit: 999 } },
  ];
  const rows = dailyAggregates(sales);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { date: '2026-09-26', revenue: 150, profit: 60, orders: 2 });
  assert.deepEqual(rows[1], { date: '2026-09-27', revenue: 75, profit: 30, orders: 1 });
});

test('topProducts ranks by revenue and caps the list', () => {
  const sales = [
    { items: [{ id: 'a', name: 'Tea', price: 45, qty: 3 }] },
    { items: [{ id: 'a', name: 'Tea', price: 45, qty: 1 }, { id: 'b', name: 'Pearls', price: 10, qty: 2 }] },
  ];
  const top = topProducts(sales, 1);
  assert.equal(top.length, 1);
  assert.equal(top[0].name, 'Tea');
  assert.equal(top[0].qty, 4);
  assert.equal(top[0].revenue, 180);
});

test('lowStock returns products at or below the threshold, worst first', () => {
  const products = [
    { id: 'a', name: 'A', stock: 10 },
    { id: 'b', name: 'B', stock: 0 },
    { id: 'c', name: 'C', stock: 5 },
    { id: 'd', name: 'D', stock: 50 },
  ];
  const low = lowStock(products, 5);
  assert.deepEqual(low.map((p) => p.name), ['B', 'C']);
});

test('stockValue reports both cost and retail value', () => {
  const v = stockValue([{ cost: 18, price: 45, stock: 10 }, { cost: 3, price: 10, stock: 5 }]);
  assert.equal(v.atCost, 195);
  assert.equal(v.atRetail, 500);
});

test('applySaleToStock decrements stock without mutating the input', () => {
  const products = [{ id: 'a', stock: 5 }, { id: 'b', stock: 2 }];
  const sale = { items: [{ id: 'a', qty: 2 }, { id: 'b', qty: 10 }] };
  const next = applySaleToStock(products, sale);

  assert.equal(next[0].stock, 3);
  assert.equal(next[1].stock, 0, 'stock floors at zero, never negative');
  assert.equal(products[0].stock, 5, 'original untouched');
  assert.notEqual(next[0], products[0], 'returns new objects');
});
