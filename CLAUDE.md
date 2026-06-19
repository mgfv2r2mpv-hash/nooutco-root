# games-nooutco-me — Project Rules

## Project Overview

ABA therapy game platform hosted at **games.nooutco.me**. Static HTML game files served from GitHub via Cloudflare Pages/Worker, with a Cloudflare Worker API for image management and admin tooling.

**Games:** IDMatchGame, NameIDGame, FamousPersonGame, FFCGame, IntraverbalGame, SequencesGame, ThinkOrSayGame, HickoryDickoryDockGame, PatternPackCo, MatchingMarket

## Tech Stack

- **Frontend:** Vanilla HTML/JS per game (no build step)
- **Backend:** Cloudflare Worker (`worker.js`) — image management, admin ops, AI fact expansion
- **Storage:** Cloudflare R2 (images), GitHub repo as source-of-truth for game content files
- **Admin:** `AdminTools/` — protected by `ADMIN_SECRET`, manages game images and topics
- **AI:** Anthropic API via `ANTHRO_KEY` — `POST /api/admin/update-facts` expands FamousPersonGame facts

## Worker Secrets (set in Cloudflare dashboard)

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Fine-grained PAT — Contents: Read & Write on repo |
| `GITHUB_OWNER` | GitHub username/org |
| `GITHUB_REPO` | Repository name |
| `ADMIN_SECRET` | AdminTools password |
| `ANTHRO_KEY` | Anthropic API key |

## 1. Verification Protocol

### Worker Changes
1. `npx tsc --noEmit` (if TypeScript is added)
2. `npx wrangler dev` — simulate locally before deploying
3. **Audit:** No game content, image URLs, or player-identifiable data in logs or error responses

### Game HTML Changes
- Test in browser at `localhost` or via Cloudflare Pages preview
- Verify game loads without console errors
- Confirm image paths resolve (R2 or GitHub raw)

## 2. Security & Privacy

- **No PHI in logs:** Game content may reference client-facing stimuli — never log player responses or session data
- **Admin endpoints gated:** All `/api/admin/*` routes require `ADMIN_SECRET` header check
- **No cleartext secrets:** Worker secrets via Cloudflare dashboard only — never hardcoded in `worker.js` or committed files
- **CORS:** Only allow origins that need it; do not use `*` for admin routes
- **V8 Isolates:** Worker is stateless — do not rely on global variable persistence across invocations

## 3. Code Standards

- **Simplicity first:** Games are vanilla HTML/JS — no framework unless the complexity genuinely demands it
- **Worker CPU budget:** Stay within 50ms (Bundled) / 10ms (Free) CPU limits
- **Environment bindings:** Use `wrangler.toml` for R2, KV, and secret bindings — never hardcode
- **Error handling:** Worker must return structured JSON errors, never raw stack traces
- **No TODOs:** Either implement or leave a scoped note on what's missing

## Collaboration Protocol

- **After completing any set of changes:** ask "Anything else, or should I open a PR / merge to dev?"
- **Before implementing a feature:** ask clarifying questions until 95% confident of intent and constraints. Do not write code until that bar is met.

## 4. Git Workflow

1. Develop on `dev` branch
2. `git push origin dev`
3. `gh pr create` → `gh pr merge --rebase --delete-branch=false`
4. `git fetch origin main` locally after merge

## 5. Clinical Boundary

Games display ABA stimulus content (images, labels, sequences). Code must not:
- Log or transmit which player selected which response
- Store session outcomes without explicit design for that feature
- Infer or display clinical conclusions from game performance
