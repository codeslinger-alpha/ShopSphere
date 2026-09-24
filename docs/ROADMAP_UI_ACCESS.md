# Roadmap — UI overhaul, admin removal with refunds, and read surfaces

This is the working checklist for a multi-step change. It exists so the work survives an
interrupted session: each step is independently shippable, each ends with the same four
commands, and the box is ticked only once those commands are green.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified.

- [x] **Step 0** — This document
- [x] **Step 1** — Dark theme, brand mark, favicon
- [x] **Step 2** — "Account settings" in the navigation
- [x] **Step 3** — Imagery (SVG art + keyword photos)
- [x] **Step 4** — Star rating control
- [x] **Step 5** — Admin listing removal with vendor refunds
- [x] **Step 6** — A read surface per role for the unused tables
- [x] **Step 7** — Docs and full verification

## The command that closes a step

Run all four from the repository root. A step is not done until every one passes:

```bash
npm run lint
npm run build
npm test
npm run test:e2e
```

`npm run test:e2e` needs the two environment variables recorded in the project memory
(`NO_PROXY` / `no_proxy` for localhost, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointing
at the installed chromium revision). Without them the suite fails to launch a browser.

`npm test` runs the server integration suite serially (`--test-concurrency=1`) against a
remote Supabase database, in a temp schema inside a transaction that is rolled back. It
must stay serial: the tests share that one connection.

Record the outcome of the four commands in the step's own section below before ticking it.

---

## Step 1 — Dark theme, brand mark, favicon

**Goal.** Dark is the default palette; a header toggle switches to the existing light one
and the choice persists across reloads. The unrelated purple bolt favicon becomes a
ShopSphere mark, and it is rendered as the brand mark in the header *and* the footer.

**Files.** `client/src/index.css`, `client/src/App.css`, `client/src/theme/useTheme.js`
(new), `client/index.html`, `client/public/favicon.svg`,
`client/public/img/logo-shopsphere.svg` (new), `client/src/components/Header.jsx`,
`client/src/components/Footer.jsx`.

**Done when.** No raw colour literal survives in `App.css`; toggling and reloading shows no
flash of the wrong theme; the footer shows the mark rather than a bare "S".

**Verified.** `npm run lint`, `npm run build`, `npm test` (60/60), `npm run test:e2e`
(36/36) — all green. `grep '#[0-9a-fA-F]\|rgba\?(' App.css` returns only a comment.

Two deviations from the plan, both to avoid a duplicate asset:

- The mark lives at `client/public/favicon.svg` alone; there is no
  `client/public/img/logo-shopsphere.svg`. The header and the footer both point at the
  favicon, which is the same "one mark for one brand" rule the header comment already
  stated — a second copy of the identical SVG would only be two files to keep in step.
- The hook is `client/src/hooks/useTheme.js`, beside `useResource.js` and `useCartCount.js`,
  rather than a new `client/src/theme/` directory for a single file.

`App.css` also gained `.theme-toggle` and `.site-footer .brand-mark` (the footer's mark is
26px, the header's 30px).

## Step 2 — "Account settings" in the navigation

**Goal.** The profile entry point moves out of the dashboard body and into the navigation,
renamed "Account settings". The dashboard keeps role links only.

**Files.** `client/src/components/Header.jsx`, `client/src/components/Footer.jsx`,
`client/src/pages/ProfilePage.jsx`, `client/src/pages/DashboardPage.jsx`, and any test in
`client/tests/` asserting on the old strings.

**Done when.** No "Complete my profile" tile exists in the dashboard; every route to the
profile page is labelled "Account settings".

**Verified.** Same four commands, run together with Step 1 — all green. No test in
`client/tests/` asserted on the old strings (`My profile`, `Complete my profile`,
`Save profile`), so nothing needed updating there; the two doc references in
`WEBSITE_FLOW.md` and `SERVER_DATABASE_FLOW.md` were corrected in this step.

## Step 3 — Imagery

**Goal.** Category tiles, action entry points and the hero use locally drawn SVG art
relevant by construction. Individual product listings use topic-matched photos from a
keyword host, and fall back to their category's illustration — not a grey box — when that
host is unreachable.

**Files.** `client/public/img/*.svg` (new), `client/src/components/categoryArt.js` (new),
`client/src/components/ProductMedia.jsx`, `client/src/components/ProductCard.jsx`,
`client/src/pages/{HomePage,ProductDetailPage,DashboardPage}.jsx`, `client/src/App.css`.

**Done when.** A keyboard listing shows a keyboard or an electronics illustration, never a
random landscape; the chain degrades correctly with the network blocked.

**Verified.** `npm run lint`, `npm run build`, `npm test` (60/60), `npm run test:e2e`
(36/36) — all green. Also eyeballed directly: a throwaway Playwright spec mocked the
catalogue and screenshotted the home page in both themes, the catalog grid, the product
detail page and the dashboard. The keyboard, headphones, watch and lamp listings each
showed a photograph of the right object; a mug with no matching photo fell back to the Home
illustration; the footer showed the mark; the toggle switched palettes and the moon/sun
icon followed the state. That spec was deleted afterwards.

### The photo host had to change

The plan named `loremflickr.com`. It is not usable — every request returns **401**, tested
directly. Three alternatives were tested before settling:

| Host | Result |
| --- | --- |
| `loremflickr.com` | 401 on every path, with and without a query |
| `image.pollinations.ai` | 200 and prompt-accurate, but **429 on any burst of 5** — a product grid would rate-limit itself into permanent fallback, and a cold request took 40s |
| `images.unsplash.com` | 200, `image/jpeg`, ~20–47 KB, no key, no quota on image reads — **chosen** |

So the photo stage is a **curated map of fixed Unsplash CDN ids**, not a keyword search at
runtime. Each id was found by reading Unsplash's own search pages and keeping the alt text
that described the photo, and two of them were downloaded and viewed to confirm the match.
Because the ids are fixed, a listing shows the same photo on every load, which a search
endpoint would not guarantee.

Two more deviations from the plan, both to keep the asset count down:

- Category illustrations are the only new SVG **files** (nine of them, in
  `client/public/img/`). The action banners and the hero cards are **inline** SVG in
  `client/src/components/ActionArt.jsx` instead. A category illustration is content and has
  to carry its own colour; a dashboard tile is chrome and should take its colour from the
  theme, which `stroke="currentColor"` does and a downloaded `<img>` cannot. It also saves a
  request per tile.
- The lookup module is `client/src/components/imagery.js`, holding both `photoFor(name)` and
  `categoryArt(name)`, rather than a `categoryArt.js` holding only the second. One file
  decides what a listing shows, which is easier to reason about than two.

Product keywords match on whole words (with a plural "s" dropped), so "Lightweight Running
Shoes" does not reach the lamp photo via "light". Category names match on substrings,
because "Electronics" has to find the "electronic" stem.

**Not verified at the time.** The offline claim was reasoned, not tested: the illustration
stage is a local file so it cannot fail to load, but the run above had network access, so
the "network blocked" path was not exercised end to end. **Step 7's walkthrough closed
this** — `client/tests/imagery.spec.js` aborts every request to the photo host and asserts a
listing lands on its category illustration. That walkthrough also found two bugs in exactly
this code, both recorded under Step 7: two seeded categories had no illustration, and
`.stand-in` was keyed on the stage rather than on "is this the listing's own image".

**Noticed, not caused.** In the catalog grid, the action row sits about 15px higher on one
card in the first row. The card, grid and `.card-actions` rules are untouched by this step
(`git diff` on `App.css` shows only colour tokens, `.theme-toggle`, `.site-footer
.brand-mark`, the tile rules and the `.stand-in` comment), so this is pre-existing.

## Step 4 — Star rating control

**Goal.** The review rating is a clickable star control, and review displays render stars
rather than the text "4/5".

**Files.** `client/src/components/StarRating.jsx` (new),
`client/src/pages/ProductDetailPage.jsx`, `client/src/App.css`.

**Done when.** Clicking the third star submits `rating=3`; the form still reads its values
from `FormData`. The control is keyboard operable and announces "3 out of 5 stars".

**Verified.** `npm run lint`, `npm run build`, `npm test` (60/60), `npm run test:e2e`
(36/36) — all green. The behaviour itself was then driven directly with a throwaway
Playwright spec, because the suite has no assertion on the rating control and "it looks like
a star widget" is not evidence that it submits anything. That spec asserted: the reviews list
renders two read-only controls whose `aria-label` is `"4 out of 5 stars"` and whose filled
count matches each rating; clicking the third star makes `FormData` submit `rating: "3"` to
`PUT /api/products/1/review`; and `ArrowRight` moves the selection to 4. It passed, and was
deleted afterwards.

The same run was screenshotted in both themes. The stars are gold in both (dark `#f5c76a`,
light `#e0940f`), the focus ring lands on the star beside the focused radio, and the "4 out
of 5" readout sits under the row. In light mode the amber is deliberately darker than the
dark theme's, so it stays legible on white.

Three things worth recording from building it:

- **`--star` is a new token** in both blocks, rather than reusing `--warn`. A four-star
  review rendered in the warning colour reads as a problem report, and `--warn` is dark
  brown (`#b54708`) in the light palette, which is not a colour anyone associates with a
  rating.
- **`.review-form input` had to gain `:not([type="radio"])`.** That rule gives every input
  the textbox's `width: 100%`, padding and border, and at specificity (0,1,1) it beat
  `.visually-hidden` (0,1,0) — so the hidden rating radios rendered as five visible empty
  boxes spanning the form. The codebase already had this exact override once for
  `.check-label input { width: auto }`; excluding radios at the source is the fix that also
  covers the shop-review form Step 6 will add.
- **The numeric readout sits outside the `role="radiogroup"`.** A radiogroup may only own
  radios, and a `<span>` inside it would be an invalid child. It is also a `<span>`, not an
  `<output>`: `<output>` carries an implicit live region, and the radio already announces
  its own state, so the live region would say everything twice.

**Not covered.** The `readOnly` mode is exercised by the reviews list, but its `onChange`
callback is not: nothing passes one yet. Step 6's shop-review form is the first caller that
will.

## Step 5 — Admin listing removal with vendor refunds

**Goal.** An admin can remove a listing or a whole master product, and every affected vendor
is refunded the wholesale cost of the stock they still hold, computed by LIFO attribution
against their actual purchase rows. This is the TODO at the top of `schema.sql`.

**Files.** `server/sql/migrations/006_vendor_refunds.sql` (new), `server/sql/schema.sql`,
`server/src/queries/adminCatalogQueries.js`, `server/src/controllers/adminCatalogController.js`,
`server/src/routes/adminRoutes.js`, `server/tests/refund.integration.test.js` (new),
`client/src/pages/AdminConsolePage.jsx`, `client/src/pages/AdminCatalogPage.jsx`,
`client/src/App.css`, `client/tests/admin.spec.js`.

**Done when.** Removal is `discontinued = true` plus an exact refund in one transaction;
a second removal is a 409 and credits nothing; removing a master refunds every shop holding
it.

**Verified.** `npm run lint`, `npm run build`, `npm test` (71/71), `npm run test:e2e`
(39/39) — all green. The 11 new server checks are in
[`server/tests/refund.integration.test.js`](server/tests/refund.integration.test.js),
on the same temp-schema-in-a-rolled-back-transaction harness as the order suite; the 3 new
e2e checks extend [client/tests/admin.spec.js](client/tests/admin.spec.js). The admin
expansion was also screenshotted in both themes.

The LIFO test asserts `$53.00` for 7 units against purchases of 5@$9.00 and 5@$4.00. That
number is what makes the test worth having: charging every unit at the newest price would
give 63, at the oldest 28, and at the master's fallback 175 — three plausible
implementations, three different answers, and only one of them is the rule.

### Four decisions the plan did not settle

**Paid-out stock is zeroed.** The plan guarded a second removal on `discontinued = false`,
which stops the double-click but not the real hole: `RESTOCK_LISTING` clears that flag and
adds to `in_stock`, so a vendor who bought again would leave the already-refunded units on
the shelf to be refunded a second time. `PAID_OUT_LISTING` zeroes `in_stock` at removal, and
there is a check ("purchases refilled after a removal are not paid for twice") that fails
without it. It is also the honest reading: the stock has been bought back, so it is no longer
inventory.

**A master removal sweeps on `in_stock`, not on `discontinued`.** A vendor who retires their
own listing keeps the stock and is paid nothing — that was their decision. But once the
master is gone that stock is unsellable, so the sweep refunds it. Guarding the sweep on
`in_stock > 0` rather than the flag closes that hole and makes the sweep idempotent in the
same stroke, because there is nothing left to attribute on a second call.

**The preview and the payment are the same SQL.** `REFUND_ATTRIBUTION` takes an array of
`prod_id`s and is called by both the refund path (one id) and the console's per-shop preview
(that shop's ids). A future edit that changes the rule changes both, which is the only way a
preview is worth showing. It was briefly written as a lateral subquery inside the listings
query, which collided on `$1`; the two results are now merged in the controller, the way
`attachMasterAttributes` already merges masters and attributes.

**The removal write belongs to the page, not to the expansion.** The first draft had
`ShopListings` own its `useTask` and render its own `Feedback`. The e2e check for the refund
message failed: reloading the shop list clears `useResource`'s data for a moment, which
unmounts the whole expansion — message and all — before it can be read. The write now goes
through the console's own `write`, so the message lands in the feedback area that survives
the reload. `expanded` lives in `ShopsPanel`, which stays mounted, so the expansion comes
back with its new numbers. This is the kind of thing only a browser test finds; the
component looked correct in isolation.

### Deviation from the plan

`REFUND_ATTRIBUTION` returns four extra columns beyond the ones the endpoint needs:
`purchased_units`, `fallback_units`, `fallback_unit_amount` and `purchased_amount`. They are
not stored — `vendor_refunds` has the planned columns only — but they are asserted on
directly, which is what lets the test state the rule rather than just the total. `unit_amount`
is `amount / units` and therefore `NULL` when `units` is 0: the price of no units is not a
number, and `0` there would read as "free" rather than "nothing was owed".

**Not yet applied to the live database.** Migration 006 has been exercised only by the test
harness, which builds it from `schema.sql`. The live Supabase database does not have
`vendor_refunds` yet — `npm run db:migrate` is part of Step 7's manual walkthrough, as the
plan lays it out, and nothing before that step touches the live schema.

## Step 6 — A read surface per role for the unused tables

**Goal.** Every table and column in the schema becomes reachable by the role that should see
it: an admin sees everything, a vendor sees their own sales, purchases and refunds, a
customer sees their own payments. Platform commission and courier earnings stop being
always-zero columns. `shop_reviews` becomes writable and readable, enforced by a trigger
that mirrors `fn_verify_product_review_purchase`.

**Files.** `server/sql/migrations/007_shop_review_verification.sql` (new),
`server/sql/schema.sql`, `server/src/queries/{orderQueries,paymentQueries,shopReviewQueries}.js`,
`server/src/controllers/{orderController,paymentController,shopReviewController}.js`,
`server/src/routes/{adminRoutes,roleRoutes}.js`,
`client/src/pages/{AdminConsolePage,VendorPage,OrderDetailPage,AccountPaymentsPage}.jsx`,
`client/src/App.jsx`.

**Deliberately excluded.** `users.point` stays a read-only profile field. No points economy
is invented. See `docs/REFUNDS_AND_READ_SURFACES.md` once Step 7 writes it.

**Done when.** No seeded table is unreachable from some account, and no table in the schema
is decorative — every one is either read by a query or was dropped for having no reader.

**Verified.** `npm run lint` clean; `npm run build` clean (217 modules, 449.29 kB);
`npm test` **82/82** in 113s; `npm run test:e2e` **53/53** in 2.6m. The server suite gained
`tests/readSurfaces.integration.test.js` (11 checks) on the temp-schema harness; the client
gained `tests/read-surfaces.spec.js` (9) and four more admin-console tests.

**Re-verified after the permission tables were removed.** `npm run lint` clean;
`npm run build` clean (217 modules, **447.48 kB**); `npm test` **82/82** in 120s;
`npm run test:e2e` **52/52** in 2.5m. The server count is unchanged because the permissions
check was *replaced* by the check that asserts the tables are gone, not deleted; the e2e
count fell by exactly one, the removed admin-console tab test.

### Four bugs the tests found, and one the client did

1. **`CREATE_ORDER_ITEM` did not parse.** `ROUND($3 * $4 * $5, 2)` — three untyped
   parameters multiplied together is `42725`, "operator is not unique: unknown * unknown":
   PostgreSQL has no candidate to anchor the type. Casting the quantity to `numeric` is
   `42P08` instead, "inconsistent types deduced for parameter $3: numeric versus integer",
   because the `VALUES` list had already deduced it from the integer column. The statement
   now reads `ROUND($3::int::numeric * $4::numeric * $5::numeric, 2)` — each parameter cast
   to the type something else already gave it. It is the same trap the
   `ADVANCE_ORDER_STATUS` comment describes, which is the second time this file has hit it.
2. **An expected trigger failure poisoned the test transaction.** A `RAISE` in a trigger
   aborts the whole transaction, so the assertion that the shop-review trigger refuses a
   non-buyer left every later statement in that file answering `25P02`. The refusal now runs
   inside its own `SAVEPOINT`.
3. **The test file hung instead of failing.** Its teardown was `server.close()` unawaited and
   no `client.release()`, so the process finished its assertions and then sat there until the
   timeout — three minutes of nothing that reads exactly like slow tests. The teardown now
   matches `order.integration.test.js`: awaited close, released client, `pool.end()`. Worth
   remembering: `node --test … | tail -80` buffers everything until the process exits, so an
   empty output file is not evidence of a hang, and a hang is not evidence of a failing test.
4. **`/vendor/payments` had no route.** The dashboard linked to it and `VendorPage` rendered
   it, but nothing in `App.jsx` mounted it, so the link fell through to the catch-all and
   redirected home. Found while writing the e2e spec for that tab.
5. **The checkout spec's `.panel.last()` broke.** `OrderDetailPage` now renders a review panel
   per shop after the payment panel, so "the last panel" was no longer the payment's. The
   assertion is now located by the sentence it is about.

### Deviations from the plan

- **The permissions matrix was built, then removed at the user's request.** See "The
  permission tables were removed" below.
- **Migration 008 was not in the plan.** `008_cancel_voids_commission.sql` replaces
  `fn_cleanup_cancelled_order` so a cancel zeroes `orders.platform_commission` and its
  `order_items` lines. Without it the admin payments screen would show a cancelled order
  sitting beside a failed payment while still reporting the commission it earned — revenue
  that never existed. Applied in place to `schema.sql` as well, with a pointer comment. No
  backfill was needed: every commission column was at its default zero beforehand.
- **The seed now fills the money columns.** Section 8 of `seed_demo.sql` writes the
  commission and courier earnings the placement and delivery rules would have produced, so
  the three new screens show real numbers instead of a column of zeroes. It is scoped to the
  seed's own `created_at` and skips cancelled orders, so `npm run db:seed` can never rewrite
  a real order's figures.
- **`GET /api/admin/payments` does not include "the order's refunds", as the plan's table
  promised.** A `vendor_refunds` row has no `order_id` and never will: it compensates a shop
  for unsold stock, not a customer for an order. The two are not the same kind of money, and
  forcing a join would have meant inventing one. Refunds have their own tab.
- **`paginated`/`parseListQuery` were extracted** into `server/src/utils/listQuery.js` rather
  than written a third and fourth time, and `listUsers`, `listShops` and `listProducts` were
  moved onto them, so all four lists answer a bad filter identically.

### The permission tables were removed

Step 6 built the `GET /api/admin/permissions` matrix as the plan asked, and the round-trip
came out clean: seven `demo.*` permissions, all seven enforced by a mounted `requireRole`,
none declared-only. The test proved the other branch too, by inserting a `demo.unchecked`
permission and asserting its row flipped to `enforced: false` with `declared_only` at 1.

The user then asked for it to be removed, at the widest scope offered — **the database
tables too**. So `009_drop_permissions.sql` drops `permissions` and `role_permissions`, and
the feature went with them: the console's Permissions tab and `PermissionsPanel`, the
endpoint and its route, `listPermissions`, `LIST_PERMISSION_MATRIX`, `ENFORCED_BY`, the
seven-permission seed block, the client test and the `.status-pill.status-enforced` /
`.status-pill.status-declared` rules. `roles` stays, because that is what a user's row
actually points at.

That the matrix reported 7/7 enforced is the argument for dropping it, not against. The
tables said nothing the routers did not already say, and a grant added to `role_permissions`
would have granted exactly nothing — which is the one mistake such a table invites. Had the
count come out lower, the tables would have been worth keeping as a to-do list; it did not,
so they were not. One integration check replaces the old one and keeps the removal under
test: `to_regclass('permissions')` and `to_regclass('role_permissions')` are both null,
`GET /api/admin/permissions` is a 404, and `roles` still has its four rows.

**Not yet applied to the live database** — as of this step. Migrations 006, 007, 008 and 009
had been exercised only by the test harness, which builds the schema from `schema.sql`, so
the live Supabase database had none of them. *Closed in Step 7*: `npm run db:migrate` applied
all four, and the verification table below records what came back.

## Step 7 — Docs and full verification

**Goal.** The two new docs are written, the two existing flow docs describe what changed,
and the whole feature is walked manually against the real database.

**Files.** `docs/REFUNDS_AND_READ_SURFACES.md` (new), `docs/UI_AND_THEME.md` (new),
`docs/WEBSITE_FLOW.md`, `docs/SERVER_DATABASE_FLOW.md`, this file.

**Done when.** Every box above is ticked, this file's own box included, and the manual
walkthrough in the plan has been run and its numbers recorded.

**Verified.** `npm run lint` clean; `npm run build` clean (217 modules, 447.52 kB);
`npm test` **82/82** in 154s; `npm run test:e2e` **57/57** in 2.6m — 52 from Steps 1–6 plus
the 5 new `tests/imagery.spec.js` tests the walkthrough below earned.

`docs/UI_AND_THEME.md` was written, and `docs/WEBSITE_FLOW.md` gained the Payments and
Refunds tabs, the in-place listing expansion with its refund preview, the vendor payments
tab, the courier-pay rule, shop reviews on order detail, the customer payment history, the
new endpoints in the API table, and a short "interface shell" section pointing at the new
doc.

### Migrations applied to the live database

`npm run db:migrate` applied **006, 007, 008 and 009** to the real Supabase database — the
first time any of them had run anywhere but the test harness. Verified afterwards:

| Check | Result |
| --- | --- |
| `to_regclass('permissions')`, `to_regclass('role_permissions')` | both `NULL` |
| `to_regclass('vendor_refunds')` | present |
| `roles` | 4 rows, intact |
| `platform_commission` | present on `orders` **and** `order_items` |
| `trg_verify_product_review_purchase`, `trg_verify_shop_review_purchase` | both present |
| `schema_migrations` | 001–009 |

### The walkthrough, and what it found

**Theme, in a real browser.** Dark with no stored choice and no `data-theme` attribute
(`body` at `rgb(13, 21, 18)`); the header button announces "Switch to light theme"; clicking
it lands `data-theme="light"` and `rgb(244, 247, 243)`; the value is in
`localStorage.shopsphere_theme`; and a reload comes back light, applied before first paint.

**Money, against the live API and the live database.** A customer ordered 2 × Demo Wireless
Keyboard at $35.00:

| Step | Observed |
| --- | --- |
| `POST /orders` | order 9, `total_amount` $70.00, `platform_commission` $3.50, courier auto-assigned |
| line commission | $3.50 on the single line — 5% of $70.00, and the sum matches the order |
| courier "delivered" | `delivery_personnel.earnings` `NULL` → **$4.40** = 3.00 + 0.02 × 70.00 |
| "delivered" again | `409`, and earnings stayed $4.40 |
| vendor `/vendor/payments` | `net_to_shop` $66.50 per line = 70.00 − 3.50; no buyer name or email anywhere in the sales rows |
| admin `/admin/shops/1/listings` | previewed the removal at `units: 18, purchased_units: 18, amount: $450.00` |
| admin removal of listing 4 | shop 1 earnings $0 → **$450.00**, exactly 18 × $25.00 LIFO, and one `vendor_refunds` row (`reason: admin_removal`, `removed_by: 4`) |
| removing it again | `409`, earnings unchanged at $450.00 |
| `/account/payments` | 5 rows, all the caller's own, no commission field; a vendor calling it gets `403` |

One result looked wrong and was not: `vendor@shopsphere.test` still reported
`refunds_received: 0.00` after the $450 refund. Shop 1 belongs to
`vendor2@shopsphere.test`, and reading *their* books showed `refunds_received` and
`earnings_balance` both at $450.00 with the refund row present. That is the isolation
working, and it is the reason the assertion was run from the owning account.

**Two real bugs the walkthrough found, both now fixed and covered.**

1. **Two live categories had no illustration.** The seeded catalog has a "Mobile Phones"
   root and a "Phone Accessories" child, and neither contains a stem the electronics row
   of `CATEGORY_STEMS` held — so an Anker Power Bank and a Samsung Galaxy S25 got the
   neutral parcel while a keyboard got a chip. `phone`, `mobile` and `tablet` were added to
   the electronics stems; the storefront went from **2 of 11 listings on
   `category-other.svg` to 0 of 11**. Nothing looked broken in either state, which is what
   makes this class of bug worth a test: the fallback is supposed to be a wrong-but-quiet
   answer, so it can be wrong invisibly.
2. **`.stand-in` was keyed on the wrong question.** `ProductMedia` set it from the stage
   index, but the CSS says the class means "not the listing's own image" — and those differ
   whenever a listing has no image URL *and* no keyword match, because then the category art
   sits at index 0. The identical illustration was therefore styled quietly for one product
   and not for another depending on whether its name happened to match a photo keyword. The
   class is now derived from "is this the listing's own picture".

Both fixes came with `client/tests/imagery.spec.js`, which had no equivalent before: the
fallback chain was untested, so neither bug was reachable by any existing suite. It guards
the stage order, the failover from an unreachable photo host, that every seeded root
category resolves to an illustration of its own, and that only a listing's own image skips
`.stand-in`. The fourth of its tests failed on first run against the *test's* expectation
rather than the code, which is how the second bug was found.

**Not retroactive.** Every order placed before migration 008 keeps `platform_commission` at
its default zero, so the seeded orders 1–7 and their payments show `$0.00` commission and a
`$0.00` courier balance. That is the rule the doc states — the rate is applied at placement,
so it changes future orders only — and the walkthrough's own order 9 is the first with a
non-zero figure.

### Demo data mutated by this walkthrough

Orders **8** and **9** were created for `customer@shopsphere.test` (order 9 delivered,
order 8 left pending), listing 7 is short by 4 units across the two, and listing **4**
(Demo Wireless Keyboard, shop 1) is removed-with-refund and cannot be re-removed. Shop 1
carries $450.00 of earnings and `vendor_refunds` holds one row.

---

## Known state of the demo data

Verification of the orders feature, and then of this work, mutated the seeded demo data and
none of it can be undone (a delivered order cannot be cancelled, and an admin removal
cannot be re-removed):

**From the orders verification**

- order #4 exists as **delivered** for `customer@shopsphere.test`
- product ids 10 and 11 are short by 3 and 1 units respectively
- the courier's profile carries motorcycle / DHA-GA-11-2233 / Honda CB Shine / DK-1234567

**From this walkthrough**

- orders **8** (pending) and **9** (delivered) exist for `customer@shopsphere.test`
- listing 7 is short by 4 units across those two orders
- listing **4** (Demo Wireless Keyboard, shop 1) is discontinued and refunded
- shop 1 (`vendor2@shopsphere.test`) holds **$450.00** of earnings, and `vendor_refunds`
  holds one row
- the courier's `earnings` is **$4.40**

These affect the specific numbers seen during manual verification, not whether the
assertions hold. A fresh `npm run db:init` plus `npm run db:seed` restores the original
figures.

---

## The schema reference

Step 7 swept the docs but missed `docs/SCHEMA.md`, which had been deleted while three files
still linked to it (`README.md`, `docs/IMPLEMENTATION_STEPS.md`,
`server/README.md`). It is a **generated** artifact, and its generator
(`scripts/document-schema.py`) had itself gone stale — its hand-written preamble still named
the dropped `role_permissions` table and still claimed there was no commission policy — so
restoring the old file from git would have restored a wrong document. The preamble was fixed
first, and `npm run docs:schema` was added to the root `package.json` so the regeneration is
discoverable rather than tribal knowledge.

`docs/SCHEMA.md` now documents the current **21 tables**, with no `permissions` or
`role_permissions` entry and with `vendor_refunds` present.

**One caveat, recorded because it is the kind of thing that gets lost.** The Bash safety
classifier was down for the whole of that stretch, so `npm run docs:schema` could not be
run. The file was instead derived by hand from `server/sql/schema.sql`, following the
generator's own algorithm — same table order, same field splitting, same ERD edge rules,
same preamble text taken verbatim from the script. It should therefore be byte-identical to
what the generator produces. Nobody has confirmed that. **The first person with a working
shell should run `npm run docs:schema` and check `git diff --stat docs/SCHEMA.md` is
empty**; if it is not, the diff will be small and localised, and the generator is right by
definition. Nothing has been verified since, because nothing else changed except docs.

`docs/erd.drawio.png` is a separate matter and was deliberately left alone. It is a
hand-arranged Chen-notation ERD that is **untracked** (so deleting it would be irreversible,
not recoverable from git), **referenced by nothing**, has **no `.drawio` source** anywhere
in the repo so it cannot be regenerated, and is **stale** — it still draws `permissions` and
`role_permissions` as entities. It looks like a course-submission artifact. Deleting or
replacing it is the owner's call, not a tidy-up to make silently.
