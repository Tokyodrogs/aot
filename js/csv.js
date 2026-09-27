// CSV export. Small, dependency-free, and Excel-safe (quoted, BOM optional).

/** RFC-4180 escaping: wrap in quotes when needed, double any inner quotes. */
export function escapeCsv(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from a header row plus object rows. */
export function toCSV(columns, rows) {
  const header = columns.map((c) => escapeCsv(c.label ?? c.key)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => escapeCsv(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','),
  );
  return [header, ...body].join('\r\n');
}

/**
 * Trigger a browser download. No-ops outside a browser (e.g. in tests).
 * @param {string} filename
 * @param {string} text
 * @param {{withBom?: boolean}} [opts]
 */
export function downloadText(filename, text, { withBom = true } = {}) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
  const blob = new Blob([withBom ? '\uFEFF' : '', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export const productColumns = [
  { key: 'name', label: 'Product' },
  { key: 'sku', label: 'SKU' },
  { key: 'category', label: 'Category' },
  { key: 'unit', label: 'Unit' },
  { key: 'cost', label: 'Cost' },
  { key: 'price', label: 'Price' },
  { key: 'stock', label: 'Stock' },
  { key: 'stockValue', label: 'Stock value (cost)', value: (p) => Number(p.cost) * Number(p.stock) },
];

export const saleColumns = [
  { key: 'receipt', label: 'Receipt' },
  { key: 'at', label: 'Date' },
  { key: 'customer', label: 'Customer' },
  { key: 'payment', label: 'Payment' },
  {
    key: 'items',
    label: 'Items',
    value: (s) => (s.items ?? []).map((i) => `${i.qty} x ${i.name}`).join(' | '),
  },
  { key: 'subtotal', label: 'Subtotal', value: (s) => s.totals?.gross ?? '' },
  { key: 'discount', label: 'Discount', value: (s) => s.totals?.discount ?? '' },
  { key: 'vat', label: 'VAT', value: (s) => s.totals?.vat ?? '' },
  { key: 'total', label: 'Total', value: (s) => s.totals?.total ?? '' },
  { key: 'profit', label: 'Profit', value: (s) => s.totals?.profit ?? '' },
];
