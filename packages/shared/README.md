# packages/shared

Canonical source for code duplicated across `apps/tools`, `apps/games`, and
`apps/apex`.

```
css/tokens.css      design tokens (with Atkinson font @imports)
ui/nav-bar.js       <noaba-bar> unified navigation web component
ui/nav-bar.css      nav bar styles (relies on tokens.css variables)
ui/logo-mark.svg    canonical brand mark (served at each app root)
worker/helpers.js   sha256Hex(), jsonRes()  — Pages worker helpers
worker/suggest.js   handleSuggest()         — /api/suggest POST handler
```

## How it ships

Cloudflare Pages deploys each app by uploading its `apps/<app>` directory as-is
(tools/games via `wrangler pages deploy`; apex via native git integration — both
no build step). So shared code can't be imported across `../../` at deploy time.
Instead it is **copied into each app**:

```
npm run sync:shared        # scripts/sync-shared.mjs
```

This writes:

| Source              | Destinations                                            |
| ------------------- | ------------------------------------------------------- |
| `css/tokens.css`    | `apps/{tools,games,apex}/tokens.css`                    |
| `ui/nav-bar.js`     | `apps/{tools,games,apex}/assets/nav-bar.js`             |
| `ui/nav-bar.css`    | `apps/{tools,games,apex}/assets/nav-bar.css`            |
| `ui/logo-mark.svg`  | `apps/{tools,games,apex}/logo-mark.svg`                 |
| `worker/helpers.js` | `apps/{tools,games}/shared/helpers.js`                  |
| `worker/suggest.js` | `apps/{tools,games}/shared/suggest.js`                  |

The generated copies **are committed**. CI (`deploy-pages.yml`) re-runs the sync
and `git diff --exit-code apps` to block anyone editing a generated copy directly.
The diff covers **all** of `apps/` including `apps/apex`, so apex copies are guarded
even though apex deploys outside that workflow.

## Asset vs worker destinations

There are two destination kinds, and the distinction matters:

- **Worker source → `apps/<app>/shared/…`** — bundled into `_worker.js` by wrangler
  and kept *out* of public serving via each app's `.assetsignore` (`shared/`).
- **Served client assets → `apps/<app>/assets/…` or app root** — these MUST NOT live
  under `shared/` (it is `.assetsignore`'d and would 404). `nav-bar.{js,css}` and the
  brand logo are served assets. `assets/` is never added to any `.assetsignore`.

Pages load the bar with absolute paths so the same tags work at any depth and on any
domain (load `tokens.css` *before* `nav-bar.css`):

```html
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/assets/nav-bar.css">
<script src="/assets/nav-bar.js" defer></script>
...
<noaba-bar product="tools" crumbs="Notes/BT session note" crumb-hrefs="/notes/"></noaba-bar>
```

## Rules

- Edit **only** the files in `packages/shared/`, then run `npm run sync:shared`, and
  commit the canonical edit + generated copies together.
- The worker `shared/*.js` copies are bundled into `_worker.js` and stay assetsignored.
- `tokens.css`, `assets/*`, and `logo-mark.svg` are public assets — never assetsignore them.
- The admin shell (`ui/admin-shell.{js,css}`, games only) joins this sync in Phase 6.
