# Refunds, the shop balance, courier pay, and who may read what

Three rules that move money — admin removal refunds, customer returns, and courier
pay — plus the table saying which account can see which table. Two of the three
exist because the schema had the columns and nothing that filled them:
`shops.balance` (then called `earnings`) and `delivery_personnel.earnings` were at
their default zero from the first commit. The third, customer returns, is the
buyer's side of the same idea.

There is **no platform commission**. The customer's payment is the shops' goods
plus the courier's fee, and nothing is withheld in between.

## Why removal is a flag plus a refund, not a `DELETE`

`fn_prevent_delete` raises on `DELETE` from `users`, `shops`, `master_products`,
`products`, `delivery_personnel` and `orders`. That is the schema's own design, and it
is the right one: an order that has been placed references the listing it was placed
against, and a vendor's history has to survive the listing being withdrawn. A real
`DELETE` would either fail or take a purchase record with it.

So "remove this listing" means `products.discontinued = true`. What it did not mean
until now is that the vendor keeps nothing: the stock the vendor paid for is still on
their shelf, and discontinuing the listing strands it. The removal therefore pays the
vendor back for that stock in the same transaction, and writes a `vendor_refunds` row
so the payment is a fact rather than a number that appeared in a column.

`in_stock` is zeroed at the same moment, and that is not cosmetic. The stock has been
paid for, so it is no longer the vendor's inventory. Without the zero, a later restock
would add to units that had already been refunded once, and the next removal would pay
for them a second time.

## LIFO: which units were on the shelf

A listing's `in_stock` says how many units the vendor holds. It does not say which
`shop_purchases` rows they came from, and at what price — and the vendor bought them in
batches at different wholesale prices. Paying the newest price for every unit, or the
oldest, is wrong in a way nobody would notice from the total alone.

`REFUND_ATTRIBUTION` in `server/src/db/queries/adminCatalogQueries.js` answers it in one
statement: walk the listing's purchase rows newest-first, consuming `in_stock` against
each batch, and stop when the stock runs out. Whatever the purchases do not cover is
charged at `master_products.wholesale_price` — the fallback for a listing whose stock
arrived without a purchase row, which is every seeded listing.

The window function is what makes it one pass:

```sql
COALESCE(SUM(sp.quantity) OVER (
  PARTITION BY sp.shop_id, sp.master_prod_id
  ORDER BY sp.purchased_at DESC, sp.purchase_id DESC
  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
), 0) AS consumed_before
```

`consumed_before` is everything bought *more recently* than this row, so this row covers
`in_stock - consumed_before` units, clamped at zero at the bottom and at that batch's own
quantity at the top. It partitions by shop **and** master product rather than by listing
because stock is bought against a master product and then sold as whichever listing the
vendor chooses — two listings of the same master by the same shop draw on the same
batches, and the second one removed must not be paid for units the first one already took.

### Worked through

`Demo Tech Corner` holds two batches of the demo keyboard:

| Purchased | Units | Wholesale unit price |
| --- | --- | --- |
| 2026-01-01 | 5 | $4.00 |
| 2026-06-01 | 5 | $9.00 |

Set `in_stock = 7` and remove the listing. Newest first: 5 units at $9.00 = $45.00, then
2 of the 3 remaining units of the older batch at $4.00 = $8.00. **$53.00**, for 7 units,
so `unit_amount` is $7.57.

Remove it again after a restock, and the new stock pays first — the batches are read
newest-first every time, so a batch that was already consumed by the first refund is
behind the units bought since. The `purchase_id DESC` tiebreak is what keeps two batches
bought in the same second from being ordered arbitrarily.

No purchase rows at all: `Demo Bluetooth Headphones` wholesales at $40.00. Four units on
the shelf refund $160.00 — the master's price, not zero.

Zero units on the shelf: the listing is still discontinued, and nothing is paid.
`unit_amount` is then `NULL` rather than `0`, because the price of no units is not a
number, and `0` there would read as "free" rather than "nothing was owed".

### Idempotence

`UPDATE products SET discontinued = true WHERE prod_id = $1 AND discontinued = false`
returning nothing means "already removed", and the endpoint answers `409` rather than
paying a second time. Two admins clicking at once therefore produce one refund, not two;
the row lock `FOR UPDATE` takes in `MASTER_LISTINGS_WITH_STOCK` is what makes the second
one wait and then see the first one's result.

Removing a *master* product is the same rule applied to every listing of it, across every
shop holding one, in a single transaction — so either every vendor is paid or none is.

## The shop balance

`shops.balance` is a running total the vendor spends on stock. It is credited by
`settle_delivery` when an order is **delivered**, debited by a wholesale purchase, and
credits and debits again around administrative refunds and customer returns:

| Event | Effect on `shops.balance` |
| --- | --- |
| Sale delivered | **credit** the goods total for that shop's lines |
| Wholesale purchase | **debit** `quantity × wholesale_unit_price`; refused with a 409 if short |
| Return approved | **debit** the refunded goods total |
| Admin removal refund | **credit**, via `vendor_refunds` |
| Recharge | **credit**, via `shop_topups` |

The balance is a cache, and the identity it must satisfy is

```
balance = delivered sales + recharges − purchases − customer refunds + admin refunds
```

which is asserted in `server/tests/schema.integration.test.js` and again after each
step of the return flow in `server/tests/returns.integration.test.js`. If the cache
ever drifted from its sources the suite would fail, which is what makes it safe to keep
the number denormalised at all.

Two deliberate asymmetries inside that table:

- **A wholesale purchase is refused when the balance cannot cover it.** The funds test
  is part of the `UPDATE` predicate (`balance >= $2`), not a read followed by a check, so
  two purchases racing cannot both pass it and overdraw the shop.
- **A customer's refund is not refused.** Approving a return debits the balance
  unconditionally. A vendor must not be able to escape refunding a customer by having
  spent the money, so `shops.balance` is deliberately not `CHECK (>= 0)` and may go
  negative. The two are separate query constants so the difference is legible rather
  than accidental.

No amount is ever accepted from the client. Every movement is computed server-side from
`order_items`, `master_products.wholesale_price` or the return's own frozen
`refund_amount`, exactly as the money reads already refuse to take a `user_id` or
`shop_id` from the caller.

## Customer returns

A customer may ask to return any line of a **delivered** order, in whole or in part,
giving a reason. The vendor accepts or declines. If accepted, any active courier may
collect the parcel, and the shop restocks it on arrival.

**Money and goods move at different moments, on purpose.** The balance is debited and
the `customer_refunds` row written at **vendor approval**, because that is when the shop
accepts the obligation and the customer becomes owed. `products.in_stock` is incremented
at **restock**, because until the parcel is physically back the shop cannot sell it
again — restocking at collection would put stock on the shelf while it sat in a
courier's van. The courier's fee is not refunded: the trip happened.

Every transition is a compare-and-set, with the status it starts from inside the
`UPDATE` predicate rather than read first and checked after:

```sql
-- approve:  WHERE return_id=$1 AND status='requested'
-- reject:   WHERE return_id=$1 AND status='requested'
-- collect:  WHERE return_id=$1 AND status='approved'
-- restock:  WHERE return_id=$1 AND status='collected'
```

`rowCount = 0` means somebody else got there first, and the controller answers `409` —
the same shape `SHIP_ORDER`, `CANCEL_ORDER` and the removal above use. A second approve
therefore cannot debit the shop twice.

Two database rules back this up, in `fn_check_return_quantity`: a return is only legal
on a **delivered** order, and the units returned across all *non-rejected* requests for
one order line cannot exceed what was bought. The first is what makes a return and a
cancellation provably disjoint — `CANCEL_ORDER` requires `pending` — so the stock
restore in `fn_cleanup_cancelled_order` and the restock can never both fire for the same
unit. The second is what stops three accepted requests of two units each on an order of
three from restocking six. Rejected requests do not count, so a customer whose return
was refused may ask again; a partial unique index keeps one *open* request per line
without blocking that retry.

## Courier pay

Inside the delivered transition, and nowhere else:

```
earnings += delivered.delivery_cost
```

`delivery_cost` was written at placement as `COURIER_BASE_FEE + COURIER_RATE *
total_amount`, with the constants in `server/src/db/queries/orderQueries.js`. Reading it
back from the row rather than recomputing it is what makes the courier's pay and the
customer's delivery charge **one number**: what the customer was charged is what the
courier is paid, and changing a constant later cannot retroactively move money on an
order already placed.

An order whose goods come to $90.00 has a delivery charge of $3.00 + $1.80 = $4.80, and
the customer pays $94.80 — $90.00 to the shops and $4.80 to the courier. The flat part
is what makes a short delivery worth doing; the share is what makes a large one worth
doing carefully.

It cannot be paid twice, and that is not a second guard: `settle_delivery`'s transition
is a compare-and-set that moves one row exactly once, so a courier tapping "delivered"
twice gets a `409` from the same statement that would have paid them.

## Who may read what

Every read surface below derives its subject from the session, never from the request.
`/api/vendor/payments` takes no `shop_id`; `/api/account/payments` takes no `user_id`; a
customer's order list filters on the JWT's user id; a return is visible only to the
customer who asked, the vendor whose shop sold it, and a courier collecting it. That is
the whole isolation story, and it is why the server tests are mostly about what a caller
must *not* see.

| Table | Admin | Vendor | Customer | Courier | Guest |
| --- | --- | --- | --- | --- | --- |
| `users` | `GET /admin/users` (paged, filterable by role/status) | own profile | own profile | own profile | — |
| `roles` | `GET /admin/users` shows the role a user holds | — | — | — | — |
| `shops` | `GET /admin/shops`, with `balance` | `GET /vendor/shops`; balance and totals in `/vendor/payments`, `/vendor/balance` | public `GET /shops` (no balance) | — | public `GET /shops` |
| `master_products` | manage via `/admin/master-products` | `GET /vendor/master-products`, read-only facts | through the catalog | — | through the catalog |
| `products` | `GET /admin/shops/:id/listings`; remove and refund | `GET /vendor/listings` | `GET /products` | — | `GET /products` |
| `attributes`, `category_attributes`, `attribute_values` | manage via `/admin/*` | read on masters | read via `GET /products/:id` | — | read |
| `shop_purchases` | only as the basis of a refund | `GET /vendor/purchases`; spend in `/vendor/payments`; the debit in `/vendor/balance` | — | — | — |
| `shop_topups` | — | one shop's movements and the recharge form in `/vendor/balance`; totals in `/vendor/statistics` | — | — | — |
| `orders` | joined into `GET /admin/payments` | sales rows in `/vendor/payments`, **without the buyer's name or email** | own `GET /orders`, `/orders/:id` | assigned `GET /delivery/deliveries` | — |
| `order_items` | the goods total per order via `/admin/payments` | the line subtotal in full | items on their own order | items per delivery | — |
| `payments` | `GET /admin/payments` — every payment | — | `GET /account/payments` — own only | — | — |
| `vendor_refunds` | `GET /admin/refunds`, with shop, listing and the acting admin | own shops' refunds in `/vendor/payments` and as a movement in `/vendor/balance` | — | — | — |
| `product_returns` | — | `/vendor/returns` for shops they own | own requests in `/returns` | approved ones in `/delivery/returns` | — |
| `customer_refunds` | — | as a negative movement in `/vendor/balance` and a figure in `/vendor/statistics` | reflected in the return they asked for | — | — |
| `product_reviews` | public read; write only as a buyer | " | write own, eligibility-gated | — | read |
| `shop_reviews` | public read; write only as a buyer | " | write own, eligibility-gated | — | read |
| `delivery_personnel` | `earnings` on the admin lists | — | — | own `earnings` on the profile and workspace | — |
| `cart_items`, `wishlist_items` | — | — | own | — | — |
| `locations`, `countries` | via users and orders | via orders | own profile and orders | delivery and pickup addresses | `GET /countries` |

Three asymmetries are deliberate rather than omissions:

- **A vendor does not see the buyer's name or email.** The courier delivers the parcel and
  already has it; the vendor is fulfilling against an order number. The vendor's sales rows
  carry `order_id` and nothing that identifies the customer. A return is the exception that
  proves the rule — a vendor deciding one needs to know which order it is about, and gets
  the listing, the reason and the customer's name because the customer asked them for it.
- **A customer sees the whole of their own payment.** There is no commission line to hide:
  the payment is the goods plus the trip, and the page shows both halves.
- **`users.point` is read and never written.** The profile shows it; no rule moves it. A
  points economy was deliberately not invented, and the column staying still is the honest
  version of that.

## There is no permission table

`permissions` and `role_permissions` do not exist in `schema.sql`. They had held seven
`demo.*` permissions and seven grants since the first seed, and no code ever read either
table: authorization here is `requireRole(roleName)` on a mounted router, which is a
check per role and never per capability.

A table that looks like an authorization model and is not one is worse than no table. It
invites exactly one mistake — someone adding a grant and believing it grants something —
and it made every reader learn that the two tables were decorative. If per-capability
authorization is ever wanted, it should arrive with the code that consults it; `roles`
stays, because that is what a user's role actually points at.

## Where the pieces live

| Piece | File |
| --- | --- |
| Refund, return, top-up tables, `fn_prevent_delete`, `fn_check_return_quantity` | `server/sql/schema.sql` |
| Shop-review purchase trigger | `server/sql/schema.sql` |
| Cancellation restores stock, unassigns and fails the payment | `server/sql/schema.sql` |
| Delivered transition, courier pay, per-shop balance credit | `server/sql/schema.sql` (`settle_delivery`) |
| LIFO attribution, listing and master removal | `server/src/db/queries/adminCatalogQueries.js` |
| Courier constants, checkout and delivery statements | `server/src/db/queries/orderQueries.js` |
| Balance debit, recharge, movements | `server/src/db/queries/vendorQueries.js` |
| Returns: the four transitions and the refund | `server/src/db/queries/returnQueries.js` |
| Income series and reconciliation | `server/src/db/queries/statisticsQueries.js` |
| Payments, refunds, vendor books | `server/src/db/queries/paymentQueries.js` |
| Shop reviews | `server/src/db/queries/shopReviewQueries.js` |
| Shared paging and filter parsing | `server/src/utils/listQuery.js` |
| The rules under test | `server/tests/refund.integration.test.js`, `server/tests/returns.integration.test.js`, `server/tests/readSurfaces.integration.test.js` |
