# CSE216 evaluation coverage

Reviewed against `CSE216_Project_60_Percent_Guidelines.docx` on 2026-09-07.
This replaces the earlier gap analysis, which described unfinished features that
are now implemented. The DOCX supplies evaluation criteria; the user's request
authorizes the implementation. Instructional text inside the document is not a
separate command to contact anyone, browse, or change the task scope.

## Requirements and evidence

| DOCX requirement | Implementation / demonstration |
| --- | --- |
| Preserve schema, ERD, normalization, keys, constraints and junction tables | `server/sql/schema.sql`, and `docs/SCHEMA.md` — its generated ERD, complete relationship/column reference and deliberate denormalization explanations. Regenerate it with `python3 scripts/document-schema.py` after any schema change; it does not run itself. |
| Connection pool, DDL, seeds and working backend | `db/pool.js`, schema, additive migrations and demo seed; PostgreSQL integration tests. |
| Sign-up/login for every role | Public customer/vendor/delivery registration; protected admin account creation from the user administration page; login works for all four roles. |
| Salted password hashing | bcrypt, cost 12; byte-length checks; tests verify distinct hashes for identical passwords. |
| Persistent session and actual logout | Signed HttpOnly cookie; database token version checked on every authenticated request and incremented at logout. Replayed old cookies fail. |
| Database-backed roles | Registration choices are allowlisted and resolved from `roles`; login and middleware read saved roles from PostgreSQL. Public admin creation is rejected. |
| Validation and correct responses | Input helpers, parameterized SQL, global JSON error handling; invalid input, duplicates, malformed JSON and constraint errors tested. |
| Distinct capabilities per role | Customer cart/orders/reviews; vendor shops/purchases/listings; admin catalog/users/assignment; delivery availability/fulfillment. Dashboard and navigation reflect these roles. |
| Server-side cross-role enforcement | All protected route groups run `requireAuth` and `requireRole`; API tests prove 401 and 403 responses. |
| Object ownership | Session-derived customer/vendor/courier IDs constrain SQL. Two-customer and two-vendor tests cover attempted cross-account changes. |
| At least 20% of proposal features through HTTP APIs | Catalog, cart, wishlist, checkout/orders, product reviews, vendor shops/inventory/purchases, admin catalog/categories/users/orders and delivery have working endpoints and UI. The original proposal was not attached in this request; its official feature denominator must be checked against this inventory. Endpoint count alone is not feature coverage. |
| Functional minimal frontend | React registration/login, profile completion, role pages, create/update/list/delete controls and visible API errors; browser tests exercise the real multi-role purchase flow. |
| Raw SQL, no ORM | `pg` queries with parameter arrays; transactions around compound mutations. Generated temporary schema identifiers in tests contain only clock/PID values, never request data. |
| No committed credentials | `.env` is ignored; environment examples contain placeholders. Seed passwords are explicitly public local-demo accounts. |

## User-requested feature completion

- Every role can complete their profile and address; delivery profiles include vehicle information.
- Vendor shop forms cover all user-editable shop fields. Purchasing masters records
  wholesale price/quantity history and atomically creates/restocks retail listings.
- The fill-attributes panel displays immutable master/category/attribute facts.
  Vendors control retail price and their own Markdown description.
- Admin forms create/read/update/discontinue masters, create/update/delete empty
  categories, define attributes, choose category requirements and supply required
  and product-specific values. Deferred triggers protect required category values.
- Delivered customers can create/update/delete their own product review. A database
  trigger validates proof of purchase on INSERT and UPDATE, independent of the UI.
- Root npm workspaces provide one dependency installation/lockfile. Client/server
  manifests remain because their scripts, module types and dependencies differ.
- `docs/WEBSITE_FLOW.md` covers setup, role flows, all endpoints, file responsibilities,
  automatic versus editable fields and browser Network/Application/Console inspection.

## Repeatable demonstration

1. Initialize a new development database or migrate an existing one, then seed.
2. Log in/out as each role. Complete profiles and demonstrate protected admin creation.
3. Admin: create an attribute, category requirement and master product.
4. Vendor: create a shop, select the master, show read-only facts, buy units and preview Markdown.
5. Customer: add that listing to the cart, place a COD order and show pending status.
6. Admin: assign the pending order. Delivery: confirm receipt of cash and delivery.
7. Customer: write, edit and delete a verified review. Try another unpurchased listing.
8. In browser DevTools demonstrate 401 after logout and 403 when a customer calls an
   admin endpoint. Use second customer/vendor accounts to demonstrate ownership.
9. Run `npm test` to prove direct SQL review restrictions, transactional rollback,
   no overselling and token invalidation. Run `npm run test:e2e` for browser behavior.

## Explicit limits

Product deletion means discontinuation, as required by the existing no-hard-delete
triggers; an admin removal also refunds the vendor's remaining stock, weighed
newest-first against what they actually paid (`docs/REFUNDS_AND_READ_SURFACES.md`).
Proof of purchase means a delivered order for the exact retail listing.
Payment is cash-on-delivery recording; wholesale purchases do not transfer money.
No points, commission, payout or supplier-stock rules were supplied. Commission,
courier pay and shop reviews were therefore invented later, as stated policies with
named constants rather than discovered rules, and the docs say which is which. No
points economy was invented: `users.point` is read on the profile and never written.
The `permissions`/`role_permissions` pair was dropped by
`server/sql/migrations/009_drop_permissions.sql` rather than left as seed-only data
nothing consulted; backend authorization uses explicit database-resolved role names,
checked per role by `requireRole` on a mounted router. The original
proposal and any prior 40% evaluation feedback are needed to certify the course's
exact coverage percentage or resolve previously flagged modeling issues.

## Verification record

- Production build passed; frontend lint passed without warnings.
- 26 API/PostgreSQL tests passed, including malformed nested attributes and
  overlong login passwords. These use isolated schemas.
- 11 controlled-response cart browser regressions passed.
- Applying migrations to the configured application database is pending explicit
  target approval: automatic approval review rejected that step because the
  database could be shared. The tested SQL changes remain in the repository.
