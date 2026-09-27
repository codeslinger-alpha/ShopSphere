# ShopSphere client

React + Vite with role-aware pages and an HTTP-only session cookie.
Run `npm install` once from the repository root, then `npm run dev` for both sides
or `npm run dev:client` for Vite only. Open http://localhost:5173.
The default API is http://localhost:5000/api; see `.env.example` to override it.

[Full website flow, source map, API reference and DevTools walkthrough](../docs/BACKEND.md)

`src/App.jsx` defines routes. `src/pages/` contains role screens;
`src/components/FormFields.jsx` shares forms, Markdown and master facts;
`src/api/http.js` sends JSON with `credentials: 'include'` and surfaces failures;
`src/auth/` handles sessions; `src/hooks/useResource.js` handles loading and saves.
`client/public/` contains the favicon, and the build generates `client/dist/`.

From the root, run `npm run build`, `npm run lint` or `npm run test:e2e`.
Browser tests use Chromium (`npm exec --workspace client -- playwright install chromium`)
or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Cart tests control API responses for edge
cases; the full role journey calls a real temporary Express API and PostgreSQL schema.
Configure `server/.env` and grant the development database user schema-creation
permission. Tests start a separate Vite instance on port 5174.

For debugging, press F12, open Network → Fetch/XHR, then submit a form. Headers
shows status and URL, Payload the submitted fields, and Response the JSON reply.
An initial `/auth/me` 401 is normal while signed out. Caught errors appear on the
page; server logs appear in the backend terminal, not the browser Console.
