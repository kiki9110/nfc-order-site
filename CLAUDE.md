# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"BUKI BOOTH" — a system that lets customers who buy NFC/QR keychains on BOOTH (booth.pm)
register and edit the destination URL their tag/QR code redirects to, keyed by their BOOTH
order number. Comments, UI text, and product naming are in Japanese; preserve that.

There is **no build system, package manager, test suite, or git repo**. Each file is deployed
by manually copy-pasting its full contents into a hosting dashboard. Keep that constraint in
mind: avoid module imports or tooling that assumes a bundler — everything must run as a single
self-contained file.

## Three deployment targets

The repo is three independent pieces that talk over HTTP. They are NOT one app.

1. **`worker.js`** → Cloudflare Worker (the backend + API). Single `export default { fetch }`
   that routes by `url.pathname`. Paste the whole file into Cloudflare → Worker → Edit code.
   Requires a KV namespace bound as **`NFC_URLS`** (the only binding). Serves the embedded
   `/admin` and `/portal` pages via `adminHTML()` / `portalHTML()` template functions inside
   the file.

2. **`Code.gs`** → Google Apps Script (the order-intake automation). Reads BOOTH "商品が購入され
   ました" (item-sold) notification emails from Gmail, extracts the order number + purchased
   options, and POSTs them to the Worker's admin API so the order becomes valid for login.
   Run `setupTrigger()` once to install the 5-minute polling trigger; `runOnce()` /
   `testExtract()` / `reprocessAll()` are manual entry points. Also relays contact-form
   messages from the Worker to email via `notifyNewMessages()`.

3. **Static HTML pages** (`home`, `page1`–`page4`, `message`, `self`, `self-login`) → static
   hosting (e.g. GitHub Pages). Customer-facing site; they link to each other with relative
   `*.html` hrefs and call the Worker via `WORKER_ORIGIN`
   (`sessionStorage.getItem('workerOrigin') || 'https://buki-booth.com'`). These are separate
   from the Worker's embedded `/portal` and `/admin` HTML — don't confuse the two.

### Customer page flow
`home.html` → `page1` (enter/login with order number) → `page2` (customize: pick options,
set URL) → `page3` (confirm) . `page4` separately links a standalone-purchased option to an
existing body order. `self.html` / `self-login.html` are a self-service registration path for
people who know the URL. `message.html` is the contact form.

## Critical shared contract: ADMIN_PASSWORD

`worker.js` (`const ADMIN_PASSWORD`) and `Code.gs` (`CONFIG.ADMIN_PASSWORD`) **must hold the
exact same string**. Admin endpoints authenticate with header `Authorization: Bearer <ADMIN_PASSWORD>`;
both default to the placeholder `'your-secret-password-here'`. If you change one, change the other.

## KV data model (all in the `NFC_URLS` namespace)

Everything is one KV namespace partitioned by key prefix. Code that lists "NFC orders" filters
keys by *excluding* the other prefixes (see `handleGetAll`), so any new prefix you add must be
added to those exclusion filters too.

| Key pattern        | Holds                                                              |
|--------------------|-------------------------------------------------------------------|
| `<orderId>`        | NFC tag record: `{ url, options, addonCount, accessCount, ... }`  |
| `QR:<orderId>`     | QR-code record (parallel to the NFC record)                       |
| `ORDER:<orderId>`  | Saved order/customization detail                                  |
| `OPT:<orderId>`    | Option-only order stock (options bought standalone, no body)      |
| `MSG:<ts>-<rand>`  | Contact-form message (`pending=1` filters un-emailed ones)        |
| `INVENTORY`        | Single inventory/maintenance record                               |
| `SELF_OPT`         | Default option config for the self-registration page              |

## API surface (defined by the `if (path === ...)` chain at the top of `worker.js`)

- **Public (no auth, order number is the key):** `/nfc/<id>`, `/qr/<id>` (redirect + bump
  access count), `/api/customer-get|customer-set|customer-set-all|customer-set-qr`,
  `/api/opt-get|opt-apply`, `/api/get-inventory`, `/api/self-register|self-opt-get`,
  `/api/message` (form submit).
- **Admin (Bearer auth):** `/api/register`, `/api/set*`, `/api/get*`, `/api/delete`,
  `/api/save-order`, `/api/get-order`, `/api/inventory`, `/api/export|import`,
  `/api/opt-register|opt-list|opt-set-used`, `/api/self-opt-set`, `/api/messages`,
  `/api/message-update`.

To add an endpoint: add an `if (path === '/api/...')` line in the `fetch` router, then write a
`handleXxx(request, env, cors)` function. Guard admin handlers with the
`auth !== \`Bearer ${ADMIN_PASSWORD}\`` → 401 check used throughout.

## Two kinds of orders

- **Body order:** the email contains the body product (`CONFIG.PRODUCT_BODY`) → registered via
  `/api/register` as a normal keychain order.
- **Option-only order:** email has options but no body → registered via `/api/opt-register` into
  the `OPT:` stock, later attached to a body order by the customer on `page4` (`/api/opt-apply`).

`Code.gs` decides between these in `processOrders()`. Re-running registration is safe: the Worker
preserves any customer-set URL/history on overwrite, so `reprocessAll()` won't wipe customer data.

## Configuration to be aware of when editing

- `Code.gs` `CONFIG` block: `WORKER_ORIGIN`, `ADMIN_PASSWORD`, Gmail `GMAIL_QUERY`, and the
  product-name match lists (`PRODUCT_BODY`, `OPTIONS`, `ADDON_REORDER`). The match lists contain
  both real product names and `(demoN)` test entries — the demo entries are meant to be deleted
  before production.
- Order-number extraction lives in `extractOrderId()` (ordered regex fallbacks). Per-option
  detection is substring matching in `bodyHasProduct()`; quantity (2nd+ copies) is parsed by
  `countProduct()` from the `x ○点` money line immediately following the product name.
