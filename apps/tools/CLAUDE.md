# tools-nooutco-me - Project Rules

## Project Overview

ABA clinician tools hosted at **tools.nooutco.me**. Static HTML pages served via Cloudflare Pages with a `_worker.js` Pages Worker handling API routes (LLM proxy, suggest form). No build step - vanilla HTML/JS/CSS.

**Tools:** CPRAnalyzer, NoteDrafter, SessionFlow, SuggestFeature

## Tech Stack

- **Frontend:** Vanilla HTML/JS/CSS per tool, shared `tokens.css` design tokens
- **Backend:** Cloudflare Pages Worker (`_worker.js`) - `/api/suggest` (Resend email), `/api/llm-call` (LLM proxy)
- **Storage:** KV namespace `SUGGEST_DUPES` (id: `81921b08db4d47218c9053fdbf01296d`) for suggestion deduplication

## Worker Secrets (set in Cloudflare dashboard)

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend email delivery for suggest form |
| `SUGGEST_TO_EMAIL` | Destination address for suggestions |
| `ADMIN_SECRET` | Admin tooling password |

## Collaboration Protocol

- **After completing any set of changes:** commit on a feature branch and open a PR into `dev`. When Kaleb names a destination ("to dev", "put on main"), merge onto every branch he named in that turn, then stop: the pipeline deploys, and `.github/workflows/incident.yml` opens an incident session and emails him if anything fails. Do not watch CI or check the live site unless he asks. Unasked, open the PR and say so; do not merge.
- **Before implementing a feature:** ask clarifying questions until 95% confident of intent and constraints. Do not write code until that bar is met.

## Git Workflow

1. Branch off `dev`, commit, open a PR into `dev`: `gh pr create --base dev`. Merge with `gh pr merge --rebase` when he asks for dev or main.
2. "Put on main" means the change lands on `dev` AND on `main`, with `dev` a direct ancestor of `main`. After the feature PR is on `dev`, open `gh pr create --base main --head dev` for the record, then fast-forward: `git fetch origin && git push origin origin/dev:main`. GitHub marks that PR merged. Never use the rebase button for dev into main: it rewrites the commits, and `dev` stops being an ancestor.
3. If the fast-forward is refused, something landed on `main` directly: merge `origin/main` into `dev` (one merge commit, normal push), then fast-forward. Never reset or force-push `dev`, and never delete it (`--delete-branch=false` on any `dev` head).

## Code Standards

- No build step - keep everything vanilla; no frameworks unless complexity demands it
- No cleartext secrets - Worker secrets via Cloudflare dashboard only
- No PHI - tools assist drafting; clinician owns final output
- No TODOs - implement or leave a scoped note
