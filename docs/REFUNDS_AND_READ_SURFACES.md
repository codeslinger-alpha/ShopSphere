# Refunds, commission, courier pay, and who may read what

Three rules that move money, and one table saying which account can see which table.
The rules exist because the schema had the columns and nothing that filled them:
`shops.earnings`, `delivery_personnel.earnings`, `orders.platform_commission` and
`order_items.platform_commission` were all at their default zero from the first commit.

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

`REFUND_ATTRIBUTION` in `server/src/queries/adminCatalogQueries.js` answers it in one
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

## Platform commission

`PLATFORM_COMMISSION_RATE = 0.05`, in `server/src/queries/orderQueries.js`. At placement,
each `order_items` line records `ROUND(quantity * unit_price * rate, 2)` in its own
`platform_commission` column, and `RECORD_PLATFORM_COMMISSION` copies the **sum of the
lines** onto `orders.platform_commission`.

Per line, then summed — not the order total multiplied by the rate. The two disagree
whenever a line's subtotal does not divide evenly: three lines of 3 × $10.10 are $1.52
each, $3.04 in total, where 5% of the $90.90 total is $3.03. Summing the lines is what
stops an order from disagreeing with its own items.

`total_amount` is still `fn_recalc_order_total`'s alone. Gross value and platform revenue
are different numbers, and a schema that kept only one would be a reporting bug nobody
notices until the figures are needed.

**A cancelled order earns no commission.** `fn_cleanup_cancelled_order` zeroes
`orders.platform_commission` and its order items as well as returning the stock —
`server/sql/migrations/008_cancel_voids_commission.sql`. Without it, the admin payments
screen would show a cancelled order beside a failed payment while still reporting the
margin it never earned. Because the rate is applied at placement, changing the constant
changes only future orders: every past order keeps the commission it was placed with.

## Courier pay

Inside the delivered transition, and nowhere else:

```
earnings += COURIER_BASE_FEE + COURIER_RATE * total_amount
```

with `COURIER_BASE_FEE = 3` and `COURIER_RATE = 0.02`. An order whose goods come to
$90.00 pays the courier $3.00 + $1.80 = $4.80; `delivery_cost` is not part of it, being
what the customer pays for the trip rather than what the trip is paid. The flat part is
what makes a short delivery worth doing; the share is what makes a large one worth doing
carefully.

It cannot be paid twice, and that is not a second guard: `ADVANCE_ORDER_STATUS` is a
compare-and-set that moves one row exactly once, so a courier tapping "delivered" twice
gets a `409` from the same statement that would have paid them.

## Who may read what

Every read surface below derives its subject from the session, never from the request.
`/api/vendor/payments` takes no `shop_id`; `/api/account/payments` takes no `user_id`; a
customer's order list filters on the JWT's user id. That is the whole isolation story,
and it is why the server tests are mostly about what a caller must *not* see.

| Table | Admin | Vendor | Customer | Courier | Guest |
| --- | --- | --- | --- | --- | --- |
| `users` | `GET /admin/users` (paged, filterable by role/status) | own profile | own profile | own profile | — |
| `roles` | `GET /admin/users` shows the role a user holds | — | — | — | — |
| `shops` | `GET /admin/shops`, with `earnings` | `GET /vendor/shops`; totals in `/vendor/payments` | public `GET /shops` (no earnings) | — | public `GET /shops` |
| `master_products` | manage via `/admin/master-products` | `GET /vendor/master-products`, read-only facts | through the catalog | — | through the catalog |
| `products` | `GET /admin/shops/:id/listings`; remove and refund | `GET /vendor/listings` | `GET /products` | — | `GET /products` |
| `attributes`, `category_attributes`, `attribute_values` | manage via `/admin/*` | read on masters | read via `GET /products/:id` | — | read |
| `shop_purchases` | only as the basis of a refund | `GET /vendor/purchases`; spend in `/vendor/payments` | — | — | — |
| `orders` | joined into `GET /admin/payments` | sales rows in `/vendor/payments`, **without the buyer's name or email** | own `GET /orders`, `/orders/:id` | assigned `GET /delivery/deliveries` | — |
| `order_items` | commission per line via `/admin/payments` | `net_to_shop` per sale | items on their own order | items per delivery | — |
| `payments` | `GET /admin/payments` — every payment | — | `GET /account/payments` — own only, **without commission** | — | — |
| `vendor_refunds` | `GET /admin/refunds`, with shop, listing and the acting admin | own shops' refunds in `/vendor/payments` | — | — | — |
| `product_reviews` | public read; write only as a buyer | " | write own, eligibility-gated | — | read |
| `shop_reviews` | public read; write only as a buyer | " | write own, eligibility-gated | — | read |
| `delivery_personnel` | `earnings` on `GET /admin/shops`-style lists | — | — | own `earnings` on the profile and workspace | — |
| `cart_items`, `wishlist_items` | — | — | own | — | — |
| `locations`, `countries` | via users and orders | via orders | own profile and orders | delivery address | `GET /countries` |

Three asymmetries are deliberate rather than omissions:

- **A vendor does not see the buyer's name or email.** The courier delivers the parcel and
  already has it; the vendor is fulfilling against an order number. The vendor's sales rows
  carry `order_id` and nothing that identifies the customer.
- **A customer does not see commission.** The margin is not the buyer's business, and the
  server does not send the field at all — the checkout response leaves it out too, so the
  page has nothing to hide.
- **`users.point` is read and never written.** The profile shows it; no rule moves it. A
  points economy was deliberately not invented, and the column staying still is the honest
  version of that.

## There is no permission table

`permissions` and `role_permissions` are gone — `009_drop_permissions.sql` drops them, and
the admin console's Permissions tab went with them. They had held seven `demo.*`
permissions and seven grants since the first seed, and no code ever read either table:
authorization here is `requireRole(roleName)` on a mounted router, which is a check per
role and never per capability.

A table that looks like an authorization model and is not one is worse than no table. It
invites exactly one mistake — someone adding a grant and believing it grants something —
and it made every reader learn that the two tables were decorative. If per-capability
authorization is ever wanted, it should arrive with the code that consults it; `roles`
stays, because that is what a user's role actually points at.

## Where the pieces live

| Piece | File |
| --- | --- |
| Refund table, `fn_prevent_delete` interaction | `server/sql/migrations/006_vendor_refunds.sql` |
| Shop-review purchase trigger | `server/sql/migrations/007_shop_review_verification.sql` |
| Cancellation voids commission | `server/sql/migrations/008_cancel_voids_commission.sql` |
| The permission tables dropped | `server/sql/migrations/009_drop_permissions.sql` |
| LIFO attribution, listing and master removal | `server/src/queries/adminCatalogQueries.js` |
| Commission and courier constants and statements | `server/src/queries/orderQueries.js` |
| Payments, refunds, vendor books | `server/src/queries/paymentQueries.js` |
| Shop reviews | `server/src/queries/shopReviewQueries.js` |
| Shared paging and filter parsing | `server/src/utils/listQuery.js` |
| The rules under test | `server/tests/refund.integration.test.js`, `server/tests/readSurfaces.integration.test.js` |
