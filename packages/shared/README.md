# packages/shared

Canonical source for code duplicated across `apps/tools` and `apps/games`.

```
css/tokens.css      design tokens (with Atkinson font @imports)
worker/helpers.js   sha256Hex(), jsonRes()  — Pages worker helpers
worker/suggest.js   handleSuggest()         — /api/suggest POST handler
```

## How it ships

Cloudflare Pages deploys each app by uploading its `apps/<app>` directory as-is
(tools/games via `wrangler pages deploy`, no build step). So shared code can't be
imported across `../../` at deploy time. Instead it is **copied into each app**:

```
npm run sync:shared        # scripts/sync-shared.mjs
```

This writes:

| Source                          | Destinations                                   |
| ------------------------------- | ---------------------------------------------- |
| `css/tokens.css`                | `apps/tools/tokens.css`, `apps/games/tokens.css` |
| `worker/helpers.js`             | `apps/{tools,games}/shared/helpers.js`         |
| `worker/suggest.js`             | `apps/{tools,games}/shared/suggest.js`         |

The generated copies **are committed**. CI (`deploy-pages.yml`) re-runs the sync
and `git diff --exit-code` to block anyone editing a generated copy directly.

## Rules

- Edit **only** the files in `packages/shared/`, then run `npm run sync:shared`.
- The worker `shared/*.js` copies are bundled into `_worker.js` by wrangler and are
  kept out of public asset serving via each app's `.assetsignore` (`shared/`).
- `tokens.css` is a public asset (linked from each app's HTML) — do not ignore it.
