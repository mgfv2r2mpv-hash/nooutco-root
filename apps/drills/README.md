# Clinical Typing Drills

A Mac app for one clinician: a clinical question, one to five minutes on the
clock, a typing score (GWAM, errors, NWAM, accuracy, tricky keys, form tips), a
garden in the margins that grows with every word and warms with speed, and a
progress board. Kept answers go to the voice corpus (drill register) and the
expert queue.

- `web/` the page. Runs in the app's WKWebView and in any browser.
- `app/` the Swift shell: `build.sh`, `install.sh` (to /Applications),
  `uninstall.sh` (`--data` also trashes the history), `--selftest`.
- `tests/` node tests for the arithmetic, Playwright for the page (WebKit and
  Chromium).

Data: `~/Library/Application Support/Clinical Typing Drills`.
