# Backend guide

ShopSphere uses **Express 5 + PostgreSQL (`pg`), with parameterized SQL and no ORM**.
All endpoints below start with `/api`. There is no external payment gateway:
checkout records cash on delivery; wholesale purchases and vendor refunds are
internal database records, not online transfers.

## Request and database flow

`src/index.js` → `routes/*` → authentication/role middleware → `controllers/*`
→ `db/queries/*` → `db/pool.js` or `db/transaction.js` → PostgreSQL.

Routes choose handlers and access rules. Controllers validate input and coordinate
operations. Query modules contain SQL; `$1`, `$2`, etc. bind request values.
`transaction(work)` reserves one connection for BEGIN/work/COMMIT, rolls back on
failure, and always releases it. Express forwards rejected async handlers to the
shared JSON error handler.

## Runtime files

Paths in this section are relative to `server/src/`.

| File | Responsibility |
| --- | --- |
| `index.js` | Loads `server/.env`, logs requests, configures CORS/JSON/cookies, mounts routers, returns JSON 404/errors; listens only when run directly. |
| `middleware/authMiddleware.js` | Verifies JWT cookie, loads the current user/role, checks active status and token version; provides `requireAuth` and `requireRole`. |
| `middleware/errorMiddleware.js` | Maps input and PostgreSQL errors to 400/409, malformed JSON to 400, oversized bodies to 413, unexpected errors to 500. |
| `middleware/requestLogger.js` | Logs HTTP status, method, URL, duration and authenticated user ID. |
| `db/pool.js` | One shared `pg.Pool`, configured by `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; wraps pooled queries for logging. |
| `db/transaction.js` | Atomic multi-statement operations on a dedicated pooled connection. |
| `db/logger.js` | SQL statement summaries, timing and error codes; omits bound values such as emails, addresses and password hashes. |
| `db/sql.js` | Escapes `%`, `_` and backslash for literal `ILIKE` searches. |
| `utils/authToken.js` | Signs one-day JWTs and sets/clears the HTTP-only `shopsphere_token` cookie; requires a 32-character JWT secret. |
| `utils/input.js` | Throwing validators for IDs, strings, money, URLs, addresses and phones. |
| `utils/validation.js` | Parsers for integers, prices, sorting, paging, search and attribute filters. |
| `utils/listQuery.js` | Validates shared list filters and formats paginated results. |
| `utils/logging.js` | Controls `LOG_SQL`/`LOG_REQUESTS`; defaults to enabled outside production. |

## Feature files and tables

Each controller below lives in `src/controllers/`; its matching query file lives
in `src/db/queries/`. This accounts for every controller and query module.

| Controller / query file | What it does and database tables used |
| --- | --- |
| `authController.js` / `authQueries.js` | Registration, login, logout and current user. Reads `roles`, `countries`, `users`; writes `locations`, `users`, `delivery_personnel`. Also supplies the authentication middleware's user lookup and shared location insert. |
| `catalogController.js` / `catalogQueries.js` | Public product search/details/facets, categories, shops, roles and database health. Joins `products`, `shops`, `master_products`, `categories`, `attributes`, `category_attributes`, `attribute_values`; health uses `SELECT 1`. |
| `cartController.js` / `cartQueries.js` | Customer cart reads and guarded quantity changes. Writes `cart_items`; joins listing/master/shop availability. Also uses `wishlistQueries.PRODUCT_EXISTS`. |
| `wishlistController.js` / `wishlistQueries.js` | Idempotent saves and owned deletions in `wish_list_items`; joins catalog tables for display/availability. |
| `orderController.js` / `orderQueries.js` | Checkout, history, cancellation and courier delivery. Reads/writes `cart_items`, `products`, `orders`, `order_items`, `payments`, `delivery_personnel`; reads `users`, `shops`, `master_products`, `locations`. Uses the shared location insert for a new shipping address. Commission/pay constants live in this query module. |
| `profileController.js` / `profileQueries.js` | Country list and current user's profile. Joins `users`, `roles`, `locations`, `countries`, `delivery_personnel`; creates a fresh location when updating an address. |
| `vendorController.js` / `vendorQueries.js` | Owned shops, wholesale purchases and retail listings. Writes `shops`, `locations`, `shop_purchases`, `products`; reads available `master_products` and category metadata. |
| `adminController.js` / `adminQueries.js` | Paged user/shop moderation; reads `users`, `roles`, `shops`, `locations`, `products`; changes user/shop status and invalidates user sessions. |
| `adminCatalogController.js` / `adminCatalogQueries.js` | Categories, attributes, master products and listing removal. Writes `categories`, `attributes`, `category_attributes`, `master_products`, `attribute_values`, `products`; attributes remaining stock to `shop_purchases`, writes `vendor_refunds` and credits `shops.earnings`. |
| `paymentController.js` / `paymentQueries.js` | Admin ledgers, customer payment history, vendor sales/refunds/totals. Reads `payments`, `orders`, `order_items`, `products`, `shops`, `users`, `vendor_refunds`, `shop_purchases`; also reuses `vendorQueries.LIST_OWNED_PURCHASES`. |
| `reviewController.js` / `reviewQueries.js` | Public product reviews and customer-owned review writes; `product_reviews`, `users`, `orders`, `order_items`. |
| `shopReviewController.js` / `shopReviewQueries.js` | Equivalent shop reviews; `shop_reviews`, `users`, `orders`, `order_items`, `products`. |
| `roleController.js` / `roleQueries.js` | Courier availability, vehicle information and earnings in `delivery_personnel`. |

## API map: where each endpoint is handled

All router files live in `src/routes/`. `:id` below abbreviates the named ID in
the route source. Identity always comes from the verified session; owner-scoped
queries prevent access to another customer's or vendor's records.

| Router | Endpoints (after `/api`) | Access → controller |
| --- | --- | --- |
| `authRoutes.js` | `POST /auth/register`, `/auth/login` | Public → auth |
| `authRoutes.js` | `GET /auth/me`; `POST /auth/logout` | Signed in → auth |
| `catalogRoutes.js` | `GET /health`, `/roles`, `/products`, `/products/facets`, `/products/:id`, `/categories`, `/shops` | Public → catalog |
| `cartRoutes.js` | `GET/POST /cart`; `PUT/DELETE /cart/:id` | Customer → cart |
| `wishlistRoutes.js` | `GET/POST /wishlist`; `DELETE /wishlist/:id` | Customer → wishlist |
| `orderRoutes.js` | `GET/POST /orders`; `GET /orders/:id`; `PUT /orders/:id/cancel` | Customer → order |
| `roleRoutes.js` | `GET /countries`; `GET/PUT /profile` | Countries public, profile signed in → profile |
| `roleRoutes.js` | `GET /products/:id/reviews`, `/shops/:id/reviews` | Public → review / shopReview |
| `roleRoutes.js` | `GET /products/:id/review-eligibility`, `/shops/:id/review-eligibility`; `PUT/DELETE /products/:id/review`, `/shops/:id/review` | Customer → review / shopReview |
| `roleRoutes.js` | `GET /account/payments` | Customer → payment |
| `roleRoutes.js` | `GET/POST /vendor/shops`; `PUT /vendor/shops/:id`; `GET/POST /vendor/listings`; `PUT /vendor/listings/:id`; `GET /vendor/purchases` | Vendor → vendor |
| `roleRoutes.js` | `GET /vendor/master-products`; `GET /vendor/payments` | Vendor → adminCatalog / payment |
| `roleRoutes.js` | `GET/PUT /delivery/profile` | Delivery → role |
| `roleRoutes.js` | `GET /delivery/deliveries`; `PUT /delivery/orders/:id/status` | Delivery → order |
| `adminRoutes.js` | `GET /admin/users`; `POST /admin/users`; `PUT /admin/users/:id/status` | Admin → admin / auth / admin |
| `adminRoutes.js` | `GET /admin/shops`; `PUT /admin/shops/:id/status` | Admin → admin |
| `adminRoutes.js` | `GET /admin/shops/:id/listings`, `/admin/catalog-metadata`; `POST /admin/attributes`; `POST /admin/categories`; `PUT/DELETE /admin/categories/:id` | Admin → adminCatalog |
| `adminRoutes.js` | `GET/POST /admin/master-products`; `PUT/DELETE /admin/master-products/:id`; `PUT /admin/listings/:id/discontinue` | Admin → adminCatalog |
| `adminRoutes.js` | `GET /admin/payments`, `/admin/refunds` | Admin → payment |

List filters use `q`, `page`, `limit` and feature-specific choices. Products also
accept category, price range, sort and repeated `attribute=id:value` filters.
Paged responses are `{ items, total, page, limit, total_pages }`; other list routes
may return arrays. Current window-count pagination returns total zero for an
out-of-range empty page. Common errors: 400 invalid input, 401 missing/stale login,
403 wrong role, 404 missing/non-owned record, 409 business conflict.

## Database rules that matter

- **Catalog ownership:** admins own master facts and category requirements;
  vendors own shop listings and retail prices. New vendor shops start `pending`.
  Only active shops with available masters and non-discontinued listings appear
  in the public catalog. Cart contents do not reserve stock.
- **Checkout:** locks the selected cart rows in product-ID order, conditionally
  decrements stock, creates the order/items/commission/payment, then deletes only
  the purchased cart rows. Concurrent checkout cannot purchase those same rows
  twice, and newly added different products remain in the cart. Prices are read
  at checkout; opening the cart does not lock a price. Payment totals are added
  in PostgreSQL using decimal arithmetic.
- **Delivery:** assigns an available courier whose user account is active, or
  leaves the order unassigned. Status changes compare the expected current state.
  Delivery completes the pending cash payment and credits courier earnings once.
- **Cancellation:** database trigger restores stock, fails the pending payment
  and clears order/line commissions. Only pending orders can be cancelled.
- **Vendor removal refunds:** admin removal discontinues stock, calculates the
  refund from the newest wholesale purchases first, records the refund, credits
  the shop and zeroes inventory in one transaction. History is preserved.
- **Database enforcement:** triggers prevent hard deletion of historical entities,
  cascade account/shop disabling, release a courier's orders when unavailable,
  recalculate order totals, constrain order transitions, and require delivered
  purchases for reviews. Deferred category-value triggers check required master
  attributes at commit. These protections also apply to direct SQL writes.
- **Sessions:** bcrypt hashes passwords; JWTs carry user ID and token version.
  Logout/status changes increment `users.token_version`. Each protected request
  reloads the user so disabling an account takes effect immediately.

## Setup, schema and supporting files

Paths below are relative to `server/` unless specified otherwise.

| File | Purpose |
| --- | --- |
| `package.json` | API dependencies and start/watch/database/test commands. Root `package-lock.json` locks both workspaces. |
| `.env.example` | Configuration template: database connection, port, JWT secret, allowed browser origins and logging. `.env` is local and ignored. |
| `README.md` | Backend setup entry point. |
| `scripts/init.js` | Takes an advisory lock, refuses non-empty schemas, loads `sql/schema.sql` atomically. |
| `scripts/migrate.js` | Takes an advisory lock and runs ordered, unapplied migrations in one transaction; tracks names in `schema_migrations`. |
| `scripts/seed.js` | Loads the demo SQL transactionally under an advisory lock; rejects production mode and preserves matching existing demo rows. |
| `sql/schema.sql` | Fresh-database tables, keys, checks, indexes, functions and triggers. |
| `sql/test_insert/seed_demo.sql` | Demo countries/roles/accounts/catalog/orders/reviews and purchase history. |
| `sql/migrations/001_add_users_token_version.sql` | Adds logout/session revocation version. |
| `sql/migrations/002_add_shop_purchases.sql` | Adds wholesale purchase history. |
| `sql/migrations/003_complete_flows.sql` | Order/review/category enforcement, status constraints and supporting indexes. |
| `sql/migrations/004_admin_shop_approval.sql` | Pending shop status and account re-enable behavior. |
| `sql/migrations/005_delivery_vehicle_fields.sql` | Structured courier vehicle fields. |
| `sql/migrations/006_vendor_refunds.sql` | Vendor refund ledger and indexes. |
| `sql/migrations/007_shop_review_verification.sql` | Enforces delivered-purchase eligibility for shop reviews. |
| `sql/migrations/008_cancel_voids_commission.sql` | Clears commissions when cancelling an order. |
| `sql/migrations/009_drop_permissions.sql` | Removes unused permission tables; authorization uses roles. |
| `tests/admin.integration.test.js` | Shop approval, account moderation, role guards and list filters. |
| `tests/cart.integration.test.js` | Cart validation/ownership/stock, wishlist behavior and session revocation. |
| `tests/catalog.integration.test.js` | Search, category trees, facets, sorting, paging and invalid filters. |
| `tests/concurrency.integration.test.js` | Independent-connection checkout race and preservation of newly added cart items. |
| `tests/order.integration.test.js` | Checkout rollback/stock/address/payment, cancellation and courier operations. |
| `tests/readSurfaces.integration.test.js` | Commission, courier earnings, role-scoped payment reads and shop reviews. |
| `tests/refund.integration.test.js` | Refund attribution, exactly-once removal and admin removal previews. |
| Root `scripts/dev.js` | Starts client and backend together for development. |
| Root `scripts/document-schema.py` | Generates `docs/SCHEMA.md` from the schema without connecting to PostgreSQL. |

From the repository root: `npm run db:init` for an empty database,
`npm run db:migrate` for an existing one, `npm run db:seed` for local demo data,
`npm run dev:server` for the API, and `npm test` for PostgreSQL integration tests.
Tests use disposable schemas and need schema-creation permission. Keep migrations
for existing installations; do not replace them with a rerun of the fresh schema.
No schema migration is required by this refactor.

Detailed references: [schema and ERD](SCHEMA.md), [order/payment rules](ORDERS_AND_PAYMENT.md),
[vendor refunds](REFUNDS_AND_READ_SURFACES.md), [setup and workflows](WEBSITE_FLOW.md).
