import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeCsv, productColumns, saleColumns, toCSV } from '../js/csv.js';

test('escapeCsv quotes only when necessary', () => {
  assert.equal(escapeCsv('plain'), 'plain');
  assert.equal(escapeCsv('has,comma'), '"has,comma"');
  assert.equal(escapeCsv('has"quote'), '"has""quote"');
  assert.equal(escapeCsv('line\nbreak'), '"line\nbreak"');
  assert.equal(escapeCsv(null), '');
  assert.equal(escapeCsv(0), '0');
});

test('toCSV builds a header row plus escaped body rows', () => {
  const csv = toCSV(
    [{ key: 'a', label: 'Name' }, { key: 'b', label: 'Note' }],
    [
      { a: 'One', b: 'fine' },
      { a: 'Two, Inc.', b: 'says "hi"' },
    ],
  );
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Name,Note');
  assert.equal(lines[1], 'One,fine');
  assert.equal(lines[2], '"Two, Inc.","says ""hi"""');
});

test('toCSV supports computed columns', () => {
  const csv = toCSV([{ key: 'n', label: 'N' }, { key: 'd', label: 'Double', value: (r) => r.n * 2 }], [{ n: 4 }]);
  assert.equal(csv.split('\r\n')[1], '4,8');
});

test('productColumns exports a stock value at cost', () => {
  const csv = toCSV(productColumns, [
    { name: 'Tea', sku: 'MT', category: 'Drinks', unit: 'cup', cost: 18, price: 45, stock: 10 },
  ]);
  const lines = csv.split('\r\n');
  assert.ok(lines[0].includes('Stock value (cost)'));
  assert.equal(lines[1], 'Tea,MT,Drinks,cup,18,45,10,180');
});

test('saleColumns flattens a sale with its totals', () => {
  const sale = {
    receipt: 'SI-000001',
    at: '2026-09-27T10:00:00.000Z',
    customer: 'Aling Nena',
    payment: 'Cash',
    items: [
      { qty: 2, name: 'Milk tea' },
      { qty: 1, name: 'Pearls' },
    ],
    totals: { gross: 100, discount: 0, vat: 10.71, total: 100, profit: 61 },
  };
  const row = toCSV(saleColumns, [sale]).split('\r\n')[1];
  assert.equal(
    row,
    'SI-000001,2026-09-27T10:00:00.000Z,Aling Nena,Cash,2 x Milk tea | 1 x Pearls,100,0,10.71,100,61',
  );
});

test('saleColumns quotes the items field when a product name contains a comma', () => {
  const sale = {
    receipt: 'SI-000002',
    at: '2026-09-27T11:00:00.000Z',
    customer: 'JM',
    payment: 'GCash',
    items: [{ qty: 1, name: 'Milk tea, large' }],
    totals: { gross: 65, discount: 0, vat: 6.96, total: 65, profit: 39 },
  };
  const row = toCSV(saleColumns, [sale]).split('\r\n')[1];
  assert.equal(
    row,
    'SI-000002,2026-09-27T11:00:00.000Z,JM,GCash,"1 x Milk tea, large",65,0,6.96,65,39',
  );
});
