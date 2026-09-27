// Money helpers. All arithmetic is rounded to centavos (2 decimals) so that
// float drift never shows up on a receipt.

export const round2 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const text = String(abs);
  // Scaling by string exponent ("1.005" -> "1.005e2" -> 100.5) rounds on the
  // decimal value the user actually wrote, so 1.005 becomes 1.01 rather than
  // 1.00 as plain Math.round(1.005 * 100) would give (1.005 * 100 === 100.499…).
  // Exponential literals can't take the trick, so fall back for those.
  const scaled = /e/i.test(text) ? abs * 100 : Number(`${text}e2`);
  const rounded = Math.round(scaled);
  const out = /e/i.test(String(rounded)) ? rounded / 100 : Number(`${rounded}e-2`);
  return sign * (Number.isFinite(out) ? out : 0);
};

const PESO = '\u20B1';

/**
 * Format a number as currency. Negatives render as "-₱5.00", never "₱-5.00".
 * @param {number|string} value
 * @param {{currency?: string, decimals?: number}} [opts]
 */
export function formatMoney(value, opts = {}) {
  const { currency = PESO, decimals = 2 } = opts;
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  const negative = safe < 0;
  const text = Math.abs(safe).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${negative ? '-' : ''}${currency}${text}`;
}

/** Format a percentage with a fixed number of decimals, e.g. 12.3 -> "12.3%". */
export function formatPercent(value, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${round2(n).toFixed(decimals)}%`;
}

/**
 * Turn user input ("₱1,234.5", "1234", "") into a number. Never throws.
 * @param {number|string} input
 */
export function parseMoney(input) {
  if (typeof input === 'number') return round2(input);
  const cleaned = String(input ?? '').replace(/[^0-9.\-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? round2(n) : 0;
}

/**
 * Turn user input ("12", "2.9", "abc", "-4") into a positive integer quantity.
 * Truncates at the decimal point instead of stripping it ("2.9" -> 2, not 29),
 * and rejects negatives.
 * @param {number|string} input
 */
export function parseQty(input) {
  const raw = typeof input === 'number' ? String(input) : String(input ?? '').trim();
  if (raw.startsWith('-')) return 0;
  const match = raw.match(/\d+/);
  const n = match ? Number.parseInt(match[0], 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
