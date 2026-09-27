// Kwenta UI wiring. All money math lives in calc.js/money.js; this file only
// moves values between the DOM and the store.

import {
  DEFAULT_SETTINGS,
  applySaleToStock,
  dailyAggregates,
  discountAmount,
  emptyLine,
  lineTotal,
  lowStock,
  nextReceiptNumber,
  saleTotals,
  stockValue,
  subtotal,
  topProducts,
} from './calc.js';
import { formatMoney, formatPercent, parseMoney, parseQty, round2 } from './money.js';
import { downloadText, productColumns, saleColumns, toCSV } from './csv.js';
import { createStore, makeId, normalizeProduct, parseBackup } from './storage.js';
import { buildSampleState } from './seed.js';
import { barChart } from './chart.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = createStore(typeof localStorage !== 'undefined' ? localStorage : null);
let state = store.load();

// In-memory working sale, kept out of persisted state until it is saved.
let cart = [{ ...emptyLine() }];
let posFilter = { q: '', category: 'All' };
let invFilter = { q: '', sort: 'name' };
let recFilter = { q: '', days: 14 };
let dashRange = 14;
let editingProductId = null;
let lastReceiptHtml = '';

/* ------------------------------------------------------------------ utils */

function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast is-on ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.className = `toast ${kind}`;
  }, 2600);
}

function persist() {
  state = store.save(state);
  renderStorageNote();
}

function fmtDate(iso, withTime = true) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  const date = d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  if (!withTime) return date;
  return `${date} ${d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
}

function daysAgo(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

function salesInRange(days) {
  if (!days) return [...state.sales];
  const from = daysAgo(days).getTime();
  return state.sales.filter((s) => new Date(s.at).getTime() >= from);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// <dialog> is supported by every current browser, but degrade to the plain
// `open` attribute instead of throwing where it is not (or under test harnesses).
function openDialog(el) {
  if (typeof el.showModal === 'function') {
    el.showModal();
    return;
  }
  el.setAttribute('open', '');
  el.classList.add('is-open');
}

function closeDialog(el) {
  if (typeof el.close === 'function') {
    el.close();
    return;
  }
  el.removeAttribute('open');
  el.classList.remove('is-open');
}

/* ------------------------------------------------------------------- nav */

function setView(name) {
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  $$('.nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  if (name === 'dashboard') renderDashboard();
  if (name === 'sell') renderPos();
  if (name === 'inventory') renderInventory();
  if (name === 'records') renderRecords();
  if (name === 'settings') renderSettings();
}

/* -------------------------------------------------------------- dashboard */

function renderDashboard() {
  const sales = salesInRange(dashRange);
  const totals = sales.reduce(
    (acc, s) => {
      acc.revenue = round2(acc.revenue + (s.totals?.total ?? 0));
      acc.profit = round2(acc.profit + (s.totals?.profit ?? 0));
      acc.orders += 1;
      return acc;
    },
    { revenue: 0, profit: 0, orders: 0 },
  );
  const sv = stockValue(state.products);
  const rangeLabel = dashRange ? `last ${dashRange} days` : 'all time';

  $('#kpiSales').textContent = formatMoney(totals.revenue);
  $('#kpiSalesMeta').textContent = `${totals.orders} orders in the ${rangeLabel}`;
  $('#kpiProfit').textContent = formatMoney(totals.profit);
  $('#kpiProfitMeta').textContent = totals.revenue
    ? `${formatPercent((totals.profit / totals.revenue) * 100)} margin on sales`
    : 'No sales recorded yet';
  $('#kpiOrders').textContent = String(totals.orders);
  $('#kpiOrdersMeta').textContent = totals.orders
    ? `${formatMoney(totals.revenue / totals.orders)} average order`
    : 'Ring up a sale to begin';
  $('#kpiStock').textContent = formatMoney(sv.atCost);
  $('#kpiStockMeta').textContent = `${formatMoney(sv.atRetail)} at retail \u00b7 ${state.products.length} products`;

  const from = dashRange ? daysAgo(dashRange) : null;
  const series = dailyAggregates(from ? state.sales.filter((s) => new Date(s.at) >= from) : state.sales);
  $('#chart').innerHTML = barChart(series);

  const top = topProducts(sales, 6);
  $('#topProducts').innerHTML = top.length
    ? top
        .map(
          (p, i) => `<li><span class="idx">${i + 1}</span><span class="nm">${esc(p.name)}</span>` +
            `<span class="qty">${p.qty} sold</span><span class="rev">${formatMoney(p.revenue)}</span></li>`,
        )
        .join('')
    : '<li class="empty">No sales in this range yet.</li>';

  renderAlerts(sv);
}

function renderAlerts(sv) {
  const alerts = [];
  const low = lowStock(state.products, state.settings.lowStockThreshold);

  for (const p of low.slice(0, 6)) {
    const cls = p.stock <= 0 ? 'bad' : 'warn';
    alerts.push(
      `<div class="alert ${cls}"><span class="dot"></span><b>${esc(p.name)}</b>` +
        `<span class="sp muted">is ${p.stock <= 0 ? 'out of stock' : 'running low'}</span>` +
        `<span class="val">${p.stock} ${esc(p.unit)} left</span></div>`,
    );
  }
  if (low.length > 6) {
    alerts.push(`<div class="alert warn"><span class="dot"></span><span class="sp">and ${low.length - 6} more products below the alert level</span></div>`);
  }

  const losers = state.products.filter((p) => p.price > 0 && p.price < p.cost);
  for (const p of losers.slice(0, 3)) {
    alerts.push(
      `<div class="alert bad"><span class="dot"></span><b>${esc(p.name)}</b>` +
        `<span class="sp muted">is priced below cost</span>` +
        `<span class="val">${formatMoney(p.cost - p.price)} loss per unit</span></div>`,
    );
  }

  if (state.products.length === 0) {
    alerts.push(
      `<div class="alert warn"><span class="dot"></span><span class="sp">` +
        `No products yet. Add your items in <b>Inventory</b>, or load sample data from <b>Settings</b> to see how it works.</span></div>`,
    );
  } else if (alerts.length === 0) {
    alerts.push(
      `<div class="alert good"><span class="dot"></span><span class="sp">` +
        `Stock levels healthy \u00b7 ${formatMoney(sv.atRetail - sv.atCost)} potential profit sitting on the shelf.</span></div>`,
    );
  }

  $('#alerts').innerHTML = alerts.join('');
}

/* ------------------------------------------------------------------- sell */

function renderPos() {
  const categories = ['All', ...new Set(state.products.map((p) => p.category).filter(Boolean))].sort((a, b) =>
    a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b),
  );
  $('#posCategories').innerHTML = categories
    .map((c) => `<button class="chip ${posFilter.category === c ? 'is-active' : ''}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`)
    .join('');

  const q = posFilter.q.trim().toLowerCase();
  const items = state.products
    .filter((p) => (posFilter.category === 'All' ? true : p.category === posFilter.category))
    .filter((p) => (q ? `${p.name} ${p.sku}`.toLowerCase().includes(q) : true));

  $('#posGrid').innerHTML = items.length
    ? items
        .map(
          (p) =>
            `<button class="pos-item" data-add="${p.id}" type="button" ${p.stock <= 0 ? 'disabled' : ''}>` +
            `<span class="nm">${esc(p.name)}</span>` +
            `<span class="pr">${formatMoney(p.price)}</span>` +
            `<span class="st">${p.stock <= 0 ? 'Out of stock' : `${p.stock} ${esc(p.unit)} on hand`}</span>` +
            `</button>`,
        )
        .join('')
    : '<p class="empty">No products match. Add some in Inventory.</p>';

  $('#receiptNo').textContent = nextReceiptNumber(state.counter, state.settings);
  renderCart();
}

function renderCart() {
  const lines = cart.filter((l) => l.name);
  $('#cart').innerHTML = lines.length
    ? lines
        .map(
          (l, i) =>
            `<div class="cart-row" data-i="${i}">` +
            `<span class="nm">${esc(l.name)}<span class="un">${formatMoney(l.price)} each</span></span>` +
            `<span class="qty"><button data-dec="${i}" type="button" aria-label="Decrease">\u2212</button>` +
            `<span>${l.qty}</span><button data-inc="${i}" type="button" aria-label="Increase">+</button></span>` +
            `<span class="amt">${formatMoney(lineTotal(l.price, l.qty))}</span>` +
            `<button class="rm" data-rm="${i}" type="button" aria-label="Remove">\u00d7</button></div>`,
        )
        .join('')
    : '<p class="empty">Tap a product to add it.</p>';

  const t = saleTotals({ items: cart, discountPct: parseMoney($('#saleDiscount').value) }, state.settings);
  const rows = [
    ['Subtotal', formatMoney(t.gross)],
    ...(t.discount ? [['Discount', `\u2212${formatMoney(t.discount)}`]] : []),
    ...(state.settings.vatEnabled
      ? [
          [state.settings.vatInclusive ? `Vatable sales (${formatPercent(state.settings.vatRate * 100, 0)})` : 'Vatable sales', formatMoney(t.vatableSales)],
          ['VAT', formatMoney(t.vat)],
        ]
      : []),
  ];

  $('#saleTotals').innerHTML =
    rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('') +
    `<div class="grand"><dt>Total</dt><dd>${formatMoney(t.total)}</dd></div>` +
    `<div class="profit"><dt>Profit on this sale</dt><dd>${formatMoney(t.profit)} (${formatPercent(t.marginPct)})</dd></div>`;

  $('#saveSale').disabled = lines.length === 0;
}

function addToCart(productId) {
  const p = state.products.find((x) => x.id === productId);
  if (!p) return;
  const inCart = cart.reduce((n, l) => (l.id === productId ? n + Number(l.qty) : n), 0);
  if (inCart >= p.stock) {
    toast(`Only ${p.stock} ${p.unit} of ${p.name} on hand`, 'bad');
    return;
  }
  const existing = cart.find((l) => l.id === productId);
  if (existing) existing.qty += 1;
  else cart = [...cart.filter((l) => l.name), { id: p.id, name: p.name, price: p.price, cost: p.cost, qty: 1 }];
  // Only the receipt is redrawn. Rebuilding the product grid here would throw
  // away the shopkeeper's scroll position on every tap.
  renderCart();
}

function saveSale() {
  const items = cart.filter((l) => l.name && Number(l.qty) > 0);
  if (items.length === 0) return toast('Add at least one item first', 'bad');

  for (const item of items) {
    const p = state.products.find((x) => x.id === item.id);
    if (p && Number(item.qty) > Number(p.stock)) {
      return toast(`Not enough ${p.name} in stock (${p.stock} left)`, 'bad');
    }
  }

  const sale = {
    id: makeId('sal'),
    receipt: nextReceiptNumber(state.counter, state.settings),
    at: new Date().toISOString(),
    customer: $('#saleCustomer').value.trim() || 'Walk-in',
    payment: $('#salePayment').value,
    discountPct: parseMoney($('#saleDiscount').value),
    notes: '',
    items: items.map((i) => ({ id: i.id, name: i.name, price: i.price, cost: i.cost, qty: Number(i.qty) })),
  };
  sale.totals = saleTotals(sale, state.settings);

  state.sales = [...state.sales, sale];
  state.products = applySaleToStock(state.products, sale);
  state.counter = Number(state.counter) + 1;
  persist();

  cart = [{ ...emptyLine() }];
  $('#saleCustomer').value = '';
  $('#saleDiscount').value = '0';
  renderPos();
  toast(`Saved ${sale.receipt} \u00b7 ${formatMoney(sale.totals.total)} \u00b7 profit ${formatMoney(sale.totals.profit)}`, 'good');
  showReceipt(sale);
}

/* --------------------------------------------------------------- receipt */

function receiptHtml(sale) {
  const s = state.settings;
  const t = sale.totals ?? saleTotals(sale, s);
  const items = (sale.items ?? [])
    .map(
      (i) =>
        `<div class="rc-item"><span class="q">${i.qty} \u00d7 ${esc(i.name)} @ ${formatMoney(i.price)}</span>` +
        `<span>${formatMoney(lineTotal(i.price, i.qty))}</span></div>`,
    )
    .join('');

  return (
    `<div class="rc-head"><b>${esc(s.businessName)}</b><br/>` +
    `${esc(s.address)}<br/>` +
    (s.tin ? `TIN: ${esc(s.tin)}<br/>` : '') +
    (s.phone ? `${esc(s.phone)}<br/>` : '') +
    `</div>` +
    `<div class="rc-line"></div>` +
    `<div class="rc-item"><span>${esc(sale.receipt)}</span><span>${esc(fmtDate(sale.at))}</span></div>` +
    `<div class="rc-item rc-mut"><span>${esc(sale.customer)}</span><span>${esc(sale.payment)}</span></div>` +
    `<div class="rc-line"></div>` +
    items +
    `<div class="rc-line"></div>` +
    `<div class="rc-item"><span>Subtotal</span><span>${formatMoney(t.gross)}</span></div>` +
    (t.discount ? `<div class="rc-item"><span>Discount</span><span>-${formatMoney(t.discount)}</span></div>` : '') +
    (s.vatEnabled
      ? `<div class="rc-item rc-mut"><span>Vatable sales</span><span>${formatMoney(t.vatableSales)}</span></div>` +
        `<div class="rc-item rc-mut"><span>VAT ${formatPercent(s.vatRate * 100, 0)}</span><span>${formatMoney(t.vat)}</span></div>`
      : `<div class="rc-item rc-mut"><span>VAT exempt / non-VAT</span><span>0.00</span></div>`) +
    `<div class="rc-total"><span>TOTAL</span><span>${formatMoney(t.total)}</span></div>` +
    `<div class="rc-line"></div>` +
    `<div class="rc-foot">Thank you! ${esc(s.businessName)}</div>`
  );
}

function showReceipt(sale) {
  lastReceiptHtml = receiptHtml(sale);
  $('#receiptPrint').innerHTML = lastReceiptHtml;
  openDialog($('#receiptDialog'));
}

/* ------------------------------------------------------------- inventory */

function renderInventory() {
  const q = invFilter.q.trim().toLowerCase();
  let rows = state.products.filter((p) => (q ? `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q) : true));
  rows = rows.slice().sort((a, b) => {
    switch (invFilter.sort) {
      case 'stock':
        return a.stock - b.stock || a.name.localeCompare(b.name);
      case 'value':
        return b.stock * b.cost - a.stock * a.cost;
      case 'category':
        return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
      default:
        return a.name.localeCompare(b.name);
    }
  });

  const threshold = state.settings.lowStockThreshold;
  $('#invTable tbody').innerHTML = rows.length
    ? rows
        .map((p) => {
          const margin = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0;
          const lowFlag = p.stock <= threshold;
          return (
            `<tr data-id="${p.id}">` +
            `<td><span class="nm">${esc(p.name)}</span><br/><span class="sku">${esc(p.sku || '\u2014')}</span></td>` +
            `<td class="muted">${esc(p.category)}</td>` +
            `<td class="num">${formatMoney(p.cost)}</td>` +
            `<td class="num">${formatMoney(p.price)}</td>` +
            `<td class="num">${formatPercent(margin, 0)}</td>` +
            `<td class="num">${lowFlag ? `<span class="pill ${p.stock <= 0 ? 'low' : ''}">${p.stock}</span>` : p.stock}</td>` +
            `<td class="num">${formatMoney(p.stock * p.cost)}</td>` +
            `<td class="num"><button class="btn tiny ghost" data-edit="${p.id}" type="button">Edit</button></td>` +
            `</tr>`
          );
        })
        .join('')
    : '<tr><td colspan="8" class="empty">No products yet. Click "Add product".</td></tr>';
}

function openProductDialog(id = null) {
  editingProductId = id;
  const p = id ? state.products.find((x) => x.id === id) : null;
  $('#productDialogTitle').textContent = p ? 'Edit product' : 'Add product';
  $('#pName').value = p?.name ?? '';
  $('#pSku').value = p?.sku ?? '';
  $('#pCategory').value = p?.category ?? '';
  $('#pUnit').value = p?.unit ?? 'pc';
  $('#pCost').value = p?.cost ?? '';
  $('#pPrice').value = p?.price ?? '';
  $('#pStock').value = p?.stock ?? 0;
  $('#categoryList').innerHTML = [...new Set(state.products.map((x) => x.category))]
    .map((c) => `<option value="${esc(c)}"></option>`)
    .join('');
  updateProductMargin();
  openDialog($('#productDialog'));
  $('#pName').focus();
}

function updateProductMargin() {
  const cost = parseMoney($('#pCost').value);
  const price = parseMoney($('#pPrice').value);
  if (price <= 0) {
    $('#productMargin').textContent = '';
    return;
  }
  const gain = round2(price - cost);
  const pct = round2((gain / price) * 100);
  $('#productMargin').textContent =
    gain >= 0
      ? `Mark-up: ${formatMoney(gain)} per unit (${formatPercent(pct)} margin).`
      : `Warning: you lose ${formatMoney(Math.abs(gain))} per unit at this price.`;
}

function saveProduct() {
  const name = $('#pName').value.trim();
  if (!name) return toast('A product needs a name', 'bad');
  const data = normalizeProduct({
    id: editingProductId ?? makeId('prd'),
    name,
    sku: $('#pSku').value.trim(),
    category: $('#pCategory').value.trim() || 'General',
    unit: $('#pUnit').value.trim() || 'pc',
    cost: parseMoney($('#pCost').value),
    price: parseMoney($('#pPrice').value),
    stock: parseQty($('#pStock').value),
  });

  state.products = editingProductId
    ? state.products.map((p) => (p.id === editingProductId ? data : p))
    : [...state.products, data];
  persist();
  renderInventory();
  renderPos();
  toast(editingProductId ? 'Product updated' : `"${name}" added`, 'good');
}

/* --------------------------------------------------------------- records */

function renderRecords() {
  const q = recFilter.q.trim().toLowerCase();
  const from = recFilter.days ? daysAgo(recFilter.days).getTime() : 0;
  let rows = state.sales.filter((s) => new Date(s.at).getTime() >= from);
  if (q) {
    rows = rows.filter((s) =>
      `${s.receipt} ${s.customer} ${(s.items ?? []).map((i) => i.name).join(' ')}`.toLowerCase().includes(q),
    );
  }
  rows = rows.slice().sort((a, b) => (a.at < b.at ? 1 : -1));

  const sum = rows.reduce(
    (acc, s) => {
      acc.total = round2(acc.total + (s.totals?.total ?? 0));
      acc.profit = round2(acc.profit + (s.totals?.profit ?? 0));
      return acc;
    },
    { total: 0, profit: 0 },
  );

  $('#recTable tbody').innerHTML = rows.length
    ? rows
        .map(
          (s) =>
            `<tr>` +
            `<td class="nm">${esc(s.receipt)}</td>` +
            `<td class="muted">${esc(fmtDate(s.at))}</td>` +
            `<td>${esc(s.customer)}</td>` +
            `<td class="muted">${esc((s.items ?? []).map((i) => `${i.qty}\u00d7 ${i.name}`).join(', '))}</td>` +
            `<td class="num">${formatMoney(s.totals?.total)}</td>` +
            `<td class="num" style="color:var(--good)">${formatMoney(s.totals?.profit)}</td>` +
            `<td class="num"><button class="btn tiny ghost" data-receipt="${s.id}" type="button">View</button></td>` +
            `</tr>`,
        )
        .join('') +
      `<tr><td colspan="4" class="nm">Shown: ${rows.length} sale${rows.length === 1 ? '' : 's'}</td>` +
      `<td class="num nm">${formatMoney(sum.total)}</td>` +
      `<td class="num nm" style="color:var(--good)">${formatMoney(sum.profit)}</td><td></td></tr>`
    : '<tr><td colspan="7" class="empty">Nothing here yet. Sales you record will appear in this list.</td></tr>';
}

/* -------------------------------------------------------------- settings */

function renderSettings() {
  const s = state.settings;
  $('#setName').value = s.businessName;
  $('#setAddress').value = s.address;
  $('#setTin').value = s.tin;
  $('#setPhone').value = s.phone;
  $('#setPrefix').value = s.receiptPrefix;
  $('#setLowStock').value = s.lowStockThreshold;
  $('#setVat').checked = s.vatEnabled;
  $('#setVatInclusive').checked = s.vatInclusive;
  $('#setVatRate').value = s.vatRate;
  const sv = stockValue(state.products);
  $('#dataSummary').textContent =
    `${state.products.length} products \u00b7 ${state.sales.length} sales \u00b7 stock at cost ${formatMoney(sv.atCost)}` +
    (state.updatedAt ? ` \u00b7 last saved ${fmtDate(state.updatedAt)}` : '');
}

function saveSettings() {
  state.settings = {
    ...state.settings,
    businessName: $('#setName').value.trim() || DEFAULT_SETTINGS.businessName,
    address: $('#setAddress').value.trim(),
    tin: $('#setTin').value.trim(),
    phone: $('#setPhone').value.trim(),
    receiptPrefix: $('#setPrefix').value.trim().toUpperCase() || 'SI',
    lowStockThreshold: Math.max(parseQty($('#setLowStock').value), 0),
    vatEnabled: $('#setVat').checked,
    vatInclusive: $('#setVatInclusive').checked,
    vatRate: Math.min(Math.max(Number($('#setVatRate').value) || 0, 0), 0.5),
  };
  persist();
  $('#brandBusiness').textContent = state.settings.businessName;
  renderSettings();
  toast('Settings saved', 'good');
}

function renderStorageNote() {
  const hasBackend = typeof localStorage !== 'undefined';
  $('#storageNote').textContent = hasBackend
    ? `${state.sales.length} sales \u00b7 stored in this browser`
    : 'Demo mode \u00b7 changes are not persisted';
}

/* ---------------------------------------------------------------- events */

function wire() {
  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (btn) setView(btn.dataset.view);
  });

  // Dashboard
  $('#rangeSelect').addEventListener('change', (e) => {
    dashRange = Number(e.target.value);
    renderDashboard();
  });

  // POS
  $('#posSearch').addEventListener('input', (e) => {
    posFilter.q = e.target.value;
    renderPos();
  });
  $('#posCategories').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    posFilter.category = chip.dataset.cat;
    renderPos();
  });
  $('#posGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (btn) addToCart(btn.dataset.add);
  });
  $('#cart').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    const rm = e.target.closest('[data-rm]');
    if (inc) addToCart(cart[Number(inc.dataset.inc)].id);
    if (dec) {
      const i = Number(dec.dataset.dec);
      cart[i].qty = Math.max(cart[i].qty - 1, 1);
      renderCart();
    }
    if (rm) {
      cart.splice(Number(rm.dataset.rm), 1);
      if (cart.filter((l) => l.name).length === 0) cart = [{ ...emptyLine() }];
      renderCart();
    }
  });
  $('#saleDiscount').addEventListener('input', renderCart);
  $('#saveSale').addEventListener('click', saveSale);
  $('#clearSale').addEventListener('click', () => {
    cart = [{ ...emptyLine() }];
    $('#saleDiscount').value = '0';
    $('#saleCustomer').value = '';
    renderCart();
    toast('Cleared');
  });
  $('#printReceipt').addEventListener('click', () => {
    const items = cart.filter((l) => l.name && Number(l.qty) > 0);
    if (items.length === 0) return toast('Nothing to print yet', 'bad');
    const draft = {
      receipt: `${nextReceiptNumber(state.counter, state.settings)} (draft)`,
      at: new Date().toISOString(),
      customer: $('#saleCustomer').value.trim() || 'Walk-in',
      payment: $('#salePayment').value,
      items,
      totals: saleTotals({ items, discountPct: parseMoney($('#saleDiscount').value) }, state.settings),
    };
    showReceipt(draft);
  });

  // Receipt dialog
  $('#closeReceipt').addEventListener('click', () => closeDialog($('#receiptDialog')));
  $('#doPrint').addEventListener('click', () => window.print());

  // Inventory
  $('#invSearch').addEventListener('input', (e) => {
    invFilter.q = e.target.value;
    renderInventory();
  });
  $('#invSort').addEventListener('change', (e) => {
    invFilter.sort = e.target.value;
    renderInventory();
  });
  $('#addProduct').addEventListener('click', () => openProductDialog(null));
  $('#invTable').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit]');
    if (btn) openProductDialog(btn.dataset.edit);
  });
  $('#productForm').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'save') {
      e.preventDefault();
      saveProduct();
      closeDialog($('#productDialog'));
    }
  });
  ['#pCost', '#pPrice'].forEach((sel) => $(sel).addEventListener('input', updateProductMargin));
  $('#exportProducts').addEventListener('click', () => {
    if (state.products.length === 0) return toast('No products to export', 'bad');
    downloadText('kwenta-products.csv', toCSV(productColumns, state.products));
    toast('Products exported', 'good');
  });

  // Records
  $('#recSearch').addEventListener('input', (e) => {
    recFilter.q = e.target.value;
    renderRecords();
  });
  $('#recRange').addEventListener('change', (e) => {
    recFilter.days = Number(e.target.value);
    renderRecords();
  });
  $('#recTable').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-receipt]');
    if (!btn) return;
    const sale = state.sales.find((s) => s.id === btn.dataset.receipt);
    if (sale) showReceipt(sale);
  });
  $('#exportSales').addEventListener('click', () => {
    if (state.sales.length === 0) return toast('No sales to export', 'bad');
    const rows = state.sales.slice().sort((a, b) => (a.at < b.at ? -1 : 1));
    downloadText('kwenta-sales.csv', toCSV(saleColumns, rows));
    toast(`${rows.length} sales exported`, 'good');
  });

  // Settings
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#backup').addEventListener('click', () => {
    const blob = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
    if (typeof document === 'undefined') return;
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `kwenta-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup downloaded', 'good');
  });
  $('#restore').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = parseBackup(await file.text());
    e.target.value = '';
    if (!result.ok) return toast(result.error, 'bad');
    if (!window.confirm('Replace all current data with this backup?')) return;
    state = result.state;
    persist();
    setView('dashboard');
    toast('Backup restored', 'good');
  });
  $('#loadSample').addEventListener('click', () => {
    if (state.products.length && !window.confirm('Load sample data over your current products and sales?')) return;
    const { products, sales, counter } = buildSampleState(state.settings);
    state = { ...state, products, sales, counter };
    persist();
    setView('dashboard');
    toast('Sample data loaded', 'good');
  });
  $('#wipe').addEventListener('click', () => {
    if (!window.confirm('Erase all products, sales and settings from this browser? This cannot be undone.')) return;
    store.clear();
    state = store.load();
    setView('dashboard');
    toast('All data erased');
  });
}

/* ------------------------------------------------------------------ boot */

function boot() {
  wire();
  $('#brandBusiness').textContent = state.settings.businessName;
  renderStorageNote();

  // First run: seed the demo so the app explains itself.
  if (state.products.length === 0 && state.sales.length === 0) {
    const { products, sales, counter } = buildSampleState(state.settings);
    state = { ...state, products, sales, counter };
    persist();
    toast('Loaded sample data \u2014 erase it in Settings to start fresh');
  }

  setView('dashboard');
}

boot();
