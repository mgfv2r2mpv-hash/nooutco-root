# Clinical Typing Drills

A Mac app for one clinician: a clinical question, one to five minutes on the
clock, a typing score (GWAM, errors, NWAM, accuracy, tricky keys, form tips), a
garden in the margins that grows with every word and warms with speed, and a
progress board. Kept answers go to the voice corpus (drill register) and the
expert queue.

Also: daily streaks and counts, a calendar (each day's average NWAM and GWAM, a
badge for the number of drills, a warm ribbon under days in a row), a trophy
case with unlock dates and conditions (`web/trophies.js` replays the history,
so a date is the drill that first met the condition), a Shift-side trainer in
the margins (`web/shift.js`), Option+Backspace counted as a revision rather
than an error, and thinking stops read apart from finger rhythm.

- `web/` the page. Runs in the app's WKWebView and in any browser.
- `app/` the Swift shell: `build.sh`, `install.sh` (to /Applications),
  `uninstall.sh` (`--data` also trashes the history), `--selftest`.
- `tests/` node tests for the arithmetic, Playwright for the page (WebKit and
  Chromium).

Data: `~/Library/Application Support/Clinical Typing Drills`.
