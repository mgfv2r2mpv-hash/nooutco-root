# Snack Quest — build spec

A **prototype**, deliberately outside the normal pipeline. Goal: a playable skeleton a
technician and learner can sit down with, that captures data cleanly. Polish beats
feature count; a learner should *want* the next round.

## What it is

A quest wrapper around three discrete-trial tasks. Our friend — a purple bear in a
rainbow hat — is hungry. The learner picks where he'll have his snack, then earns his
food by answering trials. Each round he waddles a little closer to the next food item.
When he reaches it, it's collected. The last item is always the honey; when he gets the
honey, the quest is done.

**Location:** `apps/games/snack-quest/` (new game directory, sibling of `receptive/`,
`matching/`, `glam-team-makeover/`).

## Non-negotiables

1. **Never name the character in anything a user can see.** He is always **"our friend"**
   (or "he"/"him"). The artwork resembles a trademarked character; this is free use with
   no commercial intent, and a name is the thing that would make it a problem. No name in
   UI copy, page title, alt text, ARIA labels, tooltips, the results report, or the games
   index card. Internal identifiers use neutral words (`friend`, `walker`); a *proper
   name* appears nowhere, in code or copy.
2. **No PHI, no transmission.** Session data is device-local via the existing
   `NooutcoResults` store only. Never log or transmit which learner chose what.
   (`apps/games/CLAUDE.md` sections 2 and 5.)
3. **Inherit the site chrome.** Do not invent a new shell. Use what every other game uses:
   `<noaba-bar>` + `/assets/nav-bar.css` + `/assets/nav-bar.js`, `../tailwind.css`,
   `../game-chrome.css` / `../tokens.css` where they apply, `../../tooltip-help.js`,
   `../header-chrome.js`, `../../reward.js`, `../../results-report.js`,
   `../../admin-gear.js`, and the same `#app-header` / `#settings-bar` / `#extra-panel`
   structure and class names the `receptive/` game uses. Settings should feel like the
   same product, because they are.
4. **Vanilla HTML/JS, no build step** (`apps/games/CLAUDE.md` section 3).
5. **Reuse the shared modules; do not reimplement them.** Specifically `token-board.js`
   for all schedule math and `results-report.js` for all persistence — see below. Every
   line of FR/VR arithmetic or localStorage plumbing written by hand is a defect waiting
   to happen.
6. Register the game in `apps/games/index.html` as a card matching the existing pattern,
   and bump `APP_VERSION` in `apps/games/_worker.js` (minor — this is a feature).

## Flow

```
page load
   |
   |- 1. TASK — three tiles:  Matching  .  Receptive  .  Expressive
   |
   |- 2. PLACE — four tiles:  Playroom  .  Party  .  Sky  .  Countryside
   |        story copy: our friend wants a snack; where should he have it?
   |
   |- 3. QUEST — N rounds (default 5)
   |        each round:  trial card slides up over the scene
   |                  -> learner responds
   |                  -> card fades away to reveal the scene
   |                  -> our friend waddles toward the current food
   |                  -> (on a delivering round) he reaches it, it's collected
   |
   \- 4. DONE — final artwork + collected food + specific praise + SR timer
            -> session results grid -> play again (task/place may change)
```

Task and place are chosen **before** play, in that order. Between quests the learner may
change either; the session results grid accumulates across every playthrough until
"Clear data".

## The three tasks

All three draw stimuli from the **existing topic libraries** — reuse
`receptive/manifest.json` / `matching/manifest.json` (topics `T_animals`, `T_foods`,
`T_toys`, ...) and the same topic + target-picker settings pattern those games already
have. This is a wrapper around real teaching targets, not a toy with seven fruit.

**Manifest image paths are already root-absolute** — an entry reads
`/shared/stimuli/img/T_animals/bear.jpg`, in both `receptive/manifest.json` and
`matching/manifest.json`, so it resolves unchanged from `snack-quest/` and needs no
prefixing. The manifest *file* is still fetched by relative path
(`fetch('../receptive/manifest.json')`). Do not copy the image libraries.

Two things about that directory are worth knowing before anyone "fixes" it. It is
`apps/games/shared/stimuli/img/`, and `apps/games/.assetsignore` lists `shared/` — the
intent there was to keep the bundled worker source (`shared/helpers.js`,
`shared/suggest.js`) from being served, and the stimuli were added under the same
directory later. Despite the entry, production does serve them: a request for
`/shared/stimuli/img/T_animals/bear.jpg` against games.nooutco.me returns 200. So the
paths are correct and shipped, not a dev-only accident.

(An earlier revision of this spec claimed these paths were the older
`_Resources/_imgSource/...` form. They are not, on `dev`; that reading came from a
checkout sitting on a different branch.)

Reuse `receptive/game.js`'s `labelFromSrc(src)` convention for display names, including
the `manifest.displayNames[src]` override, and keep its `sampleDeck` behaviour (every
target appears before any repeats).

| Task | Sample (SD) | Comparison array | Learner does | Scored by |
|---|---|---|---|---|
| **Matching** | picture | 2-4 pictures | taps the match | the app |
| **Receptive** | the word, shown **and** spoken | 2-4 pictures | taps the named picture | the app |
| **Expressive** | one picture, **field of one** | none | *says* what it is | the technician |

**Expressive is the receptive engine reskinned, and the reskin is small.** The receptive
engine already carries both halves of the trial: `state.sampleSrc` is the correct
answer's *image path* (its own comment says "not displayed"), and `state.sampleLabel` is
the word it renders. Expressive inverts exactly that — **render `sampleSrc` as the single
stimulus in a field of one, and never render `sampleLabel` anywhere**. Prompt copy:
**"What is it?"**

Showing the word would let the learner read the answer instead of naming the picture;
that is the entire clinical point of the mode, so it is asserted in the tests below.

The technician scores the vocal response with three large, unambiguous buttons:
**Correct / Prompted / Incorrect**. Those buttons are for adult hands reaching over a
learner's shoulder — place them where a learner reaching for the picture cannot hit them
by accident, and make Correct/Incorrect visually distinct without being punishing.

Receptive keeps its word on screen (shown *and* spoken) — only expressive hides it.

## Token economy and movement

**Use `token-board.js` (`window.NooutcoTokens`) for the schedule. It already does this.**

```js
const tokens = NooutcoTokens.create({
  namespace: 'snackQuest',
  onAward: (n) => { /* THIS trial delivered — our friend arrives + collects */ },
  onGoal:  ()  => { /* honey collected — finish the quest */ },
});
```

- `award()` increments the trial counter and fires `onAward(n)` **only when the schedule
  actually reinforces**. That callback *is* the "delivering round" signal — set a flag
  inside it, call `award()`, then branch: flag set means arrive-and-collect, flag clear
  means step partway. Do not compute FR/VR by hand.
- `render()` toggles the **`goal-reached`** class on `#token-board` and fires `onGoal()`
  once. `NooutcoReward.attachGoalSR` watches for exactly that class, so the honey pickup
  wires to the SR timer with no extra glue.
- Provide the canonical DOM IDs in your own markup (`#chk-token-board`, `#token-settings`,
  `#sel-schedule-type`, `#inp-schedule-value`, `#inp-starting-tokens`, `#inp-goal-tokens`,
  `#sel-token-emoji`, `#token-board`, `#token-emoji-display`, `#token-progress-text`) and
  call `NooutcoTokens.create` directly, the way `receptive/` does. Prefer this over the
  `token-board-ui.js` drop-in, because the drop-in builds its own controller and the
  `onAward` / `onGoal` hooks are needed here.
- Constrain the schedule UI to the range the brief asks for: **FR1-FR5 and VR2-VR5**.

Then the quest layer on top:

- Goal tokens **N** (default 5). The quest lays out **N food items**: N-1 fruit drawn from
  the fruit set, and the **honey always last**.
- **Only one food is on the scene at a time.** When our friend reaches one it's collected
  (flies to the token strip), the next appears at a fresh random spot, and he turns and
  starts toward that one.
- **Earning = our friend reaching a food item.** On a delivering round he covers the
  remaining distance and arrives. On a non-delivering round **he still moves toward it** —
  roughly 1/n of the way — so progress is always visible and never feels like nothing
  happened.
- **Errors:** he still waddles (never punish with stillness), but only a **correct**
  response calls `award()`. Prompted responses move him and are recorded as prompted;
  they do not advance the ratio. Say so in the settings help text so a technician knows
  what they are looking at.

## Motion — this is the part the learner comes back for

- Between rounds the trial card **slides up and over** the scene, then **fades off** after
  the response so the scene is fully visible for the walk. The learner must actually get
  to watch him move; do not overlap the walk with the next question.
- The walk is a **silly see-saw waddle** — alternating rotation of a few degrees paired
  with a small vertical bob, carrying him along the ground plane toward the food.
  Compositor properties only (`transform`, `opacity`); never animate layout.
- He **faces the direction he's walking** (horizontal flip).
- Arrival gets a beat: a small hop, then the food pops and flies to the token strip.
- All motion respects `prefers-reduced-motion` — reduce to a plain position change with
  no rotation or bob.

## Final screen

- Show `assets/finals/<place>.webp` — the portrait artwork of our friend in that location.
- **Composite the collected food items on top, z-indexed in front of the artwork.**
- Praise text **specific to the task completed** and to helping our friend get food to eat
  and share, landing on the idea that everything is better together. **Vary it a little
  each time** — a small pool of phrasings per task, not one fixed string. Example shape:
  "You matched every single one! Our friend has a whole snack to share now — everything's
  better together."
- Then the **SR timer**: `NooutcoReward.attachGoalSR({ boardId: 'token-board',
  buttonId: 'btn-finish-sr', minutes: 5 })`, exactly as `receptive/index.html` does.
- Then the **session results grid** — every trial from every playthrough this session,
  with task and place per row. Use `NooutcoResults` (`../../results-report.js`):
  `save(key, rows)` / `load(key)` / `clear(key)` / `open({ title, meta, columns, rows,
  summary })`. Do not hand-roll a second results store.

## Assets (already in the repo, already optimized)

```
assets/scenes/{playroom,party,sky,countryside}.webp   1376x768  opaque backdrop
assets/finals/{playroom,party,sky,countryside}.webp   928x1152  portrait, friend composited
assets/friend/friend.webp                             928x1152  alpha sprite
assets/food/{apple,bananas,dates,grapes,orange,watermelon,honey}.webp  384x384 alpha
```

**Measured alpha bounding boxes.** The sprites carry transparent padding, so raw
width/height will not line his feet up with the ground and will make the fruit look
randomly sized. Use these:

| sprite | content box within the image | note |
|---|---|---|
| `friend` | x 23.81%-76.83%, y 8.94%-92.71%  (53.0% x 83.8%) | feet at **92.71%** of image height |
| `apple` | x 25.00%-73.96%, y 22.92%-75.26%  (49.0% x 52.3%) | small |
| `bananas` | x 7.03%-94.01%, y 16.93%-83.07%  (87.0% x 66.2%) | wide |
| `dates` | x 10.42%-92.45%, y 25.00%-77.86%  (82.0% x 52.9%) | wide, short |
| `grapes` | x 11.72%-90.62%, y 3.39%-97.66%  (78.9% x 94.3%) | tall |
| `honey` | x 15.10%-95.31%, y 5.73%-92.97%  (80.2% x 87.2%) | large |
| `orange` | x 21.88%-78.12%, y 15.63%-84.37%  (56.3% x 68.8%) | small |
| `watermelon` | x 13.02%-85.42%, y 28.13%-77.60%  (72.4% x 49.5%) | wide, short |

Normalize each food sprite to a similar *apparent* size using its content box, and anchor
our friend by his **feet line (92.71%)**, not the bottom of the image.

## Technician and learner ergonomics

- **Learner-facing surfaces are big, calm, and few.** Tap targets at least 64px. No dense
  text on a trial. The picture is the star.
- **Technician-facing surfaces stay out of the way** — settings collapse behind the same
  Settings panel pattern the other games use.
- Full keyboard operation and sane focus order; visible focus rings; `aria-live` for round
  and token changes.
- Works at 768px and up; degrades gracefully to a phone-sized viewport.
- No console errors. No layout shift when the trial card comes and goes.

## Verification

Run against the real app, not from reasoning:

```bash
cd apps/games
npx playwright test tests/snack-quest        # server: npx wrangler pages dev . --port 8788
```

Write Playwright specs under `apps/games/tests/snack-quest-*.spec.js` covering at minimum:

- task -> place -> quest flow reaches a trial for **each of the three tasks**
- **expressive never renders the target word anywhere in the DOM** — assert it against the
  full page content, do not assume it
- FR1 delivers on every correct round; FR3 delivers on the third; the honey is always the
  final item collected
- our friend's position changes on a non-delivering round (he moved) and coincides with
  the food's position on a delivering round (he arrived)
- the final screen shows the right `finals/<place>.webp` with collected food in front
- session results accumulate across two playthroughs with different tasks
- no page in the flow contains a proper name for the character

Then **playtest it**: drive a full 5-round quest, screenshot every stage at 1440 and 768,
and *look at the screenshots*. Fix what looks wrong, feels slow, or would lose a learner.
That loop — play, look, fix — is the actual deliverable, not the test count.

## Out of scope

No worker/API changes beyond the `APP_VERSION` bump. No R2. No changes to the existing
`receptive/` or `matching/` games — this wrapper reuses their manifests and patterns but
leaves those games alone.
