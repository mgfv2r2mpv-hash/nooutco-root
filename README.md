# nooutco-root — No Outcome ABA monorepo

One repository for the three No Outcome ABA web surfaces. Each app deploys as its own
Cloudflare Pages project pointed at this repo with a per-app **Root directory**.

| App | Path | Pages projects | Domains |
| --- | --- | --- | --- |
| Apex site (voting board) | `apps/apex` | `nooutco-root` (main) · `dev-nooutco-root` (dev) | nooutco.me, www · d.nooutco.me |
| Tools (notes, CPR, session-flow) | `apps/tools` | `tools-nooutco-me` (main) · `dev-tools-nooutco-me` (dev) | tools.nooutco.me · d-tools.nooutco.me |
| Games | `apps/games` | `games-nooutco-me` (main) · `dev-games-nooutco-me` (dev) | games.nooutco.me · d-games.nooutco.me |

`packages/shared` is reserved for Phase 2 code consolidation (see its README).

## Deployment model

- Each Pages project: **Root directory** = `apps/<app>`, build command empty (static
  serve of committed files), production branch `main` (prod) or `dev` (dev).
- KV / service bindings and secrets are configured **per Pages project in the Cloudflare
  dashboard** and are independent of this repo.
- `apps/games/worker.js` + `apps/games/wrangler.toml` is the standalone `games-save-photo`
  Worker, deployed separately by `.github/workflows/deploy-worker.yml`.

## CI (`.github/workflows`)

- `scrub-cron.yml`, `term-digest-cron.yml` — nightly/weekly POSTs to tools.nooutco.me
  (need repo secret `CRON_SECRET`).
- `deploy-worker.yml` — deploys the standalone games worker (needs repo secret
  `CLOUDFLARE_API_TOKEN`).
- `games-test.yml` — Playwright E2E for `apps/games`.
- `triage.yml` — issue triage.

## Local development

`npm run dev:games`, `npm run build:cpr`, `npm run build:games-css`, `npm run test:games`.
