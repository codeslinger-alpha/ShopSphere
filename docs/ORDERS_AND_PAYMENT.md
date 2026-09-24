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
deletes the cart. Any failure — a listing that sold out, an address that does not
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
| Refunds | None on the customer side; vendor refunds exist | A cancelled order fails its pending cash-on-delivery payment — no customer money had moved. Separately, an admin withdrawing a listing pays the vendor for the stock they still hold: `vendor_refunds`, described in [`REFUNDS_AND_READ_SURFACES.md`](REFUNDS_AND_READ_SURFACES.md). That compensates a shop for unsold inventory, not a buyer for an order, and the two never share a table. |
| Delivery fee | Flat, defaulting to `0` | `orders.delivery_cost` stays a column rather than a per-distance calculation. It is what the customer pays for the trip, not what the courier is paid — see the courier rule below. |
| Platform commission | 5% per line at placement, stored | Named constants in `orderQueries.js`, not inline numbers. Written per `order_items` line and summed onto the order, so gross value and platform revenue are never the same column. |
| Courier pay | Base fee plus a share of the goods total, on delivery | Credited in the same statement that completes the payment, so the compare-and-set that makes delivery happen once is what makes the courier paid once. |

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
([`CLAIM_STOCK`](../server/src/queries/orderQueries.js)):

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
`CART_FOR_ORDER` ends with `ORDER BY c.prod_id`. Every checkout on the system
walks the listings in the same sequence, so a conflict becomes a wait, never a
deadlock.

### Atomicity

The claim loop is a series of writes, so a failure part way through would leave
stock subtracted for an order that was never created. Everything runs inside
`transaction(work)` from [`utils/transaction.js`](../server/src/utils/transaction.js),
which issues `BEGIN`, commits only if the callback returns, and rolls back on any
error. The `v.fail(409, ...)` for a short line is thrown from inside that
callback, so by the time the response is written every claim already made in that
request has been undone.

## The placement sequence

Inside one transaction, in this order:

| Step | Statement | Note |
| --- | --- | --- |
| 1 | `CART_FOR_ORDER` | Empty cart → `400`. Ordered by `prod_id`. |
| 2 | `CLAIM_STOCK` per line | `rowCount 0` → `409`, whole transaction rolls back. |
| 3 | `CREATE_LOCATION` or `USER_PROFILE_ADDRESS` | A supplied address becomes a new `locations` row; otherwise the profile's `users.address` is used. Neither → `400` naming the profile. |
| 4 | `FIND_AVAILABLE_COURIER` | Fewest open orders first; `NULL` when nobody is available. |
| 5 | `CREATE_ORDER` | `total_amount` is deliberately **not** written — the trigger owns it. |
| 6 | `CREATE_ORDER_ITEM` per line | `unit_price` is the cart's snapshot, so a later price change cannot rewrite what was agreed. The line also records its own `platform_commission` — `ROUND(quantity × unit_price × rate, 2)`. |
| 7 | `RECORD_PLATFORM_COMMISSION` | Copies the **sum of the lines** onto `orders.platform_commission`. Per line then summed, not the order total times the rate: the two disagree whenever a line does not divide evenly. `total_amount` is still `trg_order_items_recalc_total`'s alone. |
| 8 | `ORDER_TOTALS` | Reads back `total_amount` after `trg_order_items_recalc_total` has written it. The database is the authority, not a sum in the controller. |
| 9 | `CREATE_PAYMENT` | `amount = total_amount + delivery_cost`, `'cash_on_delivery'`, `'pending'`, `paid_at = NULL`. |
| 10 | `CLEAR_CART` | `DELETE FROM cart_items WHERE user_id = $1`. |

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

Marking an order delivered advances the order, completes the payment and credits
the courier, all in one transaction. `COMPLETE_PAYMENT` is itself conditional on
the payment still being `pending`, so a second delivery cannot re-date a settled
payment — and because the courier's earnings are credited by the same
compare-and-set that moves the order, a courier tapping "delivered" twice gets a
`409` from the statement that would have paid them, rather than being paid twice.

The courier is paid `COURIER_BASE_FEE + COURIER_RATE × total_amount` — a named
constant each, in `orderQueries.js`. `delivery_cost` is deliberately not part of
it: that is what the customer pays for the trip, not what the trip is paid. The
flat part is what makes a short delivery worth doing, the share what makes a large
one worth doing carefully.

Cancelling is a compare-and-set — `order_status = 'pending'` is part of the
`UPDATE` predicate rather than read first and checked after — so two cancels
racing cannot both return the stock. The stock restore, the payment failure and
the voiding of the order's platform commission are done by
`fn_cleanup_cancelled_order`, which fires only on the transition that actually
happens. Voiding the commission is migration 008: without it the admin payments
screen would show a cancelled order beside a failed payment while still reporting
a margin that never existed.

## Endpoints

| Method | Path | Role | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/orders` | customer | Places the cart as an order. `201` with the created order; `400` empty cart or no address; `409` a line that sold out or went off sale. |
| `GET` | `/api/orders` | customer | The caller's own orders, newest first, with payment status. |
| `GET` | `/api/orders/:orderId` | customer | One order with its items. `404` if it is not the caller's. |
| `PUT` | `/api/orders/:orderId/cancel` | customer | `pending` only. `404` unknown, `409` already shipped or cancelled. |
| `GET` | `/api/delivery/deliveries` | delivery | The courier's assigned `pending` and `shipped` orders, with their items and the customer's contact details. |
| `PUT` | `/api/delivery/orders/:orderId/status` | delivery | `{"order_status":"shipped"\|"delivered"}`. `404` not assigned to this courier, `409` wrong current status. Delivering also completes the payment and credits the courier. |
| `GET` | `/api/account/payments` | customer | The caller's own payment history, without the platform's commission in the response at all. |
| `GET` | `/api/vendor/payments` | vendor | The caller's books across owned shops: sales (no buyer identity), purchases, refunds received and earnings. No shop ID is accepted. |

Customer identity always comes from the JWT, never from the request body, and the
delivery queries are all keyed on `delivery_person_id = req.user.user_id`.

## Client

| Route | Page | What it does |
| --- | --- | --- |
| `/checkout` | `CheckoutPage` | Shows the cart as the order, offers "send to a different address", and posts the order. |
| `/orders` | `OrdersPage` | The customer's order history with both statuses. |
| `/orders/:orderId` | `OrderDetailPage` | Items, totals, address, courier, the payment record, Cancel while pending, and one shop-review form per shop that contributed a line. |
| `/delivery/deliveries` | `DeliveriesPage` | The courier's run, with only the next legal action on each order. |
| `/account/payments` | `AccountPaymentsPage` | The customer's own payment history, with a link back to each order. |

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
- delivering credits the courier `COURIER_BASE_FEE + COURIER_RATE × total_amount`
  exactly once, and a second delivery attempt is refused rather than paid;
- each line records its own `platform_commission` and the order carries the sum of
  the lines, which is not the same as the rate applied to the order total;
- cancelling returns the stock, fails the pending payment and voids the commission,
  once;
- checkout assigns an available courier and leaves the order unassigned when there
  is none;
- the claim is a single statement whose predicate includes the stock test, and the
  `CHECK (in_stock >= 0)` constraint is present as the backstop.

**Not** proven: true parallel contention. The test harness runs one database
session, and savepoints nest inside it, so two simulated concurrent checkouts
cannot actually contend for a row lock — a simulated "loser" whose savepoint is
outermost would roll back more than its own work. The suite therefore asserts the
atomic statement and the constraint directly instead of claiming a race it cannot
reproduce. The Playwright suite cannot settle it either, since every API response
there is mocked. Seeing the real behavior needs two live connections — two
browsers signed in as two customers, buying the last unit of a one-unit listing
at the same moment — and that is the honest manual check.

## Terminal output

Two loggers make the server's work visible while developing, both gated by
`utils/logging.js` (an explicit `LOG_SQL` / `LOG_REQUESTS` wins; otherwise on
outside production).

- **SQL** — `utils/sqlLogger.js` wraps both choke points, `pool.query` in
  `config/db.js` and the transactional client in `utils/transaction.js`, and
  prints one collapsed line per statement with its duration, row count and
  parameters. A failed statement logs its PostgreSQL error code.
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
- **Refunding a customer.** Cancel fails the pending payment; no customer money had
  moved, so there is nothing to return. Vendor refunds are a different kind of
  money and live in [`REFUNDS_AND_READ_SURFACES.md`](REFUNDS_AND_READ_SURFACES.md).
- **Delivery fee rules.** `delivery_cost` is a column, not a calculation.
- **Image upload.** Product imagery is external placeholder URLs resolved by
  `ProductMedia.jsx`. A listing with no image URL and no keyword match shows its
  category's illustration, which is a local file, so it survives being offline;
  the stages above that are remote and need network access.
- **Retroactive commission.** Every order placed before migration 008 keeps
  `platform_commission` at its default zero. The rate is applied at placement, so
  changing the constant changes future orders only.
