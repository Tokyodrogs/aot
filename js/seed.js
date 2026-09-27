// Demo data so the console is alive on first open. "Load sample data" in
// Settings regenerates this; nothing here is ever written over real data
// without an explicit confirmation.

import { saleTotals, nextReceiptNumber } from './calc.js';
import { makeId } from './storage.js';

export const SAMPLE_PRODUCTS = [
  { name: 'Brown Sugar Milk Tea (Regular)', sku: 'MT-REG', category: 'Drinks', unit: 'cup', cost: 18, price: 45, stock: 60 },
  { name: 'Brown Sugar Milk Tea (Large)', sku: 'MT-LRG', category: 'Drinks', unit: 'cup', cost: 26, price: 65, stock: 40 },
  { name: 'Matcha Latte', sku: 'MT-MAT', category: 'Drinks', unit: 'cup', cost: 24, price: 60, stock: 28 },
  { name: 'Thai Iced Tea', sku: 'DR-THAI', category: 'Drinks', unit: 'cup', cost: 16, price: 42, stock: 34 },
  { name: 'Bottled Water 500ml', sku: 'DR-H2O', category: 'Drinks', unit: 'bottle', cost: 6, price: 15, stock: 120 },
  { name: 'Tapioca Pearls (topping)', sku: 'TP-PRL', category: 'Toppings', unit: 'scoop', cost: 3, price: 10, stock: 200 },
  { name: 'Cheese Foam (topping)', sku: 'TP-CHE', category: 'Toppings', unit: 'scoop', cost: 5, price: 15, stock: 4 },
  { name: 'Pork Siomai (6 pcs)', sku: 'FD-SIO', category: 'Food', unit: 'pack', cost: 38, price: 75, stock: 22 },
  { name: 'Chicken Lumpia (5 pcs)', sku: 'FD-LMP', category: 'Food', unit: 'pack', cost: 30, price: 60, stock: 3 },
  { name: 'Instant Pancit Canton', sku: 'FD-PNC', category: 'Food', unit: 'pack', cost: 11, price: 22, stock: 90 },
  { name: 'Load Card 50', sku: 'LD-50', category: 'Load', unit: 'pc', cost: 47, price: 52, stock: 15 },
  { name: 'Load Card 100', sku: 'LD-100', category: 'Load', unit: 'pc', cost: 94, price: 105, stock: 10 },
];

export const SAMPLE_CUSTOMERS = ['Walk-in', 'Aling Nena', 'Kuya Ben', 'JM', 'Rizza', 'Office order'];

/** Deterministic PRNG so the demo data is reproducible run to run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a complete demo state: products, then 14 days of sales.
 * @param {object} settings
 * @param {{days?: number, seed?: number}} [opts]
 */
export function buildSampleState(settings, { days = 14, seed = 20260927 } = {}) {
  const rand = mulberry32(seed);
  const products = SAMPLE_PRODUCTS.map((p, i) => ({ ...p, id: makeId(`prd${i}`) }));

  const sales = [];
  let counter = 1;
  const now = new Date();

  for (let d = days - 1; d >= 0; d -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, 0, 0, 0);
    const orders = 3 + Math.floor(rand() * 9); // 3-11 orders a day
    for (let o = 0; o < orders; o += 1) {
      const stamp = new Date(day);
      stamp.setHours(9 + Math.floor(rand() * 11), Math.floor(rand() * 60), 0, 0);
      const lineCount = 1 + Math.floor(rand() * 3);
      const picked = new Set();
      const items = [];
      for (let l = 0; l < lineCount; l += 1) {
        // Only sell what is actually on the shelf, exactly like the real POS.
        const inStock = products.filter((p) => p.stock > 0 && !picked.has(p.id));
        if (inStock.length === 0) break;
        const p = inStock[Math.floor(rand() * inStock.length)];
        picked.add(p.id);
        const qty = Math.min(1 + Math.floor(rand() * 3), p.stock);
        p.stock -= qty;
        items.push({ id: p.id, name: p.name, price: p.price, cost: p.cost, qty });
      }
      if (items.length === 0) continue;
      const sale = {
        id: makeId(`sal${d}${o}`),
        receipt: nextReceiptNumber(counter++, settings),
        at: stamp.toISOString(),
        customer: SAMPLE_CUSTOMERS[Math.floor(rand() * SAMPLE_CUSTOMERS.length)],
        payment: rand() > 0.75 ? 'GCash' : 'Cash',
        discountPct: rand() > 0.9 ? 5 : 0,
        notes: '',
        items,
      };
      sale.totals = saleTotals(sale, settings);
      sales.push(sale);
    }
  }

  return { products, sales, counter };
}
