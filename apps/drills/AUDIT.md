# ClickClackOracle audit (2026-09-24)

A survey of `web/*.js`, `index.html`, `drill.css`, `app/Sources/*.swift`,
`app/build.sh`, the tests, OVERNIGHT.md and the last 40 commits, done before
any fix. Every finding below was read in the code; the few marked
*(uncertain)* were read but not reproduced.

Status is one of: **open**, **fixed** (with the test that failed before the
fix), **deferred** (with the reason) or **not a bug** (with the evidence).

Baseline before any change: 161 node tests and 122 Playwright tests
(WebKit and Chromium) pass. After iteration 3: 164 node tests and 142
Playwright tests pass.

Ordered by what matters most to him: his answers first (lost, doubled or
written without a Keep), then his rulings, then the everyday screens, then
the mini games, then tidying.

## 1. His answers: lost, doubled, or outside the Keep

| # | Where | Category | Sev | Finding | Fix plan | Status |
|---|---|---|---|---|---|---|
| A1 | `app/Sources/main.swift:334`, `web/drill.js:1316-1356` | unresolved path | HIGH | An answer held without a Keep (the "is not kept" bar) and the unkept answer on the results screen live in memory only. The shell has no `applicationShouldTerminate` or `windowShouldClose`, and quits when the last window closes, so Cmd-Q or Cmd-W drops them with no word. Persisting them would write his text before Keep, which his ruling forbids. | Page exposes a count of unkept answers; the shell asks it on quit and on window close and shows "An answer is not kept" with Cancel and Quit anyway. Nothing is written by the warning. | open |
| A2 | `web/drill.js:1324-1327`, `1349-1355` | bug | HIGH | Keeping from the pending bar sets `snap.record.kept` but not `state.kept`, and `holdIfUnkept` never checks `record.kept`. Home, then Progress, then Home holds the kept answer again, and a second Keep writes a second expert-queue line. | `holdIfUnkept` skips a record already kept; `keepPending` sets `state.kept` when the snap is the live round. | **fixed**: `drills.spec.js` "an answer kept from the pending bar is not held again after Progress and Home, and a double click keeps it once" |
| A3 | `web/drill.js:486-492`, `498` | unresolved path | HIGH | Keep going (C) starts a round with the carried text and skips `holdIfUnkept`. Esc in that round goes home in phase "running", where `holdIfUnkept` bails, so the earlier, finished and scored answer is gone with no bar. | Hold the finished answer before the carried round starts; drop the hold when a later round of it is kept. | **fixed**: `drills.spec.js` "Keep going, then Esc mid-round: the finished answer is held on the bar, and Keep it keeps it" (`continueRound` holds the finished answer first; a later hold or Keep of the same answer replaces it, see "Keep going to the end: one row holds the whole answer..." and "...the earlier round kept from the bar, then K on the last round sends only what came after") |
| A4 | `web/drill.js:217-233`, `498-500`, `app/Sources/Speech.swift:49-53` | bug | HIGH | `home()` never stops the microphone, and `startRound` only resets `state.listening` without `store.micStop()`. After Esc or a new round the Mac microphone and recognizer keep running with the button reading "Talk". | Stop the mic in `home()` and `startRound` whenever it is listening. | **fixed**: `drills.spec.js` "Esc while talking turns the Mac microphone off" (`home()` and `startRound` call `stopMic()` when listening) |
| A5 | `web/drill.js:1206-1214`, `1430` | bug | MED | `keep()` has no in-flight guard. The button is disabled, but K calls `keep()` directly, so a quick K K (or K then Send) keeps one answer twice: two queue lines and two drafts for him to reject. | A `keeping` flag set before the await and checked on entry. | **fixed**: `drills.spec.js` "K pressed twice while the Keep is on its way keeps the answer once" (a `keeping` set of records in flight; a kept record is never kept again) |
| A6 | `web/drill.js:1343-1350` | bug | MED | The pending bar's Keep it and Send buttons stay live while their request runs; a double click keeps the answer twice. | Disable the row while it saves and skip a record already kept. | **fixed**: same test as A2 (the double click); the row's buttons are disabled while it saves |
| A7 | `web/drill.js:440-449` | bug | MED | `batonPass` awaits `keep()` before it marks the app busy, so a double B passes the guard twice: two keeps and two `claude -p` baton calls. | Mark busy before the keep. | **fixed**: `drills.spec.js` "the baton pass run twice at once keeps once and asks the expert once" |
| A8 | `web/drill.js:1316`, `1327` | weak use case | MED | `PENDING_MAX = 3`: a fourth unkept answer silently pushes the oldest out, text included. Each oracle follow-up left unkept adds one. | Raise the cap and say on the bar when the oldest would drop. | open |
| A9 | `web/drill.js:1236-1238`, `1349-1355` | weak use case | MED | The bar's Keep and Send report into `.keepnote` and the expert log, both hidden on home, so a failed Keep from the bar shows nothing. | Write the outcome into the pending row. | **fixed**: `drills.spec.js` "a failed Keep from the pending bar says so on the bar and leaves the answer held" |
| A10 | `web/oracle.js:298-311`, `web/shelf.js:28-31` | unresolved path | MED | The baton passage (the expert's reply that becomes his next copy text) is never checked against his answer, and shelving it writes its text to settings.json. If the reply quotes him, his words reach disk outside Keep. | Drop a baton passage that shares a run of eight words with his answer. | open |
| A11 | `web/drill.js:557`, `566` | weak use case | MED | One Esc mid-round drops a five-minute answer outright. Holding it in memory would write nothing. | Esc during a running round with twenty words or more holds the text on the pending bar, unscored. | open |
| A12 | `web/drill.js:363-368` | weak use case | MED | While talking, each partial result sets `box.value = micBase + text`, so anything typed during the mic is erased while its keystrokes stay in the score. | Refresh `micBase` on every typed input while listening. | open |

## 2. His rulings

| # | Where | Category | Sev | Finding | Fix plan | Status |
|---|---|---|---|---|---|---|
| R1 | `web/oracle.js:154-156` | bug | HIGH | The eight-word guard in `toProposal` checked title, rule, applies and rationale only. A topic slug made from his words (`i-always-fade-the-prompt-within-three-sessions-when-the`) or keywords that together quote him went through to the expert. | Guard the slug (dashes read as spaces) and the keywords (joined in order) as well. | **fixed**: `drill-oracle.test.mjs` "the eight-word guard covers the topic slug and the keywords too" |
| R2 | `web/drill.js:1233`, `web/stance.js:59-72`, `web/oracle.js:108-111` | bug | MED | The stance label ignored the review lens: a steelman or "what would change your mind" answer read as "pushes back", and the drafting prompt carried that beside the lens line, inviting a false dissent record. | `toneOf(text, lens)` reads the stance as "not read (lens)" for those two lenses, counts kept; the draft prompt leaves the stance line out. | **fixed**: `drill-stance.test.mjs` "a steelman or change-your-mind answer is not read as pushing back" |
| R3 | `web/oracle.js:22`, `web/stance.js:85-108` | incomplete | LOW | The oracle can ask him to steelman on its own, and an oracle item carries no lens, so R2's fix does not reach those answers. | Deferred unless the oracle gains a lens field; the drafting model sees the oracle's own question. | open |
| R4 | `web/stance.js:36-37` | weak use case | LOW | Markers ignore negation: "I dont agree" counts as agreement. | Skip a marker right after not / don't / dont / nothing. | open |

## 3. The everyday screens

| # | Where | Category | Sev | Finding | Fix plan | Status |
|---|---|---|---|---|---|---|
| S1 | `web/drill.js:1419-1429`, `index.html:210` | bug | MED | The page-wide key handler treats any focused input as free keys. In the admin-token field Return starts a drill instead of Connect, and on the results screen the letters k c b d s n typed there fire keep, continue, baton, drill, shelve or numbers. | Return early for INPUT and TEXTAREA targets; Enter in the token field connects. | open |
| S2 | `index.html:25`, `web/drill.js:1197-1204`, `705-726` | bug | MED | The trophy chip stays clickable during a running round. `openBoard` does not stop the clock, so the round later finishes and yanks him from the board to the results. | Ignore board opens while a round is armed or running. | open |
| S3 | `web/drill.js:299-336`, `440-471`, `drill.css:329` | unresolved path | MED | Busy is CSS only (`pointer-events: none`); Return still starts a round, and an oracle or baton reply that lands up to 180 s later takes over whatever round is on screen and clears the box. | Block `again()` and `arm()` while busy, and drop a reply whose round has changed. | open |
| S4 | `web/drill.js:294-298`, `428-431` | bug | MED | `busy("")` never clears its text, so after Send from the home bar "Drafting from answer N of M..." stays on home for good. | Restore the minute line when busy clears. | open |
| S5 | `web/drill.js:412`, `427-429` | unresolved path | LOW | If `store.expertSent` rejects, `busy("")` is skipped and the oracle, baton and Send stay dead until relaunch. | try/finally around the body of `sendToExpert`. | open |
| S6 | `web/drill.js` (store.save* at 777, 798, 938, 1084, 1087, 1102, 1245, 1278, 1395) | unresolved path | MED | Saves are neither awaited nor caught; a refused disk write is an unhandled rejection and he is never told. | One `persist()` wrapper that catches and shows a line. | open |
| S7 | `web/drill.js:473-481` | unresolved path | LOW | `ingestInBackground()` is not awaited and its `draftAndPropose` has no catch. | `.catch` into the expert log. | open |
| S8 | `web/score.js:44-55`, `web/bands.js` | incomplete | LOW | The bands were recalibrated (Expert 85, Elite 95, Master 105) with no note on screen; his first result reads "Expert" where it used to read "Professional". | A one-time line on the first result after the change, flagged in settings. | open |
| S9 | `web/trophies.js:124` | weak use case | LOW | Band trophies use his best NWAM with no accuracy gate and with copy and compose mixed, so a trophy can say Elite while the road says Expert. | Use `highestBand` per mode, as the road does. | open |
| S10 | `web/drill.js:1093-1104` | incomplete | LOW | After "clinical"/"a word" re-scores the round, the rating note, stars, basis and ladder lines keep the old score. | Re-run those parts of `render()`. | open |
| S11 | `web/drill.js:1109-1113`, `1150-1160` | weak use case | LOW | The progress chart and "Lately" trend mix copy and compose rounds, which line 122 says must never mix. | Plot and trend compose rounds only. | open |
| S12 | home (`index.html`, road, shelf, review, nemesis lines) | weak use case | LOW | OVERNIGHT.md: on a day all four lines show, Start sits further down the card. | Measure the card with all four showing; fold to one status line if Start falls below the fold. | open |
| S13 | `app/Sources/Speech.swift:49-51` *(uncertain)* | bug | MED | If the audio engine fails to start the tap stays installed; the next Talk installs a second tap, which raises and would crash. | Remove the tap when `engine.start()` throws and always in `stopAudio`. | open |
| S14 | `app/Sources/Speech.swift:51-53` *(uncertain)* | unresolved path | LOW | On a final result or error Swift stops the audio but never tells the page, which still shows "Stop talking". | Post a stopped message and reset the button. | open |
| S15 | `app/Sources/main.swift:386`, `web/drill.js:566` *(uncertain)* | bug | LOW | Cmd-Z from the Edit menu can change the box with no key events, so text and score disagree. | Refuse Cmd-Z in the box as Cmd-V already is. | open |
| S16 | `index.html:136-144` | incomplete | LOW | Tabs have `role="tab"` but no `aria-selected` and no arrow keys. | Set `aria-selected` in `showTab`. | open |

## 4. The mini games (pairgame.js, shifty.js, river.js)

Practice-only holds: all three save through `saveRun` into `settings.games`; nothing reaches history, bests or bands.

| # | Where | Category | Sev | Finding | Fix plan | Status |
|---|---|---|---|---|---|---|
| G1 | `web/drill.js:1421`, `shifty.js:212`, `river.js:127` | bug | HIGH | The shortcut guard skips `[data-pairgame]` only. When Shifty or River ends, focus sits on Close, and K keeps, C continues, D drills, S shelves, Esc goes home with the box left in the page. | One shared `data-minigame` on all three boxes, checked by the guard. | **fixed**: `drills.spec.js` "on a finished or open game, K and C on Close do nothing to the round, and Esc closes the game, not the results" (each game box stops its own keys and carries `data-minigame`, which the page guard checks) |
| G2 | `pairgame.js:163` | bug | MED | Escape is handled on the game's input, which is disabled when the race ends, so Esc on Close does nothing. | Handle Escape on the box. | **fixed**: `drills.spec.js` "Esc on the pair race's Close, after the race, closes it and leaves the results" (Escape is handled on the box) |
| G3 | `drill.js:217-233`, `543` | unresolved path | MED | `home()` and `startRound()` leave an open game box inside the results; it comes back stale on the next results screen, and River's 100 ms interval runs on. | Close any open game through its own shut in `home()` and `startRound()`. | open |
| G4 | `river.js:46`, `92` | bug | MED | A second River open removes the old box without clearing its timer. | Reopen through the old box's close. | open |
| G5 | `pairgame.js:86-90`, `100`, `110` | bug | MED | The hare's interval is set inside a 1.1 s timeout; closing within that window, or reopening, leaves a 1.8 s interval running on a detached node. | Keep the timeout id and clear it in `stop()`; stop before removing an old box. | open |
| G6 | `drill.css:687` | bug | LOW | Two different games can be open at once, stacked at the same spot with two live inputs. | One game at a time. | open |
| G7 | `pairgame.js:177`, `shifty.js:194` | bug | MED | A run ends on a count of spaces, right words or not: twenty quick spaces give a huge wpm and earn Shell Shock, Redline and Heel and Toe. | Advance only on a matching word, or refuse to save a run with wrong words. | open |
| G8 | `minigames.js:13-17`, `47` | bug | MED | Game trophies are rebuilt from the last 60 runs only, so a trophy can vanish or change its date once old runs drop off. | Store the first-earned date for each trophy. | open |
| G9 | `drill.js:1300` | weak use case | MED | Shifty's pool took the first 4000 words of the Mac's sorted word list: every one starts with "a" (aa to agla), about two thirds of the pool. Stripping punctuation also glued "self-injury" into "selfinjury". | Pool from the passages only (`shiftyPool`), split at every non-letter. | **fixed**: `drill-minigames.test.mjs` "Shifty's words come from his field" |
| G10 | `drill.css:704`, `730`, `740` | bug | LOW | Reduced motion misses the hare's bolt (`.pg-hare.is-bolt` wins on specificity) and `.rv-fill`. | Add both to the reduced-motion block. | open |
| G11 | `drill.css:692-693`, `724-726` | bug | LOW | Dark mode: ok green about 3.0:1 and bad red about 2.2:1 on `#23262e`; the tachometer hub and ticks nearly vanish. | Dark-mode colours for these. | open |
| G12 | `pairgame.js:150`, `shifty.js:200` | bug | LOW | A clock that never started (text arrived with no keydown) gives `secs` of the page's age and saves a nonsense run. | Refuse to finish when the clock never started. | open |
| G13 | all three games | incomplete | LOW | `role=dialog` without `aria-modal` or a focus trap; Tab walks into the page behind. | `aria-modal` and keep Tab inside. | open |
| G14 | tests | incomplete | LOW | Only the Shifty browser test checks history is unchanged; nothing covers Esc, a reopen or closing mid-run. | History checks for the pair race and River; one lifecycle test. | open |
| G15 | `drill.js:1416-1418` *(uncertain)* | bug | LOW | For 3 s after the bell every key is swallowed, including keys typed into a game opened by a click in that window. | Exempt keys aimed at a game box. | open |

## 5. Dead code

Settings keys are clean: every key written (`minutes`, `mode`, `copyDefault`, `strictShift`, `tame`, `shelf`, `words`, `games`) is read, and every key read is written.

| # | Where | Category | Sev | Finding | Fix plan | Status |
|---|---|---|---|---|---|---|
| D1 | `web/score.js:376` `countRuns` | dead code | LOW | Only a test imports it. | Remove with its test, suite green before and after. | open |
| D2 | `web/minigames.js:94` `export { mean }` | dead code | LOW | Nothing imports it. | Drop the export. | open |
| D3 | `web/bank.js:417` `CLINICAL_SEED` | dead code | LOW | Exported, used only inside bank.js. | Stop exporting it. | open |
| D4 | `index.html:63`, `76`, `192` | dead code | LOW | `data-drill-map-toggle`, `data-drill-race`, `data-drill-map` and the `drill-map` class are used nowhere in web/ or tests/. | Remove them. | open |
| D6 | `tests/drill-oracle.test.mjs:11` | incomplete | LOW | A literal em dash in JS source, against the ASCII-source ruling. | Write it as `\u2014`; the assertion is unchanged. | **fixed**: `grep -P '[\x{2013}\x{2014}]'` over web/ and tests/ now finds no em or en dash (the test itself still passes) |
| D7 | `web/bank.js` (411), `drill.js` (14), `outline.js`, `calendar.js`, `passages.js`, `tests/drill-copy.test.mjs`, `drill-round2.test.mjs`, `drill-strict-shift.test.mjs`, `drills.spec.js` | incomplete | LOW | Other literal non-ASCII characters in JS source (the box-drawing rule in bank.js, and single middle dots, times signs, curly quotes, angle quotes, a plus-minus, a copyright and a registered sign), against "JS source is ASCII, with \u escapes". No dashes among them. | Rewrite each as a `\u` escape, one file at a time with the suite green; a node test asserts every web/*.js and tests file is ASCII. | open |
| D5 | `drill.css` (e.g. `.tabs` at 144/211/456, `.trophy.is-next` at 247/484) | dead code | LOW | About 30 selectors are defined two or three times; the later ornate layer overrides the earlier. | Merge each into one rule, one at a time with the suite green. | open |
