# Backend guide

ShopSphere uses **Express 5 + PostgreSQL (`pg`), with parameterized SQL and no ORM**.
All endpoints below start with `/api`. There is no external payment gateway:
checkout records cash on delivery; wholesale purchases, shop recharges and vendor
and customer refunds are internal database records, not online transfers. No card
is charged anywhere in this codebase, and the API says so in the responses that
would otherwise imply one.

Money now balances exactly: **the customer pays the shops' goods plus the
courier's fee, and nothing is withheld in between.** There is no platform
commission. A shop's money column is `shops.balance` — a running total of sales,
top-ups, wholesale purchases and refunds, spendable on stock.

## Request and database flow

`src/index.js` → `routes/*` → authentication/role middleware → `controllers/*`
→ `db/queries/*` → `db/pool.js` or `db/transaction.js` → PostgreSQL.

Routes choose handlers and access rules. Controllers validate input and coordinate
operations. Query modules contain SQL; `$1`, `$2`, etc. bind request values.
Every API mutation uses `transaction(work)` or `transaction.query(sql, values)`,
including single-statement writes. The helper reserves one connection for
BEGIN/work/COMMIT, rolls back on failure, and always releases it. Express forwards rejected async handlers to the
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
| `db/transaction.js` | Explicit BEGIN/COMMIT/ROLLBACK for compound workflows and single-statement writes through `transaction.query`. |
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
| `orderController.js` / `orderQueries.js` | Checkout, history, cancellation and courier delivery. Reads/writes `cart_items`, `products`, `orders`, `order_items`, `payments`, `delivery_personnel`; reads `users`, `shops`, `master_products`, `locations`. Uses the shared location insert for a new shipping address. The courier's pay constants live in this query module and are written onto each order at placement. |
| `profileController.js` / `profileQueries.js` | Country list and current user's profile. Joins `users`, `roles`, `locations`, `countries`, `delivery_personnel`; creates a fresh location when updating an address. |
| `vendorController.js` / `vendorQueries.js` | Owned shops, wholesale purchases, retail listings, the shop balance and recharge, and the income statistics. Writes `shops`, `locations`, `shop_purchases`, `products`, `shop_topups`; debits and credits `shops.balance`; reads available `master_products` and category metadata. |
| `returnController.js` / `returnQueries.js` | Customer returns end to end: the request, the vendor's accept/reject, the courier's collection and the restock. Writes `product_returns`, `customer_refunds` and `products.in_stock`; debits `shops.balance` on approval. |
| `adminController.js` / `adminQueries.js` | Paged user/shop moderation; reads `users`, `roles`, `shops`, `locations`, `products`; changes user/shop status and invalidates user sessions. |
| `adminCatalogController.js` / `adminCatalogQueries.js` | Categories, attributes, master products and listing removal. Writes `categories`, `attributes`, `category_attributes`, `master_products`, `attribute_values`, `products`; attributes remaining stock to `shop_purchases`, writes `vendor_refunds` and credits `shops.balance`. |
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
| `roleRoutes.js` | `GET/POST /returns` | Customer → return |
| `roleRoutes.js` | `GET/POST /vendor/shops`; `PUT /vendor/shops/:id`; `GET/POST /vendor/listings`; `PUT /vendor/listings/:id`; `GET /vendor/purchases` | Vendor → vendor |
| `roleRoutes.js` | `GET /vendor/master-products`; `GET /vendor/payments` | Vendor → adminCatalog / payment |
| `roleRoutes.js` | `GET /vendor/balance`; `POST /vendor/topups` | Vendor → vendor |
| `roleRoutes.js` | `GET /vendor/statistics` | Vendor → vendor |
| `roleRoutes.js` | `GET /vendor/returns`; `PUT /vendor/returns/:id/approve`, `/reject`, `/restock` | Vendor → return |
| `roleRoutes.js` | `GET/PUT /delivery/profile` | Delivery → role |
| `roleRoutes.js` | `GET /delivery/deliveries`; `PUT /delivery/orders/:id/status` | Delivery → order |
| `roleRoutes.js` | `GET /delivery/returns`; `PUT /delivery/returns/:id/collect` | Delivery → return |
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

## Query modules, function by function

Every module in `src/db/queries/` is a list of exported SQL strings or small
builders. Nothing here decides access rules — that is the route's job — but every
module does enforce *scope* inside its SQL: the caller's own ID is a predicate,
never merely a filter applied to the result.

### `orderQueries.js` — checkout, delivery, cancellation

| Export | What it does |
| --- | --- |
| `COURIER_BASE_FEE`, `COURIER_RATE` | The only place the courier's pay is defined: a flat `3` plus `0.02` of the goods total. Applied at placement and **stored on the order**, so editing these changes future orders only and never re-prices one already placed. |
| `CART_FOR_ORDER` | Locks the customer's cart rows (`FOR UPDATE OF c`) in product-ID order and returns quantity, name, price and current stock. The lock is what stops two concurrent checkouts buying the same cart twice; the ordering gives every checkout the same lock order, so two orders cannot deadlock against each other. |
| `CLAIM_STOCK` | Decrements stock inside the `UPDATE` predicate — `in_stock >= $2` and the listing, shop and master are all sellable. There is no read-then-write gap, so an oversell is impossible even under concurrency. `rowCount = 0` means somebody else got the last unit. |
| `CLAIM_FAILURE_DETAIL` | Read only after a claim fails, to say *which* rule refused it (out of stock, discontinued, shop disabled, master withdrawn). Read at READ COMMITTED, so it sees the winner's committed state. |
| `FIND_AVAILABLE_COURIER` | The active, available courier with the fewest open orders; the ID breaks ties. An `LEFT JOIN` on open orders counts the load rather than filtering couriers out. |
| `CREATE_ORDER` | Inserts the order row. `total_amount` is left to the trigger. No courier found means `delivery_person_id` is `NULL` and the order waits for an administrator. |
| `CREATE_ORDER_ITEM` | Freezes the price read during checkout onto the line, which is what makes a later price change irrelevant to this order. |
| `RECORD_DELIVERY_COST` | `UPDATE orders SET delivery_cost = ROUND(base + rate * total_amount, 2)`. It runs **after** the items, because it is a share of `total_amount` and that is still 0 until `trg_order_items_recalc_total` has fired. |
| `ORDER_TOTALS` | Reads `fn_order_subtotal(order_id)` back as the authoritative total once the trigger has run. |
| `CREATE_PAYMENT` | Creates the single cash-on-delivery payment for `total_amount + delivery_cost`. `paid_at` is set explicitly to `NULL`; the column default would date a pending payment as paid the moment it was created. |
| `CLEAR_CART` | Deletes only the cart rows that were purchased (`prod_id = ANY($2)`), so products added after the checkout snapshot survive. |
| `USER_PROFILE_ADDRESS` | Fallback shipping address when the customer does not type one. |
| `LIST_ORDERS_BY_USER`, `GET_ORDER_BY_USER` | Order history and one order, composed from the shared `ORDER_SUMMARY_*` projection and scoped by `o.user_id = $1`. |
| `GET_ORDER_ITEMS` | The lines of one order with their listing and shop, for the detail page. |
| `CANCEL_ORDER` | `SET order_status = 'cancelled' WHERE order_id = $1 AND user_id = $2 AND order_status = 'pending'`. The status is in the predicate so two cancels racing cannot both restore stock: `fn_cleanup_cancelled_order` fires only on the transition that actually happens. |
| `GET_ORDER_STATUS` | Read after a failed `CANCEL_ORDER`, to tell "not yours" from "already moved on". |
| `SHIP_ORDER` | The courier's guarded start: `pending → shipped`, for this courier only. |
| `LIST_DELIVERIES_FOR_COURIER` | The courier's own live run, with customer name and phone — details a courier needs and a vendor deliberately does not get. |
| `SETTLE_DELIVERY` | `CALL settle_delivery($1, $2, NULL)`. The whole multi-table completion lives in the database; see the PL/pgSQL section. |
| `GET_ITEMS_FOR_ORDERS` | Every parcel on the run in one round trip (`order_id = ANY($1)`), rather than one query per order. |
| `GET_ASSIGNED_ORDER` | Read only after `SHIP_ORDER` matches nothing, to distinguish "not your order" from "already shipped". |

### `vendorQueries.js` — shops, buying stock, the balance

| Export | What it does |
| --- | --- |
| `LIST_OWNED_SHOPS`, `OWNED_SHOP`, `ACTIVE_OWNED_SHOP` | A vendor's shops; one shop by ownership; one shop that is additionally `active`. The three exist because different operations need different proof. |
| `CREATE_SHOP` | A new shop is inserted with `active_status = 'pending'`. Every catalog query requires `'active'`, so a pending shop is invisible to the storefront until an administrator approves it. |
| `UPDATE_SHOP` | Edits the shop's own fields. `active_status` is not in the `SET` list — shop status is administrator-only, so a vendor can neither approve their own shop nor undo a ban. |
| `LIST_OWNED_LISTINGS`, `UPDATE_OWNED_LISTING`, `CREATE_LISTING`, `RESTOCK_LISTING`, `LISTING_FOR_MASTER` | The vendor's retail listings, joined to master and category. `LISTING_FOR_MASTER` picks the vendor's existing listing of a master, because a purchase restocks that listing rather than creating a second one. |
| `AVAILABLE_MASTER` | The master being bought, only if its `active_status = 'available'`. |
| `CREATE_PURCHASE` | Records the wholesale acquisition with `quantity × wholesale_unit_price`. A ledger row, not an order. |
| `DEBIT_SHOP_BALANCE` | `SET balance = balance - $2 WHERE shop_id = $1 AND owner = $3 AND balance >= $2`. The funds test is **part of the predicate**, not a read followed by a check: two purchases racing cannot both pass and overdraw the shop, because the second waits on the row lock and then re-tests the committed balance. `rowCount = 0` becomes a 409. |
| `CREDIT_SHOP_BALANCE`, `CREATE_TOPUP` | A recharge, in two statements in one transaction: the balance moves and the ledger row that explains it is written. No gateway is involved, so these two are the whole of it. |
| `SHOP_BALANCE` | One shop's balance for the recharge page, cast to `numeric(12,2)` so the driver's string comes back at two decimals. |
| `LIST_SHOP_MOVEMENTS` | The statement of movements: a `UNION ALL` over five sources — `sale` (+), `purchase` (−), `topup` (+), `admin_refund` (+) and `customer_return` (−) — told apart by `kind` so one list can be rendered rather than two interleaved by hand. Sales are read from `order_items` grouped by delivered order, which is exactly when `settle_delivery` credits the balance. |
| `LIST_OWNED_PURCHASES`, `LIST_OWNED_LISTINGS` | Supporting reads for the vendor workspace. |

### `returnQueries.js` — customer returns

The file's header states its two rules: **scope** is a predicate on the caller's
own ID (there is no parameter in which to ask about another party), and **every
state change is a compare-and-set** whose starting status is in the `UPDATE`
predicate, so `rowCount = 0` means "somebody else already did this" and the
controller reports 409.

| Export | What it does |
| --- | --- |
| `RETURN_COLUMNS`, `RETURN_JOINS` | The shared projection, so the customer, vendor and courier surfaces describe a return identically and a field cannot go missing from one of them. |
| `LIST_RETURNS_FOR_CUSTOMER` | The caller's own returns, newest first. |
| `LIST_RETURNS_FOR_VENDOR` | Returns against shops the caller owns — by ownership, not by a shop ID the caller supplied. |
| `LIST_RETURNS_FOR_COURIER` | The pickup list: `status = 'approved'`, with the collection address and the customer's phone. Deliberately not restricted to the courier who delivered the order. |
| `GET_CUSTOMER_RETURN` | One return, scoped to the customer, for the sentence a refusal gets. |
| `RETURNABLE_LINE` | The order line a request is about, with the listing, shop and order status. The delivered test is repeated in `fn_check_return_quantity`, which is the enforcement; this read exists only to say *why*. |
| `CREATE_RETURN` | `INSERT ... SELECT` from `order_items`, computing `refund_amount` from the line's stored price. The customer's own figure for what they are owed is not a field, because it is not evidence of anything. |
| `APPROVE_RETURN` | `requested → approved`, with shop ownership in the predicate. **This is the transition that debits the balance and writes the refund**, and therefore the one that must happen exactly once. |
| `REJECT_RETURN` | `requested → rejected`. Moves no money and no stock: the customer keeps the goods and is owed nothing. It exists so the vendor has an answer that is not silence, and so the customer can ask again. |
| `COLLECT_RETURN` | `approved → collected`, guarded on the courier's *account* being active rather than on their availability — a courier on another delivery is still allowed to pick this up, and refusing them would only stall the return. |
| `MARK_RESTOCKED` | `collected → restocked`, guarded on 'collected' so a return cannot be restocked twice, and on shop ownership so only the shop that sold it can relist it. |
| `RESTOCK_PRODUCT` | `in_stock = in_stock + $2` for the returned units. A separate statement from `MARK_RESTOCKED`, because the guard belongs to the return's own row and the increment to another table. |
| `CHARGE_SHOP_BALANCE` | `balance = balance - $2` with **no funds test**. Deliberately different from the wholesale-purchase debit: a vendor must not be able to escape a customer's refund by having spent the money, so this one is allowed to take the balance negative. The two are separate constants so the difference is legible. |
| `CREATE_CUSTOMER_REFUND` | The `customer_refunds` row: shop → customer, the opposite direction of money from `vendor_refunds`. |

### `statisticsQueries.js` — vendor income

Header rule: scope is the caller's own ID, and "revenue" means **delivered**
revenue, because the balance is credited by `settle_delivery` and only then. A
return does not erase the sale that happened, so the delivered series keeps the
original line and refunds are read separately and shown beside it.

| Export | What it does |
| --- | --- |
| `PERIODS` | `["day", "week", "month"]`, the closed set the controller checks `group_by` against. |
| `DELIVERED_REVENUE_BY_PERIOD` | Units, revenue and distinct orders per bucket. `date_trunc` takes its field as a **bound parameter** (`$2`), so the period never becomes string-stitched SQL. The bucket comes back as the date it starts, because a label like `2026-W31` is not sortable. |
| `CUSTOMER_REFUNDS_BY_PERIOD` | Refunds bucketed the same way, read from `customer_refunds` rather than from the returns: a return requested one day and accepted another belongs in the bucket where the money moved. |
| `TOP_LISTINGS` | The ten listings that earned the most, best first — a leaderboard is bounded by definition. |
| `OWNED_RECONCILIATION` | The same figures the balance is built from, in scalar subqueries: delivered revenue, units, orders, recharged, wholesale spend, refunded to customers, refunds received, balance now. |

### The remaining modules

| Module | Exports |
| --- | --- |
| `paymentQueries.js` | `LIST_OWNED_PAYMENTS` (a customer's own payments), `LIST_OWNED_SALES` (a sale per line, with the customer's name deliberately **absent** — the courier delivers, so a vendor has no use for it and a marketplace that hands sellers their buyers' identities leaks them), `LIST_OWNED_REFUNDS`, `LIST_OWNED_BALANCES`, `OWNED_TOTALS`, the `PAYMENT_STATUSES`/`PAYMENT_METHODS`/`REFUND_REASONS` closed sets that mirror the table `CHECK` constraints, and the two builders `buildPaymentListQuery`/`buildRefundListQuery`. Totals are computed in the database, not by summing the lists, because those lists are unbounded and a page that summed whatever it loaded would disagree with itself as the window moved. Cancelled orders are excluded from every figure. |
| `adminCatalogQueries.js` | The catalog-admin surface. `REFUND_ATTRIBUTION` is the interesting one: LIFO cost attribution over `shop_purchases`, newest first, consuming `in_stock` against each purchase row to say what the remaining stock actually cost, with units that have no purchase record falling back to the master's current wholesale price. It takes an array of `prod_id`s so the same SQL serves both the payment and the console's preview, which is what stops a preview drifting from the payment. `DISCONTINUE_LISTING` puts `discontinued = false` in the predicate so two administrators clicking at once cannot both refund. `PAID_OUT_LISTING` zeroes `in_stock` after paying for it — without that, a later restock would add to units already refunded once and the next removal would pay for them a second time. `MASTER_LISTINGS_WITH_STOCK` takes `FOR UPDATE` to hold those rows until `PAID_OUT_LISTING` runs. `CREATE_VENDOR_REFUND` derives `unit_amount` from the total rather than accepting it. `CREDIT_SHOP_BALANCE` puts the admin refund into the same balance the shop spends from. |
| `cartQueries.js` | `GET_CART_BY_USER_ID`, `GET_CART_ITEM_BY_PRODUCT_ID`, `ADD_CART_ITEM`, `UPDATE_CART_ITEM`, `DELETE_CART_ITEM`. Cart rows carry a quantity only; price and availability are read from the listing at display time, and nothing in the cart reserves stock. |
| `wishlistQueries.js` | `GET_WISHLIST_BY_USER_ID`, `ADD_WISHLIST_ITEM`, `DELETE_WISHLIST_ITEM`, `WISHLIST_ITEM_EXISTS`, `PRODUCT_EXISTS`. The existence checks are what make a save idempotent instead of a duplicate-key error. |
| `catalogQueries.js` | `CHECK_DATABASE_CONNECTION`, `GET_PRODUCT_BY_ID`, `GET_MASTER_ATTRIBUTE_VALUES`, `LIST_CATEGORIES`, `LIST_ROLES`, `LIST_SHOPS`, and `buildProductListQuery`/`buildProductFacetsQuery`, which assemble the filtered, sorted, paged catalog search and its facet counts from validated inputs. |
| `adminQueries.js` | `SHOP_STATUSES`, `USER_STATUSES`, `FIND_SHOP_BY_ID`, `UPDATE_SHOP_STATUS`, `UPDATE_USER_STATUS`, `buildShopListQuery`, `buildUserListQuery`. Status changes bump `users.token_version`, so a ban takes effect on the next request rather than when the JWT expires. |
| `authQueries.js` | `FIND_AUTH_USER_BY_ID`, `FIND_USER_BY_EMAIL`, `FIND_ROLE_BY_NAME`, `CREATE_USER`, `CREATE_LOCATION`, `CREATE_DELIVERY_PERSONNEL`, `COUNTRY_EXISTS`, `INCREMENT_TOKEN_VERSION`. `FIND_AUTH_USER_BY_ID` is the authentication middleware's per-request user load; `CREATE_LOCATION` is shared with checkout and profile updates. |
| `profileQueries.js` | `LIST_COUNTRIES`, `PROFILE`, `UPDATE_PROFILE`, `UPDATE_DELIVERY_VEHICLE`. A profile write takes no explicit row lock: `UPDATE_PROFILE` locks the user's row itself, so a lock read before it would only be held longer. |
| `reviewQueries.js`, `shopReviewQueries.js` | `UPSERT_REVIEW`/`UPSERT_SHOP_REVIEW`, `GET_OWN_REVIEW`/`GET_OWN_SHOP_REVIEW`, `DELETE_OWN_REVIEW`/`DELETE_OWN_SHOP_REVIEW`, `LIST_PRODUCT_REVIEWS`/`LIST_SHOP_REVIEWS`, `REVIEW_ELIGIBILITY`/`SHOP_REVIEW_ELIGIBILITY`. The eligibility reads mirror the database triggers, so the UI can say why a button is absent; the trigger is still the enforcement. |
| `roleQueries.js` | `GET_DELIVERY_PROFILE`, `UPDATE_DELIVERY_PROFILE` — a courier's own availability and vehicle. |

## Controllers, handler by handler

Controllers validate input, decide the order of writes, and translate "the
database said no" into a status code. They do not contain SQL.

### `authController.js`

- `register` — validates the account, resolves the role, inserts the location and
  the user, and creates `delivery_personnel` when the role is `delivery`. An
  administrator creating staff reuses this same handler through `/api/admin/users`.
- `login` — verifies the bcrypt hash, refuses a disabled account, and signs the
  JWT into the HTTP-only cookie.
- `logout` — clears the cookie and increments `users.token_version`, which
  invalidates every other session that user holds.
- `me` — the current user and role, from the middleware's already-loaded record.

### `catalogController.js`

`listProducts`, `listProductFacets`, `getProduct`, `listCategories`, `listShops`,
`listRoles` and `healthCheck`. The first two build their SQL from validated
filters; the rest are single reads. All are public, and every one of them requires
the listing's shop to be active and its master available, so a pending or disabled
shop's stock is not merely hidden in the UI but absent from the query.

### `cartController.js` and `wishlistController.js`

`getCart`, `addCartItem`, `updateCartItem`, `removeCartItem` and
`getWishlist`, `addWishlistItem`, `removeWishlistItem`. Each mutation checks the
listing is sellable before touching the row, and every write is scoped to the
session's user ID. Adding an existing cart item adds to its quantity rather than
inserting a second row.

### `orderController.js`

- `placeOrder` — the compound checkout. It reads the user's address (or the one
  supplied), locks the cart, claims stock line by line in product order, inserts
  the order, its items, the delivery cost and the payment, then deletes only the
  purchased cart rows. Any failure rolls the whole thing back, so there is no
  half-placed order. Assigning a courier happens in the same transaction.
- `listOrders`, `getOrder` — the customer's history and one order, both scoped by
  `user_id`.
- `cancelOrder` — `CANCEL_ORDER`, then a read to distinguish "not yours" from
  "already cancelled". The stock restore and payment failure are the trigger's
  job, not the controller's.
- `listDeliveries` — the courier's own run, plus a second query for every parcel
  on it, so the page loads in two round trips regardless of order count.
- `advanceDelivery` — `pending → shipped` through `SHIP_ORDER`, or
  `shipped → delivered` through `CALL settle_delivery`. Both are compare-and-set;
  `rowCount = 0` becomes a 409 after a read explains which case it was.

### `vendorController.js`

- `shops`, `saveShop` — list and create/update the vendor's own shops.
- `listings`, `updateListing` — the vendor's retail listings.
- `buy` — the wholesale purchase. Resolves the active owned shop, the available
  master and the existing listing, then **debits the balance and records the
  purchase in one transaction**, refusing with a 409 when the balance cannot cover
  it. The success message says no online payment was charged, because none was.
- `purchases` — the vendor's acquisition history.
- `balance` — one shop's balance *and* the movements behind it, in one response.
- `topUp` — validates a positive amount, credits the balance and writes the
  `shop_topups` ledger row. The response states plainly that no card was charged.
- `statistics` — validates `group_by` against `statisticsQueries.PERIODS` (400
  otherwise), runs the four statistics queries with `Promise.all`, and merges the
  revenue and refund series into one list keyed by period so a month with sales and
  no refunds still shows a zero rather than a gap.

### `returnController.js`

- `request` — reads the order line, then inserts the return; the refund amount is
  computed by the database. A duplicate open request is refused by the partial
  unique index and surfaces as a 409 through the error handler.
- `mine`, `forVendor`, `forCourier` — the three scoped lists.
- `approve` — `APPROVE_RETURN`, then, in the same transaction, charges the shop's
  balance and writes the `customer_refunds` row. Money moves here because this is
  where the obligation is accepted.
- `reject` — `REJECT_RETURN`, with a required note: a decline without a reason is
  a 400, because the customer is entitled to know why.
- `collect` — `COLLECT_RETURN` for the signed-in active courier.
- `restock` — `MARK_RESTOCKED`, then `RESTOCK_PRODUCT`. Goods move here, not at
  collection, because until the parcel is physically back the shop cannot sell it
  again.

Every refusal in this controller is a 409, because every one of them means the
return is not in the state the caller assumed.

### `paymentController.js`

`accountPayments` (a customer's own), `vendorPayments` (sales, purchases, refunds
and balances in one response — four round trips to build one page is three more
than it needs), and the admin `listPayments` / `listRefunds`. All four read; none
writes.

### `adminController.js` and `adminCatalogController.js`

`listUsers`, `listShops`, `updateUserStatus`, `updateShopStatus` for moderation,
and the catalog surface: `listMasters`, `availableMasters`, `metadata`,
`createAttribute`, `saveCategory`, `deleteCategory`, `saveMaster`, `deleteMaster`,
`removeListing`, `listShopListings`.

`removeListing` is the one with money in it. It locks the listing's rows, computes
the refund with `REFUND_ATTRIBUTION`, discontinues the listing, zeroes its stock,
writes the `vendor_refunds` row and credits the shop — all in one transaction.
`deleteMaster` does the same for every listing of the master. `listShopListings`
merges `LIST_SHOP_LISTINGS` with `REFUND_ATTRIBUTION` so the console can show what
a removal *would* pay: the same SQL that pays it.

### `profileController.js`, `roleController.js`, `reviewController.js`, `shopReviewController.js`

`countries`, `getProfile`, `updateProfile`; `deliveryStatus`,
`updateDeliveryStatus`; and the review pairs `list`/`eligibility`/`save`/`remove`
for products and shops. Both review controllers let the database trigger decide
eligibility and turn its `P0001` into a 409 with the trigger's own sentence, which
is why the message a user sees and the rule the database enforces cannot drift.

## PL/pgSQL programs, program by program

All of these live in `server/sql/schema.sql` and therefore apply to **direct SQL
writes too**, not only to requests through the API. That is the point of putting
them here.

### Functions

| Function | Trigger(s) | What it does |
| --- | --- | --- |
| `fn_order_subtotal(p_order_id)` | — (called by others) | `LANGUAGE SQL STABLE`: the sum of `quantity × unit_price` for one order. Both the recalc trigger and the checkout read use it, so "the total" has one definition. |
| `fn_prevent_delete()` | `trg_prevent_delete_{users, shops, master_products, products, delivery_personnel, orders}` | Raises on any `DELETE`, naming the table and telling the caller to use an `active_status`/`discontinued` flag. History is never hard-deleted. |
| `fn_recalc_order_total()` | `trg_order_items_recalc_total` (AFTER INSERT/UPDATE/DELETE on `order_items`) | Rewrites `orders.total_amount` from `fn_order_subtotal` for the affected order. This is why `RECORD_DELIVERY_COST` must run after the items. |
| `fn_disable_user_on_role_removal()` | `trg_disable_user_on_role_removal` | When `users.user_role` goes from set to `NULL`, the account is disabled in the same statement rather than left role-less and enabled. |
| `fn_discontinue_products_on_shop_disable()` | `trg_discontinue_products_on_shop_disable` | A shop that becomes `disabled` takes all of its listings to `discontinued = true` with it. |
| `fn_release_orders_on_personnel_unavailable()` | `trg_release_orders_on_personnel_unavailable` | A courier going `unavailable` has their `pending` and `shipped` orders unassigned and returned to `pending`, so a delivery cannot be stranded on someone who has stopped working. |
| `fn_cleanup_cancelled_order()` | `trg_cleanup_cancelled_order` | On `→ cancelled`: restores each line's stock to its listing, clears `delivery_person_id`, and fails the pending payment. There is no commission to void — money never left the customer. |
| `fn_disable_user_dependents()` | `trg_disable_user_dependents` | Disabling a user disables the shops they own and takes them off courier duty. |
| `fn_enable_user_dependents()` | `trg_enable_user_dependents` | The reverse, deliberately partial: shops come back to `active`, but **listings stay discontinued** (the vendor consciously relists) and `delivery_personnel` is left alone (couriers set their own availability, and the disable direction may have released their orders). |
| `fn_verify_product_review_purchase()` | `trg_verify_product_review_purchase` | Refuses a product review unless the reviewer is a customer with a **delivered** order containing that listing; also restamps `last_modified`. |
| `fn_verify_shop_review_purchase()` | `trg_verify_shop_review_purchase` | The same rule for a shop: a delivered order containing one of that shop's listings. |
| `fn_check_return_quantity()` | `trg_check_return_quantity` (BEFORE INSERT OR UPDATE on `product_returns`) | Two rules: only a **delivered** order can be returned, and the units returned across all non-rejected requests for one order line cannot exceed the quantity bought. Rejected requests do not count, so a refused customer may ask again. The delivered test is also what makes a return and a cancellation provably disjoint — `CANCEL_ORDER` requires `pending` — so `fn_cleanup_cancelled_order` and the restock can never both fire for the same unit. |
| `fn_guard_order_transition()` | `trg_guard_order_transition` (BEFORE UPDATE on `orders`) | Allows only `pending → {shipped, cancelled}` and `shipped → {pending, delivered}`. Every other status change raises, so a bad transition is impossible even from `psql`. |
| `fn_require_category_values()` | `trg_master_required_values`, `trg_category_required_values`, `trg_attribute_required_values` — all `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` | Every available master product must have a non-blank value for each attribute its category requires. Deferred to commit so a master and its values can be saved in one transaction. Requirements apply to the directly assigned category; there is no inheritance. |

### `settle_delivery(IN p_order_id INT, IN p_courier_id INT, INOUT result JSONB)`

The one real multi-table workflow, called by the delivery API inside
`BEGIN`/`COMMIT`. The guarded transition makes retries safe; a failure rolls back
all four writes.

1. `UPDATE orders SET order_status = 'delivered', delivered_at = now() WHERE
   order_id = … AND delivery_person_id = p_courier_id AND order_status =
   'shipped' RETURNING *`. If nothing matched, the procedure returns an empty
   result immediately and writes nothing — that is the exactly-once guard.
2. Completes the pending payment, dating `paid_at` from the order's own
   `delivered_at` rather than from `now()`.
3. Credits the courier `ROUND(delivered.delivery_cost, 2)` — **the amount the
   customer was charged**, read back from the row rather than recomputed. Editing
   the pay constants in `orderQueries.js` therefore cannot retroactively move money
   on an order already placed.
4. Credits each shop the full subtotal of its own lines, grouped by shop in one
   statement however many shops the order spans. A sale credits the balance when it
   is **delivered**, not when it is placed: an order still in a van is not money the
   shop can spend on stock. There is no commission between the customer's payment
   and the shop, and the delivery charge is the courier's, not the shop's.
5. Builds the JSON result: the delivered order, the payment and the courier's new
   earnings.

### Indexes

`idx_orders_user_status`, `idx_order_items_product`, `idx_products_shop_master`,
`idx_vendor_refunds_shop`, `idx_vendor_refunds_created`, `idx_shop_topups_shop`,
`idx_product_returns_order`, `idx_product_returns_shop`,
`idx_product_returns_courier`, and the partial unique index
`idx_product_returns_open ON product_returns(order_id, prod_id) WHERE status IN
('requested', 'approved', 'collected')`. That last one is what makes an open
request unique per order line while leaving a rejected one free to be re-requested;
the quantity trigger above is what stops the requests that *are* open from adding
up to more than the customer bought.

## Database rules that matter

- **Catalog ownership:** admins own master facts and category requirements;
  vendors own shop listings and retail prices. New vendor shops start `pending`.
  Only active shops with available masters and non-discontinued listings appear
  in the public catalog. Cart contents do not reserve stock.
- **Checkout:** locks the selected cart rows in product-ID order, conditionally
  decrements stock, creates the order/items/delivery cost/payment, then deletes
  only the purchased cart rows. Concurrent checkout cannot purchase those same
  rows twice, and newly added different products remain in the cart. Prices are
  read at checkout; opening the cart does not lock a price. Payment totals are
  added in PostgreSQL using decimal arithmetic.
- **The money:** the customer's payment is `total_amount + delivery_cost`. The
  goods go to the shops and the delivery charge goes to the courier, in full. No
  commission is taken anywhere, and `shops.balance` can be spent on wholesale
  stock at the master's `wholesale_price`.
- **Delivery:** assigns an available courier whose user account is active, or
  leaves the order unassigned. Status changes compare the expected current state.
  Delivery completes the pending cash payment, credits the courier the order's own
  delivery cost, and credits each shop for its lines — all once, in one procedure.
- **Cancellation:** database trigger restores stock, unassigns the courier and
  fails the pending payment. Only pending orders can be cancelled.
- **Returns:** a customer may ask to return any line of a **delivered** order, in
  whole or in part. The vendor accepts or declines. Accepting debits the shop's
  balance and records the refund immediately — the obligation exists from that
  moment, whether or not the money is in the account — and any active courier may
  collect the parcel. Restocking happens when the shop has the goods back, not when
  the courier takes them. Cancellation and return are disjoint: one requires
  `pending`, the other `delivered`.
- **Vendor removal refunds:** admin removal discontinues stock, calculates the
  refund from the newest wholesale purchases first, records the refund, credits
  the shop and zeroes inventory in one transaction. History is preserved.
- **Database enforcement:** triggers prevent hard deletion of historical entities,
  cascade account/shop disabling, release a courier's orders when unavailable,
  recalculate order totals, constrain order transitions, cap return quantities,
  and require delivered purchases for reviews. Deferred category-value triggers
  check required master attributes at commit. These protections also apply to
  direct SQL writes.
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
| `scripts/seed.js` | Loads the demo SQL transactionally under an advisory lock; rejects production mode and preserves matching existing demo rows. |
| `sql/schema.sql` | Complete fresh-database definition: 24 tables, 14 functions, 20 triggers, one procedure, 10 indexes. |
| `sql/test_insert/seed_demo.sql` | Demo countries/roles/accounts/catalog/orders/reviews, purchase history, and the shop funding that makes each seeded balance reconcile with its purchases. |
| `sql/test_insert/seed_extended.sql` | Larger repeatable catalog, accounts, orders, payments, reviews and refunds; loaded after the base seed and composable with it. |
| `tests/schema.integration.test.js` | Verifies the consolidated schema, seed counts, monetary consistency and safe reseeding. |
| `tests/transaction.test.js` | Commit/rollback/release behavior and an audit against pool-level controller writes. |
| `tests/admin.integration.test.js` | Shop approval, account moderation, role guards and list filters. |
| `tests/cart.integration.test.js` | Cart validation/ownership/stock, wishlist behavior and session revocation. |
| `tests/catalog.integration.test.js` | Search, category trees, facets, sorting, paging and invalid filters. |
| `tests/concurrency.integration.test.js` | Independent-connection checkout race and preservation of newly added cart items. |
| `tests/order.integration.test.js` | Checkout rollback/stock/address/payment, cancellation and courier operations. |
| `tests/readSurfaces.integration.test.js` | Courier earnings, the customer's payment being goods plus trip, role-scoped payment reads and shop reviews. |
| `tests/refund.integration.test.js` | Refund attribution, exactly-once removal and admin removal previews. |
| `tests/returns.integration.test.js` | The balance identity, each return transition happening exactly once, the cumulative-quantity cap, and the statistics reconciling with the balance. |
| Root `scripts/dev.js` | Starts client and backend together for development. |
| Root `scripts/document-schema.py` | Generates `docs/SCHEMA.md` from the schema without connecting to PostgreSQL. |

From the repository root: `npm run db:init` for a **new empty database**,
`npm run db:seed` for the original and expanded demo data, `npm run dev:server`
for the API, and `npm test` for regressions. Tests use disposable schemas and need
schema-creation permission. The migration runner and incremental SQL files have
been removed; schema changes now live directly in `schema.sql`. Existing databases
are not rewritten by init and are not automatically upgraded.

`fn_order_subtotal(order_id)` computes historical line totals; both checkout and
the total-maintenance trigger use it. `settle_delivery` groups the delivered
status, payment settlement, courier pay and the per-shop balance credits into one
transaction, called by the delivery controller with the authenticated courier's
ID. Errors roll back the entire workflow.

See [CHECKLIST.md](CHECKLIST.md) for requirement-by-requirement findings and
[DEMO_DATA.md](DEMO_DATA.md) for the expanded fixture and demo credentials.

Detailed references: [schema and ERD](SCHEMA.md), [order/payment rules](ORDERS_AND_PAYMENT.md),
[vendor refunds and returns](REFUNDS_AND_READ_SURFACES.md), [setup and workflows](WEBSITE_FLOW.md).
