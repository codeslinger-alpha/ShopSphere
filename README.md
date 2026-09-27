# ShopSphere

Oracle Database, Express, React and Node.js shopping application using raw SQL.

Read the [backend guide](docs/BACKEND.md) for the file map, API routes, SQL,
transactions, stored routines and database rules.
The broader [website/API guide](docs/BACKEND.md) covers role workflows and
field ownership.
See the [current checklist review](docs/CHECKLIST.md), [demo dataset](docs/DEMO_DATA.md), and the
[schema reference and ERD](docs/SCHEMA.md).

From this directory, install dependencies once with `npm install`.
Configure `server/.env` from `server/.env.example`. The database is an Oracle
Autonomous Database reached through a wallet, so the connection is four settings
rather than a host and a port: `DB_USER`, `DB_PASSWORD`, `DB_CONNECT_STRING` (the
alias to use, as the wallet's own `tnsnames.ora` names it) and
`DB_WALLET_LOCATION` (the directory holding that file and the wallet's
credentials). Download the wallet for your database and unzip it into that
directory before starting the server.

For a **new empty database**, run `npm run db:init`. All definitions are in
`server/sql/schema.sql`; there is no separate migration step. Init refuses to
overwrite existing tables. Then `npm run db:seed` adds the expanded demo dataset and
`npm run dev` starts the API on port 5000 and website on port 5173.

`npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e` run validation.
The test commands need the development connection above to be configured; browser
tests also need Chromium
(`npm exec --workspace client -- playwright install chromium`).

`npm run docs:schema` rebuilds [docs/SCHEMA.md](docs/SCHEMA.md) from `schema.sql`. It needs
no database, and it does not run itself — rerun it after any schema change, or the
reference goes stale silently.

This is one npm workspace with a root lockfile and dependency installation.
The root, client and server `package.json` files have distinct purposes and are
required. Run installation and project commands from the root.
