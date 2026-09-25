# nooutco-root - Project Rules

## Project Overview

Root landing page at **nooutco.me**. Links to games and tools. Hosts the community feature-voting board and a password-protected admin area for prompt generation and card management.

## Tech Stack

- **Frontend:** `index.html` + `admin/index.html` - vanilla HTML/CSS/JS
- **Backend:** Cloudflare Pages Worker (`_worker.js`) - `/api/cards`, `/api/vote`, `/api/admin/*`
- **Storage:** KV namespace `VOTE_DATA` (id: `955ceb7270204f4a86d8229b2c7dc2a7`) - vote tallies, card status, custom cards
- **AI:** Anthropic API via `ANTHRO_KEY` - feature starter prompts and new-enhancement analysis
- **Hosting:** Cloudflare Pages, deploys directly from `main`

## Worker Secrets (set in Cloudflare dashboard for `root-nooutco-me`)

| Secret | Purpose |
|---|---|
| `ADMIN_SECRET` | Admin area password |
| `ANTHRO_KEY` | Anthropic API key for feature-starter and new-enhancement tools |

## KV Namespace

`VOTE_DATA` must be bound to the `root-nooutco-me` Pages project in the Cloudflare dashboard:
Settings → Functions → KV namespace bindings → Add `VOTE_DATA` → `955ceb7270204f4a86d8229b2c7dc2a7`

## Pages Worker Note

`_worker.js` is the active Pages worker. `favicon-worker.js` is a legacy file (standalone Cloudflare Worker previously deployed separately). If the Cloudflare dashboard has a custom worker file path configured, update it to `_worker.js`.

## Collaboration Protocol

- **After completing any set of changes:** commit on a feature branch and open a PR into `dev`. When Kaleb names a destination ("to dev", "put on main"), merge onto every branch he named in that turn, then stop: the pipeline deploys, and `.github/workflows/incident.yml` opens an incident session and emails him if anything fails. Do not watch CI or check the live site unless he asks. Unasked, open the PR and say so; do not merge.
- **Before implementing a feature:** ask clarifying questions until 95% confident of intent and constraints. Do not write code until that bar is met.

## Git Workflow

Apex deploys through Cloudflare's own git integration (`nooutco-root` from `main`, `dev-nooutco-root` from `dev`), not through `deploy-pages.yml`. It follows the same route as the rest of the repo:

1. Branch off `dev`, commit, open a PR into `dev`: `gh pr create --base dev`. Merge with `gh pr merge --rebase` when he asks for dev or main.
2. "Put on main" means the change lands on `dev` AND on `main`, with `dev` a direct ancestor of `main`. After the feature PR is on `dev`, open `gh pr create --base main --head dev` for the record, then fast-forward: `git fetch origin && git push origin origin/dev:main`. GitHub marks that PR merged. Never use the rebase button for dev into main: it rewrites the commits, and `dev` stops being an ancestor.
3. If the fast-forward is refused, something landed on `main` directly: merge `origin/main` into `dev` (one merge commit, normal push), then fast-forward. Never reset or force-push `dev`, and never delete it (`--delete-branch=false` on any `dev` head).

## Code Standards

- Vanilla HTML/CSS/JS - no framework, no build step
- No cleartext secrets - Worker secrets via Cloudflare dashboard only
- No PHI - admin tools generate prompts only; clinician owns final output
- Match root visual style (hardcoded colors, no tokens.css)
