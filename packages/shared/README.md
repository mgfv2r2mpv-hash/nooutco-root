# @nooutco/shared (placeholder)

Reserved for **Phase 2** code consolidation. Duplicated assets currently living in
each app — `tokens.css` (identical across `apps/tools` and `apps/games`), worker
helpers (`sha256`, JSON response shaping), the `/api/suggest` handler + `SUGGEST_DUPES`
usage, and common UI utilities — will be extracted here and consumed by each app.

Because each app deploys as its own Cloudflare Pages project with **Root directory
`apps/<app>`**, a Pages build cannot reach `../../packages/shared` directly. Phase 2
will wire sharing via a small prebuild copy step (for vanilla CSS/JS) and/or an npm
workspace package imported by the `apps/tools/cpr` Vite build.

Nothing here is consumed yet.
