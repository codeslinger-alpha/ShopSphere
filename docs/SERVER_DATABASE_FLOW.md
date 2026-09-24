# ShopSphere server and database flow

This is the server-side reference for the application. The React client is only
an API consumer: it sends JSON with cookies through `client/src/api/http.js` and
renders responses. Pages relevant to a route are named below only to help locate
the request in browser developer tools.

## Starting point, scripts, and deployment use

The scripts are operational tools, not code used for normal HTTP requests.

- `server/scripts/init.js` is a one-time bootstrap for a brand-new empty
  PostgreSQL database. It takes an advisory lock, refuses non-empty schemas,
  and executes `server/sql/schema.sql` in one transaction. Use it only for a
  new local database or a brand-new production database; never as an update.
- `server/scripts/migrate.js` is the production schema-update tool. It creates
  `schema_migrations`, takes an advisory lock, sorts `sql/migrations/*.sql`, and
  executes only files not already recorded. Its transaction rolls back the run
  on error. In deployment: back up, configure production `server/.env`, run this
  once per release, verify it, then start/restart Express.
- `server/scripts/seed.js` loads `sql/test_insert/seed_demo.sql` for local demo
  users/catalog data. It rejects `NODE_ENV=production`; never use it in final
  deployment.

Root `npm run db:init`, `npm run db:migrate`, and `npm run db:seed` delegate to
these scripts. `npm run dev` is local development. Final deployment runs
`npm start` only after migrations; it builds/serves frontend assets through the
deployment's static host or reverse proxy. Scripts do not run automatically when
the API starts.

## Request pipeline

Every HTTP request enters `server/src/index.js`. It enables JSON parsing,
CORS for `CLIENT_ORIGIN`, and cookie parsing, then mounts routes below `/api`.
Routes are intentionally thin: they select a controller in `server/src/routes/`.
`authMiddleware.js` verifies the `shopsphere_token` JWT, reloads the user and
role from PostgreSQL, rejects disabled users or stale token versions, and checks
the required role. Controllers validate every body/path value with
`utils/input.js`, use parameterized `pg` queries, and return JSON. Errors reach
`errorMiddleware.js`, which maps validation, PostgreSQL constraint, trigger and
duplicate errors to safe HTTP responses.

`config/db.js` owns the shared `pg.Pool`. For multi-write operations,
`utils/transaction.js` supplies a client, issues `BEGIN`, commits only if the
callback succeeds, rolls back on every error, and releases the client. This is
the boundary that prevents a half-created account, order, master product or
  purchase/listing pair.

## Database model, query modules, and rules

`schema.sql` is the authoritative database definition.

`docs/SCHEMA.md` is **generated** from it by `npm run docs:schema` (`python3
scripts/document-schema.py`) — no database needed, it parses the `CREATE TABLE` statements
directly. Nothing runs it automatically, so it is stale the moment `schema.sql` changes:
after editing the schema or adding a migration that alters it, rerun the script. Its
preamble is hand-written and lives in the script itself, which is the part to update when a
rule changes; the table and ERD sections are derived and must not be edited in the output.

- Identity/access: `users` references `roles`, and the role name is what every
  guard checks. There is no permission table: `permissions` and
  `role_permissions` were seed-only data that no code consulted, so
  `009_drop_permissions.sql` removed them rather than leave a table that reads
  like an authorization model and is not one. Authorization is `requireRole`
  on a mounted router — a check per role, never per capability.
  A user owns shops and carts/wishlists/orders/reviews.
- Addresses: `locations` references `countries`. Users and shops point to an
  address. Profile changes insert a fresh location, so old order addresses stay
  historically accurate.
- Catalog: `categories` may have a parent; `attributes` defines reusable keys;
  `category_attributes` makes a key required for one category; `master_products`
  holds admin-managed product facts; `attribute_values` stores its values.
  `products` is a shop's sellable listing of one master product.
- Commercial data: `shop_purchases` snapshots wholesale quantities/prices and
  `product_reviews` has one row per `(user_id, prod_id)`; `shop_reviews` does the
  same for a shop. `orders`, `order_items` and `payments` are live: checkout
  claims stock, writes the order and its items, records each line's platform
  commission, and records a `pending` cash-on-delivery payment. `vendor_refunds`
  is the ledger of what the platform paid vendors for stock it withdrew. See
  [`ORDERS_AND_PAYMENT.md`](ORDERS_AND_PAYMENT.md) for the order flow and
  [`REFUNDS_AND_READ_SURFACES.md`](REFUNDS_AND_READ_SURFACES.md) for the money
  rules.

Foreign keys, `NOT NULL`, checks, primary keys and `NUMERIC(12,2)` protect basic
integrity. Important PostgreSQL triggers add business rules:

- protected tables cannot be hard-deleted; catalog/listing removal is a status
  change, preserving history, **plus a compensating refund** — a listing removed
  by an admin is discontinued and the vendor is paid for the stock they still
  hold, in one transaction, with a `vendor_refunds` row as the record. See
  [`REFUNDS_AND_READ_SURFACES.md`](REFUNDS_AND_READ_SURFACES.md);
- removing a master product refunds every shop holding a listing of it, and
  `products.in_stock` is zeroed for the removed stock: it has been paid for, so
  it is no longer inventory, and a restock cannot be refunded twice;
- disabling a user disables owned shops and delivery availability; disabling a
  shop discontinues its listings. `trg_enable_user_dependents` runs the shop half
  of that cascade back the other way, so re-enabling a user restores their shops
  to `active`. Their listings stay discontinued: a vendor relists on purpose. The
  same trigger deliberately does not touch `delivery_personnel`, because disabling
  a courier sets them `unavailable`, which releases in-flight orders — returning
  them to `available` automatically would put them back on duty without opting in;
- `shops.active_status` accepts `active`, `disabled` and `pending`. The column
  default stays `active` so seeded and directly inserted rows are live; the vendor
  path writes `pending` explicitly, and only an administrator may move a shop to
  any status. `products.in_stock` and the other status columns are unaffected;
- order triggers are active and carry the checkout rules:
  `trg_order_items_recalc_total` owns `orders.total_amount`;
  `fn_guard_order_transition` allows only `pending → shipped|cancelled` and
  `shipped → delivered|pending`; `fn_cleanup_cancelled_order` returns the stock,
  fails the pending payment **and voids the order's platform commission** —
  a cancelled order must not keep reporting a margin it never earned;
  `fn_release_orders_on_personnel_unavailable` unassigns a courier's in-flight
  orders when they go unavailable;
- deferred category-value triggers reject an available master product lacking a
  required attribute at transaction commit;
- `trg_verify_product_review_purchase` rejects direct SQL INSERT **and UPDATE**
  of a product review unless that customer has a delivered order containing that
  exact listing. `trg_verify_shop_review_purchase` does the same for a
  `shop_reviews` row against any listing from that shop. In both cases the API
  eligibility check is convenience only; the trigger is the database enforcement.

All SQL text lives under `server/src/queries/`; controllers only validate,
authorize, sequence transactions, and choose a response. For example,
`adminCatalogController.js` uses `adminCatalogQueries.js`; admin moderation uses
`adminQueries.js`; money and refund reads use `paymentQueries.js`; shop reviews
use `shopReviewQueries.js`; vendor, profile, review, role, cart, wishlist, auth
and catalog use the equivalent query modules.
All request values are bound through `$1`, `$2`, etc., never concatenated into
SQL text.

`utils/sql.js` holds `escapeLikePattern`, the single implementation of the `%`/`_`/`\`
escaping every `ILIKE ... ESCAPE '\'` search relies on, shared by the catalog and
admin query builders so there is only one copy to keep correct.

`utils/listQuery.js` holds `parseListQuery` and `paginated`, the two halves every
paged list shares: a closed set of filter values joined to a free-text `q`, and a
`COUNT(*) OVER()` result turned into `{ items, total, page, limit, total_pages }`.
Users, shops, products, payments and refunds all go through it, so a bad filter
gets the same `400` and the same message wherever it is sent.

## Which role may read which table

Every read surface keys its subject on the session — no endpoint accepts a
`user_id` or `shop_id` from the caller to decide whose data to return. The full
table, with what each role deliberately cannot see and why, is in
[`REFUNDS_AND_READ_SURFACES.md`](REFUNDS_AND_READ_SURFACES.md).

## Endpoint behavior and source ownership

All paths below begin with `/api`. `401` is no valid session, `403` is an
authenticated wrong role, `400` is invalid input, `404` is missing/non-owned
data, and `409` is a business-rule or trigger conflict.

| Route group | Controller and database behavior | Relevant browser page |
| --- | --- | --- |
| `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /auth/me` | `authController.js` looks up roles, hashes passwords with bcrypt, writes location/user/delivery rows atomically, signs/revokes JWT cookies. Logout increments `users.token_version`, invalidating copied older tokens. | Register/sign-in |
| `GET /profile`; `PUT /profile` | `profileController.js` reads the user/role/location join. Update creates a location, updates only self-owned contact fields, and updates delivery vehicle data only for delivery users. | Account settings |
| `GET /products`, `/products/:id`, `/categories`, `/shops`, `/roles`, `/health` | `catalogController.js` runs read-only SQL from `queries/catalogQueries.js`. Retail product reads join listing/shop/master/category and exclude discontinued/disabled/unavailable rows. | Products/details |
| Customer cart/wishlist endpoints | `cartController.js` and `wishlistController.js` use the session user ID, never a submitted user ID. Cart writes confirm listing availability and stock. | Cart/wishlist |
| Vendor shops/listings/purchases | `vendorController.js` checks shop ownership from JWT. Buying checks the selected shop and master, records a wholesale price snapshot, then creates or restocks the listing in one transaction. A vendor may only edit retail price, seller Markdown description, and listing status; master facts are fetched from SQL. Shop status is not accepted from this path at all: create writes `pending` and update never touches the column. | My shops / Buy & list |
| `GET /admin/users`, `PUT /admin/users/:userId/status`, `GET /admin/shops`, `PUT /admin/shops/:shopId/status` | `adminController.js` reads paged, filtered lists from `adminQueries.js` (`COUNT(*) OVER()` plus `LIMIT`/`OFFSET`, via `utils/listQuery.js`) and moves a user or shop between statuses. A user status write also bumps `token_version`, killing that user's live sessions. Approving a pending shop is the same shop-status write with `active`. Disabling your own account is refused with 409. | Administration console |
| `GET /admin/payments`, `GET /admin/refunds` | `paymentController.js` reads `paymentQueries.js`: every payment joined to its order and customer with that order's `platform_commission` beside it, and every `vendor_refunds` row with its shop, listing, reason and the acting administrator. Both paged and filterable from closed sets. Admin only — these are the two surfaces a vendor's own books are a slice of. | Console → Payments / Refunds |
| `GET /vendor/payments` | `paymentController.js` returns the caller's books: sales of their own listings (`net_to_shop` per line, **without the buyer's name or email**), their wholesale purchases, refunds they have received, their shops' `earnings`, and totals. Scoped to owned shops from the JWT; no shop ID is accepted. | Vendor → Payments |
| `GET /account/payments` | `paymentController.js` returns the caller's own payments. The platform's commission is not in the response at all, so there is nothing on the page to hide. | Account → Payment history |
| Admin catalog/attributes/categories/masters; `PUT /admin/listings/:prodId/discontinue`; `DELETE /admin/master-products/:masterId` | `adminCatalogController.js` saves catalog edits in transactions. Category required keys are stored in `category_attributes`; master values in `attribute_values`. The product form can add a name/value attribute pair during save. Master updates synchronize listing name/image but intentionally leave seller descriptions alone. Both removals are the soft discontinue **plus** the LIFO vendor refund described in [`REFUNDS_AND_READ_SURFACES.md`](REFUNDS_AND_READ_SURFACES.md), in one transaction, answering 409 if the listing was already removed. | Manage catalog / Console → Shops |
| Product reviews; `GET /shops/:shopId/reviews`; `GET/PUT/DELETE /shops/:shopId/review` | `reviewController.js` and `shopReviewController.js` derive reviewer identity from JWT. They expose public reviews, check historical delivery eligibility, and upsert/delete only the caller's row. The database triggers independently verify purchase eligibility. A customer becomes eligible once an order containing that listing — or from that shop, for a shop review — has been delivered. | Product details / Order detail |
| `POST /orders`; `GET /orders`, `/orders/:orderId`; `PUT /orders/:orderId/cancel` | `orderController.js` reads the session user's cart, claims each line's stock with one conditional `UPDATE` per line inside a single transaction, creates the order, its items with their per-line platform commission, a `pending` cash-on-delivery payment and a courier assignment, then empties the cart. A line that sold out mid-checkout returns `409` and rolls the whole order back. Cancel is a compare-and-set on `pending`. | Checkout / My orders |
| `GET /delivery/deliveries`; `PUT /delivery/orders/:orderId/status` | `orderController.js` lists the courier's `pending` and `shipped` orders with their items, and moves one between statuses. Marking an order delivered also completes its cash payment, stamps `paid_at`, and credits the courier `COURIER_BASE_FEE + COURIER_RATE × total_amount` to `delivery_personnel.earnings`. The compare-and-set in the status update is what makes that happen exactly once. | Current deliveries |

There are deliberately no `/admin/orders` or `/admin/couriers` endpoints.
Administration of orders is not a feature; a shop's own sales are visible through
its listings, and delivery is dispatched automatically at checkout. A cart does
not reserve stock: placing the order is what claims it.

## Catalog write sequence

1. Admin calls `POST /admin/attributes` to create a reusable attribute key.
2. Admin calls `POST` or `PUT /admin/categories` with
   `required_attributes: [{ attribute_id, default_value }]`. The controller
   replaces that category's `category_attributes` rows. If a new requirement is
   applied to existing masters, `default_value` fills missing values; deferred
   trigger validation blocks an incomplete available catalog.
3. Admin calls `POST` or `PUT /admin/master-products` with core master fields,
   `attributes: [{ attribute_id, attrib_value }]`, and optional
   `additional_attributes: [{ name, value }]`. Required category values are
   mandatory. The server validates supplied IDs and creates each additional
   attribute with its value in the same transaction.
4. Vendor calls `GET /vendor/master-products`, sees read-only master facts,
   then `POST /vendor/listings` with only shop ID, master ID, quantity, retail
   price and seller description. Forged category/name/wholesale fields are not
   used by the controller.

## Inspecting requests in the browser

Open DevTools → **Network** → **Fetch/XHR**, enable Preserve log, then submit a
form. The request's Headers show method/path/status, Payload shows submitted
JSON, and Response shows database-backed result/message. Initiator identifies
the frontend caller; then trace the route/controller names above.

For a vendor purchase, inspect `POST /api/vendor/listings` followed by refreshed
`GET /api/vendor/listings` and `/api/vendor/purchases`; compare returned stock
and recorded wholesale price. For a review, inspect eligibility then `PUT
/api/products/:id/review`; it returns `409` without a qualifying historical
delivery. Application → Cookies shows the HTTP-only session cookie (its content is
not available to page JavaScript). Server exceptions and PostgreSQL errors are
logged in the Express terminal, while the browser receives the sanitized JSON
error from `errorMiddleware.js`.
