// Persistence. The whole "database" is a versioned JSON document kept in
// localStorage, which means Kwenta works with no server and no account.
// A backup file is just that same JSON, so data is never trapped in a browser.

import { DEFAULT_SETTINGS } from './calc.js';

export const SCHEMA_VERSION = 1;
const KEY = 'kwenta:v1';

export const emptyState = () => ({
  version: SCHEMA_VERSION,
  settings: { ...DEFAULT_SETTINGS },
  products: [],
  sales: [],
  counter: DEFAULT_SETTINGS.receiptStart,
  updatedAt: null,
});

/**
 * Coerce anything read from disk into a valid state object.
 * Unknown/missing fields fall back to defaults instead of throwing.
 */
export function normalizeState(input) {
  const state = emptyState();
  if (!input || typeof input !== 'object') return state;
  state.version = SCHEMA_VERSION;
  state.settings = { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) };
  state.products = Array.isArray(input.products) ? input.products.map(normalizeProduct) : [];
  state.sales = Array.isArray(input.sales) ? input.sales.filter((s) => s && typeof s === 'object') : [];
  state.counter = Number.isFinite(Number(input.counter)) ? Number(input.counter) : DEFAULT_SETTINGS.receiptStart;
  state.updatedAt = input.updatedAt ?? null;
  return state;
}

export function normalizeProduct(p = {}) {
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? '').trim(),
    sku: String(p.sku ?? '').trim(),
    category: String(p.category ?? 'General').trim() || 'General',
    unit: String(p.unit ?? 'pc').trim() || 'pc',
    cost: Number(p.cost) || 0,
    price: Number(p.price) || 0,
    stock: Math.max(Number(p.stock) || 0, 0),
  };
}

/** Create a store backed by any {getItem,setItem} object (localStorage or a test double). */
export function createStore(backend) {
  let memory = null;
  const canPersist = Boolean(backend && typeof backend.getItem === 'function');

  const read = () => {
    if (!canPersist) return memory;
    try {
      const raw = backend.getItem(KEY);
      return raw ? normalizeState(JSON.parse(raw)) : null;
    } catch {
      // Corrupt or unreadable storage must never take the app down.
      return memory;
    }
  };

  const write = (state) => {
    const next = normalizeState(state);
    next.updatedAt = new Date().toISOString();
    memory = next;
    if (canPersist) {
      try {
        backend.setItem(KEY, JSON.stringify(next));
      } catch {
        // Quota exceeded / private mode: keep running from memory.
      }
    }
    return next;
  };

  return {
    get key() {
      return KEY;
    },
    load() {
      return read() ?? emptyState();
    },
    save(state) {
      return write(state);
    },
    clear() {
      memory = null;
      if (canPersist && typeof backend.removeItem === 'function') backend.removeItem(KEY);
    },
  };
}

/** Validate an imported backup blob; returns {ok, state} or {ok:false, error}. */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err.message}` };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Backup must be a JSON object.' };
  if (!Array.isArray(parsed.products) && !Array.isArray(parsed.sales)) {
    return { ok: false, error: 'Backup is missing both "products" and "sales".' };
  }
  return { ok: true, state: normalizeState(parsed) };
}

/** Stable-enough id for local records; collisions are practically impossible here. */
export function makeId(prefix = 'id') {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
