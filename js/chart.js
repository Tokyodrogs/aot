// Tiny dependency-free bar chart rendered as an SVG string.
// Pure function: data in, markup out, so it is directly unit-testable.

import { formatMoney } from './money.js';

/**
 * @param {Array<{date: string, revenue: number, profit: number}>} data ascending by date
 * @param {{height?: number, barWidth?: number, maxBars?: number}} [opts]
 * @returns {string} SVG markup (or an empty-state message)
 */
export function barChart(data, opts = {}) {
  const { height = 170, barWidth = 13, maxBars = 31 } = opts;
  const rows = (data ?? []).slice(-maxBars);
  if (rows.length === 0) return '<p class="empty">No sales in this range yet.</p>';

  const gap = 5;
  const padTop = 14;
  const padBottom = 20;
  const width = Math.max(rows.length * (barWidth * 2 + gap) + 8, 220);
  const plotH = height - padTop - padBottom;
  const max = Math.max(...rows.map((r) => Number(r.revenue) || 0), 1);
  const y = (v) => padTop + plotH - (Math.max(Number(v) || 0, 0) / max) * plotH;

  const bars = rows
    .map((row, i) => {
      const x = 8 + i * (barWidth * 2 + gap);
      const revH = padTop + plotH - y(row.revenue);
      const profH = padTop + plotH - y(row.profit);
      const label = String(row.date ?? '').slice(5); // MM-DD
      const title = `${row.date}: ${formatMoney(row.revenue)} sales, ${formatMoney(row.profit)} profit, ${row.orders ?? 0} orders`;
      return (
        `<g><title>${title}</title>` +
        `<rect class="bar-rev" x="${x}" y="${y(row.revenue)}" width="${barWidth}" height="${Math.max(revH, 1)}" rx="2"><title>${title}</title></rect>` +
        `<rect class="bar-prof" x="${x + barWidth}" y="${y(row.profit)}" width="${barWidth}" height="${Math.max(profH, 1)}" rx="2"><title>${title}</title></rect>` +
        `<text class="lbl" x="${x + barWidth}" y="${height - 6}" text-anchor="middle">${label}</text>` +
        `</g>`
      );
    })
    .join('');

  return (
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily revenue and profit">` +
    `<line class="axis" x1="0" y1="${padTop + plotH}" x2="${width}" y2="${padTop + plotH}"></line>` +
    `<text class="lbl" x="0" y="${padTop - 4}">${formatMoney(max)}</text>` +
    bars +
    `</svg>` +
    `<div class="chart-legend">` +
    `<span><i style="background:#22d3ee"></i>Revenue</span>` +
    `<span><i style="background:#34d399"></i>Profit</span>` +
    `</div>`
  );
}
