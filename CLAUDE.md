# Repository guidance

## Branch & deployment model

- Flow: feature branch → PR into **`dev`** → `dev` is promoted to **`main`**.
- Deployments go through **`dev` first**, then `main`. This is intentional —
  always target `dev` in PRs, never open PRs straight into `main`.
- `dev` periodically absorbs `main` (e.g. `Merge branch 'main' into dev`),
  so its tip moves. Treat `origin/dev` as a moving target.

## Working with branches (avoids phantom merge conflicts)

PRs are **squash-merged**, which creates a brand-new commit on `dev` with a
different SHA than the branch's commits. Git therefore cannot tell a reused
or stale-based branch is "already merged," and a huge false diff /
add-add conflicts appear. To prevent this:

1. **Always branch from a freshly fetched `origin/dev`:**
   `git fetch origin && git switch -c <branch> origin/dev`
2. **One branch = one PR = one merge.** After a PR merges, that branch is
   done. Do **not** push follow-up commits to it.
3. **For follow-up work, cut a NEW branch off the updated `origin/dev`.**
4. If a PR ever shows unrelated files / conflicts, the branch base is stale —
   rebuild it off the current `origin/dev` rather than resolving by hand.

## Project layout

- Each game lives in its own top-level `*Game/` directory (e.g.
  `HickoryDickoryDockGame/HickoryDickoryDockGame/`) with `index.html`,
  `game.js`, `style.css`, and image topic folders.
- No build step / framework — static HTML/CSS/JS served directly.
  Quick check: `node --check game.js` and serve the folder over HTTP.
