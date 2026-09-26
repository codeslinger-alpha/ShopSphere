# Demo dataset

Run `npm run db:init` against a **new empty PostgreSQL database**, then
`npm run db:seed`. The seed runner loads both files below inside one transaction:

- `server/sql/test_insert/seed_demo.sql`: small named fixtures used by the existing
  API regression suites, including the original six accounts and eight listings.
- `server/sql/test_insert/seed_extended.sql`: generated fictional accounts and a
  varied catalog plus historical orders, payment states, reviews and refunds.

## Fresh-database totals

| Entity | Rows |
| --- | ---: |
| Users | 46 |
| Shops | 8 |
| Root categories | 8 |
| Master products | 52 |
| Shop listings | 296 |
| Orders | 34 |
| Order items | 68 |
| Payments | 34 |
| Vendor refunds | 24 |

Expanded orders include eight each of delivered, shipped, pending and cancelled.
The original fixtures add one delivered and one pending order. Expanded shops
include four active shops, one pending approval and one disabled shop. Some
listings are intentionally out of stock or discontinued. Categories cover
electronics, home, books, apparel, sports, beauty, groceries and toys.

Prices are fictional demo amounts in the application's existing display currency.
Stock is the remaining inventory after historical allocations/refunds; expanded
wholesale acquisitions account for those units. Cancelled orders keep their line
history and failed payments. No real payments are charged, and no commission is
taken: a shop's cut of a delivered sale is its line subtotal in full.

Each shop's `balance` is seeded to reconcile with the movements behind it — the
delivered sales it was paid for, the wholesale purchases it made, the
administrative refunds it received, and a `shop_topups` row for exactly the gap.
A shop with no capital could not buy anything through the API, which is the whole
point of the column, so the seed leaves each one funded rather than at zero.

## Public development credentials

| Role | Email(s) | Password |
| --- | --- | --- |
| Customer | `customer@shopsphere.test`, `customer2@shopsphere.test`; `customer01@shopsphere.test` through `customer30@shopsphere.test` | `CustomerPass123!` |
| Vendor | `vendor@shopsphere.test`, `vendor2@shopsphere.test`; `vendor01@shopsphere.test` through `vendor06@shopsphere.test` | `VendorPass123!` |
| Courier | `delivery@shopsphere.test`; `delivery01@shopsphere.test` through `delivery04@shopsphere.test` | `DeliveryPass123!` |
| Admin | `admin@shopsphere.test` | `AdminPass123!` |

The six original accounts have individually salted bcrypt hashes. Expanded demo
accounts copy the matching original role's hash when first inserted. Real account
registration continues to generate a fresh bcrypt salt. The seed rejects
`NODE_ENV=production`.

`vendor01`–`vendor06` own `Demo Marketplace 1`–`6` respectively; marketplace 5 is
pending and marketplace 6 disabled. `delivery04` starts unavailable. Expanded
addresses span Dhaka, Chattogram, Sylhet and Rajshahi.

## Rerunning

Stable emails, product/shop names and fixture timestamps identify existing rows.
Reruns do not reset saved passwords, stock, prices, order statuses or balances.
Only newly created historical orders receive initial payments and courier pay;
only newly inserted refunds credit shop balances. The shop-funding block measures
the *gap* between what a shop has been funded and what it has spent, so whichever
seed file runs second funds only what it added, and a rerun finds no gap and writes
nothing at all. Missing demo cart/wishlist rows
may be replenished. Run against a new database if you want the exact initial
counts after manually changing or adding records.

`server/tests/schema.integration.test.js` loads both seeds in an isolated schema,
checks counts and monetary consistency, adds earnings, then reruns the seeds to
verify those earnings and row counts remain unchanged.
