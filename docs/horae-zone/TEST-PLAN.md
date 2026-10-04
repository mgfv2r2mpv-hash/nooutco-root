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
- **H1:** 5 of 24 tests in `signup.test.mjs` fail on `3c3cac63`. The owner's first code answers `bad-code` after a second start; the 6th guess from one requester and the 16th at one address answer `bad-code` instead of `slow-down`; and the "every live code" and limits tests fail because `liveCodes`, `triesPerAddressHour` and `triesPerAddressRequesterHour` do not exist. After the fix: Horae Zone 84/84, engine 64 (63 pass, 1 skip), profile-api 195/195.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| engine `test/mailer.test.mjs` | The mailer posts to Resend with the key only in the `authorization` header. A failed send logs once, with no key, address or text, and never throws. A message without a recipient, subject or text is not sent. It cannot be built without a sender or a key reader. `fragmentLink` puts the token only after `#`, and refuses a base that is not https or already has a query or fragment. Two transport tests are ported from JanusMirror's `pairing-limits.test.mjs` | `NEGATIVE CONTROL: a send that succeeds logs nothing` |
| engine `test/same-hex.test.mjs` | `sameHex` is exported from `src/limits.mjs`, reads equal digests as the same and any one difference as not, refuses unequal lengths and non-strings, and has no early return in its loop | The equal-digest case |
| `test/signup.test.mjs` | **"sign-up needs the email code"** and **"the email code rides in the fragment"** (the plan tests). An address never sent a code is refused like a wrong code. A code works once and expires. **H1:** a newer start leaves older codes live (up to three), every live code works, a stranger's wrong guesses do not end the owner's code, and tries at one address are capped across requesters and for each requester. It is stored only as a keyed digest and compared with `sameHex`. Starts are rate limited per address and per requester, tries per requester. No answer says whether an address already has an account. A bad address, an extra field or a password outside the length rule is `shape`. The password is stored as a salted slow hash and the address sealed, opening only with the service key. A failed mail is audited and the answer is unchanged. Without the account key or a link base nothing is written or mailed. The mail has a plain subject, the code, the link and no em dash | `NEGATIVE CONTROL: the code from the mail, with a password, makes the account` |
| `test/checks.test.mjs` (added) | A request with a query string is refused as `shape` before any check or handler | The A2 negative control still passes |
| `test/leak.test.mjs` (added) | A real sign-up leaves no address, email code or password in any answer, table, bound value or log | The A2 planted-echo control |
| `test/purge.test.mjs` (added) | The purge removes spent, used-up and expired email codes, and rate-limit rows past their window | The A2 keep-fresh control |

### Manual checks for the reviewer

1. **No console calls**, as in A2: `grep -rn "console\." apps/horae-zone/src` prints nothing.
2. **No value in a URL.** `grep -rn "searchParams\|?code=\|?token=" apps/horae-zone/src packages/account-engine/src` prints nothing.
3. **Local smoke test without secrets** (as in A2, with `npx wrangler@4 dev --local` and no secret set):

   | Request | Expected |
   |---|---|
   | `curl -s -X POST -H 'content-type: application/json' -d '{"email":"someone@example.test"}' localhost:8787/account` | `{"error":"unavailable"}`, since no account key or mail key is set |
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

- **Expected result now:** engine 64 tests (63 pass, 1 skips without the private package; the runtimes test loads `src/signed-bytes.mjs` in `workerd` and Chromium), Horae Zone 81 tests, 81 pass, and profile-api 195/195.

**RED evidence.**
1. Run `git checkout a55d8771 -- packages/account-engine apps/horae-zone`, then both suites.
2. Expect the engine to fail in `signed-bytes.test.mjs` (`ERR_MODULE_NOT_FOUND` for `src/signed-bytes.mjs`), with every other engine test passing.
3. Expect Horae Zone 57 tests with 3 failing: `devices.test.mjs` on the missing `src/signin.js`, the A4 leak test because `/signin` hands out no ticket, and the ticket purge test on `no such table: ticket`. Every A2 and A3 test passes.
4. Restore with `git checkout HEAD -- packages/account-engine apps/horae-zone`.

### What each file proves

| File | Proves | Negative controls |
|---|---|---|
| engine `test/signed-bytes.test.mjs` | `signedBytes` and `SIGNED_LABEL` build the shared vector's bytes, and the vector's signature verifies over them with the vector key. Each part is length-prefixed, so a byte moved between path and body changes what is signed. A body that is not bytes, or a nonce or path that is not a string, throws `TypeError`. The body passed in is not kept or changed | `NEGATIVE CONTROL: the vector signature does not verify for another path or body` |
| `test/devices.test.mjs` | **"a request with no registered device signature is refused"** and **"a removed device is refused at once"** (the plan tests). **"/device/register requires the ticket from /signin"** (A2 open point 1). Sign-in: a wrong password and an unknown address are refused alike, and the unknown address hashes a password just as a wrong password does; the body is exactly an address and a password; tries are rate limited per address (from any requester) and per requester (across addresses); the ticket is stored only as a keyed digest bound to its account. Register: a ticket registers one device and expires; a key that is not a P-256 point is `shape` and leaves the ticket live; the body is exactly a ticket and two keys. Remove: a device can remove itself and is refused at once; it cannot remove another account's device, and the answer does not say so; the body is exactly one device id; the row stays, marked with when it was removed. **At most five live nonces per device** (A2 open point 2), a spent or expired nonce frees its place, and the cap holds when requests arrive together. **The service builds signed bytes with the engine function and accepts the shared vector** (A2 open point 4). Sign-in, register and remove each write one audit row | `NEGATIVE CONTROL: a request signed by the registered key passes the device checks`; `NEGATIVE CONTROL: the right address and password answer a single-use ticket`; `NEGATIVE CONTROL: a ticket used just inside its life registers the device` |
| `test/leak.test.mjs` (added) | Sign-in (wrong, unknown and right), a bad and a good register, a ticket reuse and a removal leave no address, password or ticket in any answer, table, bound value or log. The one answer that hands out a ticket is checked as the expected exception. The A2 sweep now lets each unspent nonce expire between routes, so the cap does not refuse it | The A2 planted-echo control |
| `test/purge.test.mjs` (added) | The purge removes spent and expired sign-in tickets and keeps a live one | The live ticket kept |

### Manual checks for the reviewer

1. **One signed-bytes builder.** `grep -rn "function signedBytes" apps/horae-zone/src packages/account-engine/src` prints only `packages/account-engine/src/signed-bytes.mjs`.
2. **The vector is fake.** `packages/account-engine/test/fixtures/signed-bytes-vector.json` holds a public key, signatures and a fake nonce, and no private key.
3. **Local smoke test**, as in A3:

   | Request | Expected |
   |---|---|
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/device/register` | `{"error":"shape"}` |
   | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/device/remove` | `{"error":"no-device"}` |
   | `curl -s -X POST -H 'content-type: application/json' -d '{"email":"someone@example.test","password":"not-a-real-one"}' localhost:8787/signin` | `{"error":"unavailable"}`, since no account key is set |

### Not in A4 (do not add here)

- The authenticator code on `/signin`, unlock and its lockout (A5).
- The PIN (A5b), admin actions (A5c) and recovery (A6).
- Pairing a vault to a new device (`/pair/offer`, `/pair/take`).
