// The accounting core. Every number a receipt or report shows is produced here,
// so it can be unit-tested without a browser.

import { round2 } from './money.js';

export const DEFAULT_SETTINGS = Object.freeze({
  businessName: 'Kwenta Demo Store',
  address: 'Imus, Cavite, Philippines',
  tin: '000-000-000-000',
  phone: '',
  receiptPrefix: 'SI',
  receiptStart: 1,
  vatEnabled: true,
  /** Philippine VAT rate. 12% is the standard rate. */
  vatRate: 0.12,
  /**
   * true  -> posted prices already include VAT (typical shelf price);
   *          VAT = total x 12/112, total is unchanged.
   * false -> VAT is added on top of the posted price.
   */
  vatInclusive: true,
  lowStockThreshold: 5,
});

export const emptyLine = () => ({ id: '', name: '', price: 0, cost: 0, qty: 1 });

export const emptySale = () => ({
  items: [emptyLine()],
  discountPct: 0,
  customer: '',
  payment: 'Cash',
  notes: '',
});

/** Total for one line item, in centavos-safe arithmetic. */
export function lineTotal(price, qty) {
  return round2(Number(price) * Number(qty));
}

/** Sum of all line totals before discount. */
export function subtotal(items = []) {
  return round2(items.reduce((sum, i) => sum + lineTotal(i.price, i.qty), 0));
}

/** Money value of a percentage discount applied to a base amount. */
export function discountAmount(base, pct) {
  const p = Math.min(Math.max(Number(pct) || 0, 0), 100);
  return round2((Number(base) || 0) * (p / 100));
}

/**
 * Split an amount into vatable sales and VAT, following BIR convention.
 * For VAT-inclusive pricing the VAT component is amount x 12/112.
 */
export function vatBreakdown(amount, { vatEnabled = true, vatRate = 0.12, vatInclusive = true } = {}) {
  const net = round2(amount);
  if (!vatEnabled) return { vatableSales: net, vat: 0, total: net };
  const rate = Number(vatRate) || 0;
  if (vatInclusive) {
    const vatableSales = round2(net / (1 + rate));
    return { vatableSales, vat: round2(net - vatableSales), total: net };
  }
  const vat = round2(net * rate);
  return { vatableSales: net, vat, total: round2(net + vat) };
}

/**
 * Full totals for a sale: discount, VAT split, cost, profit and margin.
 * VAT is a pass-through tax, so profit is measured against net sales.
 */
export function saleTotals(sale, settings = DEFAULT_SETTINGS) {
  const items = (sale?.items ?? []).filter((i) => i && Number(i.qty) > 0);
  const gross = subtotal(items);
  const discount = discountAmount(gross, sale?.discountPct);
  const net = round2(gross - discount);
  const cost = round2(items.reduce((sum, i) => sum + Number(i.cost) * Number(i.qty), 0));
  const { vatableSales, vat, total } = vatBreakdown(net, settings);
  const profit = round2(net - cost);
  return {
    gross,
    discount,
    net,
    vatableSales,
    vat,
    total,
    cost,
    profit,
    marginPct: net > 0 ? round2((profit / net) * 100) : 0,
    unitCount: items.reduce((n, i) => n + Number(i.qty), 0),
    itemCount: items.length,
  };
}

/** Next receipt number, e.g. "SI-000142", zero padded to 6 digits. */
export function nextReceiptNumber(counter, { receiptPrefix = 'SI' } = {}) {
  const n = Math.max(Number(counter) || 0, 0);
  return `${receiptPrefix}-${String(n).padStart(6, '0')}`;
}

/**
 * Aggregate sales into per-day buckets (local dates, YYYY-MM-DD).
 * Returns ascending by date, with revenue, profit and order count.
 */
export function dailyAggregates(sales = []) {
  const map = new Map();
  for (const sale of sales) {
    const d = new Date(sale.at);
    if (Number.isNaN(d.getTime())) continue;
    const key = localDateKey(d);
    const row = map.get(key) ?? { date: key, revenue: 0, profit: 0, orders: 0 };
    row.revenue = round2(row.revenue + (sale.totals?.total ?? 0));
    row.profit = round2(row.profit + (sale.totals?.profit ?? 0));
    row.orders += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Local YYYY-MM-DD for a Date (not UTC, so a 7pm sale lands on the right day). */
export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Best sellers by revenue, descending, limited to n. */
export function topProducts(sales = [], n = 5) {
  const map = new Map();
  for (const sale of sales) {
    for (const item of sale.items ?? []) {
      if (!item?.name) continue;
      const key = item.id || item.name;
      const row = map.get(key) ?? { name: item.name, qty: 0, revenue: 0 };
      row.qty += Number(item.qty) || 0;
      row.revenue = round2(row.revenue + lineTotal(item.price, item.qty));
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, Math.max(n, 0));
}

/** Products at or below the low-stock threshold, worst first. */
export function lowStock(products = [], threshold = DEFAULT_SETTINGS.lowStockThreshold) {
  return products
    .filter((p) => Number(p.stock) <= Number(threshold))
    .sort((a, b) => Number(a.stock) - Number(b.stock));
}

/** Current stock value at cost, and at retail price. */
export function stockValue(products = []) {
  return products.reduce(
    (acc, p) => {
      const qty = Number(p.stock) || 0;
      acc.atCost = round2(acc.atCost + qty * (Number(p.cost) || 0));
      acc.atRetail = round2(acc.atRetail + qty * (Number(p.price) || 0));
      return acc;
    },
    { atCost: 0, atRetail: 0 },
  );
}

/**
 * Apply a completed sale to inventory, returning a new product array.
 * Never mutates the input, and never lets stock go below zero.
 */
export function applySaleToStock(products = [], sale) {
  const deltas = new Map();
  for (const item of sale?.items ?? []) {
    if (!item?.id) continue;
    deltas.set(item.id, (deltas.get(item.id) ?? 0) + (Number(item.qty) || 0));
  }
  if (deltas.size === 0) return [...products];
  return products.map((p) =>
    deltas.has(p.id) ? { ...p, stock: Math.max((Number(p.stock) || 0) - deltas.get(p.id), 0) } : { ...p },
  );
}
