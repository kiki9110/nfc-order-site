# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"BUKI BOOTH" — a system that lets customers who buy NFC/QR keychains on BOOTH (booth.pm)
register and edit the destination URL their tag/QR code redirects to, keyed by their BOOTH
order number. It has grown well beyond a URL-redirect: it now also includes a full order
**customization** flow (image/layer editor + 2D die-cut preview), an **order lifecycle**
(cancel / confirm / made), a **support ticket + chat** system, a **contact form**, and a
**self-registration** path. Comments, UI text, and product naming are in Japanese; preserve that.

There is **no build system, package manager, or test suite**. The repo **is** now git-tracked and
pushed to GitHub (`kiki9110/nfc-order-site`, `main` branch, also serving GitHub Pages). Keep the
"single self-contained file" constraint in mind regardless: avoid module imports or tooling that
assumes a bundler — everything must run as one file. `worker.js` (~4150 lines) and `page2.html`
(~3800 lines) are large because all HTML/CSS/JS is inlined.

### Deploy / operations rule (read before shipping a change)
- **`worker.js` → auto-deploys.** Cloudflare Builds is connected to the GitHub repo: a `git push`
  to `main` runs `npx wrangler deploy` (per `wrangler.toml`, Worker `name = "nfc-order"`, KV binding
  `NFC_URLS`) and publishes the new Worker automatically. **No manual copy-paste into the Cloudflare
  dashboard is needed** — just commit and push. (Do NOT put secrets in `wrangler.toml`; `ADMIN_PASSWORD`
  is a Cloudflare Secret.)
- **`Code.gs` → still manual.** Apps Script is NOT auto-deployed (clasp intentionally not adopted).
  After editing `Code.gs`, paste the whole file into the Apps Script editor by hand. Committing it to
  git does not deploy it.
- **Static HTML pages → GitHub Pages** publishes from the same repo on push.

## Three deployment targets

The repo is three independent pieces that talk over HTTP. They are NOT one app.

1. **`worker.js`** → Cloudflare Worker (the backend + API). Single `export default { fetch }`
   that routes by `url.pathname`. **Deployed automatically on `git push` to `main`** via Cloudflare
   Builds (`npx wrangler deploy`, config in `wrangler.toml`) — no manual paste needed anymore.
   Requires a KV namespace bound as **`NFC_URLS`** (the only binding). Serves several embedded
   HTML pages via template functions inside the file:
   - `/admin` (`adminHTML`) — admin console (login, keychain list, inventory, backup,
     option stock, messages, self-opt, QR generator, **support panel**).
   - `/portal` and `/my` (`portalHTML`) — customer "my page": manage several order numbers
     (stored in `localStorage`) and edit their NFC/QR URLs.
   - `/order/<id>` (`orderDetailHTML`) — admin per-order detail with a **2D `<canvas>`**
     die-cut / punch-hole / QR / NFC preview render. Auth is via a `?pw=` query param
     (`pw === env.ADMIN_PASSWORD`) — note the password travels in the URL.
   - `/support`, `/support/new`, `/support/<n>` (`supportListHTML` / `supportNewHTML` /
     `supportChatHTML`) — customer support ticket list / new / chat pages.
   - `/setup/<id>` and `/setup-qr/<id>` → 302 redirect to `/portal?add=<id>` (legacy compat).

2. **`Code.gs`** → Google Apps Script (the order-intake + notification automation). Reads BOOTH
   notification emails from Gmail (`GMAIL_QUERY` — targets 「ご注文が確定しました」 payment-confirmed
   mails, plus legacy 「商品が購入されました」), extracts the order number + purchased options, and
   POSTs them to the Worker's admin API so the order becomes valid for login.
   `setupTrigger()` installs **two** time-based triggers: `processOrders` every **5 min**
   (order registration; uses no KV `list()` so it can run often) and `notifyAll` every **30 min**
   (email relay; batches the KV `list()`-consuming work to save the free-tier quota).
   `notifyAll` = `notifyNewMessages()` (contact form → email) + `notifyNewSupport()`
   (new support tickets → email, and marks them `emailed`). Manual entry points: `runOnce()`,
   `reprocessAll()` (ignores the processed marker), `testExtract()`, `removeTrigger()`.
   De-dup of processed mail is **per-message-ID** (in Script Properties), not per-thread label.

3. **Static HTML pages** → static hosting (e.g. GitHub Pages). Customer-facing site; they link
   to each other with relative `*.html` hrefs and call the Worker via `WORKER_ORIGIN`
   (`sessionStorage.getItem('workerOrigin') || 'https://buki-booth.com'`). These are separate
   from the Worker's embedded `/portal`, `/admin`, `/support` HTML — don't confuse the two.
   Files: `home`, `page1`–`page4`, `order-history`, `message`, `self`, `self-login`.
   (`home.html` and `page3.html` link to the Worker-hosted `/portal` and `/support` by absolute
   `buki-booth.com` URL.) `assets/guide/` holds images/GIFs used by page2's help modal.

### Customer page flow
`home.html` → `page1` (enter order number; validated live via `/api/customer-get`) → `page2`
(customize: options, base color, size, **image/layer editor** with front/back sides + 2D die-cut
canvas preview + 1440dpi print export, set URL) → `page3` (confirm; can `/api/customer-confirm`).
- `order-history.html` — customer views one order's state and can **cancel** it
  (`/api/customer-order`, `/api/customer-cancel`) within the cancel window (see lifecycle below).
- `page4` — links a standalone-purchased option to an existing body order (`/api/opt-apply`).
- `self.html` / `self-login.html` — self-service registration path for people who know the URL
  (self-register auto-issues a unique 10-digit number).
- `message.html` — contact form (`/api/message`).
- The Worker's own `/support*` pages are the support channel (linked from `home.html`).

NOTE: page2's preview is a **2D `<canvas>` composite / die-cut render**, not a WebGL/three.js 3D
model. If you see it described as "3D", that's loose terminology.

## Order lifecycle (state stored on the bare `<orderId>` NFC record)

Flags on the NFC record drive a small state machine (see `handleCustomerOrder`):
- `registeredAt` — set at first registration; `withinCancelWindow()` = **3 days** from it.
- `cancellable` = within 3 days **and** `!made` **and** `!cancelled` **and** `!confirmed`.
- `cancelled` (+`cancelledAt`) — customer cancel (`handleCustomerCancel`) also **deletes**
  `ORDER:<id>` and enqueues an `MSG:` auto-notification to the admin; keeps the NFC/QR records.
  Admin can toggle via `/api/admin-cancel` (does not delete `ORDER:`).
- `confirmed` (+`confirmedAt`) — customer confirms to start production early; after this,
  **cancellation is blocked**. Idempotent.
- `made` (+`madeAt`) — admin marks production done (`/api/set-made`); blocks cancel.
`/api/register` (re-run safely by `Code.gs`) **preserves** all of these flags and the
customer-set URL/history on overwrite.

## Critical shared secret: ADMIN_PASSWORD  ⚠️ read this before touching auth

Admin endpoints authenticate with header `Authorization: Bearer <ADMIN_PASSWORD>`. The secret now
lives in exactly two runtime stores — **no plaintext anywhere in the repo** — which must hold the
same value:

- **`worker.js`** — `adminBearer(env)` reads the Cloudflare **Secret** `env.ADMIN_PASSWORD`; if unset
  it returns an impossible token (`'\x00disabled'`) so all admin calls fail closed. `/order/<id>`
  compares `?pw=` to `env.ADMIN_PASSWORD` the same way.
- **`Code.gs`** — reads the Apps Script **Script Property** `ADMIN_PASSWORD` via `getAdminPassword_()`
  (set it in Project Settings → Script Properties; `checkAdminPassword()` verifies it without printing
  the value). No hardcoded value in the file.
- **Static pages / customer API** — carry **no** admin token. `page2.html` persists the order through
  the public `/api/save-order` (registered-only), which also syncs the NFC/QR redirect URL. The old
  admin-authed `/api/register` call was removed from page2.

✅ **The compromised value has been rotated.** `Kiki.n0825` (once committed in `page2.html`, a public
static file, and briefly in `Code.gs`) is retired. A NEW secret is now set as the Cloudflare Secret
`ADMIN_PASSWORD` **and** the matching Apps Script Script Property (both verified in production:
login with the new password works, `Kiki.n0825` is rejected). If you ever rotate again, always change
**both** stores together; the Worker fails closed if the Secret is unset, so set it before/at rotation.

## KV data model (all in the `NFC_URLS` namespace)

Everything is one KV namespace partitioned by key prefix. Code that lists "NFC orders" filters keys
with the shared `isNfcOrderKey(name)` helper (used by `handleGet` / `handleGetAll`), which excludes
`QR:`/`ORDER:`/`OPT:`/`MSG:`/`SUP:`/`RL:` and the singletons `INVENTORY`/`SELF_OPT`. **Any new prefix
you add must be added to `isNfcOrderKey()` too.**

| Key pattern        | Holds                                                                       |
|--------------------|-----------------------------------------------------------------------------|
| `<orderId>`        | NFC tag record: `{ url, options, addonCount, accessCount, made, cancelled, confirmed, ... }` |
| `QR:<orderId>`     | QR-code record (parallel to the NFC record)                                 |
| `ORDER:<orderId>`  | Saved order/customization detail (from page2 `/api/save-order`)             |
| `OPT:<orderId>`    | Option-only order stock (options bought standalone, no body)                |
| `MSG:<ts>-<rand>`  | Contact-form message / auto-notifications (`pending=1` filters un-emailed)  |
| `SUP:<6-digit>`    | Support ticket + chat: `{ number, token, subject, detail, contact, status, messages:[{from,text,ts}], emailed, autoResolved, ... }` (`token` = owner check) |
| `RL:<bucket>:<ip>:<win>` | Rate-limit counter (support endpoints); auto-expires via `expirationTtl`  |
| `INVENTORY`        | Single inventory/maintenance record (`maintenance`, `maintenanceMsg`, `colors`) |
| `SELF_OPT`         | Default option config for the self-registration page                        |

Backup/restore (`/api/export`, `/api/import`) use `listAllKeys()` (cursor-paginated) and cover
**every** key regardless of prefix.

## API surface (defined by the `if (path === ...)` chain at the top of `worker.js`)

- **Public (no auth, the order/support number is the key):** `/nfc/<id>`, `/qr/<id>` (redirect +
  bump access count; unknown id → 302 to `/portal?add=<id>`), `/api/customer-get`,
  `/api/customer-set`, `/api/customer-set-all`, `/api/customer-set-qr`, `/api/customer-order`,
  `/api/customer-cancel`, `/api/customer-confirm`, `/api/opt-get`, `/api/opt-apply`,
  `/api/get-inventory`, `/api/self-register`, `/api/self-opt-get`, `/api/message`,
  `/api/support-create`, `/api/support-get`, `/api/support-message`, `/api/support-delete`.
  `/api/save-order` is public **only for already-registered order IDs** (admin bypasses the check);
  it saves the `ORDER:` record and also syncs any `nfcUrl`/`qrUrl` onto the NFC/QR redirect records
  (empty string = keep existing). This replaced page2's old admin-authed `/api/register` call.
- **Admin (Bearer auth):** `/api/register`, `/api/set`, `/api/set-all`, `/api/set-made`,
  `/api/set-qr`, `/api/get`, `/api/get-all`, `/api/get-qr-url`, `/api/delete`, `/api/save-order`
  (admin path), `/api/get-order`, `/api/inventory`, `/api/export`, `/api/import`, `/api/admin-cancel`,
  `/api/opt-register`, `/api/opt-list`, `/api/opt-set-used`, `/api/self-opt-set`, `/api/messages`,
  `/api/message-update`, `/api/support-list`, `/api/support-reply`, `/api/support-update`.

To add an endpoint: add an `if (path === '/api/...')` line in the `fetch` router, then write a
`handleXxx(request, env, cors)` function. Guard admin handlers with the
`if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors)` check used throughout.

## Two kinds of orders

- **Body order:** the email contains the body product (`CONFIG.PRODUCT_BODY`) → registered via
  `/api/register` as a normal keychain order.
- **Option-only order:** email has options but no body → registered via `/api/opt-register` into
  the `OPT:` stock, later attached to a body order by the customer on `page4` (`/api/opt-apply`).

`Code.gs` decides between these in `processOrders()` (and `reprocessAll()`). Re-running
registration is safe: the Worker preserves any customer-set URL/history and lifecycle flags on
overwrite, so `reprocessAll()` won't wipe customer data.

## Support system (`SUP:` — customer ticket + chat)

- Customer creates a ticket (`/api/support-create`) and gets a **6-digit number** (`genSupportNumber`);
  the number is the only key — it is remembered in `localStorage` on the device and in the URL.
- Access control: each ticket also carries a **128-bit `token`** issued at creation and stored only
  in the owner's `localStorage` (entries are `{n, t}`). `support-get` / `support-message` /
  `support-delete` require a matching token (admin bypasses via Bearer); a wrong/missing token is
  returned as indistinguishable "not found"/`exists:false`. Public support endpoints are
  **rate-limited per IP** (`RL:` keys, KV + TTL). Tickets created before this change (no token) are
  grandfathered. `publicTicket()` returns neither the token nor the contact field.
- Auto-resolve: `autoResolveIfStale()` flips a ticket to `resolved` if the last message is from
  admin and ≥7 days old. It runs on every `support-get` / `support-list`, plus a batch `sweep`
  branch in `support-update`. Admin replies (`support-reply`) re-open resolved tickets.

## Known issues / status (security pass complete AND deployed — 2026-07-09)

All six findings below are fixed **and live in production**. `worker.js`/`page2.html` are deployed
(Cloudflare Builds active deployment `9d08bfa8`, traffic 100%, error rate 0%); `Code.gs` is pasted
into Apps Script; the fix commit is pushed to `main` (`3393efe`). Production spot-checks passed:
`/portal` loads, `/admin` login works with the new password and rejects `Kiki.n0825`, and the admin
keychain list no longer shows `MSG:`/`SUP:` records. Nothing here is outstanding.

1. ✅ **Admin password removed from `page2.html`** and **rotated.** page2 posts to the public
   `/api/save-order` (registered-only), which also syncs the NFC/QR redirect URL — no admin token in
   any static/customer file. The leaked `Kiki.n0825` value is retired in both stores (see the
   ADMIN_PASSWORD section above).
2. ✅ **Order-list exclusion filters centralized** in `isNfcOrderKey()` — now also excludes `MSG:`,
   `SUP:`, `RL:`, and `SELF_OPT` (used by both `handleGet` and `handleGetAll`). Verified in prod:
   admin list is clean.
3. ✅ **`handleGet` paginates** via cursor-based `listAllKeys()` (no more ~1000-key truncation).
4. ✅ **Support ownership + rate limiting** — 128-bit per-ticket `token` (owner's `localStorage` only)
   required by `support-get`/`-message`/`-delete` (admin bypasses via Bearer); wrong token → "not found".
   Public support endpoints rate-limited per IP via `RL:` keys. Legacy tokenless tickets grandfathered.
5. ✅ **`Code.gs` password externalized** to a Script Property via `getAdminPassword_()` (no plaintext).
6. ✅ **Demo product names removed** from `Code.gs` CONFIG. (No `TODO`/`FIXME` markers elsewhere.)

Residual by-design notes (not bugs):
- The customer model is still "knowing the order number = can edit that order" (`customer-get/set`,
  `portal`, `save-order`). There are no accounts; the pass removed *admin* escalation, not this base
  capability model. Same level of access as the rest of the customer API.
- Support access is **device-scoped**: the owner token lives in `localStorage`, so opening a ticket on
  another device (without the token) shows "not found". This matches the existing "this device only"
  support list. Cross-device access would require adding accounts or a shareable link with the token.
- Rate limiting uses KV (eventually consistent) and is coarse; it deters spam/enumeration but is not a
  hard guarantee. The token is the real ownership control.

## Configuration to be aware of when editing

- `Code.gs` `CONFIG` block: `WORKER_ORIGIN`, `ADMIN_PASSWORD`, `NOTIFY_EMAIL` (blank → sends to the
  script owner's Gmail), Gmail `GMAIL_QUERY`, `MAX_THREADS`, and the product-name match lists
  (`PRODUCT_BODY`, `OPTIONS` = `[{key,name,mail:[...]}]`, `ADDON_REORDER`). Match lists hold both
  real names and `(demoN)` test entries.
- Order-number extraction lives in `extractOrderId()` (ordered regex fallbacks); mail eligibility
  in `isTargetMail()`. Per-option detection is substring matching in `bodyHasProduct()`; quantity
  (2nd+ copies) is parsed by `countProduct()` from the `x ○点` money line following the product name.
- CORS on the Worker is wide open (`Access-Control-Allow-Origin: *`) for all endpoints.
