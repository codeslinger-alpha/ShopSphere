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

- Identity/access: `users` references `roles`; `role_permissions` is retained
  as schema data, while route middleware enforces the implemented permissions.
  A user owns shops and carts/wishlists/orders/reviews.
- Addresses: `locations` references `countries`. Users and shops point to an
  address. Profile changes insert a fresh location, so old order addresses stay
  historically accurate.
- Catalog: `categories` may have a parent; `attributes` defines reusable keys;
  `category_attributes` makes a key required for one category; `master_products`
  holds admin-managed product facts; `attribute_values` stores its values.
  `products` is a shop's sellable listing of one master product.
- Commercial data: `shop_purchases` snapshots wholesale quantities/prices and
  `product_reviews` has one row per `(user_id, prod_id)`. `orders`,
  `order_items`, and `payments` remain as inactive historical/future schema;
  there is no checkout or order-processing API at this time.

Foreign keys, `NOT NULL`, checks, primary keys and `NUMERIC(12,2)` protect basic
integrity. Important PostgreSQL triggers add business rules:

- protected tables cannot be hard-deleted; catalog/listing removal is a status
  change, preserving history;
- disabling a user disables owned shops and delivery availability; disabling a
  shop discontinues its listings;
- legacy order triggers remain inactive because no endpoint writes orders;
- deferred category-value triggers reject an available master product lacking a
  required attribute at transaction commit;
- `trg_verify_product_review_purchase` rejects direct SQL INSERT **and UPDATE**
  of a product review unless that customer has a delivered order containing that
  exact listing. The API eligibility check is convenience only; the trigger is
  the database enforcement.

All SQL text lives under `server/src/queries/`; controllers only validate,
authorize, sequence transactions, and choose a response. For example,
`adminCatalogController.js` uses `adminCatalogQueries.js`; vendor, profile,
review, role, cart, wishlist, auth and catalog use the equivalent query modules.
All request values are bound through `$1`, `$2`, etc., never concatenated into
SQL text.

## Endpoint behavior and source ownership

All paths below begin with `/api`. `401` is no valid session, `403` is an
authenticated wrong role, `400` is invalid input, `404` is missing/non-owned
data, and `409` is a business-rule or trigger conflict.

| Route group | Controller and database behavior | Relevant browser page |
| --- | --- | --- |
| `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /auth/me` | `authController.js` looks up roles, hashes passwords with bcrypt, writes location/user/delivery rows atomically, signs/revokes JWT cookies. Logout increments `users.token_version`, invalidating copied older tokens. | Register/sign-in |
| `GET /profile`; `PUT /profile` | `profileController.js` reads the user/role/location join. Update creates a location, updates only self-owned contact fields, and updates delivery vehicle data only for delivery users. | My profile |
| `GET /products`, `/products/:id`, `/categories`, `/shops`, `/roles`, `/health` | `catalogController.js` runs read-only SQL from `queries/catalogQueries.js`. Retail product reads join listing/shop/master/category and exclude discontinued/disabled/unavailable rows. | Products/details |
| Customer cart/wishlist endpoints | `cartController.js` and `wishlistController.js` use the session user ID, never a submitted user ID. Cart writes confirm listing availability and stock. | Cart/wishlist |
| Vendor shops/listings/purchases | `vendorController.js` checks shop ownership from JWT. Buying locks shop/master/listing, records a wholesale price snapshot, then creates or restocks the listing atomically. A vendor may only edit retail price, seller Markdown description, and listing status; master facts are fetched from SQL. | My shops / Buy & list |
| Admin catalog/attributes/categories/masters | `adminCatalogController.js` uses transactions plus advisory locks for catalog edits. Category required keys are stored in `category_attributes`; master values in `attribute_values`. Master updates synchronize listing name/image but intentionally leave seller descriptions alone. Delete master is a soft discontinue. | Manage catalog |
| Product reviews | `reviewController.js` derives reviewer identity from JWT. It exposes public reviews, checks historical delivery eligibility, and upserts/deletes only the caller's row. The database trigger independently verifies purchase eligibility. New users cannot become eligible while checkout is disabled. | Product details |

There are deliberately no `/orders`, `/admin/orders`, `/admin/couriers`, or
`/delivery/orders` endpoints. Customers can browse, wishlist, add/update/remove
cart rows, and stop there. A cart does not reserve stock or create payment data.

## Catalog write sequence

1. Admin calls `POST /admin/attributes` to create a reusable attribute key.
2. Admin calls `POST` or `PUT /admin/categories` with
   `required_attributes: [{ attribute_id, default_value }]`. The controller
   replaces that category's `category_attributes` rows. If a new requirement is
   applied to existing masters, `default_value` fills missing values; deferred
   trigger validation blocks an incomplete available catalog.
3. Admin calls `POST` or `PUT /admin/master-products` with core master fields
   and `attributes: [{ attribute_id, attrib_value }]`. Required category values
   are mandatory; optional product-specific pairs are saved in the same values
   table. The client offers an explicit **Add attribute** entry, but the server
   remains authoritative and validates duplicate IDs and all referenced IDs.
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
