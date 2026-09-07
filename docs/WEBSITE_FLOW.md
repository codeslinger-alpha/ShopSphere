# ShopSphere website, API and database flow

## Run the application

Use Node.js compatible with the installed Vite release (22.12+ or 24+) and PostgreSQL.
All commands below run from the **repository root**.

1. Run `npm install` once. The root workspace installs both client and server.
2. Copy `server/.env.example` to `server/.env` and fill in your local PostgreSQL
   connection and a random JWT secret. Do not commit `.env`.
3. Create an empty PostgreSQL database using your database tool. Set `DB_NAME` to it.
4. For a **new empty database**, run `npm run db:init`. It refuses to overwrite
   existing tables. For an **existing ShopSphere database**, use `npm run db:migrate`
   instead. Migrations 001–003 are additive; the runner records applied filenames
   in `schema_migrations` and applies pending changes in a transaction.
5. Run `npm run db:seed` for local demo/reference data. This includes Bangladesh,
   all four roles and individually salted demo account hashes. It preserves existing
   matching records and refuses production mode. Rerunning can replenish missing
   demo cart/wishlist rows; it does not reset existing passwords or inventory.
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
7. `server/src/config/db.js` provides the shared connection pool.
   `utils/transaction.js` manages BEGIN, COMMIT, rollback and connection release.
8. PostgreSQL applies foreign keys, constraints and triggers. Express sends JSON,
   and the page displays results or an accessible error/status message.

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
**Dashboard → Manage users** (`/workspace`, `RoleWorkspacePage.jsx`).
Admin account creation preserves the current administrator's session.

`authController.js` validates inputs, resolves the allowed registration role from
`roles`, hashes passwords with bcrypt (12 rounds, random per-user salt), and saves
location/user/delivery rows atomically. The 72-byte bcrypt password limit is enforced.
Login (`AuthPage.jsx`) accepts email/password only; the saved database role decides
capabilities. The signed JWT is stored in an HTTP-only cookie, SameSite=Lax, Secure
in production, with one-day expiry. The JWT contains user identity/token version;
it is not a client-supplied authority for roles. Logout increments `users.token_version`
and clears the cookie, invalidating **all existing sessions for that user**.

**My profile** (`/profile`, `ProfilePage.jsx`, `profileController.js`) edits all
user-controlled contact/address fields for any role. An address edit inserts a new
location and switches the user's reference, preserving historical order addresses.
Role, ID, points, status and creation time are visible but not self-editable.
Password hashes/token versions are never exposed. There is no password reset flow.

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
   attributes are marked and mandatory. Filling other defined attributes adds
   product-specific values in `attribute_values` without changing category rules.
5. Edit masters from the list. **Delete (discontinue)** soft-deletes them because
   the schema protects purchase/order history. They disappear from the available
   master and retail catalogs. Their status can be changed back through Edit.
   Empty categories can be hard-deleted; referenced categories cannot.

`adminCatalogController.js` saves each master/category and its attributes in one
transaction. Deferred constraint triggers in `schema.sql` also enforce required
values at commit. Category requirements apply to the **directly assigned category**,
without implicit parent inheritance. Required values are enforced for available
masters; discontinued historical masters can retain incomplete old information.
Master name/image changes synchronize retail listings; seller descriptions remain
independent. Attributes can be defined and attached/detached; attribute-definition
rename/delete is not implemented.

## Shop-owner flow

A vendor creates one or more shops at **My shops** (`/vendor/shops`, `VendorPage.jsx`).
The form covers name, phone, logo URL, cover photo URL, Markdown description,
full address and active/disabled status. IDs, owner, creation time and earnings are
shown or supplied automatically. Ownership always comes from the session.
Disabling a shop discontinues its listings; reactivating it does not automatically
relist them. Edit or restock the desired listings after reactivating the shop.

At **Buy & list** (`/vendor/inventory`), choose an active owned shop and available
master, purchase quantity, retail price and your own Markdown description.
**Fill attributes — from master catalog** automatically displays master name,
manufacturer, category, wholesale price, image, description and all attribute values.
These fields are read-only. The server ignores forged master facts and fetches them
from PostgreSQL; DOM edits cannot change the master catalog.

`vendorController.js` locks the shop/master/listing, records quantity and current
wholesale unit price in `shop_purchases`, then creates a listing or increases stock
on the existing shop/master listing. The transaction commits both changes or neither.
Restocking also saves the retail price/description entered on that purchase form.
The application reuses the first listing for a shop/master pair; legacy duplicate
listings are preserved, not destructively merged. Listing edits allow retail price,
seller description and discontinued status. Stock increases require a purchase.
Purchase history displays ID, date, shop, master, quantity, unit cost and total.

Markdown is rendered by `react-markdown` without raw HTML execution. Images are
HTTP/HTTPS URLs; binary uploads are not implemented. Wholesale purchases are
inventory records, not bank transfers; there is no supplier wallet or stock model.

## Customer cart and reviews

`ProductsPage.jsx` shows available shop listings. **Details and reviews** opens
`ProductDetailPage.jsx`, including seller/master descriptions and attributes.
Customer-only controls add listing IDs (`prod_id`, not `master_prod_id`) to cart
or wishlist. `CustomerCollectionPage.jsx` supports read/remove and absolute cart
quantity updates. A cart is not an inventory reservation.

Checkout and order/delivery processing are intentionally disabled. Customers can
only browse, manage a wishlist, and add/update/remove cart entries. Cart entries
do not reserve stock or create payments/orders.

Only a customer with a **delivered purchase of that exact shop listing** can review.
The UI checks eligibility; `reviewController.js` derives the reviewer from the
session. `fn_verify_product_review_purchase` and
`trg_verify_product_review_purchase` in `schema.sql` reject invalid INSERT **and**
UPDATE operations even when SQL is executed directly. One review per user/listing
uses the composite primary key. Rating (1–5) and review text are editable; user ID,
product ID and modification time are automatic. The customer can update/delete
only their own review. Existing historical delivered orders retain review links even
if a master is discontinued, but new users cannot become review-eligible until a
future checkout feature is added.

Points, earnings and commission fields are displayed where relevant but no reward,
payout or commission policy is implemented. Shipping cost defaults to zero. Payment
is COD bookkeeping, not an online payment gateway. `shop_reviews` and permission
mappings remain schema/demo data; product reviews and backend role checks drive the
implemented flows.

## API reference

All paths below start with `/api`. JSON request bodies use the form/database names.
Every protected route runs session middleware; writes also validate ownership where
applicable. `roleRoutes.js` mounts the profile, vendor, admin, delivery and review
endpoints. `authRoutes.js`, `cartRoutes.js`, `wishlistRoutes.js` and
`catalogRoutes.js` mount the original groups.

| Access | Method and path | Controller / operation |
| --- | --- | --- |
| Public | POST `/auth/register` | authController: register permitted public role |
| Public | POST `/auth/login` | authController: authenticate database user |
| Any role | GET `/auth/me`; POST `/auth/logout` | authController: restore/revoke session |
| Public | GET `/health`, `/roles`, `/categories`, `/shops` | catalogController: reference/health reads |
| Public | GET `/countries` | profileController: country options |
| Public | GET `/products`; GET `/products/:productId` | catalogController: available listings/details |
| Any role | GET, PUT `/profile` | profileController: own contact/address |
| Customer | GET, POST `/cart`; PUT, DELETE `/cart/:productId` | cartController: own cart |
| Customer | GET, POST `/wishlist`; DELETE `/wishlist/:productId` | wishlistController: own wishlist |
| Public | GET `/products/:productId/reviews` | reviewController: public reviews |
| Customer | GET `/products/:productId/review-eligibility` | reviewController: own purchase eligibility |
| Customer | PUT, DELETE `/products/:productId/review` | reviewController: save/remove own review |
| Vendor | GET, POST `/vendor/shops`; PUT `/vendor/shops/:shopId` | vendorController: owned shops |
| Vendor | GET `/vendor/master-products` | adminCatalogController: available wholesale masters |
| Vendor | GET, POST `/vendor/listings`; PUT `/vendor/listings/:productId` | vendorController: purchase/list/restock/edit |
| Vendor | GET `/vendor/purchases` | vendorController: owned wholesale history |
| Admin | GET `/users` | catalogController: user list without passwords |
| Admin | POST `/admin/users` | authController: create any allowed role |
| Admin | PUT `/admin/users/:userId/status` | roleController: enable/disable and revoke tokens |
| Admin | GET `/admin/catalog-metadata` | adminCatalogController: categories/required IDs/attributes |
| Admin | POST `/admin/attributes` | adminCatalogController: define attribute |
| Admin | POST `/admin/categories`; PUT, DELETE `/admin/categories/:categoryId` | adminCatalogController: category/requirement management |
| Admin | GET, POST `/admin/master-products`; PUT, DELETE `/admin/master-products/:masterId` | adminCatalogController: master CRUD (soft deletion) |
| Delivery | GET, PUT `/delivery/profile` | roleController: own vehicle/availability |

Common bodies:

```json
{"shop_id":1,"master_prod_id":2,"quantity":5,"unit_price":"30.00","description":"**My description**"}
```

```json
{"name":"Desk","manufacturer":"Maker","images":"","description":"Oak desk","category_id":1,"wholesale_price":"20.00","active_status":"available","attributes":[{"attribute_id":1,"attrib_value":"Oak"}]}
```

```json
{"name":"Furniture","description":"Home furniture","parent_category":null,"required_attributes":[{"attribute_id":1,"default_value":"Oak"}]}
```

IDs above are examples: use IDs returned by your database. Reviews use
`{"rating":5,"review":"As described"}`. Client-supplied owner/user IDs never
select the acting user. Checkout and delivery-assignment bodies are not accepted
while order processing is disabled.

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
   `product_reviews`. Order tables are retained only as inactive historical
   schema. Example read:

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
  schemas. Your application tables stay intact.
- `npm run test:e2e`: Playwright. `cart.spec.js` uses controlled API responses for
  cart UI edge cases. PostgreSQL must be configured for any future full-flow tests.
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
