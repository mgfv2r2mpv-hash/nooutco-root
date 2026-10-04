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

**RED evidence for the second security review** (root cause: a guessable email code; see the design review). Each item's tests were written first and run against the `8ebe205a` source with only the test files changed.
- **Item 1** (the email secret is a 128-bit token): 9 tests fail on `8ebe205a`. The two new tests fail on the 6-digit code and the "Sign-up code:" line in the mail; the other seven fail because a well-formed token (a wrong try, or one never sent) is `shape` there, and a 6-digit typed code reaches the compare instead of being `shape`. After the fix: Horae Zone 112/112, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 2** (no address-level verify cap): 4 tests fail on `d672e603` (the item 1 commit; only the test files changed). After 15 strangers' wrong tries from 3 requesters the owner's link answers `slow-down` (429), expected 200; in the 60-try test the 16th stranger try answers 429, expected 401; the limits test finds `triesPerAddressHour` and `codeTries` still defined; and the purge removes a live code with 15 tries as used up. After the fix: Horae Zone 113/113, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 3** (a start at the cap re-sends the newest live link): 7 tests fail on `9f55de74` (the item 2 commit; only the test files changed). The owner's start after 3 strangers' starts answers `slow-down` (429), expected 200 with a mail; in the bounded-mail test the 4th start answers 429; the expired-link and account-address tests answer 429 at the cap; the sealed-link test finds no `link_box` column; the M2 tag test's 4th tagged start answers 429, expected 200 with no mail; and the limits test finds `liveCodes` 3 and no `resendsPerAddressHour`. After the fix: Horae Zone 117/117, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 4** (no hard per-address lock on `/signin`): 7 tests in `devices.test.mjs` fail on `92d91ed2` (the item 3 commit; only the test file changed). The owner's right password after ten strangers' wrong ones from ten requesters answers `slow-down`, expected a ticket; the ceiling test finds `perAddressHour` 10, expected 100; and the hammering, backoff and three reworked H2 tests find no `perPairHour` or `backoffAfter`. A scratch test on the same source showed the defect behind the hammering test: one requester's right password after 6 wrong ones got a ticket (200), since one requester had the address's whole 10. The item 4 NEGATIVE CONTROL passes on both. After the fix: Horae Zone 121/121, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 5** (the daily cap is the mail plan's limit, with an alert at half): 7 new tests fail on `4c2c53ca` (the item 6 commit; only the test files changed), 6 in `signup.test.mjs` and 1 in `purge.test.mjs`. The default cap is 500, expected 3000; with a cap of 10 and a fake `HZ_ALERT_TO`, 5 starts mail no alert (0, expected 1); the next-day, `alert-unset`, `alert-failed` and same-statements tests fail on the missing alert (the statements themselves matched on `4c2c53ca` too); and a purge clears a two-hour-old `alert-day` row, expected kept for a day. After the fix: Horae Zone 134/134, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 6** (one domain, one address key): 3 new tests in `signup.test.mjs` fail on `6b49d7e8` (the item 7 commit; only the test file changed). A start for `v@example.test.` mails `v@example.test.`, so there is no mail to `v@example.test`; a full-width spelling of `example.test` makes a second per-address bucket (2, expected 1); and `v@-example.test` answers 200, expected `shape`. The M2 NEGATIVE CONTROL (a non-ASCII domain still starts) passes on both. After the fix: Horae Zone 127/127, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.
- **Item 7** (a known device pays the pair bucket): 2 new tests in `devices.test.mjs` fail on `7df89d4e` (the item 4 commit; only the test file changed). After 5 wrong passwords signed by a registered device of the account from one requester, and after 4 unsigned and 1 signed from one requester, the device's right password from that requester answers a ticket (200), expected `slow-down`. The item 7 NEGATIVE CONTROL passes on both. After the fix: Horae Zone 124/124, engine 64 (63 pass, 1 skip; Node, Chromium and `workerd`), profile-api 195/195.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| engine `test/mailer.test.mjs` | The mailer posts to Resend with the key only in the `authorization` header. A failed send logs once, with no key, address or text, and never throws. A message without a recipient, subject or text is not sent. It cannot be built without a sender or a key reader. `fragmentLink` puts the token only after `#`, and refuses a base that is not https or already has a query or fragment. Two transport tests are ported from JanusMirror's `pairing-limits.test.mjs` | `NEGATIVE CONTROL: a send that succeeds logs nothing` |
| engine `test/same-hex.test.mjs` | `sameHex` is exported from `src/limits.mjs`, reads equal digests as the same and any one difference as not, refuses unequal lengths and non-strings, and has no early return in its loop | The equal-digest case |
| `test/signup.test.mjs` | **"sign-up needs the email code"** and **"the email code rides in the fragment"** (the plan tests). An address never sent a code is refused like a wrong code. A code works once and expires. **H1:** a newer start leaves older codes live (up to five since item 3), every live code works, a stranger's wrong guesses do not end the owner's code, and tries at one address are capped for each requester. It is stored only as a keyed digest and compared with `sameHex`. Starts are rate limited per requester, tries per requester. No answer says whether an address already has an account, and **M1:** a start sends the same statements whether or not the address has one. **M2:** an address with a format or zero-width character, or a non-ASCII local part, is `shape` at sign-up and sign-in with nothing written or counted; starts for every `+tag` of one mailbox share one limit that never holds the plain address; codes sent are capped per day (`HZ_CODES_PER_DAY`, default `codesPerDay`), and a bad value answers `unavailable`. **L3:** a start, verify or sign-in with no, an empty or a blank `cf-connecting-ip` is `shape` with nothing written, counted or mailed. A bad address, an extra field or a password outside the length rule is `shape`. The password is stored as a salted slow hash and the address sealed, opening only with the service key. A failed mail is audited and the answer is unchanged. Without the account key or a link base nothing is written or mailed. The mail has a plain subject, the link with the token and no em dash. **Second review, item 1:** the code is a 128-bit token (22 base64url characters, a new one each start), the mail shows no code to type, and any other shape (a 6-digit code included) is `shape` before a try is counted. **Item 2:** 15 strangers' wrong tries from 3 requesters, then the owner's link still verifies; 60 from 12 never end the code; no `verify-address` bucket is written. **Item 3:** 3 strangers' starts, then the owner's start answers `{ok:true}` and mails the newest live link again, which verifies; 40 starts at one address mail at most `codesPerAddressHour` + `resendsPerAddressHour` and mint `codesPerAddressHour`; an expired link is never re-sent; at the cap an address with an account is mailed nothing and sends the same statements as one without; a live code is sealed in `link_box` (bound to its address key) and the box is dropped when the code is spent. **Item 6:** `v@example.test.`, `V@EXAMPLE.TEST` and `v@example.test` are one address (one per-address bucket, mail to the plain address, a link from one verifies for another); a full-width or decomposed spelling of a domain is the same address as its ASCII DNS name; a domain with an empty label, a leading or trailing hyphen, a character no DNS name has, an all-digit top label or a label over 63 characters is `shape` at all three routes with nothing written. **Item 5:** the default hard daily cap is 3000; with a fake `HZ_ALERT_TO`, one alert mail goes out at half the cap and no other inside the day, it names no address and has no em dash, and every start below the hard cap still mails its link; a new day can alert again; without an alert address the half-cap start is audited `alert-unset`, and a failed alert send `alert-failed`, with the answer and the link unchanged; the alert check sends the same statements whether or not the address has an account | `NEGATIVE CONTROL: the code from the mail, with a password, makes the account`; `NEGATIVE CONTROL: an ASCII local part with a non-ASCII domain, a dot or a plus still starts`; `M2 NEGATIVE CONTROL: the account key stays the full address, tag included`; `L3 NEGATIVE CONTROL: the same start with a connecting address is admitted and counted under it` |
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
- **Expected result now, after the security review fixes (`012e8993` and later):** engine 64 tests (63 pass, 1 skip), Horae Zone 110 tests, 110 pass, and profile-api 195/195.

**RED evidence.**
1. Run `git checkout a55d8771 -- packages/account-engine apps/horae-zone`, then both suites.
2. Expect the engine to fail in `signed-bytes.test.mjs` (`ERR_MODULE_NOT_FOUND` for `src/signed-bytes.mjs`), with every other engine test passing.
3. Expect Horae Zone 57 tests with 3 failing: `devices.test.mjs` on the missing `src/signin.js`, the A4 leak test because `/signin` hands out no ticket, and the ticket purge test on `no such table: ticket`. Every A2 and A3 test passes.
4. Restore with `git checkout HEAD -- packages/account-engine apps/horae-zone`.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| engine `test/signed-bytes.test.mjs` | `signedBytes` and `SIGNED_LABEL` build the shared vector's bytes, and the vector's signature verifies over them with the vector key. Each part is length-prefixed, so a byte moved between path and body changes what is signed. A body that is not bytes, or a nonce or path that is not a string, throws `TypeError`. The body passed in is not kept or changed | `NEGATIVE CONTROL: the vector signature does not verify for another path or body` |
| `test/devices.test.mjs` | **"a request with no registered device signature is refused"** and **"a removed device is refused at once"** (the plan tests). **"/device/register requires the ticket from /signin"** (A2 open point 1). Sign-in: a wrong password and an unknown address are refused alike, and the unknown address hashes a password just as a wrong password does; the body is exactly an address, a password and a key digest; tries are rate limited per requester (across addresses). **Second review, item 4:** after ten strangers' wrong passwords from ten requesters the owner's right password from a new device signs in; one requester's wrong passwords at one address are capped at `perPairHour`, then even its right password is held while another requester signs in; past `backoffAfter` wrong passwords the address answers `slow-down` whatever the password, for a quiet time that doubles and is held 1 ms before it ends, never above 15 minutes; the address ceiling is 100 wrong passwords an hour and a success takes no place in it. **Second review, item 7:** a registered device of the account guessing passwords from one requester is held at `perPairHour`, signed and unsigned wrong passwords from one requester share that cap, and the device's own successes take no place in it or in the address bucket. **H2:** with the address in backoff the owner signs in from a registered device; a success is not counted against the address, and does not empty it; a sign-in naming a device must carry its good signature (a tampered, unknown or removed device is refused); the ticket is stored only as a keyed digest bound to its account and its key digest. **M3:** a ticket refuses keys other than the ones it was signed in for (both keys, or either one swapped) and stays unspent; a sign-in without a well-formed key digest is `shape` with nothing written or counted. **M5:** a password set in NFC form signs in from its NFD form and the reverse, and a ligature signs in as its plain letters. Register: a ticket registers one device and expires; a key that is not a P-256 point is `shape` and leaves the ticket live; the body is exactly a ticket and two keys. Remove: a device can remove itself and is refused at once; it cannot remove another account's device, and the answer does not say so; the body is exactly one device id; the row stays, marked with when it was removed. **L2:** a removal that lands mid-flight wins: a device removed after its checks passed cannot remove another device, gets no nonce, cannot spend a nonce, and gets no sign-in ticket. **At most five live nonces per device** (A2 open point 2), a spent or expired nonce frees its place, and the cap holds when requests arrive together. **The service builds signed bytes with the engine function and accepts the shared vector** (A2 open point 4). Sign-in, register and remove each write one audit row | `NEGATIVE CONTROL: a request signed by the registered key passes the device checks`; `NEGATIVE CONTROL: the right address and password answer a single-use ticket`; `NEGATIVE CONTROL: a ticket used just inside its life registers the device`; `item 4 NEGATIVE CONTROL: the owner's own successes from one requester take no place in the pair bucket`; `item 7 NEGATIVE CONTROL: a known device's own successes take no place in the pair bucket and still skip the address bucket`; `H2 NEGATIVE CONTROL: a device of another account does not lift the address bucket`; `H2 NEGATIVE CONTROL: a signed sign-in still pays the per-requester bucket`; `M5 NEGATIVE CONTROL: a password that differs after normalising is still refused`; `L2 NEGATIVE CONTROL: a live device removes another, and itself` |
| `test/leak.test.mjs` (added) | Sign-in (wrong, unknown and right), a bad and a good register, a ticket reuse and a removal leave no address, password or ticket in any answer, table, bound value or log. The one answer that hands out a ticket is checked as the expected exception. The A2 sweep now lets each unspent nonce expire between routes, so the cap does not refuse it | The A2 planted-echo control |
| `test/purge.test.mjs` (added) | The purge removes spent and expired sign-in tickets and keeps a live one (its fixture rows carry a `key_digest` since M3) | The live ticket kept |

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
