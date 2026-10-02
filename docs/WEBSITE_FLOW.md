# ShopSphere website, API and database flow

## Run the application

Use Node.js compatible with the installed Vite release (22.12+ or 24+) and PostgreSQL.
All commands below run from the **repository root**.

1. Run `npm install` once. The root workspace installs both client and server.
2. Copy `server/.env.example` to `server/.env` and fill in your local PostgreSQL
   connection and a random JWT secret. Do not commit `.env`.
3. Create an empty PostgreSQL database using your database tool. Set `DB_NAME` to it.
4. Run `npm run db:init`. The single `server/sql/schema.sql` contains the complete
   schema, constraints, functions, procedure and triggers. Init refuses non-empty
   schemas; incremental migration files and commands have been retired.
5. Run `npm run db:seed` for both the original and expanded demo data. See
   [DEMO_DATA.md](DEMO_DATA.md) for counts and credentials. Existing passwords,
   inventory and balances are preserved; missing demo cart/wishlist rows can be
   replenished. The seed rejects production mode.
6. Run `npm run dev`. Open **http://localhost:5173**. Express runs on port 5000.
   Use localhost consistently for cookie handling. `npm run dev:client` and
   `npm run dev:server` start each side separately.

`client/.env.example` configures `VITE_API_URL` if your API address differs.
The default is `http://localhost:5000/api`. `CLIENT_ORIGIN` on the server must match
where the browser opens the frontend. `npm run build` generates `client/dist`;
`npm start` serves the API only. To preview the build, run
`npm run preview --workspace client -- --port 5173` with the API running.

### Local demo accounts

| Role | Email | Initial password |
| --- | --- | --- |
| Customer | customer@shopsphere.test | CustomerPass123! |
| Second customer | customer2@shopsphere.test | CustomerPass123! |
| Shop owner | vendor@shopsphere.test | VendorPass123! |
| Second shop owner | vendor2@shopsphere.test | VendorPass123! |
| Delivery | delivery@shopsphere.test | DeliveryPass123! |
| Admin | admin@shopsphere.test | AdminPass123! |

These are intentionally public, fictional development accounts. Do not seed a public
production database with them. The seeded first customer has a delivered order and
can already demonstrate product reviews.

## How a request moves through the files

1. `client/src/main.jsx` mounts React, BrowserRouter and AuthProvider.
2. `client/src/App.jsx` selects a page and protects its navigation by role.
3. A page submits through `client/src/api/http.js`. It sends JSON with
   `credentials: 'include'`, interprets error responses and notifies the app of 401s.
4. `server/src/index.js` loads `server/.env`, JSON parsing, CORS and cookie parsing,
   then mounts routes under `/api`.
5. `server/src/middleware/authMiddleware.js` verifies the cookie signature, loads
   the user and role from PostgreSQL, checks active status/token version, and
   enforces the endpoint's permitted role.
6. The route calls its controller. Controllers validate allowed fields and use
   `pg` with raw SQL and `$1`, `$2` parameters. Older domain SQL lives in `queries/`;
   newer feature SQL is next to its controller logic for easy tracing. No ORM is used.
7. `server/src/db/pool.js` provides the shared connection pool.
   `db/transaction.js` manages BEGIN, COMMIT, rollback and connection release.
8. PostgreSQL applies foreign keys, constraints and triggers. Express sends JSON,
   and the page displays results or an accessible error/status message.

### The interface shell

Dark is the default theme; the header toggle switches to light and the choice is stored in
`localStorage`, applied by an inline script in `index.html` before React mounts so there is
no flash of the wrong theme. Every colour comes from a token in `client/src/index.css` and
no raw colour literal appears in `App.css`.

Listing pictures are chosen in four falling-back steps — the listing's own image, then a
curated photo for the product name, then the locally drawn category illustration, then a
"No image" box — so a listing with no image and no network still shows something topically
right. Action art (the dashboard tiles and landing-page cards) is inline SVG taking its
colour from the theme; category art is a file that carries its own.

`docs/UI_AND_THEME.md` is the reference for all of it: the token contract, how to add a
category illustration, the fallback chain and its offline behaviour, the brand mark, and the
star control used by both product and shop reviews.

`hooks/useResource.js` handles reads, aborts obsolete requests and keeps old data
from appearing under a new URL. `useTask` prevents duplicate form submissions.
`components/FormFields.jsx` provides address/contact fields, Markdown preview,
feedback and read-only master facts. `auth/useAuth.js` shares authentication state;
`auth/AuthContext.jsx` restores and updates the session.

## Account and profile flow — every role

Public registration (`/register`, `AuthFlowPage.jsx`) offers customer, vendor and
delivery accounts. It collects name, email, password/confirmation, phone, profile
image URL, street, city, postal code, state/province and country. Delivery accounts
also require vehicle information. Admins create additional admin accounts through
**Dashboard → Administration console → Users** (`/admin`, `AdminConsolePage.jsx`).
Admin account creation preserves the current administrator's session.

`authController.js` validates inputs, resolves the allowed registration role from
`roles`, hashes passwords with bcrypt (12 rounds, random per-user salt), and saves
location/user/delivery rows atomically. The 72-byte bcrypt password limit is enforced.
Login (`AuthPage.jsx`) accepts email/password only; the saved database role decides
capabilities. The signed JWT is stored in an HTTP-only cookie, SameSite=Lax, Secure
in production, with one-day expiry. The JWT contains user identity/token version;
it is not a client-supplied authority for roles. Logout increments `users.token_version`
and clears the cookie, invalidating **all existing sessions for that user**.

**Account settings** (`/profile`, `ProfilePage.jsx`, `profileController.js`) edits all
user-controlled contact/address fields for any role. An address edit inserts a new
location and switches the user's reference, preserving historical order addresses.
Role, ID, points, status and creation time are visible but not self-editable.
Password hashes/token versions are never exposed. There is no password reset flow.

## Storefront catalog and product reviews

The public catalog (`/products`) shows each listing's average product rating and
review count on its product card. **Details and reviews** opens the product page,
which shows the full review list. A customer can write or update a product review
only after an order containing that listing is delivered; the database trigger
enforces this even if a request bypasses the page. The seeded demo customer has a
delivered order and a sample review for demonstrating the display.

## Admin catalog flow

Open **Dashboard → Manage catalog** (`/admin/catalog`, `AdminCatalogPage.jsx`).

1. Under **Categories and attributes**, define attributes (name and description).
2. Create/edit a category with name, description and optional parent. Choose its
   required attributes. These selections are rows in `category_attributes`.
3. When adding requirements to a category that already has products, either fill
   those values on the masters first or enter the form's value for existing products
   missing that attribute. Existing nonempty values are preserved. Missing required
   values cause a conflict and rollback. Parent categories cannot form cycles.
4. Under **Master products**, enter name, manufacturer, image URL, Markdown
   description, category, wholesale price and availability. Required category
   attributes are marked and mandatory. **Add attribute** adds a simple name and
   value pair; saving creates that attribute and saves its value for this master.
5. Edit masters from the list. **Delete (discontinue)** soft-deletes them because
   the schema protects purchase/order history. They disappear from the available
   master and retail catalogs. Their status can be changed back through Edit.
   Deleting a master also refunds every shop holding a listing of it, in the same
   transaction, and the confirmation reports the total it paid rather than a bare
   "discontinued". Empty categories can be hard-deleted; referenced categories cannot.

`adminCatalogController.js` saves each master/category and its attributes in one
transaction. Deferred constraint triggers in `schema.sql` enforce required values
at commit. Category requirements apply to the directly assigned category.
Master name/image changes synchronize retail listings; seller descriptions remain
independent. Attributes can be defined and attached/detached; attribute-definition
rename/delete is not implemented.

## Administration — accounts and shops

**Dashboard → Administration console** (`/admin`, `AdminConsolePage.jsx`) is where an
administrator moderates people and shops. The tab and every filter live in the URL, so
a view deep-links and survives a reload. `adminRoutes.js` mounts the whole surface at
`/api/admin` behind one `requireAuth, requireRole("admin")` guard, so a new endpoint
cannot be added without a role check by accident.

- **Users** — search by name/email, filter by role and status, page through accounts.
  Each row shows a name, email, role and status pill plus Enable/Disable. The
  administrator's own row offers no button, because the server refuses it. The
  **Create an account** form is here, behind a toggle.
- **Shops** — search by shop, owner or email and filter by status. The list reports how
  many of a shop's listings are live (`3 of 7 live`) and flags a banned owner, because
  disabling the shop is only half of what a user ban does. Disabling asks for a second,
  explicit click that names what it will discontinue, since
  `fn_discontinue_products_on_shop_disable` is one-way.
- **Pending requests** — shops whose vendor submitted them, as cards with **Approve**
  and **Reject**. Both are the same call: `PUT /api/admin/shops/:shopId/status` with
  `active_status` of `active` or `disabled`.
- **Payments** — every payment joined to its order and customer, filterable by status and
  method. Each row shows the customer's bill (`amount`) and what it was made of
  (`$120.00 + $8.00 delivery`), because what the customer owes and how it splits between
  the shops and the courier are different numbers and a row with only one of them is
  misleading. A payment that was never settled shows `—` rather than a date.
- **Refunds** — every `vendor_refunds` row with its shop, listing, units, unit price, total,
  reason and the administrator who decided to. The reason filter is a closed set
  (`admin_removal`, `shop_closed`), not free text. These are the platform paying a shop
  for withdrawn stock; the refunds a *shop* pays a *customer* are the returns flow below,
  and they never share a table.

Both financial tabs read `paymentController.js` → `paymentQueries.js` and are admin-only.
They are the two surfaces a vendor's own books are a slice of. `GET /api/admin/permissions`
existed through Step 6 and was removed with the tables behind it; see
`docs/REFUNDS_AND_READ_SURFACES.md`.

**A shop's listings expand in place.** Clicking the `3 of 7 live` count opens that shop's
listings without loading any other shop's, each with a **Remove and refund** button. That
button names the amount it will pay — `Confirm: remove and refund $500.00` — and sends
nothing until the second click, because a single slip here moves money. A listing already
discontinued offers no button and says "Nothing to refund" instead, since removal is a
one-way flag and a second removal is a `409`.

`adminController.js` validates the path ID and status against `SHOP_STATUSES` /
`USER_STATUSES` and returns `{items,total,page,limit,total_pages}`, the same shape the
storefront catalog returns, so `Pagination` is reused unchanged. Unknown filter values
are a 400 rather than a silently empty page. A status change to the value a row already
has succeeds without writing.

**Disabling a user cascades down; enabling cascades only halfway.** `trg_disable_user_dependents`
disables their shops, which discontinues their listings; `trg_enable_user_dependents`
brings the shops back to `active`, but the listings stay discontinued so a vendor
consciously relists. A shop an administrator had separately disabled also comes back
when the user's status is toggled, because nothing records *why* a shop is disabled —
the administrator re-disables it, and the alternative (splitting the cascade between
SQL and application code) would let the two paths drift apart. Courier availability is
deliberately not restored: disabling a courier sets them `unavailable`, which also
releases their in-flight orders, and returning them to duty without opting in would be
worse than leaving them to set it themselves in `/workspace`.

**No administrator can lock the platform out of its own administration.** Disabling
your own account is refused with 409. That guard alone is sufficient: whoever is signed
in is an active administrator by definition (`requireAuth` re-reads the row), so banning
every other admin still leaves you. A "last active admin" count would be unreachable,
since a *different* active admin can only be disabled when at least two exist.

## Shop-owner flow

A vendor creates one or more shops at **My shops** (`/vendor/shops`, `VendorPage.jsx`).
The form covers name, phone, logo URL, cover photo URL, Markdown description and full
address. IDs, owner, creation time, balance and status are shown or supplied
automatically. Ownership always comes from the session.

**A new shop waits for approval.** It is created `active_status = 'pending'`, so it is
invisible to shoppers (`LIST_SHOPS` and every catalog query require `'active'`) and the
vendor cannot stock it, because `ACTIVE_OWNED_SHOP` requires `'active'` too. An
administrator approves it in the console. The shop form reports the status as read-only
text rather than offering it: `active_status` is an administrator-only field, and
`vendorController.saveShop` does not read it from the request body at all. Without that
rule a vendor could approve their own shop, or undo their own ban with a routine save.
A rejected submission is `'disabled'` — there is no separate rejected state, and no
reason is recorded — but the vendor can keep editing name, description and address
while waiting, so a corrected submission can be re-reviewed.
Disabling a shop discontinues its listings; reactivating it does not automatically
relist them. Edit or restock the desired listings after reactivating the shop.

At **Buy & list** (`/vendor/inventory`), choose an active owned shop and available
master, purchase quantity, retail price and your own Markdown description.
**Fill attributes — from master catalog** automatically displays master name,
manufacturer, category, wholesale price, image, description and all attribute values.
These fields are read-only. The server ignores forged master facts and fetches them
from PostgreSQL; DOM edits cannot change the master catalog.

`vendorController.js` checks the owned shop and selected master, records quantity
and current wholesale unit price in `shop_purchases`, then creates a listing or
increases stock on the existing shop/master listing. The transaction commits both
changes or neither.
Restocking also saves the retail price/description entered on that purchase form.
The application reuses the first listing for a shop/master pair; legacy duplicate
listings are preserved, not destructively merged. Listing edits allow retail price,
seller description and discontinued status. Stock increases require a purchase.
Purchase history displays ID, date, shop, master, quantity, unit cost and total.

The **Shop view** selector filters listings and purchase history to one owned shop
or shows all owned shops. On **My shops**, selecting a shop shows its shop reviews;
on **Inventory and purchases**, each listing has a **View reviews** control for
that product's customer reviews. These reads are limited to the vendor's own shops
and listings. The Payments page uses the same selector to scope books to one owned
shop; choosing **All my shops** shows the vendor-wide books.

**Payments** (`/vendor/payments`) is the vendor's books: sales of their own listings,
their wholesale purchases, refunds they have received, their shops' balances, and
totals. It is scoped to owned shops from the session and may optionally filter by
`shop_id`; the server verifies that the requested shop belongs to that vendor. The
sales rows deliberately carry `order_id` and **not** the
buyer's name or email: the courier delivering the parcel already has it, and the vendor
is fulfilling against an order number rather than a person. A sale is worth its line
subtotal in full — there is no commission in between the customer's payment and the
shop, and the delivery charge on the same order is the courier's, not the shop's. The
"Sales" figure here counts every non-cancelled order, including ones still on their way.

**The balance** (`/vendor/balance`, `VendorBalancePage.jsx`) is what the shop can spend
on stock. It shows the number, a statement of the movements behind it — sales,
purchases, recharges, administrative refunds and customer-return refunds, newest first,
each in one list told apart by kind — and a recharge form. The form records the money
and says so in as many words: *"No card was charged."* There is no payment gateway
behind it and the page does not pretend otherwise. A balance is allowed to go negative,
because a vendor must not be able to refuse a customer's refund by having spent the
money, and the page shows it plainly rather than hiding it.

**Income** (`/vendor/statistics`, `VendorStatisticsPage.jsx`) is the time series and
leaderboard: revenue and refunds per day, week or month as a bar chart, the ten listings
that earned the most with each one's share of revenue, an every-period table, and a
reconciliation panel against the balance. Revenue here means **delivered** revenue only,
because that is when `settle_delivery` credits the balance — the page says so, and says
that the payments page's Sales figure counts orders still in transit. A return does not
erase the sale that happened: the delivered series keeps the original line and refunds
are charted beside it, so a good month and a bad one can be read at once instead of
history changing under the vendor.

**Returns** (`/vendor/returns`, rendered on the payments page) has three groups: the
requests waiting for a decision, each with **Accept and refund $X** and **Decline**;
the ones on their way back, whose **Restock** button is offered only once the courier
has collected; and the history. Declining requires a typed reason — a vendor who wants
to refuse has to say why. Accepting is what debits the balance and pays the customer;
restocking is what puts the goods back on the shelf. Those are deliberately different
moments: the money follows the obligation, the stock follows the parcel.

Markdown is rendered by `react-markdown` without raw HTML execution. Images are
HTTP/HTTPS URLs; binary uploads are not implemented. Wholesale purchases are
inventory records, not bank transfers; there is no supplier wallet or stock model.

## Delivery flow

A courier's workspace is `/workspace` (`RoleWorkspacePage.jsx`,
`roleController.js`). It holds their **availability** — `available`,
`on_delivery` or `unavailable` — and their vehicle details: free-text vehicle
information, a vehicle type from a closed list, a vehicle number, a vehicle model
and a licence number. Only the free-text notes are required, because a courier on
a bicycle has no plate or licence to give and demanding one would lock them out of
the workspace they need to go on duty.

Availability decides whether checkout picks them. Setting it to `unavailable`
releases any in-flight orders through `fn_release_orders_on_personnel_unavailable`,
returning those orders to the unassigned state rather than leaving them pointing at
someone who is not coming. Enabling the account does not put them back on duty.

**Current deliveries** (`/delivery/deliveries`, `DeliveriesPage.jsx`) is the run
itself, described under the checkout flow above. `delivery_personnel.active_status`
is the schema's own `('available','on_delivery','unavailable')` CHECK, and the
vehicle columns are defined directly in `server/sql/schema.sql`.

**Marking an order delivered is what pays the courier**, and it happens inside that one
transition: the order's own `delivery_cost` is credited to `delivery_personnel.earnings`
in the same procedure that completes the cash payment and credits each shop for its
lines. That column was written at checkout as `COURIER_BASE_FEE + COURIER_RATE ×
total_amount`, with the constants named in `orderQueries.js` rather than inlined, and
`settle_delivery` reads it back rather than recomputing it — so what the customer was
charged is exactly what the courier is paid, and changing a constant later cannot
retroactively move money on an order already placed. It cannot pay twice, and not
because of a second guard: the status update is a compare-and-set that moves one row
exactly once, so a courier tapping "delivered" twice gets a `409` from the statement that
would have paid them.

**Current deliveries** also carries the return pickups: the returns a shop has accepted
that no courier has collected yet, with the customer's address and phone, and a **Mark
collected** button. Any active courier may take one, not only the courier who delivered
the order — the original courier may since have gone unavailable or been disabled, and a
pickup only one person can perform is a pickup that can stall forever. The customer has
already been refunded by this point; nothing is paid at the door, and the card says so.

## Catalog discovery — search, filtering and facets

**Explore products** (`/products`, `ProductsPage.jsx`) is the storefront. Every filter
lives in the URL, so a result page survives a reload, the back button and being pasted
into another tab.

1. **Search** (`q`) matches the listing name, master name, manufacturer, master
   description and category name with a case-insensitive `ILIKE`. `%` and `_` are escaped
   and matched literally, so typing `%` does not match everything.
2. **Categories** come from `GET /categories` and are nested client-side on
   `parent_category`, with each level indented. Selecting a category includes every
   descendant at any depth, via a recursive `category_scope` CTE.
3. **Attribute checkboxes** come from `GET /products/facets`, which returns one row per
   attribute value with the number of matching listings. Values inside one attribute OR
   together; separate attributes AND together. The list is restricted to the attributes
   `category_attributes` assigns to each master's own category, and only values that
   actually occur in the catalog appear.
4. **Price** bounds and **sort** (`relevance`, `newest`, `price_asc`, `price_desc`,
   `name`) round out the panel. Sorting always tie-breaks on `prod_id` so paging never
   repeats or skips a listing.
5. **Paging** is server-side; the page is limited to 24 listings and the response carries
   `total` and `total_pages` from a `COUNT(*) OVER()` window.

The URL parameters are exactly the API parameters: `q`, `category_id`, repeated
`attribute=attribute_id:value`, `min_price`, `max_price`, `sort`, `page` and `limit`
(default 24, maximum 60). Attribute filters use the form `attribute=1:Black`. Malformed
values return 400 rather than being silently ignored.

**Attribute filters match on the master product, not the listing.** `attribute_values` is
keyed on `master_prod_id`, so ticking *Demo Color → Black* returns every shop's listing of
every Black master product in scope. Per-listing variants are not representable in the
current schema.

Facet counts honor the active search, category and price filters but deliberately ignore
the attribute checkboxes themselves, so a value's count does not collapse to the current
selection when it is ticked. Filter-panel requests are independent of the listing request:
if categories or facets fail to load, the grid still renders. `useResource` exposes
`isLoading` so an empty result can be told apart from a pending one.

## Customer cart, checkout and reviews

`ProductsPage.jsx` shows available shop listings. **Details and reviews** opens
`ProductDetailPage.jsx`, including seller/master descriptions and attributes.
Customer-only controls add listing IDs (`prod_id`, not `master_prod_id`) to cart
or wishlist. `CustomerCollectionPage.jsx` supports read/remove and absolute cart
quantity updates. A cart is not an inventory reservation — placing the order is
what claims stock.

**Checkout** (`/checkout`, `CheckoutPage.jsx`) turns the cart into an order in
cash on delivery. It shows the cart as the order with its total, defaults the
delivery address to the profile's with an option to enter a different one, and has
one action: **Place order (cash on delivery)**. The cart page's **Proceed to
checkout** link is disabled while any line is unavailable or exceeds stock; the
server re-checks every line regardless and refuses the whole order with `409`,
naming the listing and what is left.

**My orders** (`/orders`, `OrdersPage.jsx`) lists the customer's orders with both
the order status and the payment status, because for cash on delivery those are
two different facts. **Order detail** (`/orders/:orderId`, `OrderDetailPage.jsx`)
shows the items, the total, the address, the courier, the payment record, and a
**Cancel order** action that exists only while the order is still `pending`.
Cancelling returns the stock to the shops and fails the pending payment.

**Order detail is also where a shop is reviewed.** The page renders one review form per
shop that contributed a line, named for the shop, so a two-shop order offers two forms
rather than one ambiguous one. Eligibility comes from the same rule as product reviews —
a delivered order containing a listing from that shop — and the form reports ineligibility
as a sentence rather than hiding. An existing review opens as an update, with a delete
action beside it.

**Account settings → Payments** (`/account/payments`, `AccountPaymentsPage.jsx`) is the
customer's own payment history: method, status, amount and `paid_at` per order, with a
link to the order. The amount is shown as the goods plus the delivery charge, because
that is the whole of what the customer paid and both halves are theirs to see. It is
scoped to the session's user id and accepts no user id from the caller.

**Order detail is also where a return is asked for.** The panel is always present, even
before there is anything to return — it is where a customer finds out that returns exist,
and a missing panel answers none of the questions a missing form raises. Before delivery
it says the order has to arrive first; after delivery it offers a form that takes the
listing, how many units and why. The amount is not a field: it is the order line's own
price, computed by the server, because a form that let a customer name their own refund
would be asking them to price their own compensation. Below the form is the whole history
for the order, refusals included — a declined request that vanished would leave the
customer with no record that they had asked and no way to see why. Two sentences explain
the flow at the points they matter: an accepted return means a courier will come, and the
refund was paid when the shop accepted, not when the parcel arrived.

**Current deliveries** (`/delivery/deliveries`, `DeliveriesPage.jsx`) is the
courier's run: the orders assigned to them that are still `pending` or `shipped`,
with the customer's contact details, the address, the cash to collect and the
parcel's contents. Each card offers only the next legal action — **Mark
collected** on a pending order, **Mark delivered** on a shipped one. Marking an
order delivered also settles its cash payment.

The header carries a count badge on the cart link and links to **My orders** for
customers and **Current deliveries** for couriers. The `/products` catalog is
reached through the header search box, the landing page and the category tiles
rather than a nav entry of its own.

See [`ORDERS_AND_PAYMENT.md`](ORDERS_AND_PAYMENT.md) for the concurrency design
behind checkout, the order lifecycle, and what the tests do and do not prove.

Only a customer with a **delivered purchase of that exact shop listing** can review.
The UI checks eligibility; `reviewController.js` derives the reviewer from the
session. `fn_verify_product_review_purchase` and
`trg_verify_product_review_purchase` in `schema.sql` reject invalid INSERT **and**
UPDATE operations even when SQL is executed directly. One review per user/listing
uses the composite primary key. Rating (1–5) and review text are editable; user ID,
product ID and modification time are automatic. The customer can update/delete
only their own review. Existing historical delivered orders retain review links even
if a master is discontinued. A customer becomes eligible by having an order
containing that listing delivered, so eligibility follows the order flow above.

Points, balances and earnings are displayed where relevant. No points
economy exists: `users.point` is read on the profile and never written. The shop
balance, courier pay and shop reviews are implemented as stated platform policies with
named constants — see `docs/REFUNDS_AND_READ_SURFACES.md` for the formulas and the
per-role read table. There is no platform commission anywhere: the customer's payment
is the shops' goods plus the courier's trip. Shipping cost is a column written at
placement from those constants. Payment
is COD bookkeeping, not an online payment gateway; `payments.payment_method` already
permits `'prepaid'`, so adding a gateway later is a new branch rather than a
schema change — and the recharge and refund flows record money without pretending to
move it. The `permissions` and `role_permissions` tables are absent; authorization is
`requireRole` per mounted router, so role checks rather than capability rows drive
every implemented flow.

## API reference

All paths below start with `/api`. JSON request bodies use the form/database names.
Every protected route runs session middleware; writes also validate ownership where
applicable. `adminRoutes.js` mounts the whole `/admin` surface behind one role guard.
`roleRoutes.js` mounts the profile, vendor and delivery endpoints. `authRoutes.js`,
`cartRoutes.js`, `wishlistRoutes.js` and `catalogRoutes.js` mount the original groups.

| Access | Method and path | Controller / operation |
| --- | --- | --- |
| Public | POST `/auth/register` | authController: register permitted public role |
| Public | POST `/auth/login` | authController: authenticate database user |
| Any role | GET `/auth/me`; POST `/auth/logout` | authController: restore/revoke session |
| Public | GET `/health`, `/roles`, `/categories`, `/shops` | catalogController: reference/health reads |
| Public | GET `/countries` | profileController: country options |
| Public | GET `/products` | catalogController: searchable, filterable listing page |
| Public | GET `/products/facets` | catalogController: attribute values and counts for filters |
| Public | GET `/products/:productId` | catalogController: available listings/details |
| Any role | GET, PUT `/profile` | profileController: own contact/address |
| Customer | GET, POST `/cart`; PUT, DELETE `/cart/:productId` | cartController: own cart |
| Customer | GET, POST `/wishlist`; DELETE `/wishlist/:productId` | wishlistController: own wishlist |
| Customer | POST `/orders`; GET `/orders`, `/orders/:orderId` | orderController: place the cart as an order, read own orders |
| Customer | PUT `/orders/:orderId/cancel` | orderController: cancel while pending, restore stock |
| Public | GET `/products/:productId/reviews` | reviewController: public reviews |
| Customer | GET `/products/:productId/review-eligibility` | reviewController: own purchase eligibility |
| Customer | PUT, DELETE `/products/:productId/review` | reviewController: save/remove own review |
| Vendor | GET, POST `/vendor/shops`; PUT `/vendor/shops/:shopId` | vendorController: owned shops |
| Vendor | GET `/vendor/master-products` | adminCatalogController: available wholesale masters |
| Vendor | GET, POST `/vendor/listings`; PUT `/vendor/listings/:productId` | vendorController: purchase/list/restock/edit |
| Vendor | GET `/vendor/purchases` | vendorController: owned wholesale history |
| Vendor | GET `/vendor/payments` | paymentController: own shops' sales, purchases, refunds and balances |
| Vendor | GET `/vendor/balance`; POST `/vendor/topups` | vendorController: one shop's balance and movements, and a recharge |
| Vendor | GET `/vendor/statistics` | vendorController: income per period, top listings and reconciliation |
| Vendor | GET `/vendor/returns`; PUT `/vendor/returns/:returnId/approve`, `/reject`, `/restock` | returnController: decide a return, and restock it once collected |
| Customer | GET, POST `/returns` | returnController: own returns, and the request that starts one |
| Customer | GET `/account/payments` | paymentController: own payments, goods and delivery charge |
| Delivery | GET `/delivery/returns`; PUT `/delivery/returns/:returnId/collect` | returnController: approved pickups, and collecting one |
| Public | GET `/shops/:shopId/reviews` | shopReviewController: public shop reviews |
| Customer | PUT, DELETE `/shops/:shopId/review` | shopReviewController: own shop review, eligibility-gated |
| Admin | GET `/admin/users` | adminController: paged account list, filter by search/role/status |
| Admin | POST `/admin/users` | authController: create any allowed role |
| Admin | PUT `/admin/users/:userId/status` | adminController: enable/disable and revoke tokens |
| Admin | GET `/admin/shops` | adminController: paged shop list with owner and listing counts |
| Admin | PUT `/admin/shops/:shopId/status` | adminController: approve, ban or restore a shop |
| Admin | GET `/admin/payments` | paymentController: every payment with order, customer, goods and delivery charge |
| Admin | GET `/admin/refunds` | paymentController: every vendor refund with shop, listing and acting admin |
| Admin | GET `/admin/catalog-metadata` | adminCatalogController: categories/required IDs/attributes |
| Admin | POST `/admin/attributes` | adminCatalogController: define attribute |
| Admin | POST `/admin/categories`; PUT, DELETE `/admin/categories/:categoryId` | adminCatalogController: category/requirement management |
| Admin | GET, POST `/admin/master-products`; PUT, DELETE `/admin/master-products/:masterId` | adminCatalogController: master CRUD (soft deletion, refunds every holder) |
| Admin | GET `/admin/shops/:shopId/listings` | adminCatalogController: one shop's listings with the refund each removal would pay |
| Admin | PUT `/admin/listings/:prodId/discontinue` | adminCatalogController: discontinue one listing and refund its remaining stock |
| Delivery | GET, PUT `/delivery/profile` | roleController: own vehicle/availability |
| Delivery | GET `/delivery/deliveries` | orderController: own assigned pending/shipped orders |
| Delivery | PUT `/delivery/orders/:orderId/status` | orderController: mark collected or delivered |

`orderRoutes.js` mounts the customer order surface behind one customer guard.

Common bodies:

```json
{"shop_id":1,"master_prod_id":2,"quantity":5,"unit_price":"30.00","description":"**My description**"}
```

```json
{"name":"Desk","manufacturer":"Maker","images":"","description":"Oak desk","category_id":1,"wholesale_price":"20.00","active_status":"available","attributes":[{"attribute_id":1,"attrib_value":"Oak"}],"additional_attributes":[{"name":"Assembly","value":"Required"}]}
```

```json
{"name":"Furniture","description":"Home furniture","parent_category":null,"required_attributes":[{"attribute_id":1,"default_value":"Oak"}]}
```

IDs above are examples: use IDs returned by your database. Reviews use
`{"rating":5,"review":"As described"}`. An order is placed with `{}` to use the
profile address, or with `{"street_address":"…","city":"…","postal_code":"…",
"state_province":"…","country_id":"BD"}` to send it somewhere else. A courier moves
an order with `{"order_status":"shipped"}` or `{"order_status":"delivered"}`.
Client-supplied owner/user IDs never select the acting user: the cart, the order
and the courier's run all come from the session.

Statuses: 200 success; 201 creation; 204 successful removal/logout with no body;
400 invalid input; 401 missing/invalid session; 403 wrong role/disabled login;
404 absent or non-owned resource; 409 duplicate, stock or business-rule conflict;
413 oversized JSON; 500 unexpected internal error. `errorMiddleware.js` maps
PostgreSQL constraint errors to JSON; internal errors stay in the server terminal.

## Inspect everything with browser developer tools

1. Open the site, press **F12** or **Ctrl+Shift+I**, select **Network → Fetch/XHR**
   and enable **Preserve log**. Clear old entries before demonstrating each role.
2. Submit a form. Select its request: **Headers** shows URL/method/status;
   **Payload** shows submitted JSON; **Response** shows returned records/messages;
   **Initiator** identifies the frontend code that made the request.
3. Follow an example vendor purchase: inspect `POST /api/vendor/listings`, then
   the refreshed `/vendor/listings` and `/vendor/purchases` reads. Check stock and
   the price snapshot. Master facts should not be submitted as editable fields.
4. Under **Application → Cookies**, inspect `shopsphere_token` and its HttpOnly,
   SameSite and expiry flags. `document.cookie` cannot read an HttpOnly token.
   Logout clears it; the API tests also prove replaying a copied token fails.
5. Inspect validation errors on the page and the matching API status. Browser
   `required`/number validation may prevent a request entirely; no Network entry
   in that case is expected. **Console** shows browser errors, while backend
   errors appear in the terminal running Express.
6. Demonstrate backend role checks while logged in as a customer by running:

   ```js
   const r = await fetch('http://localhost:5000/api/admin/master-products', {
     credentials: 'include'
   });
   console.log(r.status, await r.json()); // 403
   ```

   Run the same after logout for 401. Adjust the host if your API differs.
   To demonstrate ownership, use Network **Copy as fetch** on an owned shop
   action, change its ID to a different account's ID, and inspect the 404 response.
   Use local demo records for write demonstrations. IDs alone never grant access.
7. DevTools cannot execute database SQL. Use pgAdmin/psql to inspect
   `shop_purchases`, `category_attributes`, `attribute_values` and
   `product_reviews`. Example read:

   ```sql
   SELECT mp.name, a.name AS attribute, av.attrib_value
   FROM master_products mp
   JOIN attribute_values av USING (master_prod_id)
   JOIN attributes a USING (attribute_id)
   ORDER BY mp.master_prod_id, a.name;
   ```

## Verification and dependency layout

- `npm run build`: compile the React production bundle.
- `npm run lint`: frontend lint.
- `npm test`: real API/PostgreSQL regression tests. They create temporary schemas,
  test authorization, ownership and cart/catalog rules, then remove their test
  schemas. Your application tables stay intact. Each file mounts the whole schema,
  so they run one file at a time (`--test-concurrency=1`); run in parallel they
  contend for the database and a mount exceeds its statement timeout.
- `npm run test:e2e`: Playwright. `cart.spec.js` and `catalog.spec.js` use controlled
  API responses for cart and catalog UI edge cases; `checkout.spec.js` does the same
  for checkout, order history and the courier's run; `read-surfaces.spec.js` covers
  the per-role payment, refund, return and shop-review views, including the vendor's
  income chart; `imagery.spec.js` covers the
  listing-picture fallback chain and the category-to-illustration mapping; `admin.spec.js`
  covers the admin console's tabs, filters and status writes.
  Chromium must be installed; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an
  existing executable. The tests start Vite on port 5174.

The root `package.json` declares two workspaces and shared commands. The client
manifest defines browser dependencies; the server manifest defines backend
packages. Keep all three: they are not duplicate installations. There is one root
`package-lock.json` and root `node_modules`. Vite's cache lives under the root
installation; a small `client/node_modules/.vite-temp` may be generated by Vite's
config loader and is a disposable cache, not another dependency installation.
Legacy HTML pages, duplicate lockfiles and unused starter assets are removed.

If a machine-wide HTTP proxy intercepts local tests, set `NO_PROXY=localhost,127.0.0.1`
(and `no_proxy` where needed) before running Playwright.
