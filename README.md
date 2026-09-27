# Kwenta

**A free, offline-first operating console for a small business.** Inventory, sales, VAT, profit,
printable receipts and backups — running entirely in the browser. No account, no server, no
monthly subscription, no build step.

"Kwenta" is Filipino for *to reckon up / to count what is owed*. That is exactly what this does:
it tells a small shop owner what they actually made today, after cost.

---

## Why this exists

A neighbourhood shop, milk tea stand, online reseller or service freelancer usually tracks
**sales** in a notebook but almost never tracks **cost**, so they know their takings and not their
profit. Commercial POS software fixes that — for a subscription, an installation, an internet
connection and a training session. Kwenta is the other option: open `index.html`, and the books
are already keeping themselves.

## What it does

| Area | What you get |
| --- | --- |
| **Dashboard** | Sales, profit, orders and average order value over 7/14/30 days or all time; a revenue-vs-profit chart; best sellers; a "needs attention" panel for stock-outs, low stock and items priced below cost. |
| **Sell** | Tap-to-add point of sale. Live receipt with discount, VAT split, total and **profit on the sale**. Stock decrements the moment you save. Printable 80mm-style receipt. |
| **Inventory** | Cost, price, margin %, stock and stock value per product, with search and sorting. Low-stock items are flagged automatically. |
| **Records** | Every sale, searchable by receipt number, customer or product, with running totals. Reprint any receipt. Export to CSV for your accountant. |
| **Settings** | Business details for the receipt, receipt numbering, low-stock threshold, VAT rate and VAT-inclusive vs VAT-exclusive pricing. |

### Philippine tax handling

Prices can be posted **VAT-inclusive** (the default — VAT is extracted as `total x 12/112`) or
**VAT-exclusive** (VAT is added on top). Both follow the standard 12% rate, which is editable.

> Kwenta is bookkeeping software, **not** a BIR-accredited Computerised Accounting System. Use it
> to understand your business; keep official receipts for your actual filings.

## Run it

There is nothing to install. Three options, easiest first:

```bash
# 1. Just open the file
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux

# 2. Or serve it (recommended, keeps ES-module loading reliable)
npm run dev              # http://localhost:8000
PORT=3000 npm run dev    # custom port

# 3. Or put the folder on any static host — GitHub Pages, Netlify, a USB stick
```

Node 18+ is only needed for the dev server and the tests. The site itself has **zero runtime dependencies** — no framework, no bundler, no CDN. The single dev dependency is `jsdom`, used only by the UI test suite.

## Test it

The money math is the part that must never be wrong, so it is isolated in pure modules
(`js/calc.js`, `js/money.js`, `js/csv.js`, `js/storage.js`) and covered by tests:

```bash
npm install   # only needed for the UI suite (jsdom)
npm test
```

**62 tests, no failures.** What they actually check:

| Suite | Coverage |
| --- | --- |
| `test/money.test.js` | centavo rounding (including the `1.005` case), peso formatting, negative signs, input parsing |
| `test/calc.test.js` | VAT-inclusive vs VAT-exclusive splits, discount ordering, profit and margin, receipt numbering, local-date bucketing, stock decrement that never goes negative or mutates input |
| `test/flow.test.js` | a whole trading day through the real modules: seed → sell → stock drops → profit reconciles → CSV export → backup → restore |
| `test/ui.test.js` | loads the real `index.html`, runs the real `js/app.js` in jsdom, and clicks through it: POS taps, totals on screen, a saved sale decrementing stock, product creation, settings, wipe |
| `test/storage.test.js` | corrupt-storage recovery, backup validation, memory-mode fallback |
| `test/csv.test.js` / `test/chart.test.js` | CSV escaping and SVG chart scaling |

Without jsdom installed the UI suite reports as *skipped* rather than failing, so `npm test` is
always honest about what ran.

## Where the data lives

Everything is one versioned JSON document in your browser's `localStorage` under the key
`kwenta:v1`. Consequences worth knowing:

- **Private.** Nothing is uploaded anywhere; there is no backend to breach.
- **Portable.** Settings → *Download backup* writes plain JSON; *Restore backup* re-imports it on
  another device or browser. Do this before clearing browser data.
- **Per-browser.** Two browsers on one machine keep two separate books.
- **Forgiving.** Corrupt or unreadable storage is caught and falls back to defaults rather than
  taking the app down.

## Layout

```
index.html          single-page UI, no templating engine
styles.css          design system (CSS variables, dark, responsive, print styles)
server.mjs          70-line static file server for local dev
js/money.js         rounding, peso formatting, input parsing
js/calc.js          VAT, discounts, totals, profit, aggregates, stock math
js/csv.js           CSV building and download
js/storage.js       localStorage persistence, migration, backup validation
js/seed.js          reproducible demo data (deterministic PRNG)
js/chart.js         dependency-free SVG bar chart
js/app.js           DOM wiring only — no business logic
test/               node --test suites for every module above
```

## Honest limits

- Single user, single device, no sync.
- No supplier/purchase orders, no staff logins, no multi-branch.
- Receipts are for your records, not BIR-compliant invoices.

Those are deliberate: the goal is a tool a small business can actually run today, not a platform.

## License

MIT.
