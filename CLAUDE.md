# nooutco-root — Project Rules

## Project Overview

Root landing page at **nooutco.me**. Links to games and tools. Hosts the community feature-voting board and a password-protected admin area for prompt generation and card management.

## Tech Stack

- **Frontend:** `index.html` + `admin/index.html` — vanilla HTML/CSS/JS
- **Backend:** Cloudflare Pages Worker (`_worker.js`) — `/api/cards`, `/api/vote`, `/api/admin/*`
- **Storage:** KV namespace `VOTE_DATA` (id: `955ceb7270204f4a86d8229b2c7dc2a7`) — vote tallies, card status, custom cards
- **AI:** Anthropic API via `ANTHRO_KEY` — feature starter prompts and new-enhancement analysis
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

- **After completing any set of changes:** ask "Anything else, or should I open a PR / merge to main?"
- **Before implementing a feature:** ask clarifying questions until 95% confident of intent and constraints. Do not write code until that bar is met.

## Git Workflow

This repo commits directly to `main` (no separate dev branch).

1. Make changes locally
2. `git push origin main`

## Code Standards

- Keep it minimal — this is a landing page, not an app
- No secrets, no Worker, no build step
- Match the visual style of tokens.css used across the other nooutco.me properties (hardcoded equivalents since tokens.css is not shared here)
