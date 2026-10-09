# Account engine and Horae Zone: test plan

This file covers how to run the tests, what each test file proves, the manual checks a reviewer can make, and the rules for any revision. It has one section per slice. The decisions behind the tests are in `DESIGN-REVIEW.md` beside this file.

## Rules for revisions

- **RED first.** Every behaviour change is committed with only failing tests first, then made to pass in a second commit. Record the RED count in the GREEN commit message.
- **Plain test names.** Name tests in plain sentences. Name each guard's opposite case `NEGATIVE CONTROL: …`.
- **Fakes stay local.** Fakes live inside the test file that uses them.
- **Key hygiene:**
  - No key, token, seed, code, PIN or email address is ever printed, logged, put in argv or env, or committed.
  - Test values are fixed and clearly fake, such as `example.test` addresses and canary strings.
  - Errors name the item, never its value.
- **No product or vendor self-reference** in comments, commit messages or PR text.
- **Same branch.** Push to the PR's branch.

---

## A1: engine core (`packages/account-engine`)

### Run

```
cd packages/account-engine
npm ci
npm test
```

- **Needs:** Node 22 or later.
- **Chromium:**
  - The browser test uses Playwright 1.56.1 and needs a Chromium it can find: either `PLAYWRIGHT_BROWSERS_PATH` pointing at an installed build, or `npx playwright install chromium`.
  - `npm ci` downloads no browser when `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set.
- **Workers runtime:** `workerd` comes from `npm ci`.
- **Private list:** optional. Without `@nooutco/pin-blocklist` installed, one test skips ("the installed private package loads all 2,913 PINs"). To run it, copy the package into `node_modules/@nooutco/pin-blocklist` (CI does this when its secret is set).
- **Expected result:** 48 tests; 47 pass and 1 skips without the private package, 48 pass with it.

**RED evidence.**
1. A1: run `git checkout 13f0efd -- packages/account-engine && (cd packages/account-engine && npm test)`, and expect 7 files failing with `ERR_MODULE_NOT_FOUND`. (`13f0efd` is the 2026-10-03 rewrite of `6880e14` without the list files.)
2. The 2026-10-03 rulings: at `c4a08a3`, `pin.test.mjs` and `pin-blocklist-load.test.mjs` fail with `ERR_MODULE_NOT_FOUND`. With `3c3a183`'s `src/pin.mjs` but the old non-wrapping step, exactly one test fails: "a run wraps: 0 follows 9 and precedes 1, so 890, 901, 098 and 109 are runs".
3. Restore the branch with `git checkout HEAD -- packages/account-engine`.

### What each file proves

| File | Proves | Origin | Negative controls |
|---|---|---|---|
| `test/totp.test.mjs` | The RFC 4226 HOTP vectors and RFC 6238 SHA-1 vectors. Candidates are the current window then the previous, never the next. Base32 round-trips (RFC 4648 vector). The otpauth URI names SHA1/6/30. `Uint8Array` keys need no `Buffer` | Ported from JanusMirror, plus one new test | A non-base32 string throws |
| `test/pake.test.mjs` | A matching code gives both ends the same keys. The previous-window code works. A wrong code fails on both ends. Another channel does not pair. Two runs give different keys. A replayed tagA is refused. The identity point and bad encodings are refused. Only 6-digit codes are taken | Ported unchanged | The wrong-code, wrong-channel and replay cases |
| `test/envelope.test.mjs` | Seal/open round-trip. The key is not extractable and its raw bytes are wiped. Tampering, or a wrong direction, session, context or key, is refused. Counter nonces never repeat | Ported. The replay-guard tests stay in JanusMirror until `replay` moves | Every refusal case |
| `test/limits.test.mjs` | 3 wrong codes lock a window. The 4th exchange is not admitted while 3 are unsettled. An unconfirmed exchange counts as wrong after its time. Two in a row, or four a day, close the path. The reopen link is single use, expires, and only its hash is kept. Day-old history is dropped. State round-trips and a bad shape is refused | New tests over the ported pure rules (JanusMirror tested them through the file wrapper) | `NEGATIVE CONTROL: a confirmed exchange is not a wrong code` |
| `test/pin.test.mjs` | Runs and fixture-listed PINs are refused with exactly "That PIN is too easy to guess.". Runs wrap: `890`, `901`, `098`, `109` and the owner's `7890`, `8901`, `9012`, `1098`, `0987`, `2109` are refused. Anything but 6 ASCII digits is `shape`. A refusal never contains the PIN. The rules cannot be built without a list or from a bad entry (and the error never names the entry), and they keep their own copy. `src/` carries no list and `vendor/pins` is gone | New | `NEGATIVE CONTROL: six digits with no run and not on the blocklist are allowed`; `NEGATIVE CONTROL: two of a kind, or a jump across the wrap that is not one step, is not a run` |
| `test/pin-blocklist-load.test.mjs` | The loader asks for `@nooutco/pin-blocklist` by name. A missing package is refused by name, never treated as an empty list. A package without `PINS`, with a `COUNT` that disagrees, or with a non-six-digit entry is refused. Where the private package is installed, it loads all 2,913 PINs and refuses the fixture's five | New | `NEGATIVE CONTROL: a package in the agreed shape loads, and its PINs are refused` |
| `test/vendor.test.mjs` | The noble files match their recorded sha256 pins | Pattern from JanusMirror | `NEGATIVE CONTROL: a vendored file that differs from its pin fails` (changed and added files); `NEGATIVE CONTROL: a pinned file that is missing fails` |
| `test/runtimes.test.mjs` | `src/` uses nothing Node-only. `probe()` gives the same generator and a finished exchange in Node, Chromium (served over local HTTP) and `workerd` (every module embedded, the probe answered over HTTP) | New | The probe includes a wrong-code exchange that must be refused in every runtime |

### Manual checks for the reviewer

1. **The private list is current.** In the private repo, `npm run build` rewrites `index.mjs` from its pinned `data/` files; `git diff` must then be empty, and `npm test` there passes.
2. **The vendor pins bite.** Change one byte in `vendor/noble/hashes/sha2.js`; `npm test` must fail in `vendor.test.mjs` (and nowhere else). Then revert.
3. **`src/` stays portable.** `grep -rnE "node:|Buffer|process\." src` must print nothing.
4. **The PIN rules in practice.** Try a few PINs:
   ```
   node -e "Promise.all([import('./src/pin.mjs'), import('./test/fixtures/pin-blocklist.mjs')]).then(([m, f]) => console.log(['820374','123905','159753','490173','82037'].map(m.createPinRules(f.PINS).pinAllowed)))"
   ```
   Expect allowed, too-easy, too-easy, too-easy (the wrap), shape. (These are fixed test values, not real PINs.)

### Not in A1 (do not add here)

These belong to later slices, each with its own RED tests:
- device signatures and routes (A2, A4);
- email codes (A3);
- the PIN lifecycle (reuse lock, reset, review, offline block) (A5b);
- admin (A5c).

---

## A2: Horae Zone skeleton (`apps/horae-zone`)

### Run

```
cd apps/horae-zone
npm test
```

- **Needs:** Node 22.13 or later (for `node:sqlite`). No `npm ci` is needed, because the app has no dependencies.
- **Expected result:** 30 tests, 30 pass, at the end of A2. A3 and A4 added to the same files, and the suite now holds 81 (see A4).

**RED evidence.**
1. A2: run `git checkout 7a171c6 -- apps/horae-zone && (cd apps/horae-zone && npm test)`, and expect 3 files failing on missing modules. (`7a171c6` is the 2026-10-03 rewrite of `05c75bf`.)
2. Retention: at `c4a08a3`, `purge.test.mjs` fails on the missing `src/retention.js`.
3. Restore with `git checkout HEAD -- apps/horae-zone`.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| `test/checks.test.mjs` | Every plan route is in the table, and each declares one of the four check kinds; admin routes, and only they, are `admin`. For **every** signed and admin route: an unsigned request is `no-device`, a wrong signature is `bad-signature`, and a reused nonce is `stale-nonce`. A DER and a raw signature verify alike. A signature for another path fails. A nonce expires and belongs to one device. A removed device is refused. A non-admin is `not-admin`. Open routes answer `not-built`. Method, content type, non-JSON, non-object and oversized bodies are each refused with their word and status. An unknown path is `no-route` and audited as `unknown`. Each request writes one audit row. No database gives `unavailable`. Answers are JSON and `no-store` | `NEGATIVE CONTROL: a correctly signed request with a fresh nonce passes the checks`; the admin test then grants the role and passes |
| `test/leak.test.mjs` | Canaries (a body marker, a 6-digit code, a base32 seed, a PIN, an `example.test` address) are sent in bodies, headers and paths to every route, signed and unsigned, plus a truncated JSON body. None appears in any response status, header or body, in any audit row, in any bound D1 value, or in console output. `src/` has no `console.` call | `NEGATIVE CONTROL: the canary check catches a planted echo` (a test-only route that echoes its body) |
| `test/config.test.mjs` | `wrangler.toml` has `workers_dev = false`, no route and no environment, and no `[vars]` or secret-looking assignment. The `schema.sql` column names are content-free | `NEGATIVE CONTROL: a planted route line fails` (a planted route, and `workers_dev = true`) |
| `test/purge.test.mjs` | The defaults are 6 audit years and an hourly purge, and `wrangler.toml` carries exactly that cron. The cutoff is the same moment 6 calendar years back (29 February falls back to the 28th). A purge removes spent and expired nonces and audit rows older than the cutoff, and keeps the row at the cutoff. Another number of years moves the cutoff; 0, negative, fractional or non-number years are refused and delete nothing. The Worker's `scheduled` runs the purge at the scheduled time and fails loudly with no database | `NEGATIVE CONTROL: a purge keeps a fresh nonce working and every audit row inside 6 years` |

### Manual checks for the reviewer

1. **No console calls.** `grep -rn "console\." apps/horae-zone/src` must print nothing.
2. **Local smoke test.** This needs wrangler, which is not a dependency; use `npx wrangler@4`.
   1. Start the local database and server:
      ```
      cd apps/horae-zone
      npx wrangler d1 execute horae-zone --local --file schema.sql
      npx wrangler dev --local
      ```
   2. Then check each request answers as expected:

      | Request | Expected |
      |---|---|
      | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/recover` | `{"error":"not-built"}` |
      | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/signin` | `{"error":"shape"}` (A4; it was `not-built` in A2) |
      | `curl -s localhost:8787/signin` | `{"error":"method"}` |
      | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/nonce` | `{"error":"no-device"}` |

   3. The wrangler terminal must show nothing but its own request lines.
3. **Nothing is deployed.** Confirm that no `wrangler deploy` was run, and that the database id is still the zero placeholder.

### Not in A2 (do not add here)

These belong to later slices, each RED first:
- device registration and removal (A4);
- account and email (A3);
- codes and tickets (A5);
- the PIN lifecycle (A5b);
- admin actions (A5c);
- recovery (A6).

---

## A3: account and email (`apps/horae-zone`, `packages/account-engine`)

### Run

Both suites, as in A1 and A2:

```
cd packages/account-engine
npm test
cd ../../apps/horae-zone
npm test
```

- **Expected result at the end of A3:** engine 58 tests (57 pass, 1 skips without the private package), Horae Zone 54 tests, 54 pass. The profile-api suite is unchanged at 195/195 (`cd apps/profile-api && node --test --test-concurrency=1 "test/*.test.js"`, about a minute).
- **No mail is sent.** Every test injects a mail sink; the transport tests in `mailer.test.mjs` pass a fake `fetch`.
- **Test values are fake:** the account secret is a fixed test value, the link base is `https://horae-zone.example.test/verify`, and every address ends in `example.test`.

**RED evidence.**
1. Run `git checkout 665f3042 -- packages/account-engine apps/horae-zone`, then both suites.
2. Expect the engine to fail in `mailer.test.mjs` (`ERR_MODULE_NOT_FOUND` for `src/mailer.mjs`) and `same-hex.test.mjs` (`limits.mjs` has no export `sameHex`), with every other engine test passing.
3. Expect Horae Zone to fail 4: `signup.test.mjs` and `purge.test.mjs` on the missing `src/signup.js`, the A3 leak test, and "a request with a query string is refused as shape before any check or handler". Every A2 test passes.
4. Restore with `git checkout HEAD -- packages/account-engine apps/horae-zone`.

**RED evidence for the security review fixes.** Each fix's tests were written first and run against the `3c3cac63` source (only the test file changed).
- **H1** (fix `b7fde672`): 5 of 24 tests in `signup.test.mjs` fail on `3c3cac63`. The owner's first code answers `bad-code` after a second start; the 6th guess from one requester and the 16th at one address answer `bad-code` instead of `slow-down`; and the "every live code" and limits tests fail because `liveCodes`, `triesPerAddressHour` and `triesPerAddressRequesterHour` do not exist. After the fix: Horae Zone 84/84, engine 64 (63 pass, 1 skip), profile-api 195/195.
- **H2** (fix `7868788c`): 4 of 6 new tests in `devices.test.mjs` fail on `3c3cac63` (its `src/signin.js`, `src/index.js`, `src/routes.js` and `src/throttle.js` are unchanged by H1). The owner's sign-in signed by a registered device answers `slow-down` after ten wrong passwords from ten requesters; the 11th sign-in after ten successes, and a wrong password after nine wrong and one right, answer `slow-down` instead of `bad-login`; and a sign-in naming a device with a tampered signature answers a ticket instead of `bad-signature`. The 2 H2 negative controls pass on both. After the fix: Horae Zone 90/90, engine 64 (63 pass, 1 skip), profile-api 195/195.
- **M1** (fix `68622439`): 1 new test in `signup.test.mjs` fails on `3c3cac63`: a start for an address with an account binds 3 statements (throttle, account lookup, audit) and one for a new address binds 4 (throttle, account lookup, challenge insert, audit). After the fix both bind the same 3 (throttle, challenge insert carrying the account check, audit). After the fix: Horae Zone 91/91, engine 64 (63 pass, 1 skip), profile-api 195/195.
- **M2** (fix `a0e2e2b4`): 5 new tests fail on `3c3cac63` (run in a `git archive` extract of it, with only the test files copied in): 4 in `signup.test.mjs` and 1 in `purge.test.mjs`. An address with a zero-width character answers 200 instead of `shape`; the 4th tagged start at one mailbox and the 3rd start past a daily cap of 2 answer 200 instead of `slow-down`; no start pays a `codes-day` bucket; and the purge test reads `SIGNUP_LIMITS.dayMs`, which does not exist. The 2 M2 NEGATIVE CONTROLs pass on `3c3cac63` and after. After the fix: Horae Zone 98/98, engine 64 (63 pass, 1 skip), profile-api 195/195.
- **M3** (fix `e1c8ea2c`): 2 new tests in `devices.test.mjs` fail on a `3c3cac63` extract (with the new `devices.test.mjs` and `helpers.mjs` copied in): a sign-in with no or a malformed `keyDigest` answers a ticket instead of `shape`, and the binding test cannot sign in with the new field. With the sign-in helper sending the old two-field body on the same extract, the binding test shows the defect itself: a stranger's keys register with the owner's ticket (200, expected 401). After the fix: Horae Zone 100/100, engine 64 (63 pass, 1 skip), profile-api 195/195.
- **M5** (fix `8a8f064f`): 2 of 3 new tests in `devices.test.mjs` fail on a `3c3cac63` extract (the three M5 tests copied in alone; `src/account-keys.js` is unchanged from `3c3cac63` until this fix): a password set in NFC form and signed in with its NFD form, the reverse, and a password set with a ligature and signed in with its plain letters each answer `bad-login` (401, expected 200). The M5 NEGATIVE CONTROL passes on both. After the fix: Horae Zone 103/103, engine 64 (63 pass, 1 skip), profile-api 195/195.
- **L2** (fix `a6824fe5`): 3 of 5 new tests in `devices.test.mjs` fail on a `3c3cac63` extract (the four tests that do not sign in copied in alone, with their helper): a device removed after its signature passed still removes another device (the target's `removed_at` is set, expected null), a device removed after `findDevice` still gets a nonce (200, expected `no-device`), and a nonce of a device stamped removed after `findDevice` is still spent (501 `not-built`, expected 401). The fourth, a device removed after its signed sign-in passed the checks, fails on `8a8f064f` (a ticket, expected `no-device`); its signed sign-in path came with H2 and is not on `3c3cac63`. The L2 NEGATIVE CONTROL passes on both. After the fix: Horae Zone 108/108, engine 64 (63 pass, 1 skip), profile-api 195/195.
- **L3** (fix `012e8993`): the new L3 test in `signup.test.mjs` fails on a `3c3cac63` extract (one copy per route, with the `/signin` body that commit takes): with no `cf-connecting-ip`, `/account` answers 200, `/account/email/verify` answers `bad-code` and `/signin` answers `bad-login`, each writing throttle rows, where `shape` and no row are expected. On `a6824fe5` (before the fix) it fails at its first case: `/account` with no header answers 200. The L3 NEGATIVE CONTROL passes on both. After the fix: Horae Zone 110/110, engine 64 (63 pass, 1 skip), profile-api 195/195.

**RED evidence for the second security review** (root cause: a guessable email code; see the design review). Each item's tests were written first and run against the source of the commit before its fix, with only the test files changed (item 1 against `8ebe205a`, the others as each bullet names). The fixes landed in the order 1, 2, 3, 4, 7, 6, 5, one commit each.
- **Item 1** (the email secret is a 128-bit token; fix `d672e603`): 9 tests fail on `8ebe205a`. The two new tests fail on the 6-digit code and the "Sign-up code:" line in the mail; the other seven fail because a well-formed token (a wrong try, or one never sent) is `shape` there, and a 6-digit typed code reaches the compare instead of being `shape`. After the fix: Horae Zone 112/112, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 2** (no address-level verify cap; fix `9f55de74`): 4 tests fail on `d672e603` (the item 1 commit; only the test files changed). After 15 strangers' wrong tries from 3 requesters the owner's link answers `slow-down` (429), expected 200; in the 60-try test the 16th stranger try answers 429, expected 401; the limits test finds `triesPerAddressHour` and `codeTries` still defined; and the purge removes a live code with 15 tries as used up. After the fix: Horae Zone 113/113, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 3** (a start at the cap re-sends the newest live link; fix `92d91ed2`): 7 tests fail on `9f55de74` (the item 2 commit; only the test files changed). The owner's start after 3 strangers' starts answers `slow-down` (429), expected 200 with a mail; in the bounded-mail test the 4th start answers 429; the expired-link and account-address tests answer 429 at the cap; the sealed-link test finds no `link_box` column; the M2 tag test's 4th tagged start answers 429, expected 200 with no mail; and the limits test finds `liveCodes` 3 and no `resendsPerAddressHour`. After the fix: Horae Zone 117/117, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 4** (no hard per-address lock on `/signin`; fix `7df89d4e`): 7 tests in `devices.test.mjs` fail on `92d91ed2` (the item 3 commit; only the test file changed). The owner's right password after ten strangers' wrong ones from ten requesters answers `slow-down`, expected a ticket; the ceiling test finds `perAddressHour` 10, expected 100; and the hammering, backoff and three reworked H2 tests find no `perPairHour` or `backoffAfter`. A scratch test on the same source showed the defect behind the hammering test: one requester's right password after 6 wrong ones got a ticket (200), since one requester had the address's whole 10. The item 4 NEGATIVE CONTROL passes on both. After the fix: Horae Zone 121/121, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 5** (the daily cap is the mail plan's limit, with an alert at half; fix `69c7cc33`): 7 new tests fail on `4c2c53ca` (the item 6 commit; only the test files changed), 6 in `signup.test.mjs` and 1 in `purge.test.mjs`. The default cap is 500, expected 3000; with a cap of 10 and a fake `HZ_ALERT_TO`, 5 starts mail no alert (0, expected 1); the next-day, `alert-unset`, `alert-failed` and same-statements tests fail on the missing alert (the statements themselves matched on `4c2c53ca` too); and a purge clears a two-hour-old `alert-day` row, expected kept for a day. After the fix: Horae Zone 134/134, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 6** (one domain, one address key; fix `4c2c53ca`): 3 new tests in `signup.test.mjs` fail on `6b49d7e8` (the item 7 commit; only the test file changed). A start for `v@example.test.` mails `v@example.test.`, so there is no mail to `v@example.test`; a full-width spelling of `example.test` makes a second per-address bucket (2, expected 1); and `v@-example.test` answers 200, expected `shape`. The M2 NEGATIVE CONTROL (a non-ASCII domain still starts) passes on both. After the fix: Horae Zone 127/127, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 7** (a known device pays the pair bucket; fix `6b49d7e8`): 2 new tests in `devices.test.mjs` fail on `7df89d4e` (the item 4 commit; only the test file changed). After 5 wrong passwords signed by a registered device of the account from one requester, and after 4 unsigned and 1 signed from one requester, the device's right password from that requester answers a ticket (200), expected `slow-down`. The item 7 NEGATIVE CONTROL passes on both. After the fix: Horae Zone 124/124, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.

**RED evidence for the third security review** (two lockouts a stranger could still cause; see the design review). Both items' tests were written first and run against the `17577851` source with only the test files changed (`src/signup.js` was the same at `17577851` and `561fc56d`, so item 2's RED on `561fc56d` is RED on `17577851`). To repeat it: extract `17577851` with `git archive`, lay the `a62b6d3c` test files over it and run the Horae Zone suite; 11 of 138 fail, all named below.
- **Item 1** (sign-in backoff per pair only; fix `561fc56d`): in `devices.test.mjs` the probe, "third review, item 1: six strangers polling every second never hold the owner's right password from a fresh connecting address", fails on `17577851`: the owner tried 480 times over 4 simulated hours and never signed in (about 24 s, since it runs all 4 hours; on the fix it stops at the owner's first try). "third review, item 1: one requester hammering one address backs off on its own pair, then is capped at perPairHour" fails there too (no pair backoff: `backoffAfter` 10 is not below `perPairHour` 5), and so do the two reworked H2 tests that count toward the address ceiling. After the fix: Horae Zone 135/135, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 2** (a start mints whenever no link is live; fix `a62b6d3c`): in `signup.test.mjs` the probe, "third review, item 2: strangers' 3 mints and 3 re-sends, then the owner's start 11 minutes later mails a working link", fails on `17577851` (6 mails, expected 7: the owner's start mailed nothing). "strangers starting every 10 s for an hour never leave the owner without a working link" fails (the owner's newest mailed link answered 401) and "one link is live at a time, and mail to one address stays bounded each hour" fails (2 live links at minute 1). Four reworked tests fail there too: "H1: a code lives inside one window" (`codesPerAddressHour` and `liveCodes` still defined), "H1: starts while a link is live mail that link again, and it works", "item 3: re-sends of a live link are capped each hour" and "item 3: an expired link is never sent again, and the next start mints a new one". After the fix: Horae Zone 138/138, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.

**RED evidence for R1 and R2** (the final review of #242, two load numbers raised; see the design review). Only the pinning tests changed first.
1. In `apps/horae-zone/src/signin.js` set `perAddressHour` back to 100, and in `src/signup.js` set `codesPerMailboxHour` back to 3, then run the Horae Zone suite.
2. Expect 210 tests with 2 failing: "item 4 (R1): the per-address ceiling is 1000 failures an hour, and only failures fill it" (`devices.test.mjs`, 100 where 1000 is expected) and "M2: starts for every +tag of one mailbox share one limit, and the plain address is not held by it" (`signup.test.mjs`, 3 where 10 is expected). The other 208 pass.
3. Restore with `git checkout HEAD -- apps/horae-zone/src`.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| engine `test/mailer.test.mjs` | The mailer posts to Resend with the key only in the `authorization` header. A failed send logs once, with no key, address or text, and never throws. A message without a recipient, subject or text is not sent. It cannot be built without a sender or a key reader. `fragmentLink` puts the token only after `#`, and refuses a base that is not https or already has a query or fragment. Two transport tests are ported from JanusMirror's `pairing-limits.test.mjs` | `NEGATIVE CONTROL: a send that succeeds logs nothing` |
| engine `test/same-hex.test.mjs` | `sameHex` is exported from `src/limits.mjs`, reads equal digests as the same and any one difference as not, refuses unequal lengths and non-strings, and has no early return in its loop | The equal-digest case |
| `test/signup.test.mjs` | **"sign-up needs the email code"** and **"the email code rides in the fragment"** (the plan tests). An address never sent a code is refused like a wrong code. A code works once and expires. **H1:** a newer start never ends the live code (since the third review, item 2, one is live at a time and a start while it is live mails it again), the live code works, a stranger's wrong guesses do not end the owner's code, and tries at one address are capped for each requester. It is stored only as a keyed digest and compared with `sameHex`. Starts are rate limited per requester, tries per requester. No answer says whether an address already has an account, and **M1:** a start sends the same statements whether or not the address has one. **M2:** an address with a format or zero-width character, or a non-ASCII local part, is `shape` at sign-up and sign-in with nothing written or counted; starts for every `+tag` of one mailbox share one limit that never holds the plain address; codes sent are capped per day (`HZ_CODES_PER_DAY`, default `codesPerDay`), and a bad value answers `unavailable`. **L3:** a start, verify or sign-in with no, an empty or a blank `cf-connecting-ip` is `shape` with nothing written, counted or mailed. A bad address, an extra field or a password outside the length rule is `shape`. The password is stored as a salted slow hash and the address sealed, opening only with the service key. A failed mail is audited and the answer is unchanged. Without the account key or a link base nothing is written or mailed. The mail has a plain subject, the link with the token and no em dash. **Second review, item 1:** the code is a 128-bit token (22 base64url characters, a new one each start), the mail shows no code to type, and any other shape (a 6-digit code included) is `shape` before a try is counted. **Item 2:** 15 strangers' wrong tries from 3 requesters, then the owner's link still verifies; 60 from 12 never end the code; no `verify-address` bucket is written. **Item 3:** 3 strangers' starts, then the owner's start answers `{ok:true}` and mails the live link again, which verifies; 40 starts while one link is live mail it at most 1 + `resendsPerAddressHour` times and mint no other; an expired link is never sent again and the next start mints a new one; inside a code's life an address with an account is mailed nothing and sends the same statements as one with a live link; a live code is sealed in `link_box` (bound to its address key) and the box is dropped when the code is spent. **Item 6:** `v@example.test.`, `V@EXAMPLE.TEST` and `v@example.test` are one address (one per-address bucket, mail to the plain address, a link from one verifies for another); a full-width or decomposed spelling of a domain is the same address as its ASCII DNS name; a domain with an empty label, a leading or trailing hyphen, a character no DNS name has, an all-digit top label or a label over 63 characters is `shape` at all three routes with nothing written. **Item 5:** the default hard daily cap is 3000; with a fake `HZ_ALERT_TO`, one alert mail goes out at half the cap and no other inside the day, it names no address and has no em dash, and every start below the hard cap still mails its link; a new day can alert again; without an alert address the half-cap start is audited `alert-unset`, and a failed alert send `alert-failed`, with the answer and the link unchanged; the alert check sends the same statements whether or not the address has an account. **Third review, item 2:** after strangers' 3 mints and 3 re-sends, the owner's start 11 minutes later mails a link that verifies; strangers starting every 10 s for half an hour never leave the owner's newest mailed link dead; a start a minute for an hour keeps at most one link live, mints 6 and mails 9; `codesPerAddressHour` and `liveCodes` are gone | `NEGATIVE CONTROL: the code from the mail, with a password, makes the account`; `NEGATIVE CONTROL: an ASCII local part with a non-ASCII domain, a dot or a plus still starts`; `M2 NEGATIVE CONTROL: the account key stays the full address, tag included`; `L3 NEGATIVE CONTROL: the same start with a connecting address is admitted and counted under it` |
| `test/checks.test.mjs` (added) | A request with a query string is refused as `shape` before any check or handler | The A2 negative control still passes |
| `test/leak.test.mjs` (added) | A real sign-up leaves no address, email code or password in any answer, table, bound value or log | The A2 planted-echo control |
| `test/purge.test.mjs` (added) | The purge removes spent and expired email codes (second review, item 2: a live code with many tries stays), and rate-limit rows past their window. **M2:** it keeps daily-cap rows for a day and clears them after. **Second review, item 5:** it keeps the `alert-day` row for a day too | The A2 keep-fresh control |

### Manual checks for the reviewer

1. **No console calls**, as in A2: `grep -rn "console\." apps/horae-zone/src` prints nothing.
2. **No value in a URL.** `grep -rn "searchParams\|?code=\|?token=" apps/horae-zone/src packages/account-engine/src` prints nothing.
3. **Local smoke test without secrets** (as in A2, with `npx wrangler@4 dev --local` and no secret set):

   | Request | Expected |
   |---|---|
   | `curl -s -X POST -H 'content-type: application/json' -H 'cf-connecting-ip: 192.0.2.10' -d '{"email":"someone@example.test"}' localhost:8787/account` | `{"error":"unavailable"}`, since no account key or mail key is set (without the header it is `shape`, L3) |
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' 'localhost:8787/account?x=1'` | `{"error":"shape"}` |
   | `curl -s -X POST -H 'content-type: application/json' -d '{"email":"someone@example.test","extra":1}' localhost:8787/account` | `{"error":"shape"}` |

4. **No real mail and no real secret.** Confirm that no `wrangler secret put` was run, and that `wrangler.toml` still has no `[vars]`.

### Not in A3 (do not add here)

- The authenticator code, its enrolment and the code-path lockout email (A5).
- The PIN (A5b) and recovery (A6).

---

## A4: devices (`apps/horae-zone`, `packages/account-engine`)

### Run

As in A3.

- **Expected result at A4 GREEN (`75158c79`):** engine 64 tests (63 pass, 1 skips without the private package; the runtimes test loads `src/signed-bytes.mjs` in `workerd` and Chromium), Horae Zone 81 tests, 81 pass, and profile-api 195/195.
- **Expected result after the first security review's fixes (`012e8993`):** engine 64 tests (63 pass, 1 skip), Horae Zone 110 tests, 110 pass, and profile-api 195/195.
- **Expected result now, after the third security review's fixes (`a62b6d3c` and later):** engine 64 tests (63 pass, 1 skip; Node, Chromium and `workerd`), Horae Zone 138 tests, 138 pass, and profile-api 195/195.
- **Expected result after the removal proof (8 Oct 2026, DESIGN-REVIEW A4 row 5):** Horae Zone 408 tests, 408 pass (`node --test` in `apps/horae-zone`).

**RED evidence.**
1. Run `git checkout a55d8771 -- packages/account-engine apps/horae-zone`, then both suites.
2. Expect the engine to fail in `signed-bytes.test.mjs` (`ERR_MODULE_NOT_FOUND` for `src/signed-bytes.mjs`), with every other engine test passing.
3. Expect Horae Zone 57 tests with 3 failing: `devices.test.mjs` on the missing `src/signin.js`, the A4 leak test because `/signin` hands out no ticket, and the ticket purge test on `no such table: ticket`. Every A2 and A3 test passes.
4. Restore with `git checkout HEAD -- packages/account-engine apps/horae-zone`.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| engine `test/signed-bytes.test.mjs` | `signedBytes` and `SIGNED_LABEL` build the shared vector's bytes, and the vector's signature verifies over them with the vector key. Each part is length-prefixed, so a byte moved between path and body changes what is signed. A body that is not bytes, or a nonce or path that is not a string, throws `TypeError`. The body passed in is not kept or changed | `NEGATIVE CONTROL: the vector signature does not verify for another path or body` |
| `test/devices.test.mjs` | **"a request with no registered device signature is refused"** and **"a removed device is refused at once"** (the plan tests). **"/device/register requires the ticket from /signin"** (A2 open point 1). Sign-in: a wrong password and an unknown address are refused alike, and the unknown address hashes a password just as a wrong password does; the body is exactly an address, a password and a key digest; tries are rate limited per requester (across addresses). **Second review, item 4:** after ten strangers' wrong passwords from ten requesters the owner's right password from a new device signs in; one requester's wrong passwords at one address are capped at `perPairHour`, then even its right password is held while another requester signs in; the address ceiling is 100 wrong passwords an hour and a success takes no place in it. **Third review, item 1:** six strangers push the address past 10 wrong passwords and then try every second, and the owner's right password from a new connecting address signs in on the first try; one requester hammering one address backs off on its own pair past `backoffAfter` wrong passwords, answering `slow-down` whatever the password for a quiet time that doubles and is held 1 ms before it ends, never above 15 minutes, while another requester signs in, and the pair stays capped at `perPairHour` until its first failure leaves the hour. **Second review, item 7:** a registered device of the account guessing passwords from one requester is held at `perPairHour`, signed and unsigned wrong passwords from one requester share that cap, and the device's own successes take no place in it or in the address bucket. **H2:** with the address at its ceiling the owner signs in from a registered device; a success is not counted against the address ceiling, and does not clear it; a sign-in naming a device must carry its good signature (a tampered, unknown or removed device is refused); the ticket is stored only as a keyed digest bound to its account and its key digest. **M3:** a ticket refuses keys other than the ones it was signed in for (both keys, or either one swapped) and stays unspent; a sign-in without a well-formed key digest is `shape` with nothing written or counted. **M5:** a password set in NFC form signs in from its NFD form and the reverse, and a ligature signs in as its plain letters. Register: a ticket registers one device and expires; a key that is not a P-256 point is `shape` and leaves the ticket live; the body is exactly a ticket and two keys. Remove (with a fresh code since 8 Oct 2026, see `test/device-remove.test.mjs`): a device can remove itself and is refused at once; it cannot remove another account's device, and the answer does not say so; the body holds only a device id and a ticket, each of its shape; the row stays, marked with when it was removed. **L2:** a removal that lands mid-flight wins: a device removed after its checks passed cannot remove another device, gets no nonce, cannot spend a nonce, and gets no sign-in ticket. **At most five live nonces per device** (A2 open point 2), a spent or expired nonce frees its place, and the cap holds when requests arrive together. **The service builds signed bytes with the engine function and accepts the shared vector** (A2 open point 4). Sign-in, register and remove each write one audit row | `NEGATIVE CONTROL: a request signed by the registered key passes the device checks`; `NEGATIVE CONTROL: the right address and password answer a single-use ticket`; `NEGATIVE CONTROL: a ticket used just inside its life registers the device`; `item 4 NEGATIVE CONTROL: the owner's own successes from one requester take no place in the pair bucket`; `item 7 NEGATIVE CONTROL: a known device's own successes take no place in the pair bucket and still skip the address bucket`; `H2 NEGATIVE CONTROL: a device of another account does not lift the address bucket`; `H2 NEGATIVE CONTROL: a signed sign-in still pays the per-requester bucket`; `M5 NEGATIVE CONTROL: a password that differs after normalising is still refused`; `L2 NEGATIVE CONTROL: a live device removes another, and itself` |
| `test/leak.test.mjs` (added) | Sign-in (wrong, unknown and right), a bad and a good register, a ticket reuse and a removal leave no address, password or ticket in any answer, table, bound value or log. The one answer that hands out a ticket is checked as the expected exception. The A2 sweep now lets each unspent nonce expire between routes, so the cap does not refuse it | The A2 planted-echo control |
| `test/purge.test.mjs` (added) | The purge removes spent and expired sign-in tickets and keeps a live one (its fixture rows carry a `key_digest` since M3) | The live ticket kept |
| `test/device-remove.test.mjs` (added 8 Oct 2026, Kaleb's ruling on DESIGN-REVIEW A4 row 5) | A removal takes a fresh code (an unlock ticket of the calling device): none answers `code-needed`; a malformed, other device's or expired one answers `bad-ticket`, and nothing is removed or mailed. A reused code answers `bad-ticket`, whether a removal or an open spent it, and of two removals sent together with one code only one removes. A removal with a fresh code stamps `removed_at` at the request's moment, and the removed device is refused (`no-device`) on its very next request; a device removes itself with its own code. The notice goes to the account address and carries no ticket, id, key, seed, password, number or link, and no table holds the ticket; a removal that removes nothing mails nobody. Without a mailer the route answers `unavailable`, removes nothing and leaves the code unspent. Each try writes one audit row of route and reason, and a failed notice a second (`mail-failed`), the removal standing. The last test pins the ticket form the `freshCode` helper signs | `NEGATIVE CONTROL: the second device still passes every device check`; `NEGATIVE CONTROL: the fresh code removes`; `NEGATIVE CONTROL: the device that removed it carries on`; `NEGATIVE CONTROL: the same code still removes once mail works` |

### Manual checks for the reviewer

1. **One signed-bytes builder.** `grep -rn "function signedBytes" apps/horae-zone/src packages/account-engine/src` prints only `packages/account-engine/src/signed-bytes.mjs`.
2. **The vector is fake.** `packages/account-engine/test/fixtures/signed-bytes-vector.json` holds a public key, signatures and a fake nonce, and no private key.
3. **Local smoke test**, as in A3:

   | Request | Expected |
   |---|---|
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/device/register` | `{"error":"shape"}` |
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/device/remove` | `{"error":"no-device"}` |
   | `curl -s -X POST -H 'content-type: application/json' -H 'cf-connecting-ip: 192.0.2.10' -d '{"email":"someone@example.test","password":"not-a-real-one","keyDigest":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' localhost:8787/signin` | `{"error":"unavailable"}`, since no account key is set (without the header it is `shape`, L3) |

### Not in A4 (do not add here)

- The authenticator code on `/signin`, unlock and its lockout (A5).
- The PIN (A5b), admin actions (A5c) and recovery (A6).
- Pairing a vault to a new device (`/pair/offer`, `/pair/take`).

---

## A5: the single authenticator code (`apps/horae-zone`, `packages/account-engine`)

### Run

As in A3.

- **Expected result now, with A5 re-review items 1 to 5:** engine 68 tests (67 pass, 1 skips without the private package; Node, Chromium and `workerd`), Horae Zone 236 tests, 236 pass, and profile-api 195/195. After the rebase onto `dev` with R1 and R2 the branch had 210 Horae Zone tests; item 1 added 9 in `owner.test.mjs`, item 2 added 6 more there, item 3 added 5 more there (the three sole-device tests in `otp.test.mjs` were rewritten, not added), item 4 added 5 in `lockout.test.mjs` and replaced 1 there, and item 5 added 2 in `owner.test.mjs`. Before the rebase the branch had 182; `dev` added 28 (A3 and A4's second and third security reviews).
- **Counts in the RED evidence below were measured before the rebase onto `dev`.** The hashes are the rebased ones. Each item's count was taken under the tests of its own commit; under today's tests more fail, since later items' tests need the later source too, and the rebase did not change that (re-run 2026-10-04 for the five A5 review items: 6, 96, 10, 4 and 1 failing of 210 on the rebased branch, against 6, 93, 10, 4 and 1 of 182 before the rebase; item 2's three more are `dev`'s added sign-in tests, which register a device and so need the `otp` columns item 3 added).
- **No mail is sent.** Every lock note goes to the injected mail sink, and the tests read the reopen token from it.
- **Test values are fake or made per run:** `HZ_SEED_KEY` is a fixed fake value, `HZ_TICKET_KEY` is a P-256 key pair the harness makes for each run and never writes down, and `HZ_REOPEN_BASE` is `https://horae-zone.example.test/reopen`. The device side of CPace runs in the test with the engine's `pake.mjs`, and codes come from the engine's `totp.mjs` over the seed the enrolment answered.

**RED evidence.**
1. Run `git checkout 82744bc7 -- packages/account-engine apps/horae-zone`, then both suites.
2. Expect the engine 57 tests with 1 failing: `pake.test.mjs` cannot load (`'../src/pake.mjs' does not provide an export named 'unlockChannelFor'`). Every other engine test passes (1 skips).
3. Expect Horae Zone 126 tests with 16 failing:
   - `otp.test.mjs` and `unlock.test.mjs` cannot load (`ERR_MODULE_NOT_FOUND` for `src/otp.js` and `src/unlock.js`), one failure each;
   - all 12 tests in `lockout.test.mjs` (`enrol answered 501`, since `/otp/enrol` has no handler);
   - the A5 leak test, the same way;
   - the exchange purge test (`no such table: exchange`).
   Every A2 to A4 test passes (110, the security review's included).
4. Restore with `git checkout HEAD -- packages/account-engine apps/horae-zone`.

**RED evidence for the security review findings carried to A5** (open points 8 and 9 in the design review).
1. Run `git checkout 234e058c -- apps/horae-zone`, then the Horae Zone suite.
2. Expect 161 tests with 7 failing, each a 200 carrying a seed, an exchange or a ticket where a refusal was expected:
   - `otp.test.mjs`: "enrolment spends only a ticket bound to the signing device's own keys" (M3), and the two L2 enrol tests (after the nonce spend, after the ticket spend);
   - `unlock.test.mjs`: the four L2 tests (after the nonce spend on start, after the nonce spend on finish, after the exchange spend, after the `last_step` update).
   Every other test passes, the M3 and L2 negative controls included.
3. Restore with `git checkout HEAD -- apps/horae-zone`.

**RED evidence for the A5 security review of `77305fc0`** (the section "The A5 security review" in the design review). Each item puts back the source at `77305fc0` under the current tests.
- **Item 1** (a password thief enrols first): run `git checkout 77305fc0 -- apps/horae-zone/src/otp.js`, then the Horae Zone suite. Expect 164 tests with 3 failing in `otp.test.mjs`, each a 200 carrying a seed where `{status: 409, error: 'enrol-blocked'}` was expected: "A5 review 1: a second registered device cannot enrol", "A5 review 1: the probe (password thief registers and tries to enrol first) ends with the thief refused and removed" and "A5 review 1: a device registered between the ticket spend and the seed insert blocks the enrolment". Every other test passes, "A5 review 1 NEGATIVE CONTROL: a removed device does not count, so the sole live device enrols" included. Restore with `git checkout HEAD -- apps/horae-zone/src/otp.js`.
- **Item 2** (a pending device keeps the path closed): run `git checkout 77305fc0 -- apps/horae-zone/src/unlock.js apps/horae-zone/src/lockout.js apps/horae-zone/src/retention.js apps/horae-zone/schema.sql`, then the Horae Zone suite. Expect 170 tests with 4 failing: "A5 review 2: the probe (a pending device burns tries in two windows) leaves the owner's path open" (the owner's right code in the thief's window answers 423 where 200 was expected) and "A5 review 2: a pending device gets 3 tries a day, a right code included, then the next day 3 more" (a fourth start answers 200 where `locked` was expected), both in `lockout.test.mjs`; "A5 review 2: a pending device's 3 tries a day hold when more arrive together" in `unlock.test.mjs` (1 of 5 admitted where 3 were expected, the owner's two wrongs having filled the window); and "a purge removes a pending device's tries once they are a day old" in `purge.test.mjs` (`no such table: pending_try`). Every other test passes, both "A5 review 2 NEGATIVE CONTROL" tests included. Restore with `git checkout HEAD -- apps/horae-zone`.
- **Item 3** (an unclaimed seed means lock-in): `src/otp.js`, `src/unlock.js` and `schema.sql` at `77305fc0` also lack items 1 and 2, so this item puts back the source at item 2's commit `d2e59ad9` instead. Run `git checkout d2e59ad9 -- apps/horae-zone/src/otp.js apps/horae-zone/src/devices.js apps/horae-zone/src/unlock.js apps/horae-zone/schema.sql`, then the Horae Zone suite. Expect 176 tests with 6 failing, 5 of them in `otp.test.mjs`: "A5 review 3: a repeated enrol before the first accepted code returns a new seed and invalidates the old one" and "A5 review 3: an exchange started on the old seed is refused once a repeat enrol replaced it" (the repeat answers 409 `enrolled` where 200 with a new seed was expected); "A5 review 3: a repeat enrol keeps the sole-live-device rule, and the old seed stays" (the second device is pending and answers `no-device` where `enrol-blocked` was expected); "A5 review 3: only a confirmed enrolment makes other devices pending" (pending 1 before any code was accepted, where 0 was expected); "A5 review 3: a device registered while the confirming code is in flight is held back" (pending 0 where 1 was expected). The sixth is "a purge removes finished and expired code exchanges" in `purge.test.mjs`, whose fixture names the new `exchange.enrolment` column (`table exchange has no column named enrolment`). Every other test passes, "A5 review 3: after the first accepted code, a repeat enrol answers enrolled with no seed" included. With the same four files at `77305fc0` the same 5 item 3 tests fail, beside items 1 and 2's (13 failing in all). Restore with `git checkout HEAD -- apps/horae-zone`.
- **Item 4** (the unlock ticket has no jti or kid): run `git checkout 7674e0d2 -- apps/horae-zone/src/unlock.js` (item 3's commit), then the Horae Zone suite. Expect 178 tests with 3 failing, all in `unlock.test.mjs`: "A5 review 4: the ticket claims carry a random 128-bit jti, new on every ticket, and the kid of the key that signed it" (no `jti` in the claims), "A5 review 4: the kid selects the verification key, and a ticket does not verify under the other key" (no `kid`, so the ring picks no key) and the plan test "NEGATIVE CONTROL: a correct code, account and device returns a ticket" (the claims lack `jti` and `kid`). Every other test passes. Restore with `git checkout HEAD -- apps/horae-zone`.
- **Item 5** (`/unlock/finish` does not refuse while the path is closed): run `git checkout b3a14eba -- apps/horae-zone/src/unlock.js` (item 4's commit), then the Horae Zone suite. Expect 180 tests with 1 failing in `lockout.test.mjs`: "A5 review 5: /unlock/finish refuses while the path is closed, a right code started before it closed included" (the finish answers 200 with a ticket where `{status: 423, error: 'locked'}` was expected). This is the test as it stood at `e5dd81b8`; A5 re-review item 4 moved its in-flight right code onto a pending device, since the day cap now refuses the owner device's 13th try. Every other test passes, "A5 review 5 NEGATIVE CONTROL: a locked window that leaves the path open does not refuse a finish begun before it" included. Restore with `git checkout HEAD -- apps/horae-zone`.
- **Item 6** (each start allows the current and the previous step): a note in the design review, with no code change, so there is no RED. Its two tests in `lockout.test.mjs`, "A5 review 6: one start answers for two steps, so a full window is 6 guesses and four locked windows are 24" and "A5 review 6: a guesser who stops at 2 wrong codes a window is never locked (the 24 a day bounds locked windows only)", pass on item 5's commit `e5dd81b8` and after; they pin the numbers the note states, the second one the gap left open as point 10. A5 re-review item 4 closed that gap and replaced the second test.

**RED evidence for the A5 re-review of `2bda9022`** (the section "The A5 re-review" in the design review). Item 1 changes what the verify answers, and the shared helpers now register the owner device from it, so `2bda9022`'s source under today's tests fails nearly everywhere (151 of 219) and says nothing about the probes. The probe file runs instead under `2bda9022`'s own helpers, outside the worktree:
- **Item 1** (the owner device comes from the sign-up link; probes F1 and F2): run `git archive 2bda9022 apps/horae-zone packages/account-engine apps/profile-api/test/helpers | tar -x -C /tmp/hz-red` (into an empty `/tmp/hz-red`), copy `apps/horae-zone/test/owner.test.mjs` into `/tmp/hz-red/apps/horae-zone/test/`, then `node --test test/owner.test.mjs` in `/tmp/hz-red/apps/horae-zone`. Expect 9 tests with 9 failing. "probe F1: a password thief cannot remove the owner's device and enrol" and "probe F2: a password thief cannot swap the owner's unconfirmed seed" fail where the thief's `/device/remove` of the owner's device answers 200. "owner: a device registered from a password sign-in starts pending, before any code is enrolled" fails on `no such column: owner`, and the other six where the verify answers `shape` for `keyDigest` (or 200 without it, for the shape test). The negative control fails there only because its setup verifies with `keyDigest`; it passes after. Remove `/tmp/hz-red` after.
- **Item 2** (pending devices change nothing; only the owner enrols, re-enrols or removes before confirmation): item 1's commit `97ad5276` has the helpers these tests need, so this one runs in the same way against that commit: `git archive 97ad5276 apps/horae-zone packages/account-engine apps/profile-api/test/helpers | tar -x -C /tmp/hz-red` (into an empty `/tmp/hz-red`), copy `apps/horae-zone/test/owner.test.mjs`, `otp.test.mjs` and `unlock.test.mjs` into `/tmp/hz-red/apps/horae-zone/test/`, then `node --test test/owner.test.mjs test/otp.test.mjs test/unlock.test.mjs` in `/tmp/hz-red/apps/horae-zone`. Expect 64 tests with 7 failing: the five "re-review 2" tests in `owner.test.mjs` and two "A5 re-review 2" tests in `otp.test.mjs` (the owner's enrolment answers 409 `enrol-blocked` beside a pending device, a pending device's code confirms the enrolment and holds the owner device back, a device that is not the owner removes the owner device, and the owner flag or the caller's hold changed mid-flight does not stop the write). Probes F1 and F2 and the negative control pass there and after. Remove `/tmp/hz-red` after.
- **Item 3** (the account's pending devices share 6 tries a day, and the owner is mailed; probe F3): the same way against item 2's commit `88aa4e8b`: `git archive 88aa4e8b apps/horae-zone packages/account-engine apps/profile-api/test/helpers | tar -x -C /tmp/hz-red` (into an empty `/tmp/hz-red`), copy `apps/horae-zone/test/owner.test.mjs` and `purge.test.mjs` into `/tmp/hz-red/apps/horae-zone/test/`, then `node --test test/owner.test.mjs test/purge.test.mjs` in `/tmp/hz-red/apps/horae-zone`. Expect 35 tests with 6 failing: "probe F3: 8 pending devices with 3 tries each get at most 6 tries a day between them, and the owner is mailed" (24 tries admitted, expected 6), the four "re-review 3" tests (9 of 9 parallel starts admitted, expected 6; a third device's right code admitted past the account's 6; no pending note sent, expected 1) and "a purge removes a pending device's tries once they are a day old" (no `account_id` column). Remove `/tmp/hz-red` after.
- **Item 4** (12 wrong codes a day per account close the path; the daily-cap test): the same way against item 3's commit `07d710af`: `git archive 07d710af apps/horae-zone packages/account-engine apps/profile-api/test/helpers | tar -x -C /tmp/hz-red` (into an empty `/tmp/hz-red`), copy `apps/horae-zone/test/lockout.test.mjs` into `/tmp/hz-red/apps/horae-zone/test/`, then `node --test test/lockout.test.mjs` in `/tmp/hz-red/apps/horae-zone`. Expect 24 tests with 4 failing: "re-review 4: a guesser who stops at 2 wrong codes a window closes the path at the 12th wrong code of the day, and the owner gets the link" (the 12th wrong code leaves the path open), "re-review 4: wrong codes from every device that proved a code count toward the one cap" (6 from each of two devices close nothing), "re-review 4: tries arriving together never pass the day cap" (3 of 3 admitted with 10 wrong codes behind them, expected 2) and "re-review 4: after the link one more wrong code closes the path again, and a wrong code counts for a day" (no link to spend). "re-review 4 NEGATIVE CONTROL: 11 wrong codes in a day leave the path open and mail nothing" passes there and after. Remove `/tmp/hz-red` after.
- **Item 5** (before confirmation only the owner device's wrong codes reach the account's limits; probe F4): no code changed in this item, so the probe is measured against `2bda9022`, the head the re-review read, the same way as item 1: `git archive 2bda9022 apps/horae-zone packages/account-engine apps/profile-api/test/helpers | tar -x -C /tmp/hz-red` (into an empty `/tmp/hz-red`), copy `apps/horae-zone/test/owner.test.mjs` into `/tmp/hz-red/apps/horae-zone/test/`, then `node --test --test-name-pattern="probe F4" test/owner.test.mjs` in `/tmp/hz-red/apps/horae-zone`. Expect 2 tests with 1 failing: "probe F4: before the first accepted code a password thief spends none of the account's limits, and the owner device's wrongs still count" (6 of the thief's tries admitted, expected 0; on that source those 6 locked a window, then closed the owner's path, and the owner's right code answered 423 `locked`). The same run against item 1's commit `97ad5276` also fails (3 pending tries admitted, the owner's path open), and against item 2's commit `88aa4e8b` passes, since item 2 gave a pending device no try before confirmation. "probe F4 NEGATIVE CONTROL: before the first accepted code the owner device's right code still confirms after the thief's tries" passes on all three. Remove `/tmp/hz-red` after.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| `test/owner.test.mjs` (added, A5 re-review items 1 to 3 and 5) | The sign-up verify answers a ticket that registers the account's first device as its owner, not pending, only for the keys it was verified for, and once; a verify without a key digest is `shape` and makes no account. The right password on an account with no device yet answers `no-owner-device`, stores no ticket and mails the owner a note with no password and no link, at most one an hour. A device registered from a password sign-in starts pending before any code is enrolled. Probes F1 (the thief removes the owner's device and enrols) and F2 (the thief swaps the unconfirmed seed) end with the thief refused, the owner's device live, the seed unchanged and the owner's code accepted. Item 2: a pending device does not block the owner's enrolment, and before the first accepted code it gets no try (`not-enrolled`), so it cannot confirm the enrolment or hold the owner device back; a device that is not the owner answers `not-owner` at `/device/remove` and `/otp/enrol` even when not pending; the enrolment and the removal re-check the caller in their own writes. Item 3: probe F3 (8 pending devices, 3 wrong tries each) admits 6 tries between them and mails the owner once; 9 starts from 3 pending devices sent together admit 6; the account's tries count for a day from each try and a removed device gives none back; each wrong pending try mails the owner at most once an hour, with no code, seed, link or password, and a right one mails nothing; starts never finished reach the owner when the cap refuses the next. Item 5: probe F4 (before the first accepted code the thief's device makes 12 wrong tries and is admitted none, `not-enrolled`, with no lock note; the owner device's wrong codes lock a window and close the path) | `probe F4 NEGATIVE CONTROL: before the first accepted code the owner device's right code still confirms after the thief's tries`, `owner NEGATIVE CONTROL: a wrong password on an account with no device answers bad-login and mails nobody`, `re-review 2 NEGATIVE CONTROL: after the first accepted code, a device that proved a code may remove another, the owner's included` |
| engine `test/pake.test.mjs` (added) | `unlockChannelFor(device)` is `horae-zone-unlock-v1|<device>`, apart from every JanusMirror channel. An exchange for one device does not finish for another. Anything but a device id throws `TypeError` (A1 open point 3) | `NEGATIVE CONTROL: an unlock exchange finishes for the device it names` |
| `test/otp.test.mjs` | **"the seed is returned once and never again"** (plan test): the first enrolment answers `{secret, uri}`, a second after the first accepted code answers `enrolled` with no seed, and no later answer carries it. Enrolment needs a live `/signin` ticket of the signing device's account (another account's ticket is refused and stays live), a ticket enrols once, an unsigned request is refused, and the body is exactly one ticket. The seed is stored only sealed under the seed key, bound to its account (`openSeed` fails for another account or key). Without the seed key, enrolment answers `unavailable` and stores nothing. A device registered after the first accepted code reaches only `/nonce` and `/unlock` until it proves a code. Until that first accepted code the enrolment is repeatable: a repeat answers a new seed, the old seed's code and an exchange started on the old seed answer `bad-code`, a second live device still blocks the repeat, no device is pending, and the confirming code holds back every other live device, one registered while it is in flight included (A5 review item 3). Enrolment succeeds only for the account's sole live device: a second registered device answers `enrol-blocked` and leaves the ticket live, the full password-thief probe ends with the thief refused and removed by the owner, and a device registered between the ticket spend and the seed insert still blocks it (A5 review item 1). Enrolment spends only a ticket bound to the signing device's own keys (M3). A device removed after its signed enrol passed the checks, or after its ticket was spent, answers `no-device` and gets no seed (L2). One audit row per enrolment | `NEGATIVE CONTROL: two accounts get different seeds`; `NEGATIVE CONTROL: a ticket bound to the signing device's keys enrols`; `L2 NEGATIVE CONTROL: a removal of some other device mid-flight does not stop an enrol`; `NEGATIVE CONTROL: the enrolling device and devices of an account with no code are not held back`; `A5 review 1 NEGATIVE CONTROL: a removed device does not count, so the sole live device enrols`; `A5 review 3: after the first accepted code, a repeat enrol answers enrolled with no seed` |
| `test/unlock.test.mjs` | **"NEGATIVE CONTROL: a correct code, account and device returns a ticket"** (plan test): the ticket verifies against the run's public key, and a changed payload does not. Its claims carry a 128-bit random `jti`, new on every ticket, and a `kid`, the RFC 7638 thumbprint of the signing key's public half, worked out in the test; under two signing keys in turn the kid picks the signer from a ring of both, and the other key does not verify (A5 review item 4). A wrong code, an unknown, spent or expired exchange and another device's exchange all answer `bad-code`. A code accepted once is refused again in the same step on any device, and of two exchanges proving one code only the first finished is accepted. The previous step's code is accepted, and a code two steps old or the next step's is refused. Of six starts sent together, three are admitted, and of five starts a pending device sends together, three are admitted though the owner's wrongs fill most of the window (A5 review item 2). The start body is exactly `sid`, `Ya` and `clock` with a valid point, and the finish body exactly an exchange and a tag. An account with no code answers `not-enrolled` and counts nothing. Without the ticket key or a reopen base, unlock answers `unavailable` and admits nothing. An exchange stores only keyed digests of the tags it expects. The expected tags are compared with `sameHex` (checked statically: no `digest ===`). A device removed mid-flight (after the nonce spend on start or finish, after the exchange spend, after the `last_step` update) answers `no-device`: no exchange, no ticket, the code left for live devices where the removal came before acceptance, and the device kept pending (L2). One audit row per start and finish | The plan test itself; "the previous step's code is accepted"; `L2 NEGATIVE CONTROL: a removal of some other device mid-flight does not stop a start or a finish` |
| `test/lockout.test.mjs` | **"three wrong codes in one window lock it and email; two in a row or four a day close the path until the link"** and **"the reopen link is single use and hands out no key"** (plan tests). An exchange left unfinished counts as a wrong code once its confirm time passes. A closed path is per account. A reopen link expires, and the next refused try mails a fresh one. The reopen body is exactly one token, and an unknown token answers like a spent one (`bad-link`). The stored state is the engine's and keeps only a hash of the link. A state that cannot be read fails closed and mails a link. A lock mail that fails to send is audited `mail-failed`, and the lock holds. No lock note carries a six-digit number or an em dash. One audit row per refused start and per reopen. A pending device's tries never reach the account's lockout: the password-thief probe (3 wrongs in one window, more in the next) leaves the owner's window and path open, and a pending device gets 3 tries a day of its own, a right code included (A5 review item 2). A closed path refuses a finish too: a right code started while the path was open and finished after it closed answers `locked`, gets no ticket, spends its exchange and is dropped from the lockout uncounted (A5 review item 5). One start answers for two steps, so a full window is 6 guesses and four locked windows 24 (A5 review item 6). 12 wrong codes a day from every device in the lockout close the path until the link, whatever window they fall in, so a device that stops at 2 wrong codes a window is closed out at the 12th; tries in flight count, so tries arriving together never pass the cap; after the link the next wrong code that day closes it again; a wrong code counts for a day (A5 re-review item 4, design review open point 10) | `NEGATIVE CONTROL: two wrong codes and then a right one neither lock nor mail`; `NEGATIVE CONTROL: a link used just inside its life reopens the path`; `A5 review 2 NEGATIVE CONTROL: a non-pending device's wrongs still close the path, for pending devices too`; `A5 review 2 NEGATIVE CONTROL: a pending device's tries are its own, so another pending device keeps its 3`; `A5 review 5 NEGATIVE CONTROL: a locked window that leaves the path open does not refuse a finish begun before it`; `re-review 4 NEGATIVE CONTROL: 11 wrong codes in a day leave the path open and mail nothing` |
| `test/leak.test.mjs` (added) | Enrolment, wrong and right codes, a closed path and a reopen leave no seed, code, tag, ticket or reopen token in any answer, table, bound value, audit row or log, apart from the one answer (or the one lock mail) that hands each out | The A2 planted-echo control |
| `test/purge.test.mjs` (added) | The purge removes finished and expired code exchanges (each stored with its enrolment, A5 review item 3) and keeps a live one, and removes a pending device's tries once a day old (A5 review item 2) | The live exchange kept; the tries under a day old kept |

### Manual checks for the reviewer

1. **Constant-time compare only.** `grep -rn "digest ===\|=== digest" apps/horae-zone/src` prints nothing.
2. **No console calls**, as in A2: `grep -rn "console\." apps/horae-zone/src` prints nothing.
3. **The seed has one way out.** `grep -rn "base32Encode\|otpauthUri" apps/horae-zone/src` prints only `src/otp.js` (the import and the one answer in `enrolOtp`).
4. **No real secret.** `wrangler.toml` still has no `[vars]`, no `wrangler secret put` was run, and `test/helpers.mjs` holds only the fake seed key and makes the ticket key per run.
5. **Local smoke test**, as in A3:

   | Request | Expected |
   |---|---|
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/otp/enrol` | `{"error":"no-device"}` |
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/unlock/start` | `{"error":"no-device"}` |
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/unlock/reopen` | `{"error":"shape"}` |
   | `curl -s -X POST -H 'content-type: application/json' -d '{"token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' localhost:8787/unlock/reopen` | `{"error":"unavailable"}`, since no account key is set |

### Not in A5 (do not add here)

- The PIN, the 12-hour rule and `/reverify` (A5b), admin actions (A5c) and recovery (A6).
- Anything that consumes the unlock ticket (A5b, A7).

---

## A5b: the PIN, server side (`apps/horae-zone`, `packages/account-engine`)

### Run

As in A3: `node --test test/*.test.mjs` in `apps/horae-zone`, `npm ci` then `npm test` in `packages/account-engine`, and `node --test --test-concurrency=1 "test/*.test.js"` in `apps/profile-api`.

- **Expected result now:** engine 69 tests (68 pass, 1 skips without the private package; Node, Chromium and `workerd`), Horae Zone 359 tests, 359 pass, and profile-api 195/195. `dev` at `22e18525`, the base after the rebase, has 289 Horae Zone tests (A5's head `95cf772a` had 278; the 11 more are A5's MEDIUM-1 relink tests). The plan tests added 61 Horae Zone tests in eight new files, 3 purge tests in `purge.test.mjs` and 1 engine test (`PIN_LOCKED`), so the docs commit `74ef8094` had 353; it first said 342, counted before the rebase. The security review's fixes added 6 more: 1 in `pin-reset.test.mjs` (HIGH-1), 3 in the new `pin-blocklist-order.test.mjs` (LOW-1), 1 in `pin-reset.test.mjs` and 1 in `purge.test.mjs` (LOW-2).
- **Tests that used `/reverify` as the generic not-built signed route** (`checks`, `devices`, `otp`, `purge`) now use `/pair/offer`, since `/reverify` is built. The shared signed-bytes vector (`packages/account-engine/test/fixtures/signed-bytes-vector.json`, shared with Sass and JanusMirror and left unchanged) signs `/reverify` with a body, so its test now expects the handler's `shape` answer and the nonce spent.
- **No mail is sent.** Every PIN note, reset mail and lock note goes to the injected mail sink, and the tests read the reopen token and the reset code from it.
- **Test values are fake or made per run,** as in A5. The PIN rules are the engine's five-PIN public fixture (`createPinRules` over `test/fixtures/pin-blocklist.mjs`), injected through `harness({pinRules})`. `HZ_RESET_BASE` is `https://horae-zone.example.test/pin-reset`.

**RED evidence.** Each commit's RED was watched in the run before its build, against a stub that exported only the new constants or answered `not-built`, so the failures were assertions; the counts are in each commit message. To repeat it without the stubs, put back the source before each commit under that commit's own test file and helpers, outside the worktree:

1. For a commit `C` and its file `F`: run `git archive C^ apps/horae-zone packages/account-engine apps/profile-api/test/helpers | tar -x -C /tmp/hz-red` (into an empty `/tmp/hz-red`), then `git show C:apps/horae-zone/test/F > /tmp/hz-red/apps/horae-zone/test/F` and the same for `test/helpers.mjs`.
2. Link the engine's installed `node_modules` into `/tmp/hz-red/packages/account-engine/`, then run `node --test test/F` in `/tmp/hz-red/apps/horae-zone`.
3. Remove `/tmp/hz-red` after.

Measured 2026-10-04, on the commits before the rebase onto `dev` (`6ad8addc` to `9b3ace78`, on `95cf772a`). The rebased commits (`bd7bfd7e` to `02e7258d`) change the same A5b files the same way (DESIGN-REVIEW.md, A5b), so each row's commit is given both ways:

| Commit | File | Before the build (in the run, against the stub) | Repeat, source before the commit |
|---|---|---|---|
| `6ad8addc` = `bd7bfd7e` (test 1) | `pin.test.mjs` | 12 of 12 failing, `not-built` | Fails to load: `ERR_MODULE_NOT_FOUND` for `src/pin.js` |
| `00efe3de` = `768e6acd` (test 2) | `pin.test.mjs` | 2 of 2 new tests failing on assertions | Fails to load: no export `GRANT_LABEL` in `src/pin.js` |
| `6bd0e23d` = `94bad54d` (test 3) | `pin-block.test.mjs` | 5 of 5 failing on assertions (`no-route`, no mail) | Fails to load: `ERR_MODULE_NOT_FOUND` for `src/account-lock.js` |
| `63299ecf` = `8fc3bac1` (test 4) | `pin-reuse.test.mjs` | 7 of 7 failing (assertions and the missing `pin_lock` table) | Fails to load: no export `PIN_LOCKED` in the engine's `src/pin.mjs` |
| `e58a3eb1` = `c4f9878c` (online lockout) | `pin-lockout.test.mjs` | 8 of 9 failing, the negative control passing | 10 tests, 9 failing; "NEGATIVE CONTROL: two wrong PINs and then the right one neither lock nor mail" passes |
| `ddac2b93` = `2306a136` (test 6) | `pin-reset.test.mjs` | 8 of 8 failing, `not-built` | Fails to load: `ERR_MODULE_NOT_FOUND` for `src/pin-reset.js` |
| `06d539f5` = `3213116b` (tests 7, 8) | `pin-review.test.mjs` | 7 of 7 failing, `not-built` | Fails to load: `ERR_MODULE_NOT_FOUND` for `src/pin-review.js` |
| `bf55aa5f` = `ae360501` (tests 9, 10) | `reverify.test.mjs` | 7 of 7 failing, `not-built` | Fails to load: `ERR_MODULE_NOT_FOUND` for `src/reverify.js` |
| `9b3ace78` = `02e7258d` (test 5) | `pin-plain.test.mjs` | The sweep failing on a real leak: the PIN notes said "30 seconds", "Expires 72 hours" and "12 wrong PINs" | 3 tests, 1 failing: "no user-facing response carries a date, duration, count or hash"; the coverage test and the negative control pass |

**RED evidence for the security review's fixes** (DESIGN-REVIEW.md, A5b, "The A5b security review"). Each fix's tests were watched failing before the fix in the run, and measured again 2026-10-04 by the same steps, with the fix commit's test files and `test/helpers.mjs` over the source of the commit named:

| Fix commit | Test file (from the fix commit) | Over the source of | Result |
|---|---|---|---|
| `a5af066d` (HIGH-1) | `pin-reset.test.mjs` | `74ef8094` | 10 tests, 1 failing: "a null or empty factor is refused as shape, never counted, and the refusals spend nothing", at "three nulls" (200, the PIN replaced) |
| `559fb63b` (LOW-1) | `pin-blocklist-order.test.mjs` | `74ef8094`, and `a5af066d` | 3 of 3 failing on both, each a listed PIN answered 400 `too-easy` where `bad-ticket`, `bad-pin` or `bad-reset` was expected |
| `8cf86b8f` (LOW-2) | `pin-reset.test.mjs`, `purge.test.mjs`, `pin-plain.test.mjs` | `559fb63b` | 1 of 11, 1 of 19 and 1 of 3 failing: the day cap test at "the twelfth wrong tells the owner", "LOW-2: a purge keeps each account's wrong reset rows for a day and clears them after", and "the run reaches every A5b answer and every A5b mail" at "the run mails Horae Zone: app PIN reset paused" |
| `8cf86b8f` (LOW-2) | the same three | `74ef8094` | The same three failing (the day cap test at "the hour is full"), plus HIGH-1's test, still open there |

After each fix the three suites passed: Horae Zone 354/354, 357/357 and 359/359, engine 69 (68 pass, 1 skip; Node, Chromium, `workerd`) and profile-api 195/195 each time.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| `test/pin.test.mjs` (added) | **"every open asks for Face ID and the PIN; the code only when the last accepted code is 12 hours old"** and **"offline, the PIN alone opens only while the last accepted code is under 12 hours old"** (plan tests 1 and 2). At 12 hours the open needs the code too, and a fresh code restarts the 12 hours; the 12 hours are per device; a device that never used a code needs it at its first open. Every accepted open answers exactly `{ok, grant}`, and the grant's `until` is the last accepted code plus 12 hours, never moved by a PIN-only open. A grant does not verify as a ticket, nor a ticket as a grant. The ticket verifier: a `jti` is spent once, by the open that accepts it; a wrong PIN does not spend it; it is accepted only on a request its own device signed; a changed, expired, unknown-kid or malformed ticket is refused alike and spends nothing. The first PIN needs a fresh code, and a pending device cannot set one. A PIN too easy to guess is refused with the one sentence; an open with no PIN answers `no-pin`; without the PIN rules no PIN is set. The PIN is in no row or bound value, only its slow, peppered verifier | A right PIN with a fresh ticket opens, and under 12 hours the PIN alone opens |
| `test/pin-block.test.mjs` (added) | **"ten wrong PINs offline block the device until the service answers, and the service then locks the account until an admin unlocks it"** (plan test 3): after the signed report every device route of the account but `/nonce` and the report answers `account-locked`, a right code and a right PIN included, until `unlockAccount`. The lock is read after the device checks, so an unsigned request learns nothing, and a pending device cannot lock the account. A report from one account locks only that account. The owner is mailed once per lock and at most once an hour, with no digit. The lock row holds the account and its time only, and the report takes no body | Another account's devices keep working |
| `test/pin-reuse.test.mjs` (added) | **"a replaced PIN is refused with exactly: That PIN is locked for reuse."** (plan test 4). The lock is a keyed hash with a lock-until 365 days on (held equal to `PIN_LIMITS.reuseLockMs`), and the PIN is free again after it. The table locks every replaced PIN, whatever write replaced it. A change needs the current PIN, and the code once this device's last code is 12 hours old. A new PIN too easy to guess gets its sentence; a pending device cannot change the PIN; a change before any PIN answers `no-pin` | A PIN past its lock-until is accepted |
| `test/pin-lockout.test.mjs` (added) | Plan §3.4's online wrong PINs: three wrong PINs in one window lock it and mail; two in a row or four a day close PIN entry until the link. A change's current PIN counts in the same lockout. Five tries sent together compare exactly 3. Wrong PINs leave code entry open, and wrong codes leave PIN entry open. PIN entry closes per account. 12 wrong PINs a day close it, never more than 2 a window needed. A `code-needed` open is refused before the lockout counts it, and a locked try does not spend a right ticket. The `pin_limits` row keeps only the engine state and a hash of the link. Without the mailer or a reopen base no PIN is compared | `NEGATIVE CONTROL: two wrong PINs and then the right one neither lock nor mail` |
| `test/pin-plain.test.mjs` (added) | **"no user-facing response carries a date, duration, count or hash"** (plan test 5): one run drives every A5b route through every answer and every A5b mail, then checks each answer's headers (exactly `cache-control` and `content-type`), every key and value (no number, digit, time unit, count word, month or hash-like run) and every mail with its link removed. The grant is the one value left out. The coverage test asserts the run reached 24 answer kinds (this table first said 23; the list in the test has held 24 since `9b3ace78`) and all 7 A5b mail subjects (the seventh, "Horae Zone: app PIN reset paused", from LOW-2: the run now fills the reset day too) | `NEGATIVE CONTROL: the sweep catches a planted date, duration, count or hash`, which also checks that the grant and a link are not flagged |
| `test/pin-reset.test.mjs` (added) | **"a forgotten PIN resets with any two of code, password and email code, never one"** (plan test 6). A wrong factor beside a right one answers `bad-reset`, never says which, and spends nothing. A reset spends the ticket and the emailed code it used. It locks the old PIN, and a reset to a locked PIN answers the one sentence and spends nothing. The emailed code rides after `#`, dies after its life, and a newer mail replaces it. A pending device can neither ask for the mail nor reset, and a locked account cannot reset. Tries and mails are capped per account each hour. A factor key holding null or an empty value is refused as `shape`, ten such bodies past the hour's tries, and spends nothing (HIGH-1). Wrong factors are capped per account at 12 a day, right factors waiting while the day is full, and the owner is mailed the paused note when it fills and at most hourly after (LOW-2). No PIN, password or emailed code is stored or bound in clear, and the owner's note has no number. Without a usable reset base no code is mailed; without the PIN rules no PIN is reset | Each pair of two right factors resets; after the ten refused null and empty bodies, the same ticket and email code still reset |
| `test/pin-review.test.mjs` (added) | **"the first four snoozes defer seven days and later ones one day"** and **"the review modal offers exactly Snooze and Change PIN"** (plan tests 7 and 8). A snooze counts only while the review is due, and one that lands while another is in flight counts once (checked by landing a write between the read and the write, and by mutation of the SQL guard). The review takes only `{}` or `{action: "Snooze"}`. An account with no PIN has no review, and a pending device reaches none. Snoozes are per account. The row is the account, a count and a due time, and every new PIN starts a fresh cycle | `{review: false}` before the year is out |
| `test/reverify.test.mjs` (added) | **"no reverify comes sooner than five minutes after the last"** and **"a cut account locks the app at the next check"** (plan tests 9 and 10). A cut that lands mid-flight still wins: the check answers the cut, never `ok`, and records nothing. Checks never extend the 12 hours: the code is still asked at 12 hours, and no grant comes back. The five minutes are per device. The check takes an empty body, a signature and a device that is not pending. The row holds only which device checked and when | One device's check does not hold back another's |
| `test/purge.test.mjs` (4 added) | The purge removes spent tickets past their expiry, PIN locks past their lock-until and expired reset codes, and keeps the live ones. It keeps each account's wrong reset rows for a day and clears them after (LOW-2) | The live rows kept; the hourly reset try bucket still goes after its hour |
| `test/pin-blocklist-order.test.mjs` (added, LOW-1) | The private blocklist answers only after the proof: on the first PIN a junk or foreign ticket answers `bad-ticket`, on a change a wrong current PIN answers `bad-pin`, and on a reset wrong factors answer `bad-reset` and take a try place, for every listed PIN and a run, never `too-easy`. A PIN of the wrong shape is still refused first | With the right proof, a listed PIN still answers `too-easy` and spends nothing |
| engine `test/pin.test.mjs` (1 added) | `PIN_LOCKED` is exactly "That PIN is locked for reuse." and differs from `PIN_TOO_EASY` | None |

### Manual checks for the reviewer

1. **No PIN in a statement.** `grep -n "bind(" apps/horae-zone/src/pin*.js` lists every bound statement in the PIN files; each binds ids, times, a verifier, a salt or a digest, never the body's `pin`, `password` or `emailCode` (the leak checks in `pin.test.mjs` and `pin-reset.test.mjs` assert the same on every bound value).
2. **Constant-time compare and no console calls,** as in A5: `grep -rn "digest ===\|=== digest\|console\." apps/horae-zone/src` prints nothing.
3. **One sentence for reuse.** `grep -rn "locked for reuse" apps/horae-zone/src packages/account-engine/src` prints only the engine's `PIN_LOCKED`.
4. **No number in an A5b note.** `grep -nE '^\s+"[^"]*[0-9]|subject: "[^"]*[0-9]' apps/horae-zone/src/pin-lockout.js apps/horae-zone/src/pin-reset.js apps/horae-zone/src/account-lock.js` prints nothing.
5. **Schema is additive.** `git diff 95cf772a -- apps/horae-zone/schema.sql` shows only added lines, each `CREATE ... IF NOT EXISTS`.
6. **Local smoke test,** as in A5:

   | Request | Expected |
   |---|---|
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/pin/verify` | `{"error":"no-device"}` |
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/reverify` | `{"error":"no-device"}` |

### Not in A5b (do not add here)

- The client side of the PIN, the grant and the review modal (A8).
- `/admin/unlock-account` and the other admin routes (A5c), recovery (A6), the gatekeeper (A7).

## The signed device list (`apps/horae-zone`)

### Run

As in A3: `node --test test/*.test.mjs` in `apps/horae-zone`.

- **Expected result now:** Horae Zone 381 tests, 381 pass. `dev` at `2e2720aa` has 368; the route's commit `ab99c4bf` added 10 (378), and the item 2 tests added 3 (381).
- **Test values are fake,** as in A5: `example.test` addresses, the fake ticket key pair made per run in `test/helpers.mjs`. No test calls a deployed service.

**RED evidence.** `ab99c4bf` (the route): 9 of 10 tests in `device-list.test.mjs` failed on `no-route` before the build (the count in its commit message). The item 2 tests (public keys only, the nonce bound) were written after the route, so they passed on arrival; each was proved able to fail by a mutation of the source, run and then undone:

| Mutation | Tests failing (of 13) |
|---|---|
| `count: devices.length` added to the signed claims | 2: the full-list test and "the list carries public keys only" |
| The nonce cap's `< ?` made `<= ?` in `issueNonce` (`src/checks.js`) | 1: "the list is bounded like every signed route" |
| Each `agreeKey` cut to 43 characters (not a whole public point) | 3: the full-list test, the unlock test and "the list carries public keys only" |

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| `test/device-list.test.mjs` (added) | A confirmed device gets one signed list of every confirmed device of its account, each with both public keys and `confirmedAt`, and every confirmed device gets the same list. A pending or removed device is never listed, and an unlock does not move `confirmedAt`. A pending, removed, other-account, unsigned or badly signed caller is refused, a body naming an account answers `shape`, and a locked account answers `account-locked`. A list never verifies as an unlock ticket (in the test verifier and in the service's own `readTicket`), and a ticket never as a list; the label and the typ each keep them apart alone. A list is refused from `exp` on and before `at`. The claims hold exactly `v, typ, account, at, exp, kid, devices`, each entry exactly `device, signKey, agreeKey, confirmedAt`, each key a 65-byte public point, and no address, password or authenticator secret; a wrong code changes nothing in the list. Each list spends one single-use nonce, a device holds at most five live ones, and a nonce lives a minute | The list verifies as a list and the ticket as a ticket; a list is good until its last millisecond; `NEGATIVE CONTROL: the secrets check catches a planted address, count, extra field or private key` |
| `test/helpers.mjs` | `verifyDeviceList` and `verifyUnlockTicket`, written apart from `src/`: the check Sass mirrors (pinned JWK, RFC 7638 kid, label, `v` 1, typ, account match, `at <= now < exp`) | As above |

### Manual checks for the reviewer

1. **Public keys only.** `grep -n "SELECT" apps/horae-zone/src/device-list.js` shows one read of `id, sign_key, agree_key, confirmed_at` from `device`, nothing from `account`, `otp`, `limits` or `pin`.
2. **No console calls,** as in A5: `grep -rn "console\." apps/horae-zone/src` prints nothing.
3. **Local smoke test:** `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/devices` answers `{"error":"no-device"}`.

### Not in the device list (do not add here)

- Sass's side: `sharedPeerKey` reading the list, the pinned key check and the fingerprint fallback (Sass PR #159).
- A device label or name: the device table has none, and `test/config.test.mjs` forbids a column name holding `name`.

## A5c: admin (`apps/horae-zone`)

### Run

As in A3: `node --test` in `apps/horae-zone`.

- **Expected result now:** Horae Zone 399 tests, 399 pass. `dev` at `8bd155d0` has 382; A5c adds 17 (9 in `test/admin.test.mjs`, 8 in `test/deploy.test.mjs`).
- **RED evidence:** `ab222a4a` committed the tests alone: 19 of 399 failed (`admin.test.mjs` 9, `deploy.test.mjs` 7, `checks.test.mjs` 2, `pin-block.test.mjs` 1). One RED assertion was wrong and was corrected in the GREEN commit: in `pin-block.test.mjs`, a device of the locked account that holds no role answers `not-admin` (the role check comes before the lock check), not `account-locked`.
- **Test values are fake,** as in A5b: `example.test` addresses, fixed PINs with no run of three, fake account ids, the mocked wrangler of `test/deploy.test.mjs`. No test calls a deployed service.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| `test/admin.test.mjs` (added) | **"admin routes refuse a non-admin"** (plan test 1): every admin route answers `not-admin` to a device of an account with no role or another role, and `no-device` unsigned or from a pending device of an admin account; nothing changes. **"unlocking PINs clears the rows and its response names no PIN"** (plan test 2): every `pin_lock` row of the account goes, another account's stay, the answer is exactly `{ok: true}` with no PIN, verifier, salt or number, and a replaced PIN may be chosen again. Unlocking PINs answers the same with no locks and reads no lock row. The account unlock answers whether it was locked. An admin of a locked account answers `account-locked` until another admin unlocks it. The status shows the lock and its time, closed code entry, each device's owner and pending flags, created, confirmed, removed and reverified times, and nothing of the PIN locks. The address picks the account (case aside); a bad body answers `shape`, an unknown address `no-account`, and no account key `unavailable`. Each admin request writes one audit row with its outcome word and no address anywhere | The same unlock from an admin's device is answered; before the unlock, the first PIN is refused as locked for reuse |
| `test/deploy.test.mjs` (8 added) | Step 6 sets the account the owner picks, once, with the set-once guard in the statement, after the secrets are put. An admin already set: PASS, nothing asked. No account: SKIPPED, naming `--owner-admin`. A blank or out-of-range pick, or a pick not confirmed with y, sets nothing. A row whose id has another shape is never shown or put in a command. A grant with no row back fails, and an unreadable table fails the item while the checks still run. `--owner-admin` runs Step 6 alone, with the pick and its read-back as the only prompts and one write. The dry run names Step 6's reads and write | The planted id never reaches a command |
| `test/checks.test.mjs`, `test/pin-block.test.mjs` | Updated: `/admin/status` is in the route table; an admin past the role check gets `shape` for a body naming no account; the A5b plan test unlocks through `/admin/unlock-account` | |

### Manual checks for the reviewer

1. **Double blind:** `grep -n "pin_lock" apps/horae-zone/src/admin.js` shows one `DELETE` with no `RETURNING` and no `SELECT`.
2. **No address kept:** `grep -n "email" apps/horae-zone/src/admin.js` shows it read only to derive the address key.
3. **Local smoke test:** `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/admin/status` answers `{"error":"no-device"}`.
4. **The deploy, dry:** `node bin/deploy.mjs --dry-run` prints Step 6's two reads and its one guarded write.

### Not in A5c (do not add here)

- The admin Pages screen and admin device removal (DESIGN-REVIEW, A5c, Decisions for Kaleb rows 10 and 3).
- Recovery and the vault switch (A6), the gatekeeper (A7).

## A6: recovery, the vault switch and bringing the vault (`apps/horae-zone`)

### Run

As in A3: `node --test` in `apps/horae-zone`.

- **Expected result now:** Horae Zone 452 tests, 452 pass. `dev` at `bcf1924e` has 408.
- **RED evidence:** `b88b1640` committed the tests alone: 15 of 414 failed. `recover.test.mjs`, `vault.test.mjs` and `pair.test.mjs` could not load (their modules did not exist); the #248 LOW race test registered a second owner device (200 where `bad-ticket` was expected); the older tests that used `/pair/offer` as the one signed route that answers `not-built` failed until `/pair/take` answered `no-vault`. Two tests were added after `b88b1640` and watched failing before their fix: the A6 purge test, and "an asker held back after its checks passed takes nothing" (also checked against the mutation it guards). `c44d6751` committed the security review's tests alone: 4 failed.
- **Test values are fake,** as in A5c: `example.test` addresses, fixed PINs with no run of three, vault ids of 16 repeated bytes, an envelope that is only a marker, the per-run ticket key. No test calls a deployed service.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| `test/recover.test.mjs` (added) | **"recovery never returns an old vault key"** (plan test 1): an envelope of the old vault waiting for a second device is gone from every table after the recovery, the answer is only `{device}`, the new device has no vault to take, the old devices are held back and get a signed `gone`, and the old id can never be recorded again. A recovery needs the link and the password (a wrong password spends the link and changes nothing); the link is single use, and two finishes together register one device; the new device is the owner and every other device is held back until it proves the new code, the old seed's code refused; live sign-in tickets are voided and the code lockout cleared; the PIN, the admin role and a locked account are not lifted; the two stranded accounts of A5 (owner removed before the first code, owner never registered) are recovered; the start answers and runs the same statements with or without an account and keeps one live link; the mails carry no number or password; shape before counting; the per-requester try cap; review MEDIUM-1 and LOW-2 | The link and the password together recover; the recovered device's own unrecorded vault is unknown, never gone |
| `test/vault.test.mjs` (added) | **"a switch shreds the old wrap on every device's next launch and tombstones its rows"** (plan test 2): the old id is tombstoned, the brings in flight dropped, the account mailed once, and every device, held back or locked included, gets a statement signed for it that says `gone`. The switch needs a fresh code of the caller's own, spent once; a pending device switches nothing; a tombstoned or another account's id is `vault-used`; a switch to the current vault spends nothing; shape first; the note carries no number, link or id; the state passes as no ticket or list, and the reverse; review LOW-4 | An id never recorded is `unknown`, never `gone`; another account's tombstone is not this account's |
| `test/pair.test.mjs` (added) | The envelope goes only to the device that asked, once, and no table keeps it after; an offer needs an ask from a confirmed device of the account for the current vault, never itself; a pending device can neither ask nor approve; the PIN is compared in the PIN lockout; the code at 12 hours; a switch drops the envelope; a removed approver's envelope is never taken; asks and envelopes live ten minutes; no vault answers `no-vault`; shape before the PIN; the brought note carries no number or id; an asker held back mid-flight takes nothing | The right PIN approves |
| `test/relink.test.mjs` (2 added) | The #248 LOW race: an owner device landing while another owner ticket is being spent leaves one owner device | A further device registers while another device lands |
| `test/purge.test.mjs` (2 added) | Expired recovery links and stale handoffs go; a spent link inside its life, the current vault and every tombstone stay; the recovery day rows stay a day | The hourly recovery-start row goes after its hour |
| `test/checks.test.mjs`, `test/devices.test.mjs`, `test/otp.test.mjs`, `test/purge.test.mjs` | Updated: every route now has its handler, so the stand-in for "passes its checks" is `/pair/take` answering `no-vault`, and the `not-built` answer is tested through an injected route table | |
| `test/helpers.mjs` | A6 flow helpers: `recoveryCode`, `recoverRequest`, `recoveredDevice`, `provedDevice`, `switchVault`, `vaultId`, `verifyVaultState` (the check a device mirrors) | |

### Manual checks for the reviewer

1. **Only a tombstone or a recovery says gone:** `grep -n "gone" apps/horae-zone/src/vault.js` shows the one query that answers it.
2. **No old envelope after recovery:** `grep -n "handoff\|vault" apps/horae-zone/src/recover.js` shows the deletes and the tombstone inside `recoveryBatch`.
3. **Local smoke test:** `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/vault/state` answers `{"error":"no-device"}`, and `-d '{"email":"a@example.test"}' -H 'cf-connecting-ip: 192.0.2.1' localhost:8787/recover` answers `{"ok":true}`.
4. **After the merge, in the dashboard:** the rate rule's expression names `"/recover"` (DESIGN-REVIEW A6, Kaleb row 10).

### Not in A6 (do not add here)

- The device side: the shred, the launch call, the bring screens and the check word (A8).
- Voiding offline passes on recovery (after #286 merges; Kaleb row 21).
- JanusMirror (A7).

## Offline unlock, Option C (`apps/horae-zone`)

### Run

`node --test` in `apps/horae-zone`. Expected: 431 tests, 431 pass (`dev` at `bcf1924e` has 408). RED evidence: `bf24246b` committed `test/offline.test.mjs` alone, and its 19 tests failed on `no-route`; `70dd0140` added the four supersede tests alone, and they failed (a fresh code answered `report-due`, and no row had `superseded_at`). Test values are fake: `example.test` addresses, random jtis, the fresh test ticket key.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| `test/offline.test.mjs` (added) | A fresh code earns a pass bound to the device and account, under its own label, `at` the code's time, `until` the hours asked and never past 12, the jti the Mac chose, the cap of 20; the spend moves `proved_at`. A pass is not a ticket, grant or receipt. The body is exactly `{ticket, hours, jti}`. No, stale, other-device, spent or mislabelled tickets are refused. A pending device and a locked account get none. No mailer or account key: `unavailable`, nothing spent. One plain note per pass. `report-due` while unreported, per device, spending no code. A Mac that lost its record: a fresh, unspent code proved after its unreported pass supersedes it (`superseded_at` set, `reported_at` and the counts null), the audit row says `superseded`, the fixed replacement note and the issued note are mailed, and the new pass becomes the gate. A report marks once, keeps the counts and answers a receipt for this device and jti; a report of an unknown jti marks nothing. The report body is exact and its head is the chain; ten wrong PINs lock the account; a report of opens mails a plain note | Each refusal followed by the same request that is taken; nine wrong PINs lock nothing; an unused pass mails nothing. Supersede: a code proved before the pass or one already spent is still `report-due`, spends nothing and mails nothing; another device's unreported pass is never superseded and still holds that device; a locked account (`/pin/blocked`, or another Mac's report of ten wrong PINs) answers `account-locked` and supersedes nothing |
