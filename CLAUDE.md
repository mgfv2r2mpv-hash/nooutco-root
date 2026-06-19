# tools-nooutco-me — Project Rules

## Project Overview

ABA clinician tools hosted at **tools.nooutco.me**. Static HTML pages served via Cloudflare Pages with a `_worker.js` Pages Worker handling API routes (LLM proxy, suggest form). No build step — vanilla HTML/JS/CSS.

**Tools:** CPRAnalyzer, NoteDrafter, SessionFlow, SuggestFeature

## Tech Stack

- **Frontend:** Vanilla HTML/JS/CSS per tool, shared `tokens.css` design tokens
- **Backend:** Cloudflare Pages Worker (`_worker.js`) — `/api/suggest` (Resend email), `/api/llm-call` (LLM proxy)
- **Storage:** KV namespace `SUGGEST_DUPES` (id: `81921b08db4d47218c9053fdbf01296d`) for suggestion deduplication

## Worker Secrets (set in Cloudflare dashboard)

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend email delivery for suggest form |
| `SUGGEST_TO_EMAIL` | Destination address for suggestions |
| `ADMIN_SECRET` | Admin tooling password |

## Collaboration Protocol

- **After completing any set of changes:** ask "Anything else, or should I open a PR / merge to dev?"
- **Before implementing a feature:** ask clarifying questions until 95% confident of intent and constraints. Do not write code until that bar is met.

## Git Workflow

1. Develop on `dev` branch
2. `git push origin dev`
3. `gh pr create --base main --head dev`
4. `gh pr merge --rebase --delete-branch=false`
5. `git fetch origin main` locally after merge

## Code Standards

- No build step — keep everything vanilla; no frameworks unless complexity demands it
- No cleartext secrets — Worker secrets via Cloudflare dashboard only
- No PHI — tools assist drafting; clinician owns final output
- No TODOs — implement or leave a scoped note
