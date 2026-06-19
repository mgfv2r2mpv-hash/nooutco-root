# nooutco-root — Project Rules

## Project Overview

Root landing page at **nooutco.me**. Simple static HTML page linking out to games.nooutco.me and tools.nooutco.me. No Worker, no build step.

## Tech Stack

- **Frontend:** Single `index.html` — vanilla HTML/CSS, no dependencies beyond Ko-fi widget script
- **Hosting:** Cloudflare Pages, deploys directly from `main`

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
