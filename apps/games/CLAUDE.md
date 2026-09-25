# games-nooutco-me - Project Rules

## Project Overview

ABA therapy game platform hosted at **games.nooutco.me**. Static HTML game files deployed by CI (`.github/workflows/deploy-pages.yml`, direct upload to Cloudflare Pages), with a Cloudflare Worker API for image management and admin tooling.

**Games:** IDMatchGame, NameIDGame, RedCarpetConvos, FFCGame, IntraverbalGame, SequencesGame, ThinkOrSayGame, HickoryDickoryDockGame, PatternPackCo, MatchingMarket

**FamousPersonGame is retired** in favour of Red Carpet Convos (`red-carpet-convos/people.json` is the live roster). `_worker.js` sends page visits to `/famous-person/` on to `/red-carpet-convos/`, but its files stay: the ImageManager still fetches its `index.html` for the portrait list, and every famous-person portrait (both games) lives under `famous-person/_Resources/_imgSource/images/`.

## Tech Stack

- **Frontend:** Vanilla HTML/JS per game (no build step)
- **Backend:** Cloudflare Worker (`worker.js`) - image management, admin ops, AI fact expansion
- **Storage:** Cloudflare R2 (images), GitHub repo as source-of-truth for game content files
- **Admin:** `AdminTools/` - protected by `ADMIN_SECRET`, manages game images and topics
- **AI:** Anthropic API via `ANTHRO_KEY` - `POST /api/admin/update-facts` expands FamousPersonGame facts

## Worker Secrets (set in Cloudflare dashboard)

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Fine-grained PAT - Contents: Read & Write on repo |
| `GITHUB_OWNER` | GitHub username/org |
| `GITHUB_REPO` | Repository name |
| `ADMIN_SECRET` | AdminTools password |
| `ANTHRO_KEY` | Anthropic API key |

## 1. Verification Protocol

### Worker Changes
1. `npx tsc --noEmit` (if TypeScript is added)
2. `npx wrangler dev` - simulate locally before deploying
3. **Audit:** No game content, image URLs, or player-identifiable data in logs or error responses

### Game HTML Changes
- Test in browser at `localhost` or via Cloudflare Pages preview
- Verify game loads without console errors
- Confirm image paths resolve (R2 or GitHub raw)

## 2. Security & Privacy

- **No PHI in logs:** Game content may reference client-facing stimuli - never log player responses or session data
- **Admin endpoints gated:** All `/api/admin/*` routes require `ADMIN_SECRET` header check
- **No cleartext secrets:** Worker secrets via Cloudflare dashboard only - never hardcoded in `worker.js` or committed files
- **CORS:** Only allow origins that need it; do not use `*` for admin routes
- **V8 Isolates:** Worker is stateless - do not rely on global variable persistence across invocations

## 3. Code Standards

- **Simplicity first:** Games are vanilla HTML/JS - no framework unless the complexity genuinely demands it
- **Worker CPU budget:** Stay within 50ms (Bundled) / 10ms (Free) CPU limits
- **Environment bindings:** Use `wrangler.toml` for R2, KV, and secret bindings - never hardcode
- **Error handling:** Worker must return structured JSON errors, never raw stack traces
- **No TODOs:** Either implement or leave a scoped note on what's missing


## Versioning & Caching

- **Single source of truth:** `APP_VERSION` in `_worker.js`. The worker injects
  `?v=${APP_VERSION}` into local CSS/JS URLs in served HTML and exposes
  `window.APP_VERSION` to the page.
- **`_headers`:** HTML/dynamic routes are `no-cache` (always revalidate); versioned
  CSS/JS are `immutable`. A version bump changes asset URLs, busting cache safely.
- **Bump policy:** any deploy that changes CSS/JS **must** bump `APP_VERSION` - patch for fixes, minor for features/reskins; major stays `0` for now (start `0.1.0`).
- **Config migration:** `migrate-config.js` (`window.NooutcoConfig`) stamps the config
  version and runs ordered, per-key transforms on bump so a saved configuration is
  never silently dropped. Games call `NooutcoConfig.migrate()` early in boot.
- **Results persistence:** `results-report.js` (`window.NooutcoResults`) persists trial
  data to localStorage (device-local; never transmitted) and renders the branded
  print/PDF report in a new tab. `clear()` fully wipes the store ("Clear data").

## Collaboration Protocol

- **After completing any set of changes:** commit on a feature branch and open a PR into `dev`. When Kaleb names a destination ("to dev", "put on main"), merge onto every branch he named in that turn, then stop: the pipeline deploys, and `.github/workflows/incident.yml` opens an incident session and emails him if anything fails. Do not watch CI or check the live site unless he asks. Unasked, open the PR and say so; do not merge.
- **Before implementing a feature:** ask clarifying questions until 95% confident of intent and constraints. Do not write code until that bar is met.


## 4. Git Workflow

1. Branch off `dev`, commit, open a PR into `dev`: `gh pr create --base dev`. Merge with `gh pr merge --rebase` when he asks for dev or main.
2. "Put on main" means the change lands on `dev` AND on `main`, with `dev` a direct ancestor of `main`. After the feature PR is on `dev`, open `gh pr create --base main --head dev` for the record, then fast-forward: `git fetch origin && git push origin origin/dev:main`. GitHub marks that PR merged. Never use the rebase button for dev into main: it rewrites the commits, and `dev` stops being an ancestor.
3. If the fast-forward is refused, something landed on `main` directly: merge `origin/main` into `dev` (one merge commit, normal push), then fast-forward. Never reset or force-push `dev`, and never delete it (`--delete-branch=false` on any `dev` head).

## 5. Clinical Boundary

Games display ABA stimulus content (images, labels, sequences). Code must not:
- Log or transmit which player selected which response
- Store session outcomes without explicit design for that feature
- Infer or display clinical conclusions from game performance
