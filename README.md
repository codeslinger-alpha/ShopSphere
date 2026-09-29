# ShopSphere

PostgreSQL, Express, React and Node.js shopping application using raw SQL.

Read the [backend guide](docs/BACKEND.md) for the file map, API routes, SQL,
transactions, stored routines and database rules.
The broader [website/API guide](docs/WEBSITE_FLOW.md) covers role workflows and
field ownership.
See the [current checklist review](docs/CHECKLIST.md), [demo dataset](docs/DEMO_DATA.md), and the
[schema reference and ERD](docs/SCHEMA.md).

From this directory, install dependencies once with `npm install`.
Configure `server/.env` from `server/.env.example` and create a PostgreSQL database.
For a **new empty database**, run `npm run db:init`, then `npm run db:seed`.
All definitions are in `server/sql/schema.sql`; there are no migration files.
After every schema change, run `npm run db:reset` to recreate the public schema
and populate both demo datasets. It deletes the application's existing data.
`npm run dev` starts the API on port 5000 and website on port 5173.

`npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e` run validation.
Tests need PostgreSQL schema-creation permission; browser tests also need Chromium
(`npm exec --workspace client -- playwright install chromium`).

`npm run docs:schema` rebuilds [docs/SCHEMA.md](docs/SCHEMA.md) from `schema.sql`. It needs
no database, and it does not run itself — rerun it after any schema change, or the
reference goes stale silently.

This is one npm workspace with a root lockfile and dependency installation.
The root, client and server `package.json` files have distinct purposes and are
required. Run installation and project commands from the root.
