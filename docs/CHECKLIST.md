# CSE216 checklist review

Reviewed on 2026-09-27 against **CSE216 Project Checklists.docx** supplied by the
user. Its Research Network examples illustrate database concepts; they do not
require this shopping project to implement publications, citations or research groups.
The user separately authorized implementation of missing requirements.

## Result

The technical database gaps have been implemented. Two qualifications remain:
**storefront browsing stays public at the user's explicit request**, and the
student's ability to explain the code must be demonstrated personally.

| Requirement | Finding and current evidence |
| --- | --- |
| Own authentication code, JWT/session permitted | Met. `authController.js`, `authToken.js` and `authMiddleware.js` implement registration, bcrypt password verification, JWT cookies, account-status checks and token-version revocation. No third-party authentication service is used. `oracledb` connects to Oracle Database; hosting the database externally does not delegate authentication. |
| Authentication on every page/request | Met for protected features, **intentional exception to the literal wording** for public storefront pages and their read APIs. The user explicitly chose public browsing. React initializes `/api/auth/me`; protected page guards and API `requireAuth`/`requireRole` prevent unauthorized operations. Login/registration, country/role choices and health also remain public. Do not claim that every HTTP request requires a logged-in user. |
| Explicit transaction control for every DML operation | Previously partial: standalone writes used autocommit. Now every API INSERT/UPDATE/DELETE uses `transaction(work)` or `transaction.query(...)`, including cart, wishlist, logout, moderation, profile, reviews and listing edits. Both execute BEGIN, COMMIT on success, ROLLBACK on error, and release the connection. Init and both seed files are also run transactionally by their scripts. |
| One or more triggers | Met. `schema.sql` includes order-total recalculation, cancellation stock restoration, order-transition validation, delivered-purchase review checks, deferred required attributes, status cascades and protected historical records. |
| Function returning a statistical/computed value | Previously missing: all functions returned trigger records. `fn_order_subtotal(order_id)` now returns the numeric sum of quantity × historical unit price. The total-recalculation trigger and checkout's `ORDER_TOTALS` query both use it. |
| At least one procedure for a multi-table workflow | Previously missing. `settle_delivery` conditionally advances an assigned shipped order, completes its payment, credits the courier the order's own delivery cost and credits each shop for its own lines. `PUT /api/delivery/orders/:id/status` calls it through `SETTLE_DELIVERY` inside an explicit transaction. Repeated delivery cannot pay twice. |
| Three or more complex queries | Met. See the four concrete examples below. |
| Appropriate use of database features | Met by the implemented examples: triggers enforce invariants for API and direct SQL; a function returns a computed monetary value; a procedure groups delivery writes; transactions provide all-or-nothing changes. No decorative procedure or unused analytics function was added. |
| Understand and explain every part of the code | Cannot be certified by automated review. Use the walkthrough below to prepare for the evaluation. |

## Complex-query demonstrations

Paths are under `server/src/db/queries/`.

| Query | Complexity | Where it is used |
| --- | --- | --- |
| `catalogQueries.buildProductListQuery` | Joins listings, shops, master products and categories; recursive category scope; attribute EXISTS filters; window count and pagination. | `GET /api/products`, product search/filter page. |
| `adminCatalogQueries.REFUND_ATTRIBUTION` | Purchase-history attribution, window calculations and aggregate refund values for remaining stock. | Admin shop-listing preview and listing/master removal. |
| `paymentQueries.OWNED_TOTALS` | Aggregates a vendor's sales, wholesale purchases, refunds received and shop balance across owned shops. | `GET /api/vendor/payments`, vendor payment summary. |
| `orderQueries.LIST_ORDERS_BY_USER` | Joins orders, locations, payments, courier users and order items; GROUP BY, COUNT and SUM. | `GET /api/orders`, customer order history. |
| `statisticsQueries.OWNED_RECONCILIATION` | Seven scalar aggregates over orders, order items, top-ups, purchases and both refund ledgers, in one round trip, satisfying the balance identity. | `GET /api/vendor/statistics`, vendor income page. |

## Explainable evaluation walkthrough

1. Register or log in, inspect the HTTP-only cookie, and explain why the server
   still reloads the user/role and checks `token_version` on protected requests.
2. Search products by category and attribute. Trace route → controller → query
   builder → parameterized SQL. Explain the master-product versus shop-listing split.
3. Add to the cart, then checkout. Explain explicit transaction boundaries,
   cart-row locks, conditional stock updates, price snapshots and rollback.
4. Compare `SELECT fn_order_subtotal(<order_id>)` with that order's line items.
   Explain how the trigger keeps the stored total synchronized.
5. As an on-duty courier, take a placed order off the open board
   (`PUT /api/delivery/orders/:id/claim`) — explain that the claim is a
   compare-and-set whose predicate carries the order's current status and the
   courier's own availability, so two couriers cannot both take it. Then mark the
   order shipped and then delivered. Show the `CALL settle_delivery(...)` query and
   the tables it changes — the order, the payment, the courier's earnings and each
   shop's balance. Repeat delivery to demonstrate that the guarded transition
   prevents duplicate earnings, and try to move the order as a second courier to
   show that a claim is the only way in.
6. Cancel a different pending order and show restored stock and a failed payment.
7. Submit a verified review; attempt one without a delivered purchase. Explain
   why the database trigger is still necessary when the UI already checks eligibility.
8. Ask to return a line of the delivered order, accept it as the vendor, and show
   that the shop's balance fell and a `customer_refunds` row exists. Then collect it
   as the courier and restock it as the vendor: the balance must not move again, and
   `in_stock` must go up only at the restock. Explain why money and goods move at
   different moments, and why the quantity trigger is needed when the API also checks.
9. Open vendor payments/admin refund previews and explain the joins and aggregates.

## Schema and dataset changes

`server/sql/schema.sql` is the single fresh-database definition: **24 tables, 14
functions, 20 triggers, one procedure and 11 indexes**. All seven status/flag NOT
NULL constraints are inside CREATE TABLE; token versions, purchases, refunds,
top-ups, returns, vehicle fields, final trigger definitions and refund indexes are
included. The incremental migration files, migration runner and migration npm
commands have been removed. There are no ALTER TABLE patches or trigger-drop
patches in this schema. Init still refuses non-empty schemas.

`npm run db:seed` loads the small regression/demo fixture followed by the expanded
fixture, in one transaction. A fresh database has 46 users, 8 shops, 52 master
products, 296 listings, 34 orders, 68 order items, 34 payments and 24 vendor
refunds, plus attributes, purchase history, reviews, carts, wishlists and the
`shop_topups` rows that fund each shop's starting balance. Details and public
demo passwords are in [DEMO_DATA.md](DEMO_DATA.md).

The configured application database has not been reset or upgraded by this work.
Use a **new empty database** for the consolidated schema; keep existing databases
and data until you deliberately choose how to transfer them.

## Verification (2026-09-27)

- `npm test`: **121 passed, 0 failed** against the current tree. Includes real
  HTTP/PostgreSQL regressions, procedure failure rollback, exactly-once earnings,
  explicit transaction behavior, the controller mutation audit, and
  schema/seed repeatability checks, plus `server/tests/returns.integration.test.js`
  and the delivery-board cases: a placed order waits on the board belonging to
  nobody, claiming is exactly once, an off-duty courier sees an empty board and
  cannot claim, a disabled courier is refused entirely, and only `pending` is
  claimable.
- `npm run test:e2e`: **60 passed, 4 failed**, and the four are not this feature's.
  Two fail on every run and fail identically with the new spec mock reverted, so
  they predate it: `read-surfaces.spec.js` "a customer asks to return a delivered
  line" passes a fixture whose `order_id` is 4 to a test that opens order 7 (the
  panel filters on the order), and "a courier sees the pickups nobody has
  collected" references a `courier` constant that the file never defines — a
  `ReferenceError` at `HEAD`, so that test could not have passed before. The other
  failures differ between runs (`cart.spec.js`, `imagery.spec.js`, `admin.spec.js`
  and the vendor empty-state test each failed once and passed otherwise), which is
  the signature of 5-second locator timeouts on a slow run rather than a
  regression. The two tests this change adds or edits pass on every run: "the
  courier's run offers only the move that is legal for each order" and "the board
  offers an unclaimed order, and accepting it puts it on the run".
- `git diff --check`: clean, no whitespace errors.
- `npm run lint`, `npm run build` and `npm run docs:schema`: **still not run.**
  Each attempt was refused by the Bash safety classifier while it was unavailable,
  which is an environment failure and not a result. `docs/SCHEMA.md` was edited by
  hand in prose only — the tables, edges and sections the generator emits are
  untouched, and the change adds one index and no table, so a generator run should
  reproduce it.
- The predecessor block below is retained only as a record of that earlier run.
  Its `93 passed`, `21 tables` and `34 foreign-key relationships` figures are
  **stale**; the counts are now 24 and 44, and the index count is 11.

The predecessor run reported:

- `npm test`: 93 passed, 0 failed, before the returns suite existed.
- `npm run lint`: passed for backend and frontend.
- `npm run build`: production frontend build passed.
- `npm run docs:schema`: regenerated 21 tables and 34 foreign-key relationships.

Database checks ran in disposable schemas; they did not initialize or reseed the
application's existing tables.

**The configured database has not been migrated.** The authoritative schema is
`server/sql/schema.sql`, and the migration runner was deliberately removed, so
the suite can be green while the configured database is stale — a silent
failure mode. A fresh database built with `npm run db:init` and `npm run db:seed`
is required to exercise this work.
