# Orders, checkout and cash-on-delivery payment

This document covers the order-placement feature: how a cart becomes an order,
how stock is claimed safely when several customers buy from the same shop at the
same time, how the payment is recorded and settled, and what the test suite can
and cannot prove about all of it.

It is written for whoever maintains this code next — the reasoning behind the
concurrency design is the part that is not visible from reading the SQL.

## The one-paragraph version

`POST /api/orders` takes the caller's cart as its only input and does everything
inside one database transaction: it walks the cart in `prod_id` order, subtracting
each line's quantity from `products.in_stock` with a single conditional `UPDATE`
that fails if the stock is no longer there, then inserts the order, its items, and
a `pending` cash-on-delivery payment row, assigns an available courier, and
deletes the purchased cart rows. Any failure — a listing that sold out, an address that does not
exist, any error at all — rolls the whole transaction back, so an order either
exists complete with its stock claimed or nothing happened. Payment is cash on
delivery: the money is recorded as owed at checkout and settled when the courier
marks the order delivered.

## Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Payment method | Cash on delivery only | `payments.payment_method` already permits `'prepaid'`, so a gateway later is a new branch, not a migration. |
| When stock is claimed | At checkout, never while in the cart | A cart is a wish, not a hold. Holding stock for carts would need expiry and would let one abandoned tab block a sale. |
| Order spans shops | Yes, one order can contain lines from several shops | The seed already establishes this shape and `orders` has a single `shipping_address`. Per-shop sub-orders would change both the order and the delivery model. |
| Courier assignment | Automatic at checkout, by fewest open orders | Removes a dispatch step nobody was going to build. `delivery_person_id` stays `NULL` when nobody is available — the schema allows it and the seed's second order is already in that state. |
| Refunds | Vendor-approved returns, paid at approval | A cancelled order fails its pending cash-on-delivery payment — no customer money had moved. Once an order has been delivered, a customer may ask to return a line: the vendor accepts or declines, and acceptance refunds the customer. Separately, an admin withdrawing a listing pays the vendor for stock they still hold: `vendor_refunds`. That compensates a shop for unsold inventory, the return compensates a buyer for goods, and the two never share a table — see [`REFUNDS_AND_READ_SURFACES.md`](REFUNDS_AND_READ_SURFACES.md). |
| Delivery fee | Base fee plus a share of the goods total, priced at placement | `orders.delivery_cost` stays a column rather than a per-distance calculation, but it is now written at checkout rather than defaulting to `0`: it is **the same number as the courier's pay**, so the customer's payment covers goods plus trip exactly. |
| Platform commission | None | Removed entirely. The customer's payment is the shops' goods plus the courier's fee, and nothing is withheld in between. A shop's cut of a sale is its line subtotal in full. |
| Courier pay | The order's own `delivery_cost` | Read back from the row by `settle_delivery` rather than recomputed, so editing the rate constants re-prices future orders only. Credited by the same compare-and-set that moves the order to `delivered`, so a second tap cannot pay twice. |

## The concurrency problem

Two customers can have the same listing in their carts, and the last unit can be
in both. Reading stock and then writing it back is not safe here:

```sql
-- WRONG: two requests both read 1, both write 0, and one unit is sold twice.
SELECT in_stock FROM products WHERE prod_id = $1;
UPDATE products SET in_stock = in_stock - $2 WHERE prod_id = $1;
```

Between those two statements another transaction can commit. Under `READ
COMMITTED` — the default — the `SELECT` result is a snapshot the `UPDATE` never
re-checks.

The fix is to make the test and the decrement one statement, so PostgreSQL
evaluates them while it holds the row's write lock
([`CLAIM_STOCK`](../server/src/db/queries/orderQueries.js)):

```sql
UPDATE products p SET in_stock = p.in_stock - $2
FROM shops s, master_products mp
WHERE p.prod_id = $1
  AND p.discontinued = false
  AND p.in_stock >= $2
  AND s.shop_id = p.shop_id
  AND s.active_status = 'active'
  AND mp.master_prod_id = p.master_prod_id
  AND mp.active_status = 'available'
RETURNING p.prod_id, p.in_stock
```

Three things follow from this shape:

1. **A second claim waits, then re-tests.** The first buyer's `UPDATE` takes the
   row lock. The second buyer's statement blocks on it, and when the lock is
   released PostgreSQL re-evaluates the predicate against the *committed* row.
   `in_stock >= $2` is therefore never a stale read — it is the same condition the
   lock protects.
2. **`rowCount === 0` means "you lost".** The controller treats that as the
   failure signal, not as an error. It then runs a separate read
   (`CLAIM_FAILURE_DETAIL`) to say *what* is left, and returns `409` naming the
   listing. `READ COMMITTED` means that read sees the winner's committed result,
   so the number reported is the real one.
3. **Availability is part of the claim.** A listing whose shop was disabled, whose
   master product was discontinued, or which was itself marked discontinued
   between the cart page and checkout fails the same way, rather than being sold.
   These predicates mirror `ADD_CART_ITEM` so the two agree on what is buyable.

`CHECK (in_stock >= 0)` on the column is the backstop: if that predicate is ever
weakened, the database refuses the write instead of allowing negative stock.

### Deadlock avoidance

The claim loop runs one `UPDATE` per cart line. If two multi-item orders took
their rows in different sequences — one claiming A then B, the other B then A —
each would hold what the other wants and PostgreSQL would have to kill one. The
controller therefore claims in the order the query returns, and
`CART_FOR_ORDER` uses `ORDER BY c.prod_id` before `FOR UPDATE OF c`. Every checkout on the system
walks the listings in the same sequence, so a conflict becomes a wait, never a
deadlock.

### Atomicity

The claim loop is a series of writes, so a failure part way through would leave
stock subtracted for an order that was never created. Everything runs inside
`transaction(work)` from [`db/transaction.js`](../server/src/db/transaction.js),
which issues `BEGIN`, commits only if the callback returns, and rolls back on any
error. The `v.fail(409, ...)` for a short line is thrown from inside that
callback, so by the time the response is written every claim already made in that
request has been undone.

## The placement sequence

Inside one transaction, in this order:

| Step | Statement | Note |
| --- | --- | --- |
| 1 | `CART_FOR_ORDER` | Empty cart → `400`. Locks cart rows in `prod_id` order. |
| 2 | `CLAIM_STOCK` per line | `rowCount 0` → `409`, whole transaction rolls back. |
| 3 | `CREATE_LOCATION` or `USER_PROFILE_ADDRESS` | A supplied address becomes a new `locations` row; otherwise the profile's `users.address` is used. Neither → `400` naming the profile. |
| 4 | `FIND_AVAILABLE_COURIER` | Fewest open orders first; `NULL` when nobody is available. |
| 5 | `CREATE_ORDER` | `total_amount` is deliberately **not** written — the trigger owns it. |
| 6 | `CREATE_ORDER_ITEM` per line | `unit_price` is read during checkout and then stored on the order item; an earlier cart-page price is not reserved. |
| 7 | `RECORD_DELIVERY_COST` | `ROUND(COURIER_BASE_FEE + COURIER_RATE × total_amount, 2)` written onto the order. It must run **after** the items, because it is a share of `total_amount` and that is still `0` until `trg_order_items_recalc_total` has fired. This is the step that used to record the platform commission. |
| 8 | `ORDER_TOTALS` | Reads back `total_amount` after `trg_order_items_recalc_total` has written it. The database is the authority, not a sum in the controller. |
| 9 | `CREATE_PAYMENT` | `amount = total_amount + delivery_cost`, `'cash_on_delivery'`, `'pending'`, `paid_at = NULL`. The two halves are the shops' goods and the courier's trip — the whole of the customer's money. |
| 10 | `CLEAR_CART` | `DELETE` only the purchased product IDs for this user; preserve later additions. |

### Why `paid_at` is written explicitly as `NULL`

`payments.paid_at` defaults to `CURRENT_TIMESTAMP`. Inserting a pending
cash-on-delivery payment without naming the column would date it as paid the
moment it was created — the exact opposite of what `pending` means. `CREATE_PAYMENT`
names the column and passes `NULL`.

## The order lifecycle

```
                 ┌──────────────┐
   checkout ────▶│   pending    │──── cancel (customer) ───▶ cancelled
                 └──────┬───────┘                            (stock returned,
                        │ collect (courier)                   payment failed)
                        ▼
                 ┌──────────────┐
                 │   shipped    │──── (courier may undo, back to pending)
                 └──────┬───────┘
                        │ hand over (courier)
                        ▼
                 ┌──────────────┐
                 │  delivered   │  payment: pending ───▶ completed (paid_at set)
                 └──────────────┘
```

The legal transitions (`pending → shipped`, `pending → cancelled`,
`shipped → delivered`, `shipped → pending`) are enforced in the database by
`fn_guard_order_transition`, which raises on anything else. The endpoints restate
the same table so a mistake gets a `400`/`409` with a sentence rather than a
constraint violation.

The order's status and the payment's status move independently, and the UI shows
both:

| Order | Payment | Meaning |
| --- | --- | --- |
| `pending` | `pending` | Placed, not collected yet. Cash still to come. |
| `shipped` | `pending` | On the way. Cash still to come. |
| `delivered` | `completed` | Handed over and paid; `paid_at` records when. |
| `cancelled` | `failed` | Never happened. The payment is failed, not left pending, so it cannot later look like money owed. |

Marking an order delivered advances the order, completes the payment, credits the
courier and credits each shop for its own lines, all in one transaction inside the
`settle_delivery` procedure. It completes only a payment with status `pending`, so
a second delivery cannot re-date a settled payment — and because the courier's
earnings are credited by the same compare-and-set that moves the order, a courier
tapping "delivered" twice gets a `409` from the statement that would have paid
them, rather than being paid twice.

The courier is paid the order's own `delivery_cost`, read back from the row rather
than recomputed, and each shop is credited the full subtotal of its lines. The
sale credits the shop when it is **delivered**, not when it is placed: an order
still in a van is not money the shop can spend on stock. `COURIER_BASE_FEE` and
`COURIER_RATE` in `orderQueries.js` are named constants, and because the result is
stored on the order, changing them re-prices future orders only.

Cancelling is a compare-and-set — `order_status = 'pending'` is part of the
`UPDATE` predicate rather than read first and checked after — so two cancels
racing cannot both return the stock. The stock restore, the courier unassignment
and the payment failure are done by `fn_cleanup_cancelled_order`, which fires only
on the transition that actually happens. There is no commission to void: the
customer's money had not moved and nothing had been withheld from it.

## Endpoints

| Method | Path | Role | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/orders` | customer | Places the cart as an order. `201` with the created order; `400` empty cart or no address; `409` a line that sold out or went off sale. |
| `GET` | `/api/orders` | customer | The caller's own orders, newest first, with payment status. |
| `GET` | `/api/orders/:orderId` | customer | One order with its items. `404` if it is not the caller's. |
| `PUT` | `/api/orders/:orderId/cancel` | customer | `pending` only. `404` unknown, `409` already shipped or cancelled. |
| `GET` | `/api/delivery/deliveries` | delivery | The courier's assigned `pending` and `shipped` orders, with their items and the customer's contact details. |
| `PUT` | `/api/delivery/orders/:orderId/status` | delivery | `{"order_status":"shipped"\|"delivered"}`. `404` not assigned to this courier, `409` wrong current status. Delivering also completes the payment and credits the courier. |
| `GET` | `/api/account/payments` | customer | The caller's own payment history: goods and delivery charge as separate columns, and their sum as what was paid. |
| `GET` | `/api/vendor/payments` | vendor | The caller's books across owned shops: sales (no buyer identity), purchases, refunds received and the shop balance. Optional `shop_id` filters to one shop after the server verifies ownership. |
| `GET` | `/api/vendor/balance`; `POST /api/vendor/topups` | vendor | One shop's balance and the movements behind it; and a recharge that credits it. A recharge records the money and says plainly that no card was charged. |
| `POST` | `/api/returns`; `GET /api/returns` | customer | Ask to return a line of a delivered order; and the caller's own returns. The refund amount is computed from the order line, never supplied. |
| `GET` | `/api/vendor/returns`; `PUT /api/vendor/returns/:returnId/{approve,reject,restock}` | vendor | The returns to decide on, and the three transitions. `approve` debits the shop and records the refund; `restock` returns the goods to stock. |
| `GET` | `/api/delivery/returns`; `PUT /api/delivery/returns/:returnId/collect` | delivery | Approved returns awaiting pickup, and the transition that takes one off that list. |

Customer identity always comes from the JWT, never from the request body, and the
delivery queries are all keyed on `delivery_person_id = req.user.user_id`.

## Client

| Route | Page | What it does |
| --- | --- | --- |
| `/checkout` | `CheckoutPage` | Shows the cart as the order, offers "send to a different address", and posts the order. |
| `/orders` | `OrdersPage` | The customer's order history with both statuses. |
| `/orders/:orderId` | `OrderDetailPage` | Items, totals, address, courier, the payment record, Cancel while pending, the returns panel, and one shop-review form per shop that contributed a line. |
| `/delivery/deliveries` | `DeliveriesPage` | The courier's run, with only the next legal action on each order, and the return pickups waiting for a courier. |
| `/account/payments` | `AccountPaymentsPage` | The customer's own payment history, with a link back to each order. |
| `/vendor/balance` | `VendorBalancePage` | The shop balance, its movements and the recharge form. |
| `/vendor/statistics` | `VendorStatisticsPage` | Income over time and by listing, and the reconciliation against the balance. |

The cart page's "Proceed to checkout" link is disabled while any line is
unavailable or exceeds stock. That is a convenience, not a guarantee — the server
re-checks every line — but it stops the customer being sent to a checkout that is
certain to fail.

## Testing

`server/tests/order.integration.test.js` runs against the same temporary-schema
harness as the other integration suites: a schema is created for the run, mounted
inside a transaction that is rolled back at the end, and `pool.query` is stubbed
to point at it.

The harness had to be extended for this feature. `transaction()` obtains a client
via `pool.connect()`, and the older suites stubbed only `pool.query`, which would
have let a transactional controller escape the test schema and write to the real
database. The order suite stubs `pool.connect()` as well, and — because the whole
test already sits inside an outer transaction — maps the inner
`BEGIN`/`COMMIT`/`ROLLBACK` onto **savepoints**:

```js
if (statement === "BEGIN")  return client.query(`SAVEPOINT ${savepoint}`);
if (statement === "COMMIT") return client.query(`RELEASE SAVEPOINT ${savepoint}`);
if (statement === "ROLLBACK")
  return client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    .then(() => client.query(`RELEASE SAVEPOINT ${savepoint}`));
```

Without that, the stub silently swallowed `ROLLBACK` and the atomicity test
passed for the wrong reason: a partial claim survived an order that had failed.

### What the suite proves, and what it does not

Proven:

- a checkout claims the stock, creates the order, its items and a `pending`
  cash-on-delivery payment, and empties the cart;
- a listing that ran out or went off sale mid-checkout is refused, and nothing
  from that order is taken — including lines already claimed before the one that
  failed, which is the atomicity claim;
- `in_stock` is never negative, and the order total matches
  `SUM(quantity × unit_price)` from the trigger rather than from the controller;
- delivery completes the payment and sets `paid_at`; a delivery cannot skip
  `shipped`; a courier cannot touch an order that is not theirs;
- delivering credits the courier the order's own `delivery_cost` exactly once, and
  credits each shop the full subtotal of its lines, and a second delivery attempt
  is refused rather than paid;
- the customer's payment is the goods plus the trip, and the courier's earnings
  equal the sum of the delivery charges on the orders they delivered — no
  commission is taken anywhere in between;
- cancelling returns the stock, unassigns the courier and fails the pending
  payment, once;
- checkout assigns an available courier and leaves the order unassigned when there
  is none;
- the claim is a single statement whose predicate includes the stock test, and the
  `CHECK (in_stock >= 0)` constraint is present as the backstop.

The order suite uses one database session, so its savepoints prove rollback but
cannot reproduce parallel lock contention. The separate
`server/tests/concurrency.integration.test.js` uses independent PostgreSQL
connections in a disposable schema: it pauses checkout after the cart read,
starts another checkout, adds a different item, and verifies that the original
cart is purchased once while the new item remains. Concurrent different-customer
last-unit contention is still not covered by that test. Browser tests mock the
API and do not exercise database locks.

## Terminal output

Two loggers make the server's work visible while developing, both gated by
`utils/logging.js` (an explicit `LOG_SQL` / `LOG_REQUESTS` wins; otherwise on
outside production).

- **SQL** — `db/logger.js` wraps both choke points, `pool.query` in
  `db/pool.js` and the transactional client in `db/transaction.js`, and
  prints one collapsed line per statement with its duration and row count,
  omitting bound parameter values. A failed statement logs its PostgreSQL error code.
- **Requests** — `middleware/requestLogger.js` prints one line per request with
  status, method, path, duration and user id. Errors that reach
  `errorMiddleware` are logged with the same shape, including the `4xx` responses
  that used to be returned silently.

The integration tests run with `LOG_SQL=false LOG_REQUESTS=false`, so the suite's
output stays readable.

## Out of scope

- **Prepaid payment.** A gateway would add a branch to `CREATE_PAYMENT` and a
  completion callback; nothing else in the flow assumes cash.
- **Split orders per shop.** One order spans shops by design.
- **Refunding a customer directly.** A cancel fails the pending payment; no
  customer money had moved. A customer is refunded through a **return**, which the
  vendor has to accept first, and which lives in
  [`REFUNDS_AND_READ_SURFACES.md`](REFUNDS_AND_READ_SURFACES.md) — as do vendor
  refunds, which are a different kind of money again.
- **Delivery fee rules.** `delivery_cost` is a column written from two constants at
  placement, not a distance or weight calculation.
- **Image upload.** Product imagery is external placeholder URLs resolved by
  `ProductMedia.jsx`. A listing with no image URL and no keyword match shows its
  category's illustration, which is a local file, so it survives being offline;
  the stages above that are remote and need network access.
- **Retroactive pay changes.** `COURIER_BASE_FEE` and `COURIER_RATE` are applied at
  placement and the result is stored on the order, so changing a constant changes
  future orders only — an order already placed pays what it was priced at.
