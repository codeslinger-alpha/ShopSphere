# Deploying ShopSphere for free

Three hosts, all on free plans, all deploying from the same GitHub repository:

| Piece | Host | What it serves |
| --- | --- | --- |
| Website | **Vercel** | the React build, and `/api/*` proxied to the API |
| API | **Render** | the Express server |
| Database | **Supabase** | PostgreSQL (already set up) |

The repository already carries the two files that configure this:
`client/vercel.json` and `render.yaml`. No application code changed — not in
`server/src` and not in `client/src`. The API already served a health route that
checks the database
(`GET /api/health` → `catalogController.healthCheck`), which is exactly what the
keep-alive ping below needs.

## Why the website proxies the API

The website (`*.vercel.app`) and the API (`*.onrender.com`) are different *sites*,
not merely different origins. The session cookie is `sameSite: "lax"`, and a
browser will not attach a `lax` cookie to a cross-site request — so if the browser
called Render directly, login would appear to succeed and every request after it
would arrive unauthenticated. The usual fix is `sameSite: "none"`, which makes the
cookie third-party; Safari blocks those outright and Chrome is phasing them out.

So the browser never talks to Render. It calls `/api/...` on its own Vercel
domain, and `client/vercel.json` proxies that to Render:

```
browser ──https──▶ shopsphere.vercel.app
                     ├── /            → the React build
                     └── /api/*       ──proxy──▶ shopsphere-api.onrender.com
                                                      │
                                                      └──▶ Supabase pooler
```

The cookie is therefore first-party, `sameSite: "lax"` keeps working, CORS is
never consulted, and neither the cookie code nor the CORS config needed changing.

If you would rather call Render directly, you must set `CLIENT_ORIGIN` to the
Vercel URL **and** change `cookieOptions()` in `server/src/utils/authToken.js` to
`sameSite: "none"`. Expect some visitors' logins to fail anyway.

## Before you start

- The repository pushed to GitHub (Step 1). Both hosts deploy from it.
- `server/.env` working locally against Supabase — it already is.
- A [Render](https://render.com) and a [Vercel](https://vercel.com) account, both
  signed in with GitHub.

Two values from `server/.env` are needed as secrets during the deploy:
`DB_PASSWORD` and `JWT_SECRET`. Keep them out of the repository — `render.yaml`
marks them `sync: false`, so Render prompts for them instead of reading them from
the file.

## Step 1 — GitHub

```bash
git add -A
git commit -m "Add deployment configuration"
git push origin main
```

Check before pushing that nothing secret is staged: `git status --short`. `.env`
and `.env.*` are ignored, and only `.env.example` files are tracked.

## Step 2 — Supabase (already done)

Nothing to create. The database is already the Supabase **session pooler** in
`ap-south-1`, and `server/src/db/pool.js` connects to it without any SSL option,
which is verified working locally.

If the schema has never been applied to this project, run it **once**, from your
machine, before the first deploy:

```bash
npm run db:init     # creates the schema
npm run db:seed     # demo data
```

> ⚠️ **The deployed site and your laptop share this one database.** That makes
> setup simple, and it means `npm run db:reset` or `npm run db:seed` from your
> laptop wipes the live site's data. Once deployed, treat those two commands as
> production commands.

Use the **session** pooler (port `5432`), not the transaction pooler (port
`6543`): the API runs explicit transactions, and session mode is what guarantees
a transaction stays on a single connection.

## Step 3 — Render (the API)

1. Render dashboard → **New** → **Blueprint**.
2. Pick the ShopSphere repository. Render reads `render.yaml` and shows one
   service, `shopsphere-api`.
3. It prompts for the three `sync: false` values. Fill them in:
   - `DB_USER` — from `server/.env`, the full `postgres.<project-ref>` value
   - `DB_PASSWORD` — from `server/.env`
   - `JWT_SECRET` — from `server/.env` (at least 32 characters, or the server
     refuses to start)
4. **Apply**. The first build takes a few minutes.
5. When it goes live, note the URL — `https://shopsphere-api.onrender.com` unless
   the name was taken. **If it differs, update the `destination` in
   `client/vercel.json` to match.**

Confirm it is up:

```bash
curl https://shopsphere-api.onrender.com/api/health
# {"success":true,"database":true}
```

A `503`, or `"database":false`, means the app started but cannot reach the
database — check `DB_HOST`, `DB_USER` and `DB_PASSWORD` in the Render dashboard.

## Step 4 — Vercel (the website)

1. Vercel dashboard → **Add New** → **Project** → import the same repository.
2. Set **Root Directory** to `client` and leave **Output Directory** empty. Both
   are resolved relative to the Root Directory, and this is also why the rewrite
   rules live at `client/vercel.json` instead of at the repository root: Vercel
   reads that file only from the Root Directory, so a copy at the repository root
   is not read at all — the `/api/*` proxy is never registered and the build ends
   in `No Output Directory named "dist"`, hunting for output the framework preset
   guessed at. `dist` is where Vite writes; `client/dist` typed in that field
   would mean `client/client/dist`.
3. Under **Environment Variables**, add:

   | Name | Value |
   | --- | --- |
   | `VITE_API_URL` | `/api` |

   **This one is required.** `client/src/api/http.js` falls back to
   `http://localhost:5000/api` when it is unset, so without it the deployed site
   tries to reach your laptop and every request fails with "Could not connect to
   the server."
4. **Deploy** and note the URL.

## Step 5 — Close the loop

Back in Render → the `shopsphere-api` service → **Environment**, set
`CLIENT_ORIGIN` to the real Vercel URL (it is a placeholder until now), then let
it redeploy. This changes nothing about how the app works — the proxy means no
cross-origin request is ever made — but it keeps the API's own CORS rule
accurate rather than aspirational.

Then open the Vercel URL and walk through it:

- register an account and confirm you stay logged in after a page reload
- add something to the cart and place an order
- open `/vendor/statistics` **by typing the URL directly** — this proves the SPA
  fallback rewrite works, not just in-app navigation
- in the browser devtools, check the `shopsphere_token` cookie: `HttpOnly`,
  `Secure`, `SameSite=Lax`, and its domain is the Vercel host

If login works but nothing after it does, the cookie is not being sent — see
"Why the website proxies the API" above.

## Keeping it free, and awake

**Vercel** serves a static build over its edge network, so it does not sleep and
there is nothing to keep awake. The Hobby plan's allowances — 100 GB of bandwidth
and 10 GB of origin transfer a month — are far beyond what a demo uses, though
note that the `/api/*` proxy means API traffic is counted here rather than at
Render. At any realistic scale this is nothing.

> **Hobby is for non-commercial use only.** This is a legal restriction, not a
> technical one, and it applies however little traffic the site gets: a storefront
> taking real orders, a paid client project, or anything generating revenue
> directly or indirectly belongs on the Pro plan. Running it as a portfolio piece
> or a demo is exactly what Hobby is for.

**Render** free web services sleep after **15 minutes** without inbound traffic and
take **about a minute** to wake, so the first visit after a quiet spell is slow.
The instance is also small — 512 MB RAM and 0.1 CPU, with an ephemeral
filesystem — which is plenty for this app but worth knowing.

There are two reasons to keep it awake:

- the cold start itself;
- Supabase pauses a free project that sees too little **database activity** over a
  seven-day window.

The second one has a subtlety worth stating: Supabase counts real queries against
Postgres, not merely a successful HTTP response. A health endpoint that returns
`200` without touching the database does **not** reset the timer. This app's
`/api/health` runs a genuine `SELECT 1` through the pooler
(`catalogController.healthCheck`), so it does count.

Point a free monitor at it every 10–14 minutes — [cron-job.org](https://cron-job.org)
and [UptimeRobot](https://uptimerobot.com) both do this free:

```
https://shopsphere-api.onrender.com/api/health
```

If the site is actually used most days, its own traffic is already enough to keep
Supabase awake; the ping is what covers the quiet weeks.

### The catch: 750 hours, and a month is longer

Render's free plan gives **750 instance hours per calendar month**, shared across
every free service in the workspace. Hours are only consumed while a service is
running, they reset each month, and unused hours do not carry over. Exceed them
and free services are **suspended until the next month**.

The arithmetic is the trap. A 31-day month is 744 hours, so a single service kept
awake around the clock fits inside 750 — but with only six hours of slack, and a
keep-alive ping is precisely what spends it. Two free services cannot both stay
awake.

So the ping is a trade: it buys away the cold start and the Supabase pause, and it
spends the month's hours to do it. If Render warns you near the end of a long
month, switch the ping to daytime hours only — the service will sleep overnight
and be slow on the first morning request, which is a fair price.

### If Supabase does pause

It is not deleted. Supabase emails a warning about a week beforehand, and a paused
project can be resumed from the dashboard for up to **a year** afterwards.

One thing that is not recoverable: the free plan includes **zero days of backup
retention**. A resume restores the database exactly as it was when it froze, but
anything deleted or changed before that is gone for good. There is no rollback.

> These figures are what the plans were when this was written, and free tiers
> change. The two dashboards are the authority — Render's billing page for hours,
> Supabase's project page for pause status.

## Redeploying

Both hosts rebuild automatically on every push to `main`. Nothing to run.

A schema change is different: `schema.sql` is fresh-database-only, so apply it to
Supabase from your laptop with `npm run db:reset` — remembering that this is the
live database.

## When something is wrong

| Symptom | Where to look |
| --- | --- |
| "Could not connect to the server." | `VITE_API_URL` missing in Vercel, or the `destination` in `client/vercel.json` does not match the Render URL |
| Logged in, then every request 401s | the cookie is not being sent; the proxy rewrite is missing or ordered after the catch-all |
| `503` from `/api/health` | the API is up but the database is unreachable — Render's env vars |
| Build fails on `npm ci` | `package-lock.json` is out of step with a `package.json`; run `npm install` locally and commit the lockfile |
| `No Output Directory named "dist" found` | **Root Directory** in Vercel is not set to `client`. Vercel reads `vercel.json` only from the Root Directory, so with it set anywhere else `client/vercel.json` is ignored, the output path it declares is discarded, and the build is judged against a path nothing wrote to. Set Root Directory to `client` and clear Output Directory |
| First visit after a while takes a minute | the free instance was asleep; expected, see above |
