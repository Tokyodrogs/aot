import { test } from 'node:test';
import assert from 'node:assert/strict';

import { barChart } from '../js/chart.js';

test('barChart returns the empty state for no data', () => {
  assert.match(barChart([]), /No sales in this range yet/);
  assert.match(barChart(undefined), /No sales in this range yet/);
});

test('barChart draws one revenue bar and one profit bar per day', () => {
  const svg = barChart([
    { date: '2026-09-25', revenue: 500, profit: 200, orders: 4 },
    { date: '2026-09-26', revenue: 800, profit: 340, orders: 7 },
  ]);
  assert.ok(svg.startsWith('<svg'), 'returns SVG markup');
  assert.equal((svg.match(/class="bar-rev"/g) ?? []).length, 2);
  assert.equal((svg.match(/class="bar-prof"/g) ?? []).length, 2);
  assert.ok(svg.includes('Revenue') && svg.includes('Profit'), 'includes a legend');
});

test('barChart scales the tallest bar to the plot height', () => {
  const svg = barChart([
    { date: '2026-09-25', revenue: 100, profit: 10, orders: 1 },
    { date: '2026-09-26', revenue: 200, profit: 20, orders: 2 },
  ]);
  const heights = [...svg.matchAll(/class="bar-rev"[^>]*height="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(heights.length, 2);
  assert.ok(heights[1] > heights[0], 'bigger day draws a taller bar');
  assert.equal(Math.max(...heights), 136, 'tallest bar fills the plot area (170 - 14 top - 20 bottom)');
});

test('barChart caps the number of bars', () => {
  const data = Array.from({ length: 90 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    revenue: i,
    profit: i,
    orders: 1,
  }));
  const svg = barChart(data, { maxBars: 31 });
  assert.equal((svg.match(/class="bar-rev"/g) ?? []).length, 31);
});

test('barChart escapes nothing dangerous into tooltips', () => {
  const svg = barChart([{ date: '2026-09-26', revenue: 100, profit: 50, orders: 3 }]);
  assert.match(svg, /<title>2026-09-26:/);
});
