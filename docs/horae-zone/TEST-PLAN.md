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
- the PIN lifecycle — reuse lock, reset, review, offline block (A5b);
- admin (A5c).

---

## A2: Horae Zone skeleton (`apps/horae-zone`)

### Run

```
cd apps/horae-zone
npm test
```

- **Needs:** Node 22.13 or later (for `node:sqlite`). No `npm ci` is needed, because the app has no dependencies.
- **Expected result:** 30 tests, 30 pass.

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
      | `curl -s -X POST -H 'content-type: application/json' -d '{}' localhost:8787/signin` | `{"error":"not-built"}` |
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
