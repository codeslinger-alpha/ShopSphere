# ShopSphere API

Express + PostgreSQL with raw parameterized SQL and no ORM. The API uses the
shared pool in `src/config/db.js`, routes in `src/routes/`, feature controllers
in `src/controllers/`, query constants in `src/queries/` and shared validation,
transactions and authentication middleware. Express serves `/api/...` only.

Run commands from the repository root: `npm install`, `npm run dev:server`.
Configure `server/.env` from `.env.example`. Use `npm run db:init` for a new empty
database, or `npm run db:migrate` for an existing ShopSphere database, followed
by `npm run db:seed` for local demo data. Never rerun the fresh schema over existing
tables. Migrations preserve data and the demo seed skips existing matching rows.

[Complete setup, demo credentials, endpoint reference and website flow](../docs/WEBSITE_FLOW.md)

[Schema, ERD and trigger reference](../docs/SCHEMA.md)

`npm test` runs real HTTP/PostgreSQL tests in temporary schemas. They require a
configured development connection with schema-creation permission, and remove only
their generated schemas. Tests cover cart regressions, all-role authentication,
ownership, admin catalog transactions, vendor purchases, checkout concurrency,
delivery, direct SQL review enforcement and logout. Backend logs appear in the
server terminal; browser Network shows public JSON responses.
