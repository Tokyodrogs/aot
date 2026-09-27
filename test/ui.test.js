// UI integration test. Loads the real index.html into jsdom, runs the real
// js/app.js against it, and drives the interface the way a user would.
// This is the only test that exercises the DOM wiring in app.js.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// jsdom is a devDependency. If it is not installed, every test below is
// reported as skipped rather than failing, so `npm test` still tells the truth.
let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  JSDOM = null;
}

const SKIP_REASON = 'jsdom not installed \u2014 run `npm install`';
const run = JSDOM
  ? test
  : (name, fn) => test(name, { skip: SKIP_REASON }, () => {});

const HTML = fileURLToPath(new URL('../index.html', import.meta.url));

let dom, win, doc;

const click = (el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
};
const $ = (sel) => doc.querySelector(sel);
const $$ = (sel) => [...doc.querySelectorAll(sel)];
const storageState = () => JSON.parse(win.localStorage.getItem('kwenta:v1'));

before(async (t) => {
  if (!JSDOM) return t.skip(SKIP_REASON);
  dom = new JSDOM(await readFile(HTML, 'utf8'), {
    url: 'http://localhost:8000/',
    pretendToBeVisual: true,
  });
  win = dom.window;

  // jsdom lacks these; app.js touches them.
  win.print = () => {};
  win.confirm = () => true;

  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.localStorage = win.localStorage;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Node = win.Node;
  globalThis.Event = win.Event;

  doc = win.document;
  await import('../js/app.js'); // runs boot()
});

run('boot seeds the demo shop and the dashboard renders real numbers', () => {
  const state = storageState();
  assert.ok(state, 'app wrote its document to localStorage');
  assert.ok(state.products.length > 0, 'sample products were seeded');
  assert.ok(state.sales.length > 0, 'sample sales were seeded');

  assert.match($('#kpiSales').textContent, /\u20B1[\d,]+\.\d\d/, 'sales KPI shows a peso amount');
  assert.match($('#kpiProfit').textContent, /\u20B1[\d,]+\.\d\d/);
  assert.notEqual($('#kpiOrders').textContent, '\u2014');
  assert.ok($('#chart').innerHTML.includes('<svg'), 'chart rendered as SVG');
  assert.ok($$('#topProducts li').length > 0, 'best sellers listed');
  assert.ok($$('#alerts .alert').length > 0, 'attention panel populated');
});

run('switching views moves the active panel', () => {
  click($('.nav-btn[data-view="inventory"]'));
  assert.ok($('#view-inventory').classList.contains('is-active'));
  assert.ok(!$('#view-dashboard').classList.contains('is-active'));

  click($('.nav-btn[data-view="records"]'));
  assert.ok($('#view-records').classList.contains('is-active'));
  assert.ok($$('#recTable tbody tr').length > 1, 'records table lists sales plus a totals row');
});

run('inventory lists products with margin and stock, and search filters it', () => {
  click($('.nav-btn[data-view="inventory"]'));
  const all = $$('#invTable tbody tr').length;
  assert.ok(all > 5, `expected the catalogue in the table, got ${all} rows`);

  type($('#invSearch'), 'matcha');
  const filtered = $$('#invTable tbody tr');
  assert.equal(filtered.length, 1);
  assert.match(filtered[0].textContent, /Matcha Latte/);

  type($('#invSearch'), '');
  assert.equal($$('#invTable tbody tr').length, all);
});

run('adding a product through the dialog persists it', () => {
  click($('.nav-btn[data-view="inventory"]'));
  const before = storageState().products.length;

  click($('#addProduct'));
  $('#pName').value = 'Ube Milk Tea';
  $('#pSku').value = 'MT-UBE';
  $('#pCategory').value = 'Drinks';
  $('#pUnit').value = 'cup';
  $('#pCost').value = '22';
  $('#pPrice').value = '55';
  $('#pStock').value = '30';
  $('#pCost').dispatchEvent(new win.Event('input', { bubbles: true }));
  $('#pPrice').dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.match($('#productMargin').textContent, /33\.00/, 'mark-up hint shows the per-unit gain');

  click($('#productSave'));

  const after = storageState();
  assert.equal(after.products.length, before + 1);
  const saved = after.products.find((p) => p.name === 'Ube Milk Tea');
  assert.equal(saved.price, 55);
  assert.equal(saved.stock, 30);
});

run('the POS adds to cart, computes totals, and a saved sale decrements stock', () => {
  click($('.nav-btn[data-view="sell"]'));
  const state = storageState();
  const target = state.products.find((p) => p.name === 'Ube Milk Tea');
  const stockBefore = target.stock;

  // Tap the product tile twice, re-querying each time as a finger on screen would.
  const findTile = () => $$('#posGrid .pos-item').find((b) => b.dataset.add === target.id);
  assert.ok(findTile(), 'the new product appears on the POS grid');
  click(findTile());
  click(findTile());

  assert.equal($$('#cart .cart-row').length, 1, 'two taps land on one line item');
  assert.match($('#cart .cart-row .amt').textContent, /\u20B1110\.00/, 'line total is 2 x 55');
  assert.match($('#saleTotals').textContent, /\u20B1110\.00/, 'receipt total matches');
  assert.match($('#saleTotals').textContent, /Profit on this sale/, 'profit is shown before saving');

  const salesBefore = state.sales.length;
  type($('#saleCustomer'), 'UI Test');
  click($('#saveSale'));

  const after = storageState();
  assert.equal(after.sales.length, salesBefore + 1, 'the sale was recorded');
  assert.equal(after.products.find((p) => p.id === target.id).stock, stockBefore - 2, 'stock dropped by 2');
  assert.equal(after.sales.at(-1).customer, 'UI Test');
  assert.equal(after.sales.at(-1).totals.total, 110);
  assert.equal(after.sales.at(-1).totals.profit, 66, '110 net - 44 cost');
  assert.ok($('#toast').classList.contains('is-on'), 'user got confirmation');
  assert.ok($('#receiptPrint').textContent.includes(after.sales.at(-1).receipt), 'receipt printed with its number');
});

run('a discount reduces the total and the profit', () => {
  click($('.nav-btn[data-view="sell"]'));
  const target = storageState().products.find((p) => p.name === 'Ube Milk Tea');
  const tile = $$('#posGrid .pos-item').find((b) => b.dataset.add === target.id);
  click(tile);
  assert.match($('#cart .cart-row .amt').textContent, /\u20B155\.00/, 'the cart was empty to start with');
  type($('#saleDiscount'), '10');

  // 55 gross, 10% off -> 49.50 net, cost 22 -> 27.50 profit.
  assert.match($('#saleTotals').textContent, /\u20B149\.50/);
  assert.match($('#saleTotals').textContent, /\u20B127\.50/);

  click($('#clearSale'));
  assert.equal($$('#cart .cart-row').length, 0);
});

run('settings changes persist and reach the header', () => {
  click($('.nav-btn[data-view="settings"]'));
  type($('#setName'), 'Tindahan ni Arena');
  click($('#saveSettings'));

  assert.equal(storageState().settings.businessName, 'Tindahan ni Arena');
  assert.equal($('#brandBusiness').textContent, 'Tindahan ni Arena');
  assert.ok($('#dataSummary').textContent.includes('products'), 'data summary rendered');
});

run('erasing all data returns the app to a clean slate', () => {
  click($('.nav-btn[data-view="settings"]'));
  click($('#wipe'));

  assert.equal(win.localStorage.getItem('kwenta:v1'), null, 'the stored document is removed');
  assert.ok($('#view-dashboard').classList.contains('is-active'), 'app falls back to the dashboard');
  assert.equal($('#kpiSales').textContent, '\u20B10.00', 'KPIs reset');
  assert.equal($('#kpiOrders').textContent, '0');
  assert.match($('#alerts').textContent, /No products yet/, 'the empty state is explained');

  click($('.nav-btn[data-view="inventory"]'));
  assert.match($('#invTable tbody').textContent, /No products yet/);
});

run('the app recovers from a blank store and reseeds on next boot', () => {
  // Nothing was written after the wipe, so a reload starts from scratch.
  assert.equal(win.localStorage.getItem('kwenta:v1'), null);
  assert.equal(storageState(), null);
});
