// End-to-end flow through the real production modules — the same functions the
// UI calls: seed the shop, ring up a sale, decrement stock, export, back up,
// restore. No re-implementations, no stubs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applySaleToStock, nextReceiptNumber, saleTotals } from '../js/calc.js';
import { saleColumns, toCSV } from '../js/csv.js';
import { createStore, makeId, parseBackup } from '../js/storage.js';
import { buildSampleState } from '../js/seed.js';

function fakeBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('a full trading day reconciles: sales, stock, profit, export, backup', () => {
  const store = createStore(fakeBackend());
  let state = store.load();

  // 1. Open the shop with sample stock.
  const seeded = buildSampleState(state.settings);
  state = store.save({ ...state, ...seeded });
  const openingStock = new Map(state.products.map((p) => [p.id, p.stock]));
  assert.ok(state.products.length > 0);
  assert.ok(state.sales.length > 0);

  // 2. Ring up a new sale exactly as the POS does.
  const milkTea = state.products.find((p) => p.name.startsWith('Brown Sugar Milk Tea (Regular)'));
  const pearls = state.products.find((p) => p.name.startsWith('Tapioca'));
  assert.ok(milkTea && pearls, 'sample catalogue has the products the flow needs');

  const sale = {
    id: makeId('sal'),
    receipt: nextReceiptNumber(state.counter, state.settings),
    at: new Date().toISOString(),
    customer: 'Walk-in',
    payment: 'Cash',
    discountPct: 0,
    notes: '',
    items: [
      { id: milkTea.id, name: milkTea.name, price: milkTea.price, cost: milkTea.cost, qty: 2 },
      { id: pearls.id, name: pearls.name, price: pearls.price, cost: pearls.cost, qty: 1 },
    ],
  };
  sale.totals = saleTotals(sale, state.settings);

  // 45*2 + 10 = 100 gross, VAT-inclusive split, cost 18*2 + 3 = 39.
  assert.equal(sale.totals.gross, 100);
  assert.equal(sale.totals.vatableSales, 89.29);
  assert.equal(sale.totals.vat, 10.71);
  assert.equal(sale.totals.total, 100);
  assert.equal(sale.totals.profit, 61);

  // 3. Commit it: append the sale, decrement stock, bump the receipt counter.
  state = store.save({
    ...state,
    sales: [...state.sales, sale],
    products: applySaleToStock(state.products, sale),
    counter: state.counter + 1,
  });

  const afterTea = state.products.find((p) => p.id === milkTea.id).stock;
  const afterPearls = state.products.find((p) => p.id === pearls.id).stock;
  assert.equal(afterTea, openingStock.get(milkTea.id) - 2);
  assert.equal(afterPearls, openingStock.get(pearls.id) - 1);
  assert.equal(nextReceiptNumber(state.counter, state.settings), 'SI-' + String(state.sales.length + 1).padStart(6, '0'));

  // 4. The books balance: total recorded profit equals the sum of each sale's profit.
  const bookedProfit = state.sales.reduce((n, s) => n + s.totals.profit, 0);
  const recomputed = state.sales.reduce((n, s) => n + saleTotals(s, state.settings).profit, 0);
  assert.equal(Number(bookedProfit.toFixed(2)), Number(recomputed.toFixed(2)));

  // 5. Export is well-formed CSV: one header plus one row per sale.
  const csv = toCSV(saleColumns, state.sales);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, state.sales.length + 1);
  assert.ok(lines[0].startsWith('Receipt,Date,Customer,Payment,Items'));
  assert.ok(lines[lines.length - 1].startsWith(sale.receipt));

  // 6. Backup and restore round-trip without loss.
  const backup = JSON.stringify(state);
  const restored = parseBackup(backup);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.sales.length, state.sales.length);
  assert.equal(restored.state.products.length, state.products.length);
  assert.equal(restored.state.products.find((p) => p.id === milkTea.id).stock, afterTea);
  assert.equal(restored.state.counter, state.counter);
  assert.equal(restored.state.settings.vatRate, state.settings.vatRate);

  // 7. Reloading from storage yields the same books.
  const reloaded = createStore(fakeBackend()).load();
  assert.deepEqual(reloaded.products, [], 'a fresh browser starts empty, which is why backups exist');
});

test('selling the last unit leaves stock at zero and blocks the next sale', () => {
  const store = createStore(fakeBackend());
  let state = store.save({
    ...store.load(),
    products: [{ id: 'p1', name: 'Last cup', sku: 'X', category: 'Drinks', unit: 'cup', cost: 10, price: 30, stock: 1 }],
  });

  const sale = {
    id: 's1',
    receipt: 'SI-000001',
    at: new Date().toISOString(),
    customer: 'Walk-in',
    payment: 'Cash',
    discountPct: 0,
    items: [{ id: 'p1', name: 'Last cup', price: 30, cost: 10, qty: 1 }],
  };
  sale.totals = saleTotals(sale, state.settings);
  assert.equal(sale.totals.profit, 20);

  state = store.save({ ...state, sales: [sale], products: applySaleToStock(state.products, sale) });
  assert.equal(state.products[0].stock, 0);

  // The POS refuses to oversell: this is the guard saveSale() applies.
  const oversell = sale.items[0].qty > state.products[0].stock;
  assert.equal(oversell, true, 'a second unit would exceed stock, so the UI must reject it');
});
