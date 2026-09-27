import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createStore,
  emptyState,
  makeId,
  normalizeProduct,
  normalizeState,
  parseBackup,
} from '../js/storage.js';
import { DEFAULT_SETTINGS } from '../js/calc.js';

/** Minimal localStorage double so the real persistence path is exercised. */
function fakeBackend() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('emptyState has the documented shape', () => {
  const s = emptyState();
  assert.equal(s.version, 1);
  assert.deepEqual(s.products, []);
  assert.deepEqual(s.sales, []);
  assert.equal(s.settings.vatRate, 0.12);
  assert.equal(s.settings.vatInclusive, true);
});

test('normalizeState fills defaults for missing and corrupt fields', () => {
  const s = normalizeState({ products: 'nope', sales: null, counter: 'x' });
  assert.deepEqual(s.products, []);
  assert.deepEqual(s.sales, []);
  assert.equal(s.counter, DEFAULT_SETTINGS.receiptStart);
  assert.equal(s.settings.businessName, DEFAULT_SETTINGS.businessName);
});

test('normalizeState keeps valid data and coerces products', () => {
  const s = normalizeState({
    settings: { businessName: 'Tindahan ni Ana' },
    products: [{ id: 'p1', name: ' Tea ', cost: '18', price: '45', stock: '-3' }],
    sales: [{ id: 's1' }],
    counter: 7,
  });
  assert.equal(s.settings.businessName, 'Tindahan ni Ana');
  assert.equal(s.settings.vatRate, 0.12, 'untouched settings keep defaults');
  assert.equal(s.counter, 7);
  assert.deepEqual(s.products[0], {
    id: 'p1',
    name: 'Tea',
    sku: '',
    category: 'General',
    unit: 'pc',
    cost: 18,
    price: 45,
    stock: 0,
  });
});

test('normalizeProduct clamps negative stock and defaults category/unit', () => {
  const p = normalizeProduct({ name: 'X', stock: -9 });
  assert.equal(p.stock, 0);
  assert.equal(p.category, 'General');
  assert.equal(p.unit, 'pc');
});

test('store round-trips through the backend', () => {
  const backend = fakeBackend();
  const store = createStore(backend);
  const initial = store.load();
  assert.deepEqual(initial.products, []);

  store.save({ ...initial, products: [{ id: 'a', name: 'Tea', cost: 18, price: 45, stock: 4 }] });
  assert.equal(backend.map.size, 1, 'one document was written');

  const reloaded = createStore(backend).load();
  assert.equal(reloaded.products.length, 1);
  assert.equal(reloaded.products[0].name, 'Tea');
  assert.ok(reloaded.updatedAt, 'save stamps updatedAt');
});

test('store survives corrupt storage instead of crashing', () => {
  const backend = fakeBackend();
  const store = createStore(backend);
  store.save(emptyState());
  backend.setItem(store.key, '{ this is not json');
  assert.deepEqual(createStore(backend).load().products, []);
});

test('store.clear removes the document', () => {
  const backend = fakeBackend();
  const store = createStore(backend);
  store.save({ ...emptyState(), counter: 42 });
  store.clear();
  assert.equal(backend.map.size, 0);
  assert.equal(store.load().counter, DEFAULT_SETTINGS.receiptStart);
});

test('store works without any backend (memory mode)', () => {
  const store = createStore(null);
  store.save({ ...emptyState(), counter: 5 });
  assert.equal(store.load().counter, 5);
});

test('parseBackup rejects non-JSON and wrong-shaped payloads', () => {
  assert.equal(parseBackup('nope').ok, false);
  assert.equal(parseBackup('{"foo":1}').ok, false);
  assert.match(parseBackup('{"foo":1}').error, /missing both/);
});

test('parseBackup accepts a real backup and normalizes it', () => {
  const res = parseBackup(JSON.stringify({ products: [{ id: 'a', name: 'Tea', price: 45, cost: 18, stock: 2 }], sales: [] }));
  assert.equal(res.ok, true);
  assert.equal(res.state.products[0].stock, 2);
  assert.equal(res.state.settings.vatRate, 0.12);
});

test('makeId is unique and prefixed', () => {
  const ids = new Set(Array.from({ length: 500 }, () => makeId('prd')));
  assert.equal(ids.size, 500);
  assert.ok([...ids][0].startsWith('prd_'));
});
