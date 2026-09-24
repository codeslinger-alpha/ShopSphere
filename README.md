# ShopSphere

PostgreSQL, Express, React and Node.js shopping application using raw SQL.

Read the [server/database flow guide](docs/SERVER_DATABASE_FLOW.md) for the API,
controllers, SQL, transactions, triggers and browser developer-tools inspection.
The broader [website/API guide](docs/WEBSITE_FLOW.md) covers role workflows and
field ownership.
See [evaluation coverage](docs/IMPLEMENTATION_STEPS.md) and the
[schema reference and ERD](docs/SCHEMA.md).

From this directory, install dependencies once with `npm install`.
Configure `server/.env` from `server/.env.example` and create a PostgreSQL database.
For a **new empty database**, run `npm run db:init`. For an **existing database**, run
`npm run db:migrate`. Then `npm run db:seed` adds local demonstration accounts and
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
