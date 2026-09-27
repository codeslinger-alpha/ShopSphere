# ShopSphere API

Express + Oracle Database with raw parameterized SQL and no ORM. The API uses the
shared pool in `src/db/pool.js`, routes in `src/routes/`, feature controllers
in `src/controllers/`, query constants in `src/db/queries/` and shared validation,
transactions and authentication middleware. Express serves `/api/...` only.

Run commands from the repository root: `npm install`, `npm run dev:server`.
Configure `server/.env` from `.env.example`. The database is an Oracle Autonomous
Database reached through a wallet, so the connection is `DB_USER`, `DB_PASSWORD`,
`DB_CONNECT_STRING` — the alias to use, as the wallet's `tnsnames.ora` names it,
not a host and port — and `DB_WALLET_LOCATION`, the directory holding that file and
the wallet's credentials. Unzip the wallet there before starting the server.
`npm run db:check` connects and reports what it found, without changing anything.

Use `npm run db:init` for a new empty schema, followed by `npm run db:seed` for
local demo data. Init refuses existing tables. The demo seed preserves matching
accounts, inventory and earnings.

[Backend file, API and database guide](../docs/BACKEND.md)

[Complete setup, demo credentials, endpoint reference and website flow](../docs/BACKEND.md)

[Schema, ERD and trigger reference](../docs/SCHEMA.md)

`npm test` runs the API integration suite against the configured development
connection, over real HTTP. Tests cover cart regressions, all-role authentication,
ownership, admin catalog transactions, vendor purchases, checkout concurrency,
delivery, direct SQL review enforcement and logout. Backend logs appear in the
server terminal; browser Network shows public JSON responses.

[Checklist review](../docs/CHECKLIST.md) · [Expanded dataset and accounts](../docs/DEMO_DATA.md)
