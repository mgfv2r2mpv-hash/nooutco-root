# Repository guidance

## Branch & deployment model

- Flow: feature branch → PR into **`dev`** → `dev` is promoted to **`main`**.
- Deployments go through **`dev` first**, then `main`. This is intentional —
  always target `dev` in PRs, never open PRs straight into `main`.
- `dev` periodically absorbs `main` (e.g. `Merge branch 'main' into dev`),
  so its tip moves. Treat `origin/dev` as a moving target.

## Merge strategy

PRs merge into `dev` with a **merge commit** (this is the repo's default and
preferred method). The branch's real commits — and their SHAs — become part
of `dev`'s history, so Git can always tell what is already merged. Follow-up
branches and re-merges therefore stay clean; the giant false-diff / add-add
"phantom conflicts" that squash merging used to cause do not happen.

- **Do not squash-merge.** Squashing rewrites a branch into one new SHA on
  `dev` and discards its ancestry — that is exactly what made stale-based or
  reused branches blow up with add-add conflicts.
- If you ever want a linear graph, use **rebase** merging instead — it also
  preserves commit ancestry. Squash is the one to avoid.

Required GitHub settings (Settings → General → Pull Requests, and the
branch-protection rules):

- **Allow merge commits** — enabled, and set as the **default** merge method.
- **Require linear history** on `dev` / `main` — **off** (it blocks merge
  commits). Leave it off, or, if you want it on, switch the default to rebase.

## Working with branches

1. **Branch from a recently fetched `origin/dev`:**
   `git fetch origin && git switch -c <branch> origin/dev`
2. **Keep the branch fresh before merging.** If `dev` has moved, update the
   branch (`git merge origin/dev`, or the PR's "Update branch" button) so the
   merge is small and conflict-free.
3. **Follow-up work is fine on a new branch** cut off the updated
   `origin/dev`. Because merges preserve ancestry, this no longer produces
   phantom conflicts — but a fresh base still keeps diffs minimal.

## Project layout

- Each game lives in its own top-level `*Game/` directory (e.g.
  `HickoryDickoryDockGame/HickoryDickoryDockGame/`) with `index.html`,
  `game.js`, `style.css`, and image topic folders.
- No build step / framework — static HTML/CSS/JS served directly.
  Quick check: `node --check game.js` and serve the folder over HTTP.
