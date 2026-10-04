# Account engine and Horae Zone: design review

This is the brief for reviewing the account engine and the Horae Zone account service, and for revising them later. It stands on its own. The full plan is `docs/ios-plan.md` in the sass-assistant repository, §3 ("Phase A").

It has one section per slice. Each section says:
- what landed, and where each piece came from;
- every decision, with its reason;
- the open points, each with a proposed resolution.

## Owner rulings, 2026-10-03

| Point | His words | What changed |
|---|---|---|
| The PIN blocklist in a public repository (A1 open point 1) | "private package" | The list left this repository. It is the private package `@nooutco/pin-blocklist` (repo `mgfv2r2mpv-hash/pin-blocklist`, tag `v1.0.0`). The engine takes the list as an injected dependency: `createPinRules(blocklist)`, fed by `loadPinBlocklist()`. Its tests use a five-PIN public fixture. The PR branch history was rewritten so no commit on it carries the list |
| The "no runs" definition (A1 open point 2) | "7890 is [a run]. 0 is after 9 or before 1." | Runs wrap. Digits are circular, so `890`, `901`, `098` and `109` are runs, and `490173` is now refused. The length stays 3 or more |
| CI workflows (A1 open point 8, A2 open point 9) | "ye" | `.github/workflows/account-engine-test.yml` and `horae-zone-test.yml` run on pull requests and on pushes to `dev` and `main` |
| Audit retention and the nonce purge (A2 open points 2 and 3) | "I can't care about that. Whatever is the balance of best but not overdone." | The agent's call, flagged as such: audit rows are kept 6 years (the HIPAA documentation retention period), and spent or expired nonces are purged hourly. Both are configuration in `apps/horae-zone/src/retention.js` |

**Commits:** `c4a08a3` (RED: 2 engine files and 1 service file failing on missing modules; with the new rule bodies in place but the old non-wrapping step, exactly the wrap test fails), then `3c3a183` (GREEN), then `df1f0d5` (CI).

## Background (plan §3.1–3.4, in brief)

**One account for Sass C. Assistant and JanusMirror.** Horae Zone (`horae-zone.nooutco.me`, a Worker and D1) holds:
- the account;
- the single authenticator code's seed, sealed under a Worker secret;
- the PIN keyed hashes;
- the public keys of the devices.

It never holds a vault key, a session key, vault data or PHI.

**Every device route needs a registered device signature.** The server holds the seed, so a code alone must never be enough.

**Daily unlock on every device:**
1. Face ID (Touch ID on a Mac; the device passcode is the fallback).
2. The authenticator code, only when 12 hours have passed since the last accepted one.
3. A 6-digit app PIN.

**App PIN rules:**
- **Shape:** exactly 6 digits.
- **Too easy:** no run of 3 (runs wrap: 0 follows 9 and precedes 1), and not on the common-PIN blocklist (a private package). Both refusals share the sentence "That PIN is too easy to guess."
- **Reuse lock:** a replaced PIN is locked for 365 days, and the refusal is only "That PIN is locked for reuse."
- **What users see:** no timing, count or which-PIN information is ever shown.

**The code-path lockout comes from JanusMirror:**
- 3 wrong codes in one 30-second window lock that window, and an email is sent.
- 2 locked windows in a row, or 4 in a day, close the path until a single-use emailed link reopens it.

---

## A1: engine core (`packages/account-engine`)

**Commits:** `13f0efd` (RED: 7 test files failing on missing modules), then `60f64fd` (GREEN). These are the 2026-10-03 rewrites of `6880e14` and `3f60648` with the list files taken out, so at these two commits `pin.test.mjs` cannot load; the PIN rules are green again from `3c3a183`. The suite is now 48 tests: 47 pass and 1 skips without the private package, and all 48 pass with it.

### What is in the package

| File | Source | Changes from the source |
|---|---|---|
| `src/totp.mjs` | JanusMirror `gatekeeper/src/totp.mjs` | HMAC-SHA1 from the vendored noble instead of `node:crypto`. Keys and decoded secrets are `Uint8Array`, not `Buffer`. The `clockOffset` parameters are renamed device/service. Behaviour is unchanged, and the RFC 4226/6238 vectors pass |
| `src/pake.mjs` | JanusMirror `gatekeeper/src/shared/pake.mjs` | Import paths only |
| `src/envelope.mjs` | JanusMirror `gatekeeper/src/shared/envelope.mjs` | None |
| `src/limits.mjs` | The pure part of JanusMirror `gatekeeper/src/pairing-limits.mjs` | `macLocked`→`pathLocked`, `'mac-lock'`→`'path-lock'`, `'mac-locked'`→`'path-locked'`, `pairing limits state:`→`limits state:`. The link hash uses noble sha256 and a constant-time hex compare (`sameHex`). The file, clock and mail wrapper (`createPairingLimits`, `writeState`, `readState`) is not carried; the caller keeps the state |
| `src/pin.mjs` | New | `createPinRules(blocklist)` returns a frozen `{ pinAllowed }`. It copies the list and refuses to build without one, or from an entry that is not six digits. `pinAllowed(pin)` returns `{ok:true}`, `{ok:false, reason:'shape'}` or `{ok:false, reason:'too-easy', message: PIN_TOO_EASY}` |
| `src/pin-blocklist-load.mjs` | New | `loadPinBlocklist({ importer })` imports `@nooutco/pin-blocklist` and checks its `PINS`/`COUNT` shape (`pinBlocklistFrom`). A missing package is an error, never an empty list |
| `test/fixtures/pin-blocklist.mjs` | New | Five well-known patterns in the package's shape, safe to publish |
| `src/probe.mjs` | New | A fixed CPace run reported as JSON, so every runtime can be compared |
| `vendor/noble/**`, `vendor/noble.sha256`, `vendor/refresh-noble.sh` | JanusMirror `gatekeeper/vendor` | None (@noble/curves and @noble/hashes 2.4.0) |
| *(private)* `@nooutco/pin-blocklist` | The Markert et al. dataset page (its `SOURCE.md`) | The two `.txt` lists, their sha256 pins and the build script moved there unchanged. `index.mjs` is byte-for-byte the list the old `src/pin-blocklist.mjs` held |
| `bin/vendor-pins.mjs` | Pattern from JanusMirror `test/vendor.test.mjs` | Returns the mismatches instead of asserting, so a negative control can use it |
| `src/mailer.mjs` *(A3)* | JanusMirror `gatekeeper/src/mailer.mjs` | The transport only: `createMailer({ from, readKey, fetchImpl, log })` returns `send({ to, subject, text })`, true or false. Dropped: the fixed `TO` and `FROM` addresses, the Keychain read (`readKeychainKey`, `RESEND_SERVICE`), `os.hostname()`, the clock import and the lock-email wording (`messageFor`, `clockLine`), since the caller names the sender, the recipient, the words and the key reader. The failure log line names only the kind of failure (`answered <status>` or `transport or key read failed`), never `err.message`, which can carry the key or the address. The default `log` is a no-op, not `process.stderr`, by the portability rule. Building without `from` or `readKey` throws. A message without a recipient, subject or text is not sent. Added: `fragmentLink(base, token)`, which puts a base64url token only after `#` and refuses a base that is not https or already has a query or fragment |
| `src/limits.mjs` *(A3)* | As above | `sameHex` is exported, so Horae Zone compares email-code digests with it, and now also answers false for a value that is not a string or is empty |
| `src/signed-bytes.mjs` *(A4)* | Horae Zone `apps/horae-zone/src/checks.js` (A2) | `signedBytes(nonce, path, body)` and `SIGNED_LABEL` moved out of the service, which now imports and re-exports it. The bytes are unchanged (the shared vector was made with the A2 builder). Changed: a nonce or path that is not a string, or a body that is not a `Uint8Array`, throws `TypeError` instead of being coerced with `String()`, since a coerced value is text the device never chose to sign |
| `test/fixtures/signed-bytes-vector.json` *(A4)* | New | The shared vector: label, a fake nonce, path and body, the expected bytes in hex, a raw P-256 public key and its raw and DER signatures. The key pair was made for the file and the private half discarded |

### Decisions

1. **Portability rule.**
   - Decision: `src/` imports nothing from `node:` and uses no `Buffer`, `process` or `require`. Node-only tooling lives in `bin/`.
   - Reason: the same bytes must run in Horae Zone (a Worker), in the Sass canvas and the JanusMirror pairing shell (browsers), and in Node.
   - Enforcement: a test enforces the rule statically, and `probe()` gives identical output in Node, Chromium and `workerd`.
2. **PIN run rule.**
   - Decision: any 3 consecutive digits that step by +1, −1 or 0 anywhere in the PIN, where the step wraps: 0 follows 9 and precedes 1, so `890`, `901`, `098` and `109` are runs.
   - Reason: the owner's rulings, "no runs" and then (2026-10-03) "7890 is [a run]. 0 is after 9 or before 1."
3. **One refusal sentence.**
   - Decision: the run rule and the blocklist refuse with the same text, and no refusal contains the PIN. A malformed PIN is `shape`, never "too easy".
   - Reason: a refusal must not reveal which rule matched.
4. **Blocklist source.**
   - Decision: Apple's iOS 6-digit list (2,910) combined with the authors' data-driven 29-PIN list, from Markert et al., IEEE S&P 2020 / ACM TOPS 2021.
   - Reason: the run rule alone would let 2,626 of Apple's PINs through, so the list adds real coverage.
   - Where: the private package `@nooutco/pin-blocklist`, never this public repository (owner ruling, "private package"). The engine takes the list as an injected dependency, so its own tests run on a public fixture.
5. **Vendored files are hash-pinned.**
   - Decision: a changed, added or missing file fails `test/vendor.test.mjs`.
   - Reason: this is the JanusMirror rule, carried over.
6. **Not moved yet.**
   - Decision: `mailer`, `replay`, `jwt` and `sealed-events` each move with the first slice that uses it (A3, A5, and Phase 9 respectively). The mailer moved in A3; `replay` and `jwt` are still in JanusMirror, since no slice through A5 uses them (see the A5 provenance table).
   - Reason: no code is carried without a caller and its tests.
7. **Test-only dependencies.**
   - Decision: `playwright` 1.56.1 and `workerd`, both pinned exactly as `devDependencies`.
   - Reason: they are needed only to prove the engine runs in a browser and a Worker. `src/` has no dependencies.
8. **Public repository.**
   - Decision: the package holds no secret, key, seed or deploy value, and never will.
   - Reason: everything here is world-readable.

### Open points for the reviewer

| # | Point | Where | Proposed resolution |
|---|---|---|---|
| 1 | ~~Redistributing the blocklist in a public repository~~ | - | **Decided** 2026-10-03, "private package" (see the rulings above) |
| 2 | ~~The "no runs" definition~~ | - | **Decided** 2026-10-03, runs wrap (see the rulings above) |
| 3 | ~~`pake.mjs` still uses JanusMirror's channel and DST~~ | `src/pake.mjs` | **Closed in A5**: `unlockChannelFor(device)` gives Horae Zone its own channel; the DST is unchanged, so JanusMirror can still adopt the engine as it is (A7) |
| 4 | The `limits` renames diverge from JanusMirror until A7 | `src/limits.mjs` | A7 maps JanusMirror's callers to the new names |
| 5 | `src/probe.mjs` is test support that ships in `src/` | `src/probe.mjs` | Keep it (it is tiny and pure), or move it under `test/` and have the browser and `workerd` loaders embed it from there |
| 6 | `vendor/refresh-noble.sh` uses BSD `sed -i ''` and `shasum`, so it runs on macOS only (as in JanusMirror) | `vendor/refresh-noble.sh` | Leave it, and document that the refresh runs on a Mac |
| 7 | The `workerd` test finds a free port by closing a probe listener, which leaves a small race, and waits up to 10 s. The browser test needs a Chromium that Playwright can find (when it could not, the test used to hang the run with its server open; since `df1f0d5` it fails promptly) | `test/runtimes.test.mjs` | Accept it for now. If the race ever fires, pass `127.0.0.1:0` and read the bound port from `workerd`'s output |
| 8 | ~~There is no CI workflow for the package~~ | - | **Decided** 2026-10-03, "ye": `account-engine-test.yml` |
| 9 | Consumers that vendor the engine (Sass, JanusMirror) must also install `@nooutco/pin-blocklist` and pass `loadPinBlocklist({ importer: () => import('@nooutco/pin-blocklist') })`, so the name resolves in their tree | `src/pin-blocklist-load.mjs` | Each consumer's slice (A7, A8, and the Horae Zone `/pin/set` slice) adds the git dependency and its read key |

### Out of scope for A1

- Horae Zone itself (A2 onward).
- Any deploy.
- Any change to Sass or JanusMirror (A7, A8).

---

## A2: Horae Zone skeleton (`apps/horae-zone`)

**Commits:** `7a171c6` (RED: 3 test files failing on missing modules), then `c10bd33` (GREEN: 21 tests); these are the 2026-10-03 rewrites of `05c75bf` and `4c98674`, unchanged apart from the engine's list files. Retention and the purge came in `c4a08a3` / `3c3a183`; the suite is now 30 tests. profile-api 195/195 is unchanged.

**Pattern:** `apps/profile-api`. It uses `workers_dev = false`, `schema.sql`, `node --test`, and the real-SQLite D1 helper `apps/profile-api/test/helpers/d1-sqlite.js`, which is reused by relative import rather than copied.

### What is in the app

| File | Does |
|---|---|
| `src/routes.js` | The plan §3.6 route table as data. Each route names its checks: `open`, `device`, `signed` or `admin`. Only `/nonce` has a handler; every other route answers `not-built` (501), but only after its checks pass |
| `src/checks.js` | Body rules (POST, `application/json`, a JSON object, at most 16 KB). Device lookup (the id is shape-checked before any query; a removed device is refused). The single-use nonce. The ECDSA P-256 signature check. The admin role check |
| `src/index.js` | `createHandler({now, routes})`: checks → handler → JSON (`no-store`). Every request writes one audit row. Every refusal is a closed word. It never calls `console`. `createScheduled({retention})` is the cron handler: it runs the purge at the scheduled time and throws when no database is bound, so Cloudflare records the run as failed |
| `src/retention.js` | `RETENTION` (`auditYears: 6`, `purgeCron: "0 * * * *"`), `auditCutoff(now, years)` (the same moment that many calendar years back; 29 February falls back to the 28th) and `purgeExpired(db, now, {auditYears})`, which deletes spent or expired nonces and audit rows older than the cutoff in one batch. A retention that is not a whole number of years from 1 up is refused |
| `schema.sql` | Only the tables A2 uses: `device`, `nonce`, `role`, `audit`, plus indexes on `nonce.expires_at` and `audit.at` for the purge |
| `wrangler.toml` | No route, no environment, no secret. One `[triggers]` cron for the purge (a cron opens no URL). The D1 id is a zero placeholder and stays one: the plan §4 deploy script (`bin/deploy.mjs`) writes the real id and the route into a gitignored `wrangler.deploy.toml` it generates from this file |

**Refusal words:**

| Word | Status |
|---|---|
| `method` | 405 |
| `shape` | 400 |
| `too-large` | 413 |
| `no-route` | 404 |
| `no-device` | 401 |
| `stale-nonce` | 401 |
| `bad-signature` | 401 |
| `not-admin` | 403 |
| `not-built` | 501 |
| `failed` | 500 |
| `unavailable` | 503 |

### Decisions

1. **The signed-bytes format devices must match:**
   - The message is `lv("horae-zone-v1") | lv(nonce) | lv(path) | lv(body)`. Each part carries a 4-byte big-endian length prefix, and the body is the exact bytes sent.
   - The signature is ECDSA P-256 over SHA-256.
   - The headers are `x-hz-device`, `x-hz-nonce` and `x-hz-sig` (base64url).
   - Both DER signatures (the Secure Enclave's `ecdsaSignatureMessageX962SHA256`) and raw r‖s signatures (WebCrypto) are accepted.
2. **Nonces:**
   - A nonce is 32 random bytes, bound to the device it was issued to, lives 60 s, and can be used once.
   - It is spent before the signature is checked, so one nonce allows exactly one try.
   - The spend is atomic: `UPDATE … RETURNING`.
3. **Audit rows are shape-only:** each holds the route name from the table (or `unknown`), the reason word and the time. The path as sent is never stored, because it is attacker-controlled text.
4. **No console output anywhere in `src/`.** A static test enforces this.
5. **An audit write that fails does not stop the answer.** The error carries no value worth reporting.
6. **Retention (the agent's call; the owner left it open: "Whatever is the balance of best but not overdone"):**
   - Audit rows are kept 6 years, then purged. Reason: 6 years is the HIPAA documentation retention period, which this clinical account log should meet, and each row is only a time, a route name and a reason word.
   - Spent or expired nonces are purged hourly. Reason: they already die after 60 s; the purge only keeps the table small. A deleted nonce is refused exactly like a spent one.
   - Both are configuration (`RETENTION`, overridable per call), and a test keeps `wrangler.toml`'s cron equal to `RETENTION.purgeCron`.

### Open points for the reviewer

| # | Point | Where | Proposed resolution |
|---|---|---|---|
| 1 | ~~`/device/register` is `open`: a device has no key before it registers~~ | - | **Closed in A4**: the handler requires the single-use ticket from `/signin` (RED first, `a55d8771`) |
| 2 | ~~`/nonce` needs only a known device id, so anyone holding an id can mint nonces~~ | - | **Closed in A4**: at most 5 live nonces per device (RED first, `a55d8771`). The WAF rate rule is still for the first deploy |
| 3 | ~~The `audit` table grows without limit~~ | - | **Decided** 2026-10-03: kept 6 years, purged by the hourly cron (decision 6) |
| 4 | ~~The signed-bytes builder lives in the service, but Sass and JanusMirror must build the same bytes~~ | - | **Closed in A4**: `packages/account-engine/src/signed-bytes.mjs`, with the shared vector `test/fixtures/signed-bytes-vector.json` (RED first, `a55d8771`) |
| 5 | The size check trusts `content-length` only as a fast path. The body is still buffered before the real size is known (the Workers platform caps request bodies) | `src/checks.js` `readBody` | Accept, or stream-read with a byte counter |
| 6 | The tests import the profile-api helper by relative path, which couples the two apps | `test/helpers.mjs` | Move it to `packages/shared/worker` if a third app needs it |
| 7 | The D1 id is a zero placeholder | `wrangler.toml` | The deploy script (`bin/deploy.mjs`, `DEPLOY.md`) writes the real id into the gitignored `wrangler.deploy.toml`, never into `wrangler.toml`. Deploy only on the owner's word |
| 8 | Not yet run under `wrangler dev --local`, because wrangler is not installed in the authoring environment. A `workerd` smoke test with no D1 bound loaded the Worker, which answered `unavailable` and printed nothing | - | The reviewer runs the `wrangler dev` smoke test in the test plan |
| 9 | ~~There is no CI workflow~~ | - | **Decided** 2026-10-03, "ye": `horae-zone-test.yml` |

### Out of scope for A2

- Every route handler except `/nonce`.
- Accounts, email, codes and PINs.
- Any deploy.

---

## A3: account and email (`apps/horae-zone`, `packages/account-engine`)

**Commits:** `665f3042` (RED: 2 engine files failing on the missing `src/mailer.mjs` and the unexported `sameHex`; 4 Horae Zone tests failing on the missing `src/signup.js` and the query-string rule; every A2 test still passing), then `0fb336ea` (GREEN). After GREEN: Horae Zone 54/54, engine 58 (57 pass, 1 skip), profile-api 195/195.

**Plan tests:** "sign-up needs the email code" and "the email code rides in the fragment", both in `test/signup.test.mjs`.

### What is in it

| File | Does |
|---|---|
| `src/signup.js` | `POST /account {email}` and `POST /account/email/verify {email, code, password}`, plus `SIGNUP_LIMITS` |
| `src/account-keys.js` | `accountKeys(env)`. HKDF from the one Worker secret `HZ_ACCOUNT_KEY` gives a separate key for each use: the address key, the address box, the code digest, the requester key and the login pepper (A4 adds the ticket digest; the second review, item 3, adds the link box). `hashLogin` is PBKDF2-SHA256 at 100,000 iterations over a random 16-byte salt per account, then HMAC under the pepper |
| `src/throttle.js` | `admitThrottle(db, now, windowMs, buckets)`: one `INSERT ... SELECT` that checks every bucket and records a row in each only when all are under their limit. A bucket may carry its own window (the daily cap, M2) |
| `src/index.js` | A URL with any query string is refused `shape` before any check. Handlers get `env`, the request and a mailer. A handler may return `after`, work that runs through `ctx.waitUntil` after the answer and its `ok` audit row, and that audits a failure word of its own (`mail-failed`) |
| `src/retention.js` | The hourly purge also removes spent and expired email codes, and rate-limit rows past their window (a day for the daily cap) |
| `schema.sql` | `account` (id, address_key unique, address_box, login_hash, login_salt, created_at), `challenge` (address_key, digest, link_box, expires_at, tries, used) and `throttle` (bucket, at) |
| engine `src/mailer.mjs`, `src/limits.mjs` | See the provenance table under A1 |
| `.github/workflows/horae-zone-test.yml` | Also runs when `packages/account-engine/src/**` or `vendor/**` changes, since the service now imports the engine |

**New refusal words:** `bad-code` (401) and `slow-down` (429). New audit-only word: `mail-failed`.

### Decisions

1. **Sign-up needs the email code.** `/account` makes no account, it mails a code. Only `/account/email/verify` with the live code makes the account, and the password is set in that same request (plan §3.3, first device, steps 1 and 2).
2. **The code rides in the fragment.** The mail carries `HZ_LINK_BASE#<code>`, built by the engine's `fragmentLink`, which refuses a base that is not https or already has a query or fragment. The code is also in the mail as text, so it can be typed. It is never in a query string (the service refuses any query string), a response body, an audit row or a log.
3. **Codes:**
   - 6 digits, drawn uniformly (32-bit values past the last whole million are drawn again).
   - Single use, alive 10 minutes. One is live for an address at a time (third review, item 2): a start mints a code only when the address has none inside its life, and otherwise mails the live one again. A start never ends or replaces a live code (H1 below).
   - Stored only as an HMAC digest under a key derived from the service secret, bound to the address key (since the second review, item 3, also sealed while live, so a later start can mail it again).
   - Compared with the engine's `sameHex`, never `===`.
4. **A try is counted before the compare.** The verify takes its places in the try limits and a try on every live code (`UPDATE ... RETURNING`) and only then compares, so guesses sent together cannot pass the try limits. It compares with every live code's digest, with no early exit. The first right try spends that code with a second `UPDATE ... WHERE used = 0`.
5. **No answer says whether an address has an account.** `/account` answers `{ok:true}` for a new address and an existing one, takes the same rate-limit places for both, sends the same statements for both (M1 below), and mails only a new address. A verify for an address that was never sent a code is `bad-code`, like a wrong code.
6. **Rate limits are atomic, and a refused request is not counted.** Starts are limited per requester, per mailbox for a tagged address, and per day across everyone (M2). Tries are limited per requester and per address for one requester (H1; the per-address try cap went in the second review, item 2). Since the third review, item 2, there is no per-address start cap: a start is counted under its requester and the daily cap, then mints a link when none is live for the address and otherwise re-sends the live one, under a re-send cap (a tagged address also needs a place under its mailbox cap to mint). A start that can neither mint nor re-send is not refused: it answers the same `{ok:true}` and mails nothing. Before a device has a key, the requester is the connecting address (`cf-connecting-ip`), stored only as a keyed hash. A request without one is refused as `shape` (L3 below).
7. **Shape before the rate limit.** A malformed body is refused before the throttle, so it neither counts nor spends a try.
8. **The address is stored sealed.** AES-GCM under a derived key, with the address key as associated data, so a box cannot be moved to another row. Lookups use the keyed address hash.
9. **The password is stored as a peppered slow hash.** 100,000 PBKDF2 iterations is the most the Workers runtime allows. The HMAC pepper means a copied table cannot be guessed against without the Worker secret. The password is NFKC-normalised before the hash (M5 below).
10. **The mail transport is injected.** Tests pass a sink and never send mail. Production builds the engine mailer from `HZ_MAIL_FROM` and `RESEND_KEY`. Either one missing, a missing or short `HZ_ACCOUNT_KEY`, or a bad `HZ_LINK_BASE` answers `unavailable`, and nothing is written.
11. **The mail runs after the answer.** A failed send is audited `mail-failed` and changes nothing else.

### Decisions for Kaleb

Safe defaults the plan does not fix. Each is one constant in `src/signup.js`.

| # | Point | Default now | Where |
|---|---|---|---|
| 1 | How long an email code lives | 10 minutes | `SIGNUP_LIMITS.codeTtlMs` |
| 2 | ~~Code tries at one address per hour, from everyone (H1)~~ | - | **Removed** by the second review, item 2: with a 128-bit token the cap only let strangers hold the owner's link at `slow-down` |
| 3 | ~~Codes minted for one address per hour, and codes live at once~~ | - | **Removed** by the third review, item 2: strangers used up the hour's mints and re-sends, and once those links expired the owner's start mailed nothing. One link is live at a time now, so at most 6 are minted an hour (`windowMs / codeTtlMs`) |
| 4 | Sign-up starts per connecting address per hour | 10 | `startsPerRequesterHour` |
| 5 | Code tries per connecting address per hour, and at one address from one connecting address (H1) | 20 and 5 | `verifiesPerRequesterHour`, `triesPerAddressRequesterHour` |
| 6 | Account password length | 12 to 256 characters | `passwordMin`, `passwordMax` |
| 7 | The mail wording (second review, item 1: no code to type): subject "Horae Zone sign-up link", then "Link for the device signing up:", the link, "Works once. Expires within N minutes." (N is the link's remaining life, rounded up: 10 for a new link, less for a re-sent one, item 3) and "No account is made without this link." | As written | `codeMessage` |
| 8 | Codes mailed per hour across every `+tag` of one mailbox (M2) | 10 (was 3, R2) | `codesPerMailboxHour` |
| 9 | The hard cap on sign-up starts per day across every address and requester (M2). Since the second review, item 5, it is the mail plan's daily limit, not a guard: set `HZ_CODES_PER_DAY` to the plan's limit at deploy. The agent's reading of Resend's pricing (not checked against the live page) is 3000 a month with 100 a day on the free plan and no daily limit on the paid ones, so the default only fits a paid plan. **Changed from 500 to 3000**, with the alert to `HZ_ALERT_TO` at half of it (rows 11 and 12); the third review asked that Kaleb see this change here | 3000 (was 500), or `HZ_CODES_PER_DAY` when set (a plain Worker variable, not a secret) | `codesPerDay` |
| 10 | Re-sends of the live link per hour, per address and per mailbox across its `+tag`s, for a start made while a link is live (second review, item 3; since the third review, item 2, every start that does not mint). Mail to one address is bounded at 6 minted plus 3 re-sent an hour (was 3 plus 3) | 3 | `resendsPerAddressHour` |
| 11 | When the operator alert goes out (second review, item 5): one mail a day once the day's starts reach this share of the hard cap | 50 percent | `alertAtPercent` |
| 12 | The operator alert address (second review, item 5). It is set at deploy with `wrangler secret put HZ_ALERT_TO` (or as a Worker variable) and is never written in the repo; the tests use a fake. Unset, the half-cap start is audited `alert-unset` instead of mailed | Unset; Kaleb picks it | `HZ_ALERT_TO` |
| 13 | Cloudflare Turnstile or a WAF rate rule on `/account` (and `/signin`) at the first deploy (second review, item 5). The service's own caps bound each connecting address and the day; only an edge rule bounds a stranger with many connecting addresses before the day's cap, or before the sign-in address ceiling (A4 row 2). **Required at the first deploy** since the third review (was a recommendation): the daily start cap and the sign-in address ceiling can still be filled by a stranger with enough connecting addresses, and only an edge rule bounds that stranger | Not built (deploy-time) | Cloudflare dashboard |

### Security review findings and what changed

A security review of `3c3cac63` asked for these fixes before merge. Each one was test first: the tests below fail on `3c3cac63` and pass after the fix. One commit per item:

| Item | Slice | Commit | After the fix |
|---|---|---|---|
| H1, sign-up lockout | A3 | `b7fde672` | Horae Zone 84/84 |
| H2, sign-in lockout | A4 | `7868788c` | Horae Zone 90/90 |
| M1, account timing | A3 | `68622439` | Horae Zone 91/91 |
| M2, per-address limits stepped around | A3 | `a0e2e2b4` | Horae Zone 98/98 |
| M3, ticket not bound to keys | A4 | `e1c8ea2c` | Horae Zone 100/100 |
| M5, password normal form | A3 | `8a8f064f` | Horae Zone 103/103 |
| L2, removal mid-flight | A4 | `a6824fe5` | Horae Zone 108/108 |
| L3, no connecting address | A3 | `012e8993` | Horae Zone 110/110 |

After every commit the engine ran 64 tests (63 pass, 1 skip without the private package; Node, Chromium and `workerd`) and profile-api 195/195. A4 lists H2, M3 and L2 in full; the review also raised device removal, recorded as A4 Decision for Kaleb 5 and not built.

**H1 (high): anyone could lock a chosen address out of sign-up.** `startSignup` deleted the live code for the address before storing a new one, and five wrong tries ended a code, so a stranger could end the owner's code with one start or five guesses.

What changed (`src/signup.js`):
- A start never deletes or replaces a live code. Up to `liveCodes` (3) codes are live for an address at once, each with its own try count, and the insert checks that count in the same statement. The start limit (3 per address per hour) keeps the cap from being reached inside one window, and every code a stranger starts is mailed to the owner, who can use it. (Changed by the third review, item 2: one code is live at a time and a start while it is live mails it again, so a start still never ends the owner's code.)
- A verify compares with every live code's digest (`sameHex`, no early exit), so the owner's code works whichever start made it.
- A wrong guess no longer ends a code. Guessing is bounded by the kept per-address try cap (`triesPerAddressHour`, 15, the same total as 3 codes times the old 5 tries) and a share for one requester at one address (`triesPerAddressRequesterHour`, 5). Each code's own ceiling (`codeTries`, now 15) is never reached first, since a code lives inside one window.

Tests (`test/signup.test.mjs`): "H1: a second start leaves the first code live, so the owner's code still works", "H1: every live code for an address works, the newest included", "H1: wrong guesses from another requester do not end the owner's code", "H1: tries at one address are still capped across requesters", and "H1: the address cap stops tries before any one code reaches its own try limit". They replace "wrong tries end a code" and "a newer code replaces the older one", which pinned the old behaviour.

Left as is (residual), at the time: 15 wrong guesses at one address within an hour, from 3 or more connecting addresses, held that address's verifies at `slow-down` until the window passed. Any cap on guesses is a cap a stranger can fill; that one bounded a 6-digit code to 45 in a million per address per hour. **Closed by the second review, item 2:** the code is a 128-bit token, so `triesPerAddressHour` and `codeTries` are gone and no number of strangers' tries holds or ends the owner's link.

**M1 (medium): the time to answer said which addresses have accounts.** `startSignup` looked the address up and, for one with an account, answered before the challenge write, so that path skipped a D1 round trip and a write.

What changed (`src/signup.js`): the separate account lookup is gone. The account check rides inside the challenge `INSERT ... SELECT` (`used` is `EXISTS (SELECT 1 FROM account ...)`), so both paths send the same statements in the same order and write one row. A row for an address with an account is born spent (`used = 1`): it never verifies, never counts toward the live cap, no mail goes out for it, and the hourly purge removes it.

Test (`test/signup.test.mjs`): "a start sends the same statements whether or not the address has an account" compares the statements each start binds (the D1 test double keeps every bound statement) and checks that only the new address holds a code that can verify.

Left as is (residual): the mail for a new address runs after the answer (`ctx.waitUntil`), so it adds no time to the answer, but the two paths still differ in work after the answer is sent.

**M2 (medium): the per-address limits could be stepped around.** `addressOf` took any non-space, non-control character, so a zero-width or soft-hyphen character, a look-alike letter in the local part, or a new `+tag` each made a new address key for the same mailbox, with fresh limits. Nothing capped the codes sent in a day across every address.

What changed:
- `addressOf` (`src/signup.js`) refuses, as `shape`, an address holding a format character (`\p{Cf}`: zero-width space, joiner and non-joiner, word joiner, byte-order mark, soft hyphen) anywhere, and a local part that is not printable ASCII. Sign-in uses the same check, so it refuses the same addresses before any write.
- A start for a tagged address (`name+tag@domain`) also takes a place in a per-mailbox bucket keyed on the address with the tag stripped (`codesPerMailboxHour`, 3; 10 since R2). That key is for the limit only: the account key stays the full address, tag included. An untagged address is its own mailbox and keeps its own per-address bucket, so a flood of tags cannot stop the owner's sign-up at the plain address. Mail to one mailbox is bounded at 3 an hour for the plain address plus 3 an hour across all its tags. (Since the third review, item 2, the plain address has no start bucket: it mints at most 6 links an hour, one live at a time, plus 3 re-sends. The mailbox bucket still bounds minting across the tags.)
- Every start takes a place in one global bucket, `codes-day`, over a 24-hour window. The cap is `HZ_CODES_PER_DAY` when set and `SIGNUP_LIMITS.codesPerDay` (500) when not. A value that is set but is not a whole number of 1 or more answers `unavailable` and writes nothing, so a typo stops starts instead of opening the cap. Both paths of M1 take this place, so the statements still match. `admitThrottle` takes a window per bucket for this, and the hourly purge keeps `codes-day` rows for a day.

Tests: in `test/signup.test.mjs`, "M2: an address with a format or zero-width character, or a non-ASCII local part, is refused as shape" (at `/account`, `/account/email/verify` and `/signin`, with nothing written or counted), "M2: starts for every +tag of one mailbox share one limit, and the plain address is not held by it", "M2: codes sent are capped per day across every address and requester" and "M2: without configuration the daily cap is the default, and a bad value refuses starts"; in `test/purge.test.mjs`, "M2: a purge keeps daily-cap rows for a day and clears them after". Two NEGATIVE CONTROLs pass before and after: an ASCII local part with a dot, a plus or a non-ASCII domain still starts, and the account key stays the full address.

Left as is (residual):
- ~~A non-ASCII domain is still taken as written.~~ Closed by the second review, item 6: the domain is mapped to its ASCII DNS name before the address key. Mail systems map some spellings of a domain (full-width letters, for one) to the same ASCII domain, so those spellings still make new address keys for one mailbox. They still pay the requester and daily limits. Converting the domain to its ASCII form at the boundary would close it (open point 6).
- Providers that ignore dots in the local part (`first.last` and `firstlast`) give two address keys for one mailbox. Only `+tag` is stripped, because dot rules differ by provider.
- Anyone can fill the daily cap from many connecting addresses (each at 10 starts an hour) and stop sign-up for everyone until the day passes. The cap trades that for a bound on mail sent, and the WAF rate rule at the first deploy is the second layer. **Narrowed by the second review, item 5:** the cap is the mail plan's limit (3000 by default, was 500), and the operator is mailed at half of it, so filling it takes 300 connecting-address hours and the operator hears of it first.

**M5 (medium): one password could hash two ways.** `hashLogin` hashed the password's code points as sent. The same password typed on two keyboards can arrive composed (`é` as one point) or decomposed (`e` plus a combining accent), or with a compatibility form (a ligature, a full-width letter), so an owner who set it on one device was refused on another.

What changed (`src/account-keys.js`): `hashLogin` normalises the password with NFKC before PBKDF2. Sign-up, sign-in and the throwaway hash for an address with no account all go through `hashLogin`, so all three hash the same form. No database exists yet, so no stored hash needs moving.

Tests (`test/devices.test.mjs`, since a sign-in is needed to check the stored hash): "M5: a password set in NFC form signs in from its NFD form, and the other way round" and "M5: a compatibility form (a ligature) signs in as its plain letters" fail on `3c3cac63` (401, expected 200). "M5 NEGATIVE CONTROL: a password that differs after normalising is still refused" passes on both.

Left as is (residual): the length rules (12 to 256 at sign-up, 1 to 256 at sign-in) read the password as sent, not its normalised form. A decomposed password counts its combining marks, and a few compatibility characters expand under NFKC (one Arabic ligature becomes 18 characters), so the hashed form can be shorter than 12 or longer than 256. Neither changes what the hash accepts, and PBKDF2 takes any length.

**L3 (low): a request with no connecting address shared one bucket.** `requesterOf` read a missing `cf-connecting-ip` as the word `none`, so every such request (a misrouted call, a test client, a future service binding) was counted under one requester, and a few of them filled that bucket for all the rest.

What changed (`src/signup.js`, `src/signin.js`): `requesterOf` refuses a missing or blank `cf-connecting-ip` as `shape`. `/account`, `/account/email/verify` and `/signin` call it with the other shape checks, before the account key is read and before any throttle row, code, ticket or mail. Cloudflare sets the header on every request through its edge, so a real client never meets this refusal.

Test (`test/signup.test.mjs`): "L3: a start, verify or sign-in without a connecting address is refused as shape and writes nothing" (no header, an empty one and a blank one, at all three routes). On a `3c3cac63` extract the three routes answered 200, `bad-code` and `bad-login` and wrote throttle rows. "L3 NEGATIVE CONTROL: the same start with a connecting address is admitted and counted under it" passes on both.

Left as is (residual): the header is trusted as Cloudflare sets it. A request reaching the Worker by a path that lets the caller set the header would choose its own bucket; no such path exists (no route but the edge, no service binding).

### Second security review: the root cause, a guessable email code

A second review of `8ebe205a` found that what was left of H1, H2 and M2 had one root cause. A 6-digit email code is guessable, so it needed tight per-address caps, and any cap a stranger can fill is a lever to lock a chosen address out. The fix goes at the root: the email secret becomes unguessable, and the caps that only existed to slow guessing go. Each item was test first: its tests were written before the fix and run against the source of the commit before it (only the test files changed), and they failed there. One commit per item, landed in the order 1, 2, 3, 4, 7, 6, 5:

| Item | What | Slice | Commit | RED on | After the fix |
|---|---|---|---|---|---|
| 1 | The email secret is a 128-bit random token in the link fragment; the mail shows no code to type | A3 | `d672e603` | `8ebe205a` | Horae Zone 112/112 |
| 2 | No address-level verify cap and no per-code try ceiling, so strangers' wrong tries never make the owner's link answer 429 or end it | A3 | `9f55de74` | `d672e603` | Horae Zone 113/113 |
| 3 | A start at the per-address cap answers the same 200 and re-sends the newest live link instead of minting, under a re-send cap; up to 5 live codes per address | A3 | `92d91ed2` | `9f55de74` | Horae Zone 117/117 |
| 4 | `/signin` has no hard per-address lock: a per (address, requester) failure cap, a per-address ceiling of 100 failures an hour, and a backoff on the address that never passes 15 minutes | A4 | `7df89d4e` | `92d91ed2` | Horae Zone 121/121 |
| 5 | The daily cap is the mail plan's limit (`HZ_CODES_PER_DAY`, default 3000), and one alert a day goes to `HZ_ALERT_TO` at half of it | A3 | `69c7cc33` | `4c2c53ca` | Horae Zone 134/134 |
| 6 | The address is keyed by its domain's DNS name: one trailing dot stripped, mapped to ASCII, and a domain that is not a plain DNS name is `shape` | A3 | `4c2c53ca` | `6b49d7e8` | Horae Zone 127/127 |
| 7 | A sign-in signed by a registered device of the account still pays the per (address, requester) failure cap from item 4 | A4 | `6b49d7e8` | `7df89d4e` | Horae Zone 124/124 |

After every commit the engine ran 64 tests (63 pass, 1 skip without the private package; Node, Chromium and `workerd`) and profile-api 195/195. The new decisions for Kaleb are A3 rows 9 to 13 (the hard daily cap, the re-send cap, the alert share, the alert address `HZ_ALERT_TO`, and Turnstile or a WAF rule on `/account` at the first deploy) and A4 rows 2, 7 and 8 (the address ceiling, the pair cap and the backoff).

**Item 1: the email secret becomes unguessable.** The code already rode in the link fragment and was clicked, not typed, so a 6-digit code bought nothing but guessability.

What changed (`src/signup.js`): `newCode` draws 16 random bytes and writes them in base64url (22 characters, no padding). The rest is unchanged: the token is stored only as its keyed digest (`codeDigest`), it is single use, it lives 10 minutes, and a verify compares digests with `sameHex`. `/account/email/verify` takes only that shape, so a typed 6-digit code, or any other length or alphabet, is `shape` before any throttle row or try is counted. The mail shows no code to type (the review preferred none, and the link is how the code is used): subject "Horae Zone sign-up link", the link, and the lifetime.

Tests (`test/signup.test.mjs`): "the email secret is a 128-bit random token, and the mail shows no code to type" and "a 6-digit typed code, or any other shape than the token, is refused as shape before a try is counted" are new. The existing tests now build wrong tries as well-formed tokens. On `8ebe205a` 9 tests fail (the two new ones, and seven whose wrong tries or shape checks assume the token; for example a well-formed token never sent answers `shape` there, expected `bad-code`).

Left as is: the request field stays `code`, so a client posts what it read from the fragment unchanged.

**Item 2: the address-level verify cap stops being a lockout lever.** With a 6-digit code, 15 wrong tries at one address from any 3 connecting addresses held the owner's verify at `slow-down` for the hour, and 15 tries on one code ended it. With a 128-bit token no cap is needed to stop guessing, so both caps only served a stranger.

What changed (`src/signup.js`, `src/retention.js`): the `verify-address` bucket and `SIGNUP_LIMITS.triesPerAddressHour` are gone, and so is the per-code ceiling `codeTries`: a live code is now unspent and unexpired, whatever its try count. The per-requester cap (`verifiesPerRequesterHour`, 20) and the per (address, requester) cap (`triesPerAddressRequesterHour`, 5) stay, and they bound load, not guessing. The `tries` column is still counted on every live code before the compare, as a record; no count ends a code. The hourly purge drops spent and expired codes only.

Tests: in `test/signup.test.mjs`, "item 2: 15 strangers' wrong tries from 3 requesters, then the owner's link still verifies" (on `d672e603` the owner's link answered `slow-down`), "item 2: many strangers' wrong tries never end the owner's code" (60 tries from 12 requesters; on `d672e603` the 16th answered 429) and "H1: a code lives inside one window" (which now also checks the two limits are gone). They replace "H1: tries at one address are still capped across requesters" and "H1: the address cap stops tries before any one code reaches its own try limit", which pinned the old caps. In `test/purge.test.mjs`, the purge test keeps a live code with 15 tries (on `d672e603` it was purged as used up).

Left as is: one requester still gets 5 tries at one address and 20 in all per hour, so a single connecting address cannot use `/account/email/verify` as a load lever.

**Item 3: a stranger's starts no longer stop the owner getting a link.** At the per-address start cap (3 an hour) a start answered `slow-down`, so 3 starts by a stranger held the owner's own start at 429 for the hour.

What changed (`src/signup.js`, `src/account-keys.js`, `schema.sql`):
- A start takes its place under the requester cap and the daily cap first; either one full is still `slow-down`, since both are the requester's own or everyone's, and neither says anything about the address.
- Then the start tries the per-address bucket (and the per-mailbox bucket for a tagged address). Under the cap it mints as before. At the cap it answers the same `{ok:true}` and, instead of minting, takes a place in a re-send bucket (`resend-address`, and `resend-mailbox` for a tagged address, each `resendsPerAddressHour`, 3) and mails the newest live link for the address again. Every start at the cap takes that place, mailed or not, so an address with an account (which has no live link) sends the same statements as one without (M1). Past the re-send cap, or with no live link, nothing is mailed and the answer is still `{ok:true}`.
- To mail a link again the service needs the token, which item 1 stored only as its digest. Each new code is now also sealed in `challenge.link_box`: AES-GCM under its own HKDF key ("link box"), bound to the address key, the same construction as the address box. The digest is still what a try is checked against. The box is set to NULL when the code is spent, and expired rows go in the hourly purge. A box that does not open (sealed under another secret) counts as no live link.
- `liveCodes` is 5 (was 3). The mint cap stays 3 an hour, so the live cap is never what stops a mint inside one window. (Both went in the third review, item 2.)
- The mail says "Expires within N minutes", N being the link's remaining life rounded up, since a re-sent link has less than 10 minutes left.

Tests (`test/signup.test.mjs`): "item 3: 3 strangers' starts, then the owner's start still gets a working link mailed" (the newest live link is mailed again, no code is minted, and it verifies), "item 3: the mail count per address per hour stays bounded" (40 starts from 20 requesters mail 6 links, mint 3 codes, and the caps lift after the window), "item 3: at the cap an expired link is never sent again", "item 3: at the cap an address with an account is sent nothing, with the same statements as one without" and "item 3: a live link is kept sealed for a re-send, and dropped once spent". "sign-up starts are rate limited per address", which pinned the 429, is replaced by the first two. The M2 tag test now expects `{ok:true}` with no mail and no new code past the mailbox cap, and the limits test pins `liveCodes` 5, `codesPerAddressHour` 3 and a re-send cap.

Left as is (residual):
- A bounded mail count is a cap a stranger can fill. A stranger who sends 6 starts at one address inside a minute mails the owner 3 working links and 3 copies, and then the owner's later starts in that hour mail nothing once those links expire (10 minutes). Every link the stranger causes still goes to the owner, the per-requester cap (10 an hour) bounds one connecting address, and Turnstile or a WAF rate rule on `/account` at the first deploy is the second layer. **Closed by the third review, item 2:** a start mints whenever no link is live, so the owner's start after the strangers' links expire mails a new one.
- The token is now recoverable from a copied table together with `HZ_ACCOUNT_KEY`, for as long as the code is live (at most 10 minutes). The table alone gives nothing, and anyone with both can already open every address box.

**Item 4: `/signin` has no hard per-address lock (the H2 residual).** After H2, 10 wrong passwords an hour at one address, from any connecting addresses, still held every unsigned sign-in at that address at `slow-down` for the hour. A known device got past it, but a first sign-in on a new device did not, so strangers could keep the owner off a new device.

What changed (`src/signin.js`, `src/throttle.js`):
- An unsigned sign-in takes three places in one statement: the requester's (`perRequesterHour`, 20, every try, as before), the pair's (`signin-pair`, the address key and the requester key, `perPairHour`, 5) and the address's (`perAddressHour`, now a ceiling of 100). A success gives back its pair and address places in the batch that stores the ticket, so only wrong passwords fill them.
- The address is never locked. Past `backoffAfter` (10) wrong passwords in the hour it backs off: a try is refused until `backoffMs` has passed since the latest counted try at the address. The quiet time is `backoffBaseMs` (1 minute) after the 11th wrong password and doubles with each further one (2, 4, 8 minutes), never above `backoffMaxMs` (15 minutes). A try refused by the backoff is not counted, so it does not lengthen it. (Replaced by the third review, item 1: the backoff is the pair's, never the address's, and starts after 2 wrong passwords.)
- The review asked that the backoff "answer the same refusal". The agent read that as one answer whatever the password: during the backoff the right password and a wrong one both answer `slow-down` (429), the answer every full bucket gives, so a try in the backoff tells nothing about the password. Answering `bad-login` instead would also hide it, but would tell the owner their right password was wrong.
- `admitThrottle` takes an optional `quietMs` per bucket, checked in the same `INSERT ... SELECT` as the counts, so tries sent together during a backoff cannot both pass it. The failure count that sets the quiet time is read just before, in its own statement.
- A sign-in signed by a registered device of the account still skips the address ceiling and the backoff and pays the requester bucket (H2). Item 7 (below) adds the pair bucket to that path.

Tests (`test/devices.test.mjs`): "item 4: ten strangers' wrong passwords from ten requesters, then the owner's right password from a new device signs in" (on `92d91ed2` it answered `slow-down`), "item 4: a single requester hammering one address is refused" (5 wrong passwords from one requester, then even the right one is `slow-down`, while another requester signs in; on `92d91ed2` the same requester's right password after 6 wrong ones got a ticket, since one requester had the address's whole 10), "item 4: past backoffAfter failures the address answers slow-down whatever the password, for a delay that doubles and never passes 15 minutes" (each step is held 1 ms before its delay and admitted at it, through 1, 2, 4, 8, 15 and 15 minutes) and "item 4: the per-address ceiling is 100 failures an hour, and only failures fill it" fail on `92d91ed2`. "item 4 NEGATIVE CONTROL: the owner's own successes from one requester take no place in the pair bucket" passes on both. "sign-in tries are rate limited per address, from any requester", which pinned the hard lock, is gone. The three H2 tests that filled the address bucket now put the address into backoff (11 wrong passwords) and expect the same outcomes: the unsigned try is held, the signed one is not, a success takes no place.

Left as is (residual):
- The backoff is still a delay a stranger can cause. With wrong passwords from at least 3 connecting addresses (5 each), a stranger puts an address into backoff in a minute, and one more wrong password each time the quiet time ends keeps it there; the owner's unsigned sign-in in that time answers `slow-down` until a gap of at most 15 minutes. Holding an address for an hour takes fewer than 20 wrong passwords, each from a requester under its own caps. The owner's registered devices are not held (H2), and Turnstile or a WAF rule on `/signin` at the first deploy is the second layer. **Closed by the third review, item 1:** six strangers polling every second kept the owner out for 4 hours, so the address-wide backoff is gone.
- The failure count is read before the admitting statement. Tries sent together at exactly `backoffAfter` failures can each be admitted with no quiet time; the pair, requester and address caps still bound them. (Still so since the third review, with the count read per pair.)

**Item 5: the global daily cap is the mail plan's limit, with an alert at half.** M2 capped sign-up starts at 500 a day across everyone. That bounded mail, but a stranger with 50 connecting addresses (10 starts an hour each) stopped every sign-up for a day, and nobody was told.

What changed (`src/signup.js`, `src/index.js`, `src/retention.js`):
- `SIGNUP_LIMITS.codesPerDay` is 3000, the default mail plan limit, and `HZ_CODES_PER_DAY` still sets it (a bad value still answers `unavailable`). It stays a hard cap, since past it the mail plan refuses anyway; a start over it answers `slow-down`. Below it every start goes on as before.
- After a start takes its daily place, one statement takes a row in a new `alert-day` bucket when the day's count has reached `alertAtPercent` (50) of the cap and no alert row is younger than a day. The check and the write are one `INSERT ... SELECT`, so two starts together cannot both alert. The start that takes the row mails one alert after the answer to `HZ_ALERT_TO`: subject "Horae Zone sign-ups at half the daily cap", the count reached and the cap, what happens at the cap, and that no other alert goes out for 24 hours. It names no address and no requester. Every start past the first step runs this statement, so the M1 statements still match.
- `HZ_ALERT_TO` comes from the Worker's environment (set at deploy, never in the repo). Unset or not an address, the start that reaches half the cap is audited `alert-unset` instead of mailed; a send that fails or throws is audited `alert-failed`. Neither changes the answer or the start's own link. An after-work may now name more than one reason, and `src/index.js` audits each.
- The hourly purge keeps `alert-day` rows for a day, as it keeps `codes-day` rows, so the alert goes out once a day and not once an hour.
- The daily count is taken at the first step, so it counts every start past the requester cap, including ones that mail nothing (an address with an account, or past the re-send cap). That keeps the M1 statements the same, and it can only overcount the mail sent, never undercount it. The alert is one mail more a day.

New audit-only words: `alert-unset` and `alert-failed`.

Tests: in `test/signup.test.mjs`, "item 5: without configuration the hard daily cap is the mail plan limit, 3000" (500 on `4c2c53ca`), "item 5: the alert fires once at 50 percent of the daily cap and sign-ups continue below the hard cap" (a cap of 10: no alert at 4 starts, one at the 5th, still one after 10, every start below the cap mailed its link, the 11th is `slow-down`; on `4c2c53ca` no alert went out), "item 5: one alert a day, and the next day can alert again", "item 5: at half the cap without an alert address the start is audited alert-unset and the answer is unchanged", "item 5: an alert that cannot be sent is audited alert-failed and the link still goes out" and "item 5: the alert check sends the same statements whether or not the address has an account" (the statements matched on `4c2c53ca` too; it failed there on the missing alert); in `test/purge.test.mjs`, "item 5: a purge keeps the daily alert row for a day and clears it after" (on `4c2c53ca` a two-hour-old `alert-day` row was purged). All 7 fail on `4c2c53ca` with only the test files changed.

Left as is (residual):
- The hard cap is still a cap a stranger can fill: 3000 starts a day from 300 connecting-address hours stops sign-up for everyone until the day passes. The alert reaches the operator at half, and Turnstile or a WAF rule on `/account` at the first deploy (Decision for Kaleb 13) is what bounds a stranger with many addresses.
- The alert is sent through the same mailer as the links, so a mail plan that is already refusing sends no alert either; that send is audited `alert-failed`.

**Item 6: one domain, one address key.** The domain was only lower-cased. `v@example.test.` (a trailing dot is the DNS root, so it names the same domain) made a new address key for the same mailbox, with its own per-address limits, and a domain with characters no DNS name has (`exa_mple.test`, `exa%41mple.test`, `-example.test`) was taken and mailed.

What changed (`addressOf` in `src/signup.js`, which `/account`, `/account/email/verify` and `/signin` all use): after the M2 checks the domain goes through `dnsNameOf`. One trailing dot is stripped. What is left must be letters, digits, combining marks, dots and hyphens. The URL parser then maps it to its ASCII DNS name (IDNA, as a mail system resolves it: lower case, full-width letters to ASCII, a decomposed accent to the composed one, a non-ASCII label to punycode). Every label of the result must be 1 to 63 letters, digits and inner hyphens (no leading or trailing hyphen, no empty label), there must be at least two labels, the top label must not be all digits (no address at an IP), and the whole name must be at most 253 characters. Anything else is `shape` before any write. The address key, the sealed address and the mail all use the ASCII name, so `v@bücher.example.test` is mailed at `v@xn--bcher-kva.example.test`, which every mail system delivers. The local part is lower-cased as before.

Decision (agent's): the ask was "letters, digits, hyphens, dots". A plain ASCII check would have refused every non-ASCII domain, which the M2 NEGATIVE CONTROL keeps on purpose, and a Unicode-letter check alone would have kept the M2 residual (full-width and decomposed spellings of one domain as separate keys). Mapping through the URL parser first and checking the ASCII result keeps both: a non-ASCII domain still starts, and each domain has one key. This also closes the M2 residual and A3 open point 6.

Tests (`test/signup.test.mjs`): "item 6: a trailing dot or another case is the same address as the plain one" (`v@example.test.` starts, the link is mailed to `v@example.test`, and `V@EXAMPLE.TEST` verifies with it; the three spellings share one per-address bucket), "item 6: a full-width or decomposed spelling of a domain is the same address as its DNS name" and "item 6: a domain that is not a plain DNS name is refused as shape before any write" (11 domains, at all three routes, nothing mailed, stored or counted) fail on `6b49d7e8` (only the test file changed): no mail to `v@example.test`, two per-address buckets for the full-width spelling, and `v@-example.test` answered 200. The M2 NEGATIVE CONTROL (a non-ASCII domain still starts) passes on both.

Left as is (residual): the local part is taken as written, lower-cased. Mail systems that ignore dots or case in the local part (some do, most do not) still see `first.last` and `firstlast` as one mailbox with two address keys; each still pays the requester and daily limits, and a mail system's own rules are not the service's to guess.

**Item 7: a known device still pays the pair bucket.** After H2 a sign-in signed by a registered device of the account took the requester bucket only. A stolen device (its key with it) could try passwords at the requester cap, 20 an hour from each connecting address it used, and none of them was counted at the address.

What changed (`src/signin.js`): a signed sign-in from a device of the account takes the requester place and the pair place (`signin-pair`, `perPairHour`, 5), in one statement as before. It still skips the address ceiling and the backoff, so an address in backoff holds back a new device and never a known one (H2). (Since the third review, item 1, the backoff is the pair's, and a signed sign-in pays it with the pair bucket; the address ceiling is still skipped.) A success gives back its pair place, as an unsigned success does. The give-back runs just after the ticket is stored, not in its batch, because the ticket's statement has to report whether the device was still live (L2); should the give-back fail, the success stays counted, which holds the device back and lets no guess by. The pair bucket is the one unsigned tries take, so signed and unsigned wrong passwords from one connecting address share its 5.

Tests (`test/devices.test.mjs`): "item 7: a registered device guessing passwords from one requester is held by the pair bucket" (5 signed wrong passwords from one requester, then even the right one is `slow-down`, while the same device from another requester signs in) and "item 7: a known device's wrong passwords share the pair bucket with unsigned tries from the same requester" fail on `7df89d4e` (each answered a ticket, expected `slow-down`). "item 7 NEGATIVE CONTROL: a known device's own successes take no place in the pair bucket and still skip the address bucket" passes on both.

Left as is (residual): a stolen device with many connecting addresses still tries 5 passwords an hour from each, with no address-wide count. Removing the device (A4 decision 5) stops it at once, and a password worth guessing at that rate is the owner's to choose (the length rule is A3's).

### Third security review: two lockouts a stranger could still cause

A third review of `17577851` closed sign-up verify, the address shapes and devices, and found two lockouts a stranger could still cause, each with a probe that worked on that commit. Each fix was test first: its tests were written before the fix and run against the `17577851` source (only the test files changed), and they failed there. One commit per item:

| Item | What | Slice | Commit | RED on | After the fix |
|---|---|---|---|---|---|
| 1 | The sign-in backoff is per (address, requester) pair only; the address keeps a load ceiling with no quiet period | A4 | `561fc56d` | `17577851` | Horae Zone 135/135 |
| 2 | A sign-up start mints a link whenever none is live for the address, and otherwise re-sends the live one under the re-send cap | A3 | `a62b6d3c` | `17577851` | Horae Zone 138/138 |
| 3 | These docs: the review, the changed daily cap under Decisions for Kaleb, the edge rule required at the first deploy, and L-new-1 accepted | - | the docs commit after `a62b6d3c` | - | Horae Zone 138/138, no code changed |

After every commit the engine ran 64 tests (63 pass, 1 skip without the private package; Node, Chromium and `workerd`) and profile-api 195/195. With the test files of `a62b6d3c` over the `17577851` source, 11 of 138 tests fail: the 5 new ones below, and 6 older tests reworked for the new design ("H2: a successful sign-in is not counted against the address", "H2: wrong passwords alone count toward the address ceiling, and a success does not clear them", "H1: a code lives inside one window", "H1: starts while a link is live mail that link again, and it works", "item 3: re-sends of a live link are capped each hour" and "item 3: an expired link is never sent again, and the next start mints a new one").

**Item 1: strangers could hold the sign-in backoff open.** The probe: six connecting addresses push the address past 10 wrong passwords, then each tries every second, so a stranger's counted try lands right after each quiet time ends and starts the next one. The owner, trying the right password every 30 seconds for 4 hours from a new device, never got in.

What changed (`src/signin.js`, `src/throttle.js`):
- The address-wide quiet period is gone. The backoff (`quietMs` in `admitThrottle`) rides on the pair bucket (`signin-pair`, the address key and the requester key), and `failuresAt` counts that pair's failures. Past `backoffAfter` (now 2) wrong passwords from one requester at one address, that requester waits 1 minute, then 2, and `perPairHour` (5) caps it for the hour. No other requester is held by it, so polling the address holds back only the pollers.
- The address bucket is only the load ceiling (`perAddressHour`, 100 wrong passwords an hour; 1000 since R1). A try refused by any bucket is still not counted, and a success still gives back its pair and address places.
- A sign-in signed by a registered device of the account pays the pair bucket with its backoff (it paid the pair bucket since item 7) and still skips the address ceiling.

Tests (`test/devices.test.mjs`): "third review, item 1: six strangers polling every second never hold the owner's right password from a fresh connecting address" is the probe. On `17577851` the owner tried 480 times over 4 simulated hours and never signed in; now the first try gets a ticket. "third review, item 1: one requester hammering one address backs off on its own pair, then is capped at perPairHour" holds each step 1 ms before its delay and admits it at the delay, checks that the right password and a wrong one get the same `slow-down`, that another requester signs in meanwhile, and that the pair stays capped until its first failure leaves the hour. On `17577851` the pair had no backoff (`backoffAfter` 10 was not below `perPairHour` 5). The H2 tests that filled the address bucket now fill the ceiling with rows, and the item 4 test of the address backoff is replaced by the pair test.

Left as is (residual): the address ceiling is still a cap strangers can fill. Twenty connecting addresses (200 since R1) at 5 wrong passwords each (about 3 minutes per pair) fill it, and for as long as they keep refilling it the owner's first sign-in on a new device answers `slow-down`; six reach only 30. Registered devices are not held (H2). The review allowed a high ceiling for load, and the edge rule at the first deploy (A3 Decision for Kaleb 13, now required) bounds a stranger with that many addresses.

**Item 2: the start cap could leave the owner without a link.** The probe: strangers' 3 starts minted the hour's 3 links, and their next 3 used the re-send cap. Eleven minutes later, with those links expired, the owner's start answered `{ok:true}` and mailed nothing until the hour ended.

What changed (`src/signup.js`):
- The per-address mint cap (`codesPerAddressHour`), the live cap (`liveCodes`) and the `start-address` bucket are gone. `mintCode` inserts a code only where the address has no code inside its life, checked in the same `INSERT ... SELECT`, so two starts together cannot both mint. One link is live at a time, so at most 6 are minted an hour at a 10-minute life.
- A start that does not mint goes to `resendCode` as before: a place under the re-send caps (`resend-address`, and `resend-mailbox` for a tagged address, 3 an hour each), then the live link mailed again. So every start mints a link or re-sends the live one, and past the re-send cap it mails nothing while a link already mailed to the address is still live.
- M1 holds: a code inside its life counts whether live or spent, so an address with an account (its row is born spent) takes the re-send path with the same statements as an address with a live link.
- A tagged address still needs a place under its mailbox cap (`codesPerMailboxHour`, 3; 10 since R2) to mint.
- Mail to one address is bounded at 6 minted plus 3 re-sent an hour (was 3 plus 3).

Tests (`test/signup.test.mjs`): "third review, item 2: strangers' 3 mints and 3 re-sends, then the owner's start 11 minutes later mails a working link" is the probe (on `17577851` 6 mails went out, expected 7; now the owner's link verifies). "third review, item 2: strangers starting every 10 s for an hour never leave the owner without a working link" (on `17577851` the newest link mailed to the owner answered 401; now 200) and "third review, item 2: one link is live at a time, and mail to one address stays bounded each hour" (a start a minute for an hour: on `17577851` two links were live at minute 1; now one at a time, 6 minted and 9 mailed) are new too. The H1, limits and item 3 tests that pinned the mint cap now pin one live link, the re-send cap, an expired link never sent again with the next start minting, and the same statements for an account address inside a code's life and an address with a live link.

Left as is (residual):
- A tagged address still needs a mailbox place to mint, so strangers starting other `+tag`s of the same mailbox (3 an hour; 10 since R2) can keep a tagged address from minting for up to an hour. The plain address is never held. Dropping that cap would leave mail to one mailbox unbounded across its tags.
- The re-send cap is still a cap strangers can fill, but only while a link is live, and that link has already gone to the address, so the owner's mailbox holds a working link the whole time.
- The hourly purge removes spent codes before they expire, so after a purge an address with an account mints a born-spent row instead of re-sending, as an address with no live link does. Both still send the same statements as their counterpart (M1).

**L-new-1 (low), accepted: a live link can be opened with the Worker secret.** Since the second review, item 3, each live code is also sealed in `challenge.link_box`, AES-GCM under a key derived from `HZ_ACCOUNT_KEY`, so a later start can mail it again. Whoever holds a copy of the table and that secret can open a live link. The box is cleared when the code is spent and the hourly purge removes expired rows, so a box lives at most 10 minutes, and whoever holds both can already open every address box. Accepted as is; nothing changed.

**Required at the first deploy:** Cloudflare Turnstile or a WAF rate rule on `/account` and `/signin` (A3 Decision for Kaleb 13, a recommendation until this review). The daily start cap and the sign-in address ceiling are both caps a stranger with enough connecting addresses can fill, and only an edge rule bounds that stranger.

### Final review of #242: two tuning changes (R1, R2), closed

The final review of #242 asked for two tuning changes. Both raise a load number, and neither is a guessing bound. They landed on the A5 branch (PR #244) after it was rebased onto `dev`, test first: the test that pins each number was changed to the new value, failed on the old constant, and passes since the constant changed.

| Item | What | Slice | Was | Now | Constant | Status |
|---|---|---|---|---|---|---|
| R1 | Wrong sign-in passwords per address per hour, from everyone (the address ceiling) | A4 | 100 | 1000 | `SIGNIN_LIMITS.perAddressHour` | Closed |
| R2 | Codes minted per hour across every `+tag` of one mailbox | A3 | 3 | 10 | `SIGNUP_LIMITS.codesPerMailboxHour` | Closed |

**R1: the sign-in address ceiling is 1000 an hour.** Since the third review, item 1, the ceiling only bounds load. Guessing stays bounded by the requester bucket (`perRequesterHour`, 20 tries an hour per connecting address) and the pair bucket with its backoff (`perPairHour`, 5 wrong passwords an hour at one address from one connecting address). At 100, strangers with about 20 connecting addresses could fill the ceiling and hold the owner's first sign-in on a new device at `slow-down`; at 1000 they need about 200. The edge rule at the first deploy (A3 Decision for Kaleb 13) still bounds a stranger with more. A sign-in signed by a registered device still skips the ceiling (H2).

**R2: a mailbox's `+tag`s share 10 mints an hour.** A tagged address mints only under its mailbox's cap (M2). At 3, strangers starting 3 other `+tag`s of the owner's mailbox kept the owner's tagged address from minting for up to an hour (the third review's item 2 residual); at 10 it takes 10 starts, each also paying the starter's own `startsPerRequesterHour` (10). Mail to one mailbox across its tags is now bounded at 10 minted plus 3 re-sent an hour (was 3 plus 3), beside the plain address's own 6 plus 3, and the daily cap (`codesPerDay`) still bounds the whole service. The plain address is never held by the tags, as before.

Tests: "item 4 (R1): the per-address ceiling is 1000 failures an hour, and only failures fill it" (`test/devices.test.mjs`, renamed from "item 4: the per-address ceiling is 100 failures an hour, and only failures fill it") and "M2: starts for every +tag of one mailbox share one limit, and the plain address is not held by it" (`test/signup.test.mjs`, which now also asserts the cap is 10, then makes 10 tagged starts before the cap holds). With only the tests changed, both fail on the old constants (100 and 3) and the other 208 Horae Zone tests pass. After the change: Horae Zone 210/210, engine 68 (67 pass, 1 skip without the private package), profile-api 195/195.

### Open points for the reviewer

| # | Point | Where | Proposed resolution |
|---|---|---|---|
| 1 | Before a device has a key, "per device" means per connecting address. Users behind one address (a clinic network) share a bucket, and a changing address escapes it | `requesterOf` in `src/signup.js` | Accept for now; the WAF rate rule at the first deploy adds a second layer |
| 2 | When two right tries race, the loser answers `bad-code` though its code was right | `verifySignup` | Accept; the winner made the account |
| 3 | The mail goes out through `ctx.waitUntil`. If the Worker is stopped before the send, the code is stored but never mailed, and nothing is audited | `src/index.js` | Accept; the user asks for another code |
| 4 | Not run against a real Resend or a real `wrangler dev`, because wrangler is not installed in the authoring environment, so the bundle with its `../../../packages/account-engine` imports is unchecked by wrangler. The engine's runtimes test loads `mailer.mjs` in `workerd` and Chromium | - | The reviewer runs the `wrangler dev` smoke test in the test plan |
| 5 | Changing `HZ_ACCOUNT_KEY` makes every stored address key, address box, code digest, link box and login hash unusable | `src/account-keys.js` | A rotation plan (keep the old secret to re-derive) before the first real account |
| 6 | ~~A non-ASCII domain is taken as written, so spellings a mail system maps to one domain make separate address keys (M2 residual)~~ | `addressOf` in `src/signup.js` | **Closed by the second review, item 6**: the domain is mapped to ASCII with the URL parser and checked as a plain DNS name, RED first |

### Out of scope for A3

- Real mail, real secrets and any deploy.
- The authenticator code and its enrolment, and the code-path lockout email (A5).
- The PIN (A5b) and account recovery (A6).

---

## A4: devices (`apps/horae-zone`, `packages/account-engine`)

**Commits:** `a55d8771` (RED: Horae Zone 57 tests, 3 failing on the missing `src/signin.js`, a `/signin` that handed out no ticket and the missing `ticket` table; the engine's `signed-bytes.test.mjs` failing on its missing module; every A2 and A3 test still passing), then `75158c79` (GREEN). After GREEN: Horae Zone 81/81, engine 64 (63 pass, 1 skip without the private package), profile-api 195/195.

**Plan tests:** "a request with no registered device signature is refused" and "a removed device is refused at once", both in `test/devices.test.mjs`.

**A2 open points closed, each RED first:** 1 (`/device/register` needs the `/signin` ticket), 2 (a cap on live nonces) and 4 (`signedBytes` in the engine, with a shared vector).

### What is in it

| File | Does |
|---|---|
| `src/signin.js` | `POST /signin {email, password, keyDigest}` answers `{ticket}` or a uniform `bad-login`, plus `SIGNIN_LIMITS` (keyDigest added by M3 below) |
| `src/devices.js` | `POST /device/register {ticket, signKey, agreeKey}` answers `{device}` when the two keys are the ones the ticket was bound to (M3). `POST /device/remove {device}`, signed, answers `{ok:true}`. `deviceKeyDigest` gives the digest a device sends to `/signin` |
| `src/checks.js` | `LIVE_NONCES_PER_DEVICE = 5`. `/nonce` is one `INSERT ... SELECT ... WHERE` live count under the cap `RETURNING`. `signedBytes` is imported from the engine and re-exported, with no local builder |
| `src/account-keys.js` | A sixth derived key, the ticket digest |
| `src/retention.js` | The purge also removes spent or expired tickets, and clears rate-limit rows past the longer of the sign-up and sign-in windows |
| `schema.sql` | `device.agree_key` (nullable; changed in place, since no database exists yet), a `ticket` table (digest, account_id, key_digest, expires_at, used; key_digest added by M3), and indexes on `device(account_id)` and `nonce(device_id, used, expires_at)` |
| engine `src/signed-bytes.mjs`, `test/fixtures/signed-bytes-vector.json` | See the provenance table under A1 |

**New refusal words:** `bad-login` (401) and `bad-ticket` (401). `slow-down` (429) also answers a sixth live nonce.

### Decisions

1. **Registration needs the ticket from `/signin`.** The route stays `open`, because a device has no key to sign with yet, and the handler takes exactly `{ticket, signKey, agreeKey}`. The ticket is 32 random bytes, handed out once, stored only as a keyed digest bound to its account and to the digest of the keys it may register (M3 below), alive 5 minutes, and spent by the same `UPDATE ... RETURNING` that checks it, so it registers one device.
2. **The keys are checked before the ticket is spent.** Each must be a raw P-256 public point that WebCrypto imports (ECDSA for `signKey`, ECDH for `agreeKey`). An off-curve or malformed key is `shape`, and the ticket stays live.
3. **Sign-in does not say whether an account exists.** A wrong password and an unknown address both answer `bad-login`, and the unknown address still runs one full password hash with a fixed throwaway salt, so both take the same time. Every try is limited per requester (across addresses). Wrong passwords are limited per address (from any requester), and a success is not counted there. A sign-in signed by a registered device of the account skips the address limit (changed by H2 below), and since the second review, item 7, still pays the per (address, requester) limit. Since the second review, item 4, the address limit is a high ceiling, and wrong passwords are also limited per address for one requester (see item 4 under A3). Since the third review, item 1, the backoff (at most 15 minutes) is that pair's alone, never the address's. A sign-in without a connecting address is `shape`, as at sign-up (A3, L3).
4. **Sign-in takes any stored password length.** `/signin` checks only 1 to 256 characters, so a later change to the sign-up length rule never locks out an older account.
5. **A removed device is refused at once.** `/device/remove` stamps `removed_at` and spends that device's live nonces in one batch. The A2 device check already refuses a removed device on every route, so its next request fails.
6. **Remove reaches only the caller's account, and answers the same way every time.** Both statements match only a device of the signing device's account. An unknown id or another account's device also gets `{ok:true}`, so the answer never confirms that a device exists. A device can remove itself.
7. **A removed device keeps its row**, marked with when it was removed.
8. **Five live nonces per device.** The count and the insert are one statement, so requests sent together cannot pass the cap. A spent or expired nonce frees its place. Five leaves room for a device sending a few signed requests at once, and a stolen device id can no longer fill the table.
9. **`signedBytes` lives in the engine.** Sass and JanusMirror import the same function. The shared vector pins the bytes and both a raw and a DER signature, so every consumer can test against it, and Horae Zone's own test accepts the vector's signatures.

### Decisions for Kaleb

| # | Point | Default now | Where |
|---|---|---|---|
| 1 | How long a sign-in ticket lives | 5 minutes | `SIGNIN_LIMITS.ticketTtlMs` |
| 2 | Wrong sign-in passwords per address per hour, from everyone; a success and a sign-in signed by a device of the account are not counted (H2). A ceiling since the second review, item 4, and a load bound only since the third review, item 1 (no quiet period; strangers with 200 connecting addresses can still fill it, so the edge rule in A3 row 13 is required). Raised to 1000 by R1, since the requester and pair caps bound guessing | 1000 (was 100 before R1, 10 before the second review) | `SIGNIN_LIMITS.perAddressHour` |
| 3 | Sign-in tries per connecting address per hour | 20 | `SIGNIN_LIMITS.perRequesterHour` |
| 4 | Live nonces per device | 5 | `LIVE_NONCES_PER_DEVICE` |
| 5 | Who may remove a device: any signed device of the account, itself included, with no fresh Face ID, password or code. Plan §3.5 says "Remove it on the admin or account screen" and does not say what proof that screen asks for. The security review recommends, before launch, either a fresh proof at removal (password or authenticator code) or a delay with an email to the account address that the removal can be stopped in, so a stolen device cannot remove the owner's others at once. Not built; it needs Kaleb's choice of the two | No extra proof | `removeDevice` |
| 6 | How long removed device rows are kept | No purge | `src/retention.js` |
| 7 | Wrong sign-in passwords at one address from one connecting address per hour (second review, item 4), a sign-in signed by a device of the account included (item 7) | 5 | `SIGNIN_LIMITS.perPairHour` |
| 8 | The pair backoff (second review, item 4, on the address until the third review, item 1, moved it to the pair): it starts after this many wrong passwords in the hour from one requester at one address, its first quiet time, and its cap (the quiet time doubles with each further wrong password). During it every sign-in from that requester at that address answers `slow-down`, whatever the password; other requesters are not held. With `perPairHour` 5 the pair reaches its cap after quiet times of 1 and 2 minutes | 2 (was 10); 1 minute; 15 minutes | `backoffAfter`, `backoffBaseMs`, `backoffMaxMs` |

### Security review findings and what changed

The same review of `3c3cac63` asked for these fixes before merge, each test first: the tests below fail on `3c3cac63` and pass after the fix. The commit for each is in the table under A3.

**H2 (high): anyone could lock the owner out of `/signin`.** The per-address bucket counted every try, from any requester, a success included. Ten wrong passwords from ten connecting addresses held the owner's right password at `slow-down` for the hour, and the owner's own sign-ins filled the same bucket.

What changed:
- A new route kind, `signable` (`src/routes.js`, `src/index.js`), used only by `/signin`. A request without `x-hz-device` is `open` as before. A request that names a device passes every signed check (the device is registered and not removed, the nonce is fresh and its own, the signature covers `/signin` and the body), and a bad one is refused (`no-device`, `stale-nonce`, `bad-signature`), never treated as unsigned.
- `signIn` (`src/signin.js`) looks the account up first. When the request was signed by a device of that account, only the per-requester bucket is taken; otherwise both buckets are, in one statement as before.
- A success takes back its place in the address bucket, in the same batch that stores the ticket (`releaseThrottle` in `src/throttle.js`). Taking the place first and giving it back on success keeps the cap atomic: tries sent together still cannot pass it.

Tests (`test/devices.test.mjs`): "H2: after ten wrong passwords from ten requesters, the owner signs in from a registered device", "H2: a successful sign-in is not counted against the address", "H2: wrong passwords alone still fill the address bucket, and a success does not empty it", and "H2: a sign-in that names a device must carry its good signature, never falling back to unsigned" fail on `3c3cac63`. "H2 NEGATIVE CONTROL: a device of another account does not lift the address bucket" and "H2 NEGATIVE CONTROL: a signed sign-in still pays the per-requester bucket" pass on both, and guard the bypass from widening. `test/checks.test.mjs` now lists `signable` among the route kinds and pins `/signin` as its only route.

Left as is (residual): a first device has no key to sign with, so strangers who fill the address bucket still hold back the owner's first sign-in on a new device for up to an hour (narrowed by the second review, item 4: no hard lock, a backoff of at most 15 minutes after the latest wrong password; narrowed again by the third review, item 1: no address backoff, only the address ceiling, 100 an hour then, which took about 20 connecting addresses to fill; 1000 since R1, which takes about 200). A device of the account that has been stolen (its key with it) can try passwords without the address cap; since the second review, item 7, it pays the pair cap (5 wrong passwords an hour from each connecting address, not the requester's 20), and removing it (A4 decision 5) stops it at once.

**M3 (medium): a sign-in ticket was not bound to the keys it registers.** `/device/register` took any two keys with a live ticket, so whoever saw the ticket in its 5 minutes (a log, a proxy, a compromised client library) could register their own device on the owner's account, and spend the ticket so the owner's own registration failed. The digest alone would not have been enough had it covered `signKey` only: a stranger could then send the owner's `signKey` with their own `agreeKey`, and what later slices seal to that device would open on the stranger's key.

What changed:
- `/signin` takes exactly `{email, password, keyDigest}`. `keyDigest` is SHA-256 over the raw sign point then the raw agree point (65 bytes each, so the join is unambiguous), base64url without padding, 43 characters (`deviceKeyDigest` in `src/devices.js`). A missing or malformed digest is `shape`, refused before any write or rate-limit row.
- The ticket row stores the digest (`ticket.key_digest`, a public value). `/device/register` computes the digest of the keys it was sent and spends the ticket only where both the ticket digest and the key digest match, in the one `UPDATE ... RETURNING`. Other keys answer `bad-ticket` and leave the ticket unspent, so a stranger's try neither registers nor uses up the owner's ticket.

Tests (`test/devices.test.mjs`): "M3: a ticket refuses keys other than the ones it was signed in for, and is not spent by them" (a stranger's two keys, the stranger's `signKey` with the owner's `agreeKey`, and the reverse, then the owner's keys as NEGATIVE CONTROL) and "M3: a sign-in without a well-formed key digest is refused as shape, before any write" fail on `3c3cac63`. On a `3c3cac63` extract with the sign-in helper sending the old two-field body, the first test shows the defect itself: the stranger's keys register (200, expected 401). `test/helpers.mjs` computes the digest on its own (`keyDigestOf`), apart from `src/devices.js`, so the tests pin the form a device computes; the existing register tests now sign in for the keys they register.

Left as is (residual): the ticket is still a bearer value between the owner's own `/signin` and `/device/register`; the binding means only the device holding the private halves of the bound keys can use what it registers.

**L2 (low): a removal landing mid-flight did not win.** The device check (`findDevice`) ran once, before the handler, and the writes after it did not look again. A request from a device removed between that check and its writes still acted: it removed another device of the account, got a fresh nonce, spent a nonce, or got a sign-in ticket by the H2 path.

What changed: every write a device's request makes now carries `LIVE_DEVICE` (`src/checks.js`), `EXISTS (SELECT 1 FROM device WHERE id = ? AND removed_at IS NULL)` bound to the calling device, in the same statement.
- The nonce spend in `checkSignature`, so a nonce is spent only while its device is live; a refused spend answers `stale-nonce`.
- The nonce insert in `issueNonce`, beside the cap. When the insert makes no row, a second `findDevice` tells a removed device (`no-device`) from a full cap (`slow-down`).
- Both statements of `/device/remove`, so a caller removed mid-flight changes nothing. The answer stays `{ok:true}`, as it is for any id (decision 6).
- The ticket insert of a sign-in signed by a device of the account (the H2 path), now `INSERT ... SELECT ... WHERE` it with `RETURNING`; no row answers `no-device` and no ticket is stored. An unsigned sign-in is unchanged.

Tests (`test/devices.test.mjs`): a test helper hands the handler a database where the removal lands right after a named statement has run (after the nonce spend for signed routes, after `findDevice` for `/nonce`). "L2: a device removed after its checks passed cannot remove another device", "L2: a device removed after its id was checked gets no nonce" and "L2: a nonce of a device stamped removed after its id was checked is not spent" fail on a `3c3cac63` extract. "L2: a device removed after its signed sign-in passed the checks gets no ticket" fails on `8a8f064f`, the commit before this fix; the signed sign-in path did not exist on `3c3cac63` (it came with H2). "L2 NEGATIVE CONTROL: a live device removes another, and itself" passes on both.

Left as is (residual): a wrong-password try from a device removed mid-flight still skips the address bucket for that one try (the rate check runs before the ticket insert); it is one try per removal and pays the per-requester bucket. A read-only route has no write to guard, and none exists yet.

### Open points for the reviewer

| # | Point | Where | Proposed resolution |
|---|---|---|---|
| 1 | ~~Sign-in asks no authenticator code yet~~ | `src/signin.js` | **Closed in A5** by the pending rule (A5 decision 6): a further device reaches nothing but `/nonce` and `/unlock` until it proves the code |
| 2 | `/device/register` has no rate limit of its own | `src/devices.js` | Accept: the ticket is 256-bit and single use |
| 4 | No cap on devices per account | `src/devices.js` | Decide with the account screen slice |
| 5 | App Attest is not checked (plan §3.6: "later") | `src/devices.js` | A later slice |
| 6 | `device.agree_key` is nullable, because the A2 tests and the vector test add devices without one. `/device/register` always sets it | `schema.sql` | Make it `NOT NULL` once the test helpers pass one |
| 7 | Removing a device does not revoke its Cloudflare and Anthropic tokens; the plan puts that in a runbook | - | The runbook in Sass `docs/ios.md` |
| 8 | The A2 leak sweep now lets each unspent nonce expire between routes, because open routes never spend the nonce the sweep fetches for them, and the cap would refuse the sixth | `test/leak.test.mjs` | None; what the sweep checks is unchanged |

Decided by the security review, so no longer open: point 3 (a ticket was not bound to the keys it registers) is closed by M3 above. The numbers of the other points are kept.

### Out of scope for A4

- The authenticator code, unlock and its lockout (A5), the PIN (A5b), admin actions (A5c) and recovery (A6).
- Bringing a vault to a new device (`/pair/offer`, `/pair/take`).
- Any change to Sass or JanusMirror, and any deploy.
- A fresh proof, or a delay with an email, before a device is removed (Decision for Kaleb 5). The security review recommends one before launch; it waits on his choice.

---

## A5: the single authenticator code (`apps/horae-zone`, `packages/account-engine`)

**Commits:** `82744bc7` (RED: Horae Zone 126 tests with 16 failing, the engine's `pake.test.mjs` failing to load; every A2 to A4 test, the security review's included, still passing), then `ae4fe2da` (GREEN). After GREEN: Horae Zone 151/151, engine 68 (67 pass, 1 skip without the private package), profile-api 195/195. The RED count of 126 is lower than 151 because `otp.test.mjs` and `unlock.test.mjs` could not load (their modules did not exist yet), and a file that cannot load reports as one failure. Then `234e058c` (RED for open points 8 and 9, the security review's L2 and M3 carried to A5: Horae Zone 161 tests with 7 failing, every other test passing) and the GREEN commit after it. After that GREEN: Horae Zone 161/161, engine 68 (67 pass, 1 skip), profile-api 195/195. Then one commit per item of the A5 security review of `77305fc0`, each RED first (see "The A5 security review" below).

**Rebased onto `dev`, 2026-10-04.** `dev` holds A3 and A4 as merged in #242, after its four security reviews. Only A5's own commits were moved. Two conflicts, both where each side had added to the same lines, kept both: `src/account-keys.js` derives `dev`'s link box and A5's tag digest (eight keys), and `src/retention.js` keeps `dev`'s rule that the daily cap and alert rows live a day as well as A5's purge of exchanges and pending devices' tries. No A3 or A4 fix changed. The hashes in this section and in the test plan's A5 section are the rebased ones. The counts beside them were measured before the rebase, when the base had 110 Horae Zone tests (`dev` has 138), so a repeat now shows the same failing tests among more passing ones. After the rebase: Horae Zone 210/210, engine 68 (67 pass, 1 skip), profile-api 195/195. Then R1 and R2 (see "Final review of #242" in A3).

**Plan tests:** "the seed is returned once and never again" (`test/otp.test.mjs`), "NEGATIVE CONTROL: a correct code, account and device returns a ticket" (`test/unlock.test.mjs`), "three wrong codes in one window lock it and email; two in a row or four a day close the path until the link" and "the reopen link is single use and hands out no key" (both `test/lockout.test.mjs`).

**Earlier open points closed, each RED first:** A1 open point 3 (a Horae Zone channel for `pake.mjs`) and A4 open point 1 (a further device needs the code; see decision 6).

### What is in it

| File | Does |
|---|---|
| `src/otp.js` | `POST /otp/enrol {ticket}`, signed, answers `{secret, uri}`, again with a new seed until the first accepted code confirms it (A5 security review, item 3). Exports `OTP_LABEL`, `seedBoxKey(env)` and `openSeed(env, accountId, box)` |
| `src/unlock.js` | `POST /unlock/start {sid, Ya, clock}` answers `{exchange, replies}` (two replies). `POST /unlock/finish {exchange, tagA}` answers `{ticket}`. `POST /unlock/reopen {token}` answers `{ok:true}`. Exports `UNLOCK_LIMITS`, `TICKET_LABEL`, `PENDING_TRIES_PER_DAY` (A5 security review, item 2) and `PENDING_TRIES_PER_ACCOUNT_DAY` (A5 re-review, item 3) |
| `src/lockout.js` | The engine's `limits.mjs` rules over one D1 row per account, the lock notes, and after-work that mails them to the account's address; the pending note and its hourly throttle, `pendingNotes` (A5 re-review, item 3); the day cap, `WRONG_PER_ACCOUNT_DAY`, `capDay`, `settleCapped` and `dayHasRoom` (A5 re-review, item 4) |
| `src/devices.js` | The sign-up ticket registers the account's first device as its owner device, not pending; every other device starts `pending` (A5 re-review, item 1). A removal needs a device that may change the account, checked first and again in both writes (item 2) |
| `src/signup.js`, `src/signin.js` | The verify takes `keyDigest` and answers the owner ticket; the right password on an account with no device answers `no-owner-device` and mails the owner (A5 re-review, item 1) |
| `src/routes.js`, `src/index.js` | The A5 handlers are wired in. `/nonce`, `/unlock/start` and `/unlock/finish` are marked `pendingOk`, and a pending device gets `no-device` on every other route. A `Refusal` can carry after-work (a lock mail), which runs after the refusal's own audit row |
| `src/checks.js` | `Refusal(reason, status, after)`; `ACCOUNT_CHANGER` and `mayChangeAccount` (A5 re-review, item 2) |
| `src/account-keys.js` | An eighth derived key, the tag digest: HMAC of an expected CPace confirmation tag, bound to its exchange id |
| `src/retention.js` | The purge also removes finished and expired code exchanges, and a pending device's tries once a day old |
| `schema.sql` | `otp` (account_id, box, last_step, created_at, enrolment, confirmed_by) and its `otp_confirmed` trigger, `exchange` (id, account_id, device_id, candidates, expires_at, used, enrolment), `limits` (account_id, state, version, reopen_hash), `pending_try` (device_id, account_id, at; A5 security review, item 2, and re-review item 3) and `device.pending` (changed in place, since no database exists yet) |
| engine `src/pake.mjs` | `unlockChannelFor(device)` returns `horae-zone-unlock-v1|<device>`, and throws `TypeError` for anything but a device id |

**New Worker secrets** (none is set anywhere; the tests use fake or per-run values): `HZ_SEED_KEY` (base64url, at least 32 bytes), `HZ_TICKET_KEY` (a P-256 private key as a JWK) and `HZ_REOPEN_BASE` (the https page the reopen link opens). A missing or bad value answers `unavailable`, and nothing is written.

**New refusal words:** `enrolled` (409), `not-enrolled` (409), `locked` (423), `bad-link` (401), `no-owner-device` (403, A5 re-review item 1) and `not-owner` (403, A5 re-review item 2). `enrol-blocked` (409, A5 security review item 1) was retired with the sole-device rule in re-review item 2. `bad-code` (401) and `bad-ticket` (401) are reused.

**Provenance.**

| Piece | Source | Changes from the source |
|---|---|---|
| The steps offered (current and previous, never the next) | JanusMirror `gatekeeper/src/totp.mjs` (`candidateCodes`, "Never the next window") | None in the rule. Horae Zone also withholds any step at or before the account's last accepted one |
| The lockout rules | Engine `src/limits.mjs` (A1, from JanusMirror `pairing-limits.mjs`) | None. The state lives in D1 instead of a file, written by compare-and-swap |
| The lock notes | JanusMirror `gatekeeper/src/mailer.mjs` (`messageFor`, `clockLine`) | New wording for an account rather than one Mac, sent through the engine mailer (A3). The clock line is kept for a skewed device clock |
| The reopen link | Engine `fragmentLink` (A3), JanusMirror `phone/unlock.mjs` pattern | None: the token rides only after `#` |
| `replay.mjs` and `jwt.mjs` | JanusMirror | **Not moved.** `replay.mjs` is an in-memory ledger for sealed relay messages, and a Worker keeps no memory across requests, so the A5 replay rule is the per-account `last_step` in D1 instead. `jwt.mjs` verifies Cloudflare Access RS256 tokens for the Mac relay, which Horae Zone does not do. Both stay in JanusMirror until a slice uses them (Phase 9) |

### Decisions

1. **The seed is handed out once, and only to a signed device with a fresh sign-in.** `/otp/enrol` is a signed route and takes exactly `{ticket}`, a live `/signin` ticket. The ticket is spent first, by the same `UPDATE ... RETURNING` that checks it was issued to the signing device's account and bound to the signing device's own two keys (`deviceKeyDigest`, as `/device/register` checks since M3), so another account's ticket, or one named for other keys, is refused and stays live. Until the first accepted code the enrolment is unconfirmed, and a repeat with a fresh ticket answers a new seed that replaces the old one; once confirmed, a repeat answers `enrolled` and carries no seed (A5 security review, item 3). Both writes also require the signing device to be one that may change the account (`ACCOUNT_CHANGER`): live, not pending, and until the first accepted code the owner device (A5 re-review, item 2, which replaced the sole-device rule of A5 security review item 1). Any other device answers `not-owner`, and a pending device does not block the owner's enrolment.
2. **The seed is stored only sealed.** 20 random bytes, sealed with AES-GCM under a key HKDF derives from `HZ_SEED_KEY` (its own secret, apart from `HZ_ACCOUNT_KEY`), with the account id as associated data, so a box moved to another account does not open. The seed is opened only inside `/unlock/start` to build the replies, and its bytes are zeroed after use. No answer after the first, no row, bound value, audit row or log carries it (leak canary).
3. **The code never crosses the wire.** The device proves it with CPace, the engine's `pake.mjs`, keyed by the code under `unlockChannelFor(device)`. The channel names the one device that signs start and finish, so an exchange cannot finish for another device, and its label keeps it apart from every JanusMirror channel. The DST is unchanged.
4. **Drift: zero forward, one step back.** `/unlock/start` offers the current 30-second step and the previous one, never the next, which is JanusMirror's rule. A step the service withholds (at or before the last accepted one) still gets a reply, built from a random code, so the two answers look alike.
5. **A code is accepted once.** Acceptance is one atomic `UPDATE otp SET last_step = ? WHERE last_step < ?`, so a code accepted once is refused again in the same step on any device, and of two exchanges proving one code only the first finished wins. The same statement requires the enrolment the exchange was built on, and the first accepted code confirms the enrolment (A5 security review, item 3).
6. **A further device must prove the code before it can do anything else** (A4 open point 1). The account's first device, the owner device, is registered from the sign-up link's ticket, and every device after it starts `pending`, code or no code (A5 re-review, item 1). Until the first accepted code, only the owner device enrols, re-enrols or removes a device, and only the owner device can confirm the enrolment (A5 re-review, item 2). The first accepted code confirms it and holds back every other live device (the `otp_confirmed` trigger, item 3). A pending device reaches only `/nonce`, `/unlock/start` and `/unlock/finish`, and every other route answers `no-device`, as for an unknown device; before the enrolment is confirmed its start answers `not-enrolled` and counts no try. An accepted code clears the flag. So the plan's "email + password + code" for a further device (§3.3) is `/signin` with the password, then the code through `/unlock`, which keeps the code inside CPace and bound to a registered device signature.
7. **Exchanges keep no tag.** An exchange row holds only keyed digests of the `tagA` values the service expects, with their steps. It dies at `CONFIRM_MS` (20 s, the lockout's confirm time) and is spent by its first finish, from its own device only. Every expected digest is compared with the engine's `sameHex`, with no early exit, so the time taken does not say which step matched.
8. **Every refusal at finish is `bad-code`.** A wrong code, an unknown, spent or expired exchange, and another device's exchange all answer the same. Nothing says whether the account, the device or the code was the wrong part. The one other refusal is `locked`, when the path closed after the start (A5 security review, item 5), and it comes before the code is compared, so it says nothing about the code.
9. **The lockout is the engine's, per account.** 3 wrong codes in one 30-second window lock that window, and 2 locked windows in a row or 4 in a day close the code path until the single-use emailed link reopens it (`limits.mjs`, unchanged). The state is one `limits` row per account, written by compare-and-swap on a version column, so tries sent together each see the others (6 parallel starts admit exactly 3). An exchange left unfinished counts as a wrong code once its confirm time passes. A state that cannot be read fails closed: the path counts as closed, and a link is mailed. A pending device's tries are not in this state: each pending device gets 3 a day, the account's pending devices 6 a day between them, each wrong one mails the owner at most hourly, and a closed path refuses them too (A5 security review, item 2; A5 re-review, item 3). A closed path refuses a finish as well as a start, so a try in flight when the path closes answers `locked` (item 5). Each try checks two steps, so a window is 6 guesses and 4 locked windows are 24 (item 6). Horae Zone adds one rule of its own: 12 wrong codes a day, from every device in the lockout together, close the path the same way, so a device that stops at 2 wrong codes a window is closed out at the 12th (A5 re-review, item 4, which closed open point 10).
10. **The lock mails go through the engine mailer, after the answer.** A window lock mails a plain note with no link. A closed path mails the link `HZ_REOPEN_BASE#<token>`, and a refused try mails a fresh link when the old one is missing or has expired. A reopen mails a note. No note carries a code, the seed, a tag, a ticket or any six-digit number. A failed send is audited `mail-failed`, after the refusal's own row, and the lock holds.
11. **The reopen link reopens the path and nothing else.** `/unlock/reopen` is open, takes exactly `{token}`, and answers exactly `{ok:true}`: no ticket, key or seed. The token is stored only as the engine's hash (in the state and in `reopen_hash`), it works once, and it expires after 24 hours (the engine's `UNLOCK_TTL_MS`). An unknown, spent or expired token answers `bad-link` alike. A failed reopen try renews no link, since a renewed token would reach no one.
12. **The ticket.** A right code answers `{ticket}`: base64url JSON `{v, account, device, at, exp, jti, kid}`, then `.`, then the service's raw ECDSA P-256 signature over `${TICKET_LABEL}.${payload}`, made with `HZ_TICKET_KEY`. A changed payload does not verify. `jti` is 128 random bits, new on every ticket, and `kid` is the RFC 7638 thumbprint of the signing key's public half (A5 security review, item 4).
13. **Shape and point checks before the lockout.** A malformed body, or a `Ya` that is not a valid ristretto255 point, is `shape` before anything is admitted, so it costs no try. An account with no code answers `not-enrolled` and counts nothing.

### Decisions for Kaleb

Safe defaults the plan does not fix.

| # | Point | Default now | Where |
|---|---|---|---|
| 1 | What the authenticator app shows for the entry | Issuer "Horae Zone", account "nooutco" | `OTP_LABEL` in `src/otp.js` |
| 2 | How long an unlock ticket lives | 5 minutes | `UNLOCK_LIMITS.ticketTtlMs` in `src/unlock.js` |
| 3 | The window-lock note: subject "Horae Zone: code entry paused", then "Three wrong authenticator codes were entered for this account within 30 seconds.", "Code entry for this account is paused for the rest of that 30-second window.", "No code was accepted." | As written | `windowNote` in `src/lockout.js` |
| 4 | The closed-path note: subject "Horae Zone: code entry closed", then which rule closed it, "Code entry stays closed until this link is opened:", the link, "Works once. Expires 24 hours after it was sent.", "Opening it reopens code entry only. A right code is still needed on the device." | As written | `closedNote` |
| 5 | The reopened note: subject "Horae Zone: code entry reopened", then "The reopen link was used. Code entry for this account is open again.", "A right authenticator code is still needed on the device.", "The link no longer works." | As written | `reopenedNote` |
| 6 | The skewed-clock line added to a lock note: "Some of these codes came from a device whose clock was off; a device clock set automatically gives codes that match." | As written | `CLOCK_LINE` |
| 7 | Lockout writes that collide: retry 8 times, then answer `slow-down` | 8 | `CAS_TRIES` in `src/lockout.js` |
| 8 | How long `limits` rows are kept (one small row per account that ever tried a code) | No purge | `src/retention.js` |

### Open points for the reviewer

| # | Point | Where | Proposed resolution |
|---|---|---|---|
| 1 | ~~A QR that is never scanned leaves the account enrolled with a seed nobody holds, and a second enrolment answers `enrolled`~~ | - | **Closed** by item 3 of the A5 security review: an enrolment stays unconfirmed and repeatable until the first accepted code |
| 2 | `/signin` itself still asks no code (plan §3.6 says "Email + password + code"). The pending rule (decision 6) gives the same gate | `src/signin.js`, `src/routes.js` | Accept the pending rule; revisit only if the client flow needs the code on the sign-in screen |
| 3 | Nothing consumes the unlock ticket yet, and its public key is not published. The key id is in (item 4 of the A5 security review) | `src/unlock.js` | A5b (`/pin/verify`) and A7 (the gatekeeper pins the key) consume it, under the verifier rules in item 4 |
| 4 | Changing `HZ_SEED_KEY` makes every seed box unopenable, and a start that cannot open its box fails after its try was admitted | `src/otp.js`, `src/unlock.js` | A rotation plan with the A3 one (A3 open point 5), before the first real account |
| 5 | Any registered device of the account that has proved the code can spend the account's tries and close the path for every device. That is the JanusMirror rule, and the lock notes tell the owner. A pending device no longer can (A5 security review, item 2) | `src/lockout.js` | Accept; removing the device (A4) stops it |
| 6 | The lock mail goes out through `ctx.waitUntil` (as A3 open point 3). If it is lost while the link is still live, the next refused try does not mail it again, so the path stays closed until the link expires and a fresh one is mailed (up to 24 hours) | `src/lockout.js` | Accept for now, or re-mail a live link at most once an hour on a refused try |
| 7 | Not run against a real Resend or a real `wrangler dev`, as in A3 open point 4 | - | The reviewer runs the `wrangler dev` smoke test in the test plan |
| 10 | ~~A non-pending device that stops at 2 wrong codes a window is never locked: 11,520 guesses a day, about 1.1% a day of hitting the code, with no note to the owner (item 6 of the A5 security review, measured)~~ | `src/lockout.js` | **Closed** by item 4 of the A5 re-review: 12 wrong codes a day per account close the path, in Horae Zone, with the engine's rule unchanged |

Fixed in this PR, RED first, so no longer open: points 8 (L2) and 9 (M3), below, and point 1 (item 3 of the A5 security review). The numbers of the other points are kept.

### Security review findings carried to A5

A5 was written before the A3 and A4 security review fixes landed and was rebased onto them. Two of those fixes had to reach the A5 routes too.

| Finding | Open point | RED | GREEN | Suites after |
|---|---|---|---|---|
| M3, enrol ticket not bound to keys | 9 | `234e058c` | the commit after `234e058c` | Horae Zone 161/161 |
| L2, removal mid-flight | 8 | `234e058c` | the commit after `234e058c` | Horae Zone 161/161 |

**M3 (medium), carried: `/otp/enrol` spent any live sign-in ticket of the account.** `/device/register` takes only the keys a ticket names, but enrolment took any live `/signin` ticket of the signing device's account, so a ticket seen in its 5 minutes could be spent by another of the account's devices to take the seed. Fix: `src/otp.js` reads the signing device's `sign_key` and `agree_key` and adds `AND key_digest = ?` (their `deviceKeyDigest`) to the spend. A ticket for other keys, or one bound to no device, answers `bad-ticket`, stores no seed and stays unspent. Every A5 test now enrols with a ticket signed in for the enrolling device's keys (`enrolTicket` in `test/helpers.mjs`).

Tests (`test/otp.test.mjs`): "enrolment spends only a ticket bound to the signing device's own keys" fails on `234e058c` (200 with a seed, expected 401 bad-ticket). "NEGATIVE CONTROL: a ticket bound to the signing device's keys enrols" passes on both.

**L2 (low), carried: a removal landing mid-flight did not stop an A5 write.** The A5 writes a device's request makes ran after `findDevice` and did not look again, so a device removed between the checks and its writes could still enrol or be handed an unlock ticket. Fix: the enrol ticket spend and the `otp` insert (`INSERT ... SELECT ... WHERE LIVE_DEVICE`), the exchange insert, the exchange spend, the `last_step` update and the pending clear each re-check `LIVE_DEVICE` in the same statement. When one finds no row, `findDevice` runs again, so a removed device answers `no-device` and a live one keeps its old answer (`bad-ticket`, `enrolled`, `bad-code`). A removal noticed by the exchange spend or the step update leaves the code unused for the account's live devices. A removal noticed only by the pending clear comes after the code was accepted, so that code is used up, but the device stays pending and gets no ticket. A start or exchange left unfinished by a removal ages past `CONFIRM_MS` and counts as a try, as any abandoned one does (decision 9).

Tests (`test/otp.test.mjs`, `test/unlock.test.mjs`): the removal lands right after a named statement, through the `removedMidFlight` helper, now shared in `test/helpers.mjs`. "L2: a device removed after its signed enrol passed the checks gets no seed, and the ticket stays unspent", "L2: a device removed after its enrol ticket was spent stores no seed", "L2: a device removed after its signed start passed the checks gets no exchange", "L2: a device removed after its signed finish passed the checks gets no ticket, and the code is not used up", "L2: a device removed after its exchange was spent does not use up the code" and "L2: a device removed after its code was accepted gets no ticket and stays held back" fail on `234e058c`. Each failure is a 200 carrying a seed, an exchange or a ticket. The two L2 negative controls (a removal of some other device stops nothing) pass on both.

### The A5 security review (head `77305fc0`)

A security review of PR #244 at `77305fc0` asked for six fixes before merge. Items 1 to 5 are test first: the new tests fail on `77305fc0` (or on the item before) and pass after the fix, one commit per item. Item 6 asked for a note, not a change, so its two tests measure the code as it is and pass before and after.

| Item | Finding | Commit | Suites after |
|---|---|---|---|
| 1 | HIGH, a password thief can enrol the authenticator first | the commit after `77305fc0` | Horae Zone 164/164, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 2 | MEDIUM, a pending device (password only) can keep the code path closed | the commit after item 1's | Horae Zone 170/170, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 3 | MEDIUM, an unclaimed seed means permanent lock-in | the commit after item 2's | Horae Zone 176/176, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 4 | MEDIUM, the unlock ticket has no jti or kid | the commit after item 3's | Horae Zone 178/178, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 5 | LOW, `/unlock/finish` does not refuse while the path is closed | the commit after item 4's | Horae Zone 180/180, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 6 | LOW, note that each start allows the current and the previous step | the commit after item 5's | Horae Zone 182/182, engine 68 (67 pass, 1 skip), profile-api 195/195 |

**Item 1 (high): a password thief could enrol the authenticator first.** On an account with no `otp` row, a device registered with the password alone was not pending, since nothing marks a device pending before enrolment. So whoever held the password signed in, registered a device of its own, enrolled, and took the seed. Enrolment then marked the owner's devices pending, and a pending device cannot reach `/device/remove`, so the owner could not remove the thief's device.

What changed (`src/otp.js`):
- `/otp/enrol` succeeds only for the account's sole live device. The ticket spend and the `otp` insert each carry `(SELECT COUNT(*) FROM device WHERE account_id = ? AND removed_at IS NULL) = 1` beside `LIVE_DEVICE`, in the same statement, so a device registered between the two still blocks the enrolment.
- A second live device answers the new refusal `enrol-blocked` (409). A spend refused that way leaves the ticket live, so once one device has removed the other the sole one enrols with the same ticket. When the insert is what refuses, the answer is `enrolled` if the account has a seed and `enrol-blocked` if not.
- Before enrolment no device is pending, so either of two live devices can remove the other through `/device/remove`, as A4 already allowed. The statement that marked the other devices pending at enrolment is gone: with the sole-device rule there are none to mark. A device registered after enrolment still starts pending (`src/devices.js`, unchanged).

Tests (`test/otp.test.mjs`): "A5 review 1: a second registered device cannot enrol", "A5 review 1: the probe (password thief registers and tries to enrol first) ends with the thief refused and removed" and "A5 review 1: a device registered between the ticket spend and the seed insert blocks the enrolment" fail on `77305fc0`, each with a 200 carrying a seed where `enrol-blocked` is expected. "A5 review 1 NEGATIVE CONTROL: a removed device does not count, so the sole live device enrols" passes on both. The old test "a device registered before enrolment must prove a code after it" described the hole and is replaced by the first of these. The two L2 enrol tests no longer register a second device first, since a second device now blocks the enrolment before the removal could matter. `test/helpers.mjs` gains `landsMidFlight`, the general form of `removedMidFlight`.

Left as is (residual, for Kaleb): before enrolment the thief's device can remove the owner's device just as the owner can remove the thief's, and then enrol as the sole live device. The owner would then sign in again with the password, and the new device would be pending once the thief's enrolment is confirmed (item 3). The sole-device rule turns a silent race into a visible one (the owner sees a device it did not add, or loses its own); closing it needs a second factor before the first enrolment, such as the email code, which the review did not ask for.

**Item 2 (medium): a pending device could keep the code path closed.** A pending device has shown only the password, yet its tries at `/unlock/start` went into the account's lockout like any other device's. So a password thief who registered a device after enrolment could spend 3 wrong codes in one window and 3 in the next, close the path for the owner's devices, and do it again each time the owner opened the reopen link.

What changed:
- `src/unlock.js`: a start from a pending device is counted against that device's own cap, `PENDING_TRIES_PER_DAY` (3 in any 24 hours, a right code included), and never in the account's `limits` state. The count and the insert are one statement (`INSERT INTO pending_try ... WHERE LIVE_DEVICE AND (SELECT COUNT(*) ...) < 3`), so tries arriving together cannot pass the cap. Past the cap the start answers `locked` (423), the same word the account's lockout uses. A pending device's tries lock no window, close nothing and mail nothing. A non-pending device's start is admitted into the account's lockout exactly as before.
- A closed path still refuses a pending device (`pathClosed` in `src/lockout.js`, a read that writes nothing and counts an unreadable state as closed), and that refusal spends none of its tries and renews no link.
- `schema.sql`: new table `pending_try (device_id, at)`. `src/retention.js` purges rows a day old.
- `/unlock/finish` is unchanged: rejecting an exchange the account's state does not hold is a no-op in `limits.mjs`, so a pending device's wrong code is counted only by its start.

Tests: "A5 review 2: the probe (a pending device burns tries in two windows) leaves the owner's path open" and "A5 review 2: a pending device gets 3 tries a day, a right code included, then the next day 3 more" (`test/lockout.test.mjs`), "A5 review 2: a pending device's 3 tries a day hold when more arrive together" (`test/unlock.test.mjs`) and "a purge removes a pending device's tries once they are a day old" (`test/purge.test.mjs`) fail on `77305fc0`'s `unlock.js`, `lockout.js`, `retention.js` and `schema.sql`: the owner's right code in the thief's window answers 423 where 200 is expected, a fourth start is admitted where `locked` is expected, and `pending_try` does not exist. "A5 review 2 NEGATIVE CONTROL: a non-pending device's wrongs still close the path, for pending devices too" and "A5 review 2 NEGATIVE CONTROL: a pending device's tries are its own, so another pending device keeps its 3" pass on both. The existing test "three tries in one window are admitted even when more arrive together" used a pending second device to hold six nonces at once; that device now proves the code first, so all six starts still count in the account's window.

Left as is (residual, for Kaleb): the cap is per device, and a password thief can register more devices. `/signin` admits 20 tries per requester per hour (A4), so one address could add up to 20 pending devices an hour, each with 3 tries a day, and each try is checked against two steps. That cannot close the owner's path any more, but it is still a guess at the code. A per-account cap on pending tries would end it, at the price of letting the thief use up the owner's new-device tries too, and the sign-in limits were still being changed on `feat/horae-a3-a4` (merged to `dev` since, in #242). Nothing tells the owner about a pending device's tries either; the lock notes cover only the account's lockout. (Both closed by the A5 re-review, item 3: 6 pending tries a day per account, and a note to the owner.)

**Item 3 (medium): an unclaimed seed meant permanent lock-in.** The `otp` row was inserted `ON CONFLICT DO NOTHING`, and its existence alone made every later device pending. So a seed the owner never scanned (a QR closed too early, an app that did not save it) left the account enrolled with a seed nobody held: a repeat enrolment answered `enrolled`, and every further device stayed pending, with no code to prove. This closes A5 open point 1.

What changed:
- `schema.sql`: `otp` gains `enrolment` (counts enrolments, from 1) and `confirmed_by` (the device whose code confirmed it, null until then), and `exchange` gains `enrolment`, the one its replies were built on. The trigger `otp_confirmed` holds back every other live device of the account (`pending = 1`) in the same write that sets `confirmed_by`, so no device is left unheld by a Worker that stops between two statements.
- `src/otp.js`: while `confirmed_by` is null the enrolment is repeatable. The insert became an upsert, `ON CONFLICT DO UPDATE SET box = excluded.box, created_at = excluded.created_at, enrolment = otp.enrolment + 1 WHERE otp.confirmed_by IS NULL`, under the same fresh ticket (M3) and the same sole-live-device rule (item 1) in the ticket spend and the write. A repeat answers a new seed and replaces the old one. Once confirmed, a repeat answers `enrolled` with no seed; a refused write answers `enrol-blocked` while unconfirmed.
- `src/unlock.js`: a start reads the enrolment and stores it on the exchange. The accept is still one statement and now also requires `enrolment = ?` (the exchange's) and sets `confirmed_by = COALESCE(confirmed_by, <device>)`, so the first accepted code confirms the enrolment, and an exchange started on a replaced seed answers `bad-code` and accepts nothing.
- `src/devices.js`: a device registered later starts pending only when the account's enrolment is confirmed (`EXISTS (SELECT 1 FROM otp WHERE account_id = ? AND confirmed_by IS NOT NULL)`).

Tests (`test/otp.test.mjs`): "A5 review 3: a repeated enrol before the first accepted code returns a new seed and invalidates the old one", "A5 review 3: an exchange started on the old seed is refused once a repeat enrol replaced it", "A5 review 3: a repeat enrol keeps the sole-live-device rule, and the old seed stays", "A5 review 3: only a confirmed enrolment makes other devices pending" and "A5 review 3: a device registered while the confirming code is in flight is held back" fail on `77305fc0` and on item 2's commit (`d2e59ad9`): a repeat answers 409 `enrolled` where 200 with a new seed is expected, a second device is pending (and refused `no-device`) before any code was accepted, and a device registered mid-flight stays unheld. "A5 review 3: after the first accepted code, a repeat enrol answers enrolled with no seed" passes on both, as a guard. The plan test "the seed is returned once and never again" now proves a code before its repeat enrolment, so the repeat still answers `enrolled`. `test/helpers.mjs` gains `confirmedDevice` (an enrolled device that proved its first code, the clock one step on), used where a test needs a pending second device: "a device registered after the first accepted code reaches only /nonce and /unlock until it proves a code" (renamed), three tests in `test/unlock.test.mjs` and the four item 2 tests in `test/lockout.test.mjs`. The purge test's exchange fixture names the new `enrolment` column, so it also fails on the old schema.

Left as is (residual, for Kaleb): the window of item 1's residual now runs until the first accepted code rather than until enrolment. Before it, a thief's device that registered with the password is not pending, so it can remove the owner's device and enrol again as the sole live device, and its wrong codes count in the account's lockout like the owner's (item 2 covers only pending devices). The owner sees the change: a device it did not add, or its own refused. Closing it needs a second factor before the first code, as for item 1.

**Item 4 (medium): the unlock ticket carried no jti or kid.** The ticket named the account, the device and its lifetime, and nothing that set one ticket apart from another issued in the same millisecond, or said which key signed it. So a verifier could not record a ticket as used, and a rotated `HZ_TICKET_KEY` would leave a verifier trying every key it holds (A5 open point 3).

What changed (`src/unlock.js`):
- `signTicket` adds `jti`, 16 random bytes from `crypto.getRandomValues` (base64url, 22 characters), new on every ticket.
- `ticketKey` returns the signing key with its `kid`, the RFC 7638 JWK thumbprint of the public half: base64url SHA-256 over `{"crv","kty","x","y"}` in that order with no spaces, worked out from `HZ_TICKET_KEY` itself, so no new secret or setting is needed and the kid changes when the key does. Both claims are inside the signed payload. `v` stays 1, since nothing has consumed a ticket yet.

What the A5b verifier (`/pin/verify`) must do, recorded here so it is built in, not added later:
- Read `kid` from the payload, pick that public key from the keys it trusts, and refuse a kid it does not hold, before it checks the signature with that key. It never takes a key from the ticket.
- Record each `jti` as spent in the same write that accepts the ticket (one ticket, one use), so a ticket seen once cannot be spent again in its 5 minutes. A spent `jti` may be purged after the ticket's `exp`.
- Accept a ticket only on a request signed by the device the ticket names (`device`), the same per-request signature every Horae Zone device route checks, so a ticket lifted from one device's traffic does nothing for another.

Tests (`test/unlock.test.mjs`): "A5 review 4: the ticket claims carry a random 128-bit jti, new on every ticket, and the kid of the key that signed it" and "A5 review 4: the kid selects the verification key, and a ticket does not verify under the other key" fail on item 3's commit (`7674e0d2`): the claims have no `jti` and no `kid`, so the kid picks no key. The second test runs the service under two keys in turn, holds both public keys in a ring keyed by the thumbprint worked out in the test (not by the service's code), and checks the kid picks the signer and the other key does not verify. The plan test "NEGATIVE CONTROL: a correct code, account and device returns a ticket" now expects the two new claims and fails the same way on `7674e0d2`.

Left as is: the spent-`jti` ledger and the device-signed request belong to the verifier, which A5b builds; this PR has no consumer to put them in.

**Item 5 (low): `/unlock/finish` did not refuse while the path was closed.** A closed path refused every start, but a start admitted while the path was still open could reach `/unlock/finish` in its 20 seconds after other tries closed it, and a right code there was accepted and answered a ticket. The lockout exists to stop codes being tried, so a try in flight when it closes should stop too.

What changed (`src/unlock.js`):
- After the exchange is spent and before its code is compared, `closedAtFinish` settles the account's lockout (one compare-and-swap write through `ruleLimits`, as every try makes) and reads whether the path is closed. If it is, the finish answers `locked` (423), the word a refused start uses, and signs no ticket.
- The refused exchange stays spent, and its try is dropped from the lockout's pending list without counting as a wrong code, since no code was compared. A closed path whose link has died gets a fresh link mailed, as a refused start does; a live link is not mailed again.
- On an open path nothing changes: the code is compared and accepted or rejected as before, and any notes the settling produced go out with the finish's own.

Tests (`test/lockout.test.mjs`): "A5 review 5: /unlock/finish refuses while the path is closed, a right code started before it closed included" fails on item 4's commit (`b3a14eba`) with only `src/unlock.js` put back: the finish answers 200 with a ticket where 423 `locked` is expected. It starts a right code 5 seconds before the end of a window, closes the path in the next window with the fourth locked window that day, then finishes; it also checks the audit row, the empty pending list, that no mail is sent again, that the exchange is spent, and that after the link a right code works. "A5 review 5 NEGATIVE CONTROL: a locked window that leaves the path open does not refuse a finish begun before it" passes on both. `test/helpers.mjs` splits `tryCode` into `startCode`, whose finish can be sent later.

Left as is: the check and the accept are two statements, so a path that closes between them still accepts that one finish. Its start was admitted while the path was open and its code is right, so it is no extra guess.

**Item 6 (low): each start allows the current and the previous step.** `/unlock/start` answers two CPace replies, one for the current 30-second step and one for the previous step (never the next, and never a step at or before the last accepted one), so one try checks two codes. The lockout counts tries, not codes: 3 tries in a window are 6 guesses, and the 4 locked windows that close the path in a day are 12 tries, 24 guesses. Each guess is against a 6-digit code, so one try has 2 chances in a million, a full window 6 in a million, and 24 guesses before the path closes 24 in a million. After the owner opens the reopen link the 4 locked windows are still in the day, so the next locked window closes the path again (6 more guesses).

Why the previous step is acceptable: a code read in the last seconds of its step is often typed and sent after the step has turned, and a phone clock a few seconds slow shows the previous code; refusing those would make the owner's right code fail at random. RFC 6238 (section 5.2) recommends at most one step back for this network delay. The cost is a doubled chance per try, which the numbers above already count, and no forward step is offered, so a code read early never widens the set.

What the review's "at most 24 a day" does not cover (measured, open point 10): the lockout counts wrong codes per 30-second window, not per day, so a non-pending device that stops at 2 wrong codes a window never locks a window, never closes the path and sends the owner no note. That is 2 tries x 2 steps = 4 guesses a window, 2,880 windows a day, 11,520 guesses a day, about 1.1% a day of hitting the code and about 29% over 30 days. Only a live, non-pending device of the account can do it (a pending device has its 3 tries a day, item 2), so the case is a copied device key without the owner's phone, or a thief's device before the first accepted code (item 3's residual). The agent does not think that is acceptable for a copied device key, and the fix changes the engine's lockout rule (JanusMirror ruling 4), so it is left for Kaleb. (Closed by the A5 re-review, item 4: 12 wrong codes a day per account close the path, a Horae Zone rule over the engine's state, so the engine and JanusMirror are unchanged.)

Tests (`test/lockout.test.mjs`): "A5 review 6: one start answers for two steps, so a full window is 6 guesses and four locked windows are 24" (a start's two replies, a fourth try in a window refused, the fourth locked window closing the path) and "A5 review 6: a guesser who stops at 2 wrong codes a window is never locked (the 24 a day bounds locked windows only)" (20 windows of 2 wrong codes, 80 guesses, then no locked window, no closed path, no lock note and a right code accepted). Both pass on item 5's commit (`e5dd81b8`) as well as after, since item 6 changes no code; they pin the numbers the note states. The existing tests "the previous step's code is accepted" and "a code two steps old, or the next step's, is refused" (`test/unlock.test.mjs`) pin the two steps offered.

### The A5 re-review (head `2bda9022`): ownership comes from the email inbox

A re-review of PR #244 at `2bda9022` said do not merge. Two holes were left by the residuals of items 1 to 3 above: the sole-device rule fell to the password alone (before the first accepted code a thief's device was not pending, so it could remove the owner's device and enrol, or replace the seed nobody had confirmed yet), and the pending-device cap was per device, so a thief with many devices had many caps. The reviewer's probes F1 to F4 are the RED tests.

**The root rule: ownership comes from the email inbox, not the password.** Whoever can open the sign-up link owns the account. The password signs a further device in, and that device can do nothing that changes the account until it proves the code.

| Item | Change | Probe | Commit | Suites after |
|---|---|---|---|---|
| 1 | The owner device comes from the sign-up link; every later device starts pending | F1, F2 | the commit after `2bda9022` | Horae Zone 219/219, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 2 | Pending devices change nothing; only the owner enrols, re-enrols or removes before confirmation | F1, F2 | the commit after item 1's | Horae Zone 225/225, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 3 | At most 6 pending tries per account a day, and each wrong one mails the owner | F3 | the commit after item 2's | Horae Zone 230/230, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 4 | At most 12 wrong codes per account a day from any device (open point 10) | daily cap | the commit after item 3's | Horae Zone 234/234, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 5 | Before confirmation a non-pending device's wrongs still count toward the account limits, and only the owner device can be one | F4 | the commit after item 4's | Horae Zone 236/236, engine 68 (67 pass, 1 skip), profile-api 195/195 |

**Item 1: the owner device comes from the sign-up link.** Before this, the first device of an account was whichever device signed in first with the password, and until the first accepted code no device was pending.

What changed:
- `src/signup.js`: `/account/email/verify` takes `{email, code, password, keyDigest}` and answers `{ok, ticket}`. The ticket registers the account's first device, bound to the keys `keyDigest` names (as a `/signin` ticket is since M3), and is stored like one, as a keyed digest marked `owner = 1`. The account and its owner ticket go in one batch, so an account never exists without one. A verify without `keyDigest` answers `shape` and makes no account.
- `src/devices.js`: an owner ticket is spent only while the account has no device, removed ones included, and the device it registers is marked `owner = 1` and not pending. Every other device starts `pending = 1`, whether or not a code is enrolled or confirmed (before, a device started pending only once the enrolment was confirmed).
- `src/signin.js`: the right password on an account with no device yet answers the new refusal `no-owner-device` (403), stores no ticket, and mails the owner a note at the address sealed at sign-up, at most one an hour per account (`owner-alert` throttle bucket). The note carries no password, connecting address or link. A wrong password still answers `bad-login`, and mails nobody.
- `schema.sql`: `device.owner` and `ticket.owner` (changed in place, since no database exists yet). `device.pending` now defaults to 1, so a row written without it is held back rather than let through.
- The routes are unchanged: a pending device already reached only `/nonce`, `/unlock/start` and `/unlock/finish`, and got `no-device` everywhere else. With every non-owner device pending from registration, a password thief's device reaches neither `/device/remove` nor `/otp/enrol`, so F1 and F2 end with the thief refused.

Tests (new file `test/owner.test.mjs`): "owner: the sign-up verify answers a ticket that registers the account's first device as its owner, not pending", "owner: the sign-up ticket registers only the keys it was verified for, once", "owner: a verify without a key digest is refused as shape and makes no account", "owner: a password-only sign-in on an account with no device yet is refused, stores no ticket, and mails the owner", "owner: the refused sign-in mails the owner at most once an hour", "owner: a device registered from a password sign-in starts pending, before any code is enrolled", "probe F1: a password thief cannot remove the owner's device and enrol" and "probe F2: a password thief cannot swap the owner's unconfirmed seed". All fail on `2bda9022`, run under that commit's own helpers: F1 and F2 because the thief's `/device/remove` of the owner's device answers 200, the others because the verify refuses `keyDigest` as shape or there is no `owner` column. "owner NEGATIVE CONTROL: a wrong password on an account with no device answers bad-login and mails nobody" passes after.

Older tests that described the old design were rewritten to the root rule, each in the same commit: in `test/otp.test.mjs` the item 1 and item 3 tests now expect the second device to be pending (`no-device` at `/otp/enrol` and `/device/remove`) and the owner device to remove it, and "A5 review 3: only a confirmed enrolment makes other devices pending" became "A5 re-review: a device registered before the first accepted code is pending from the start, and stays so after it". `test/helpers.mjs` `signUp` now registers the owner device from the sign-up ticket, as the app does next (`owner: false` stops after the verify), and `registeredDevice` registers a fresh account's first device the same way. Tests in `test/devices.test.mjs` that count sign-in tickets and devices leave the owner's out, and the A3 tests in `test/signup.test.mjs` check the verify's ticket for shape before comparing the rest.

Left as is (open, for Kaleb): an owner ticket lives 5 minutes. If the app never registers the owner device in that time (it crashed, the network dropped), the account has no device and no way to get one: a sign-in is refused by this item, and a new sign-up start for the address mails nothing, since the address has an account (A3, M1). The agent proposes that a sign-up start for an address whose account has never had a device mails a fresh link whose verify hands out a new owner ticket, RED first, in this PR or before the first real account. The final re-review raised this as MEDIUM-1, and it is closed after the merge (see "The final A5 re-review" below).

**Item 2: pending devices change nothing, and before confirmation only the owner device changes the account.** After item 1 the routes already kept a pending device out of `/device/remove` and `/otp/enrol`, which is why F1 and F2 passed. Three gaps were left: the sole-device rule still counted pending devices, so a password thief could keep the owner from enrolling by registering devices (20 an hour); a pending device holding the seed could prove the first code, which confirmed the enrolment and, through the `otp_confirmed` trigger, held the owner device back; and the writes checked only that the caller was not removed, so a device that was not the owner, or was held back mid-flight, was stopped only by the route check before the handler.

What changed:
- `src/checks.js`: `ACCOUNT_CHANGER`, a condition bound to a device id: the device is live and not pending, and until the account's enrolment is confirmed it is also the owner device. `mayChangeAccount(db, id)` reads it without writing.
- `src/otp.js`: the ticket spend and the seed insert carry `ACCOUNT_CHANGER` in place of the sole-device rule. A device that is not the owner answers the new refusal `not-owner` (403), and its ticket stays live. A pending device no longer blocks the owner's enrolment, and `enrol-blocked` is retired.
- `src/devices.js`: `/device/remove` answers `not-owner` unless the caller may change the account, and both of its writes (the nonce spend and the removal) carry `ACCOUNT_CHANGER`, so a caller held back after the check removes nothing. After the first accepted code, any device that has proved a code may remove another, the owner device included.
- `src/unlock.js`: before the enrolment is confirmed, a pending device's `/unlock/start` answers `not-enrolled` (409) and counts no try, since there is nothing it may prove yet. The `last_step` update also requires, while `confirmed_by` is null, a device that may change the account, so only the owner device confirms the enrolment and the trigger never holds the owner device back.
- No schema change. Before confirmation only the owner device can be non-pending, which is what item 5 (probe F4) relies on.

Tests (`test/owner.test.mjs`): "re-review 2: a password thief's pending device does not block the owner's enrolment", "re-review 2: a pending device cannot confirm the enrolment, so the owner device is never held back", "re-review 2: before the first accepted code, a device that is not the owner cannot enrol or remove, even when not pending" (a row changed by hand), "re-review 2: the enrolment re-checks the owner flag in its own writes" and "re-review 2: a removal re-checks the caller's standing in its own writes" fail on item 1's commit (`97ad5276`): the owner's enrolment answers 409 `enrol-blocked`, the pending device's start answers 200 and its code confirms the enrolment, the hand-changed device removes the owner device (200), the seed is stored after the owner flag was cleared mid-flight, and the owner device is removed after the caller was held back mid-flight. "re-review 2 NEGATIVE CONTROL: after the first accepted code, a device that proved a code may remove another, the owner's included" passes on both. In `test/otp.test.mjs` the two sole-device tests became "A5 re-review 2: a second registered device cannot enrol, and does not block the owner device" and "A5 re-review 2: a device registered between the ticket spend and the seed insert is pending and does not block the enrolment" (both fail on `97ad5276` with 409 `enrol-blocked`), and "A5 review 3: a repeat enrol keeps the sole-live-device rule" became "A5 re-review 2: a repeat enrol is the owner device's alone, so a pending device leaves the old seed". Two L2 tests in `test/unlock.test.mjs` had a pending second device prove the first code after the owner device was removed; they now start from a confirmed enrolment and still check that a removal mid-flight uses up no code. Probes F1 and F2 pass.

Left as is (open, for Kaleb): if the owner device is removed before the first accepted code (by itself, since no other device may), the account has no device that may enrol or confirm, and a sign-in only adds pending devices that answer `not-enrolled`. This is the same stranded account as the owner-ticket residual of item 1, and the same remedy (a fresh sign-up link while the account has no confirmed code) would cover both. The MEDIUM-1 fix below does not cover it: that fix keeps the owner ticket's own rule (no device ever registered, removed ones included), so an account whose owner device was registered and then removed still waits for A6 recovery.

**Item 3: the pending devices of an account share one cap, and the owner hears about their wrong tries.** Before this, each pending device had 3 tries a day of its own (A5 security review item 2), so a password thief who registered 8 devices had 24 tries a day, 48 guesses, and the owner was told nothing.

What changed:
- `src/unlock.js`: `PENDING_TRIES_PER_ACCOUNT_DAY` (6). A pending device's start is admitted only while the account's pending tries in the last 24 hours, from all its pending devices together, are under 6, and the device's own under 3 (kept, so one device cannot spend the account's 6 alone). Both counts and the insert are one statement, so tries arriving together from several devices cannot pass either cap. The rows are counted by account id, so removing a device gives none of its tries back.
- `src/unlock.js`, `src/lockout.js`: a wrong code from a pending device at `/unlock/finish`, and a pending start refused at either cap, mail the owner the pending note at the address sealed at sign-up, at most one an hour per account (`pending-alert` throttle bucket). The refusal at the cap is what reaches the owner when a thief starts tries and never finishes them: an unfinished start has no answer to mail about. A right code from a pending device mails nothing. The note carries no code, seed, link, password or count beyond the rule.
- `schema.sql`: `pending_try.account_id` and the index `pending_try_account_at` (changed in place, since no database exists yet).

Tests (`test/owner.test.mjs`): "probe F3: 8 pending devices with 3 tries each get at most 6 tries a day between them, and the owner is mailed", "re-review 3: the account's 6 pending tries a day hold when tries from several devices arrive together", "re-review 3: the account's pending tries are counted for a day from each try, and removing a device gives none back", "re-review 3: each wrong pending try mails the owner, at most one note an hour, and a right one mails nothing" and "re-review 3: pending tries started and never finished mail the owner once the account's cap refuses one" fail on item 2's commit (`88aa4e8b`): F3 admits 24 tries where 6 are expected, the parallel starts admit 9, a third device's right code is admitted past the account's 6, and no pending note is sent. "a purge removes a pending device's tries once they are a day old" (`test/purge.test.mjs`) now writes `account_id` and fails there on the missing column. The item 2 tests in `test/lockout.test.mjs` and `test/unlock.test.mjs` (3 tries per device, a second pending device keeps its own) pass on both, since 3 plus 1 is under 6.

Left as is (accepted cost, for Kaleb): the account's 6 are shared with the owner's own new devices, so a thief who spends them holds back the owner's second phone until a day after the thief's tries. The owner's proved devices are never held back, and the note tells the owner the password is known.

**Item 4: 12 wrong codes a day close the path (open point 10).** Before this, the lockout counted wrong codes per 30-second window only, so a device that stopped at 2 wrong codes a window never locked a window, never closed the path and sent the owner no note: 11,520 guesses a day (item 6 of the A5 security review, measured).

What changed:
- `src/lockout.js`: `WRONG_PER_ACCOUNT_DAY` (12). Wrong codes from every device in the account's lockout count toward one cap over the last 24 hours, whatever window they fall in, and the 12th closes the code path until the single-use link, as the other rules do, with the same closed-path note ("12 wrong authenticator codes were entered for this account in one day.") and link. The count is read from the engine state's own window records, which already keep a day, so there is no new column or table. `capDay` closes the path only in a ruling that added a wrong code, so the link reopens a path at the cap, and the next wrong code that day closes it again with a new link (as a fresh locked window does after a reopen under the engine's rules). `dayHasRoom` counts tries in flight as wrong until they settle, so tries arriving together never pass the cap, and a path the link reopened at the cap takes one try at a time.
- `src/unlock.js`: the three rulings (the admit at `/unlock/start`, the closed-path check and the settle at `/unlock/finish`) use the capped settle, and a wrong code at finish is capped too.
- `packages/account-engine/src/limits.mjs` is unchanged. The rule is Horae Zone's, layered on the engine's, since JanusMirror shares the engine (its ruling 4) and a Mac has one device.
- A pending device's tries stay out of this count. They have their own caps (3 a device, 6 an account a day, item 3), and keeping them out of the lockout is what stops a password thief locking the owner out (A5 security review item 2). So the most guesses an account takes in a day, from every device, are 12 tries in the lockout and 6 pending tries, each checking two steps: 36 guesses, about 0.004% a day of hitting the code.

Tests (`test/lockout.test.mjs`): "re-review 4: a guesser who stops at 2 wrong codes a window closes the path at the 12th wrong code of the day, and the owner gets the link", "re-review 4: wrong codes from every device that proved a code count toward the one cap", "re-review 4: tries arriving together never pass the day cap" and "re-review 4: after the link one more wrong code closes the path again, and a wrong code counts for a day" fail on item 3's commit (`07d710af`): the 12th wrong code leaves the path open, 6 wrong codes from each of two devices close nothing, and 3 tries started together with 10 wrong codes behind them are all admitted. "re-review 4 NEGATIVE CONTROL: 11 wrong codes in a day leave the path open and mail nothing" passes on both. The measuring test "A5 review 6: a guesser who stops at 2 wrong codes a window is never locked" pinned the old behaviour and was replaced by the first of these. "A5 review 5: /unlock/finish refuses while the path is closed, a right code started before it closed included" had the owner device start a right code with 9 wrong codes behind it and then lock a fourth window, 13 tries; the day cap now refuses the 13th, so no rule can close the path while one of the lockout's own tries is in flight, and the test's in-flight right code now comes from a pending device, whose tries are counted outside the lockout. Its assertions are unchanged.

**Item 5: before confirmation only the owner device's wrong codes reach the account's limits (probe F4).** The design was already that a non-pending device's wrong codes count toward the account's lockout before the first accepted code, as after it. On `2bda9022` that was the hole F4 names: before the first accepted code a password thief's device was not pending, so its wrong codes were the account's, and 6 of them (3 in one window, 3 in the next) locked a window, closed the owner's path and left the owner's right code answering `locked`. The rule stays as designed because, since item 1, only the owner device can be non-pending before confirmation.

What changed: no code in this item. Item 1 made the thief's device pending from registration, so its tries left the lockout (on item 1's commit `97ad5276` the thief got 3 pending tries and the owner's path stayed open), and item 2 gave a pending device no try at all before confirmation (`not-enrolled`, from item 2's commit `88aa4e8b` on). This item adds the probe that pins both halves.

Tests (`test/owner.test.mjs`): "probe F4: before the first accepted code a password thief spends none of the account's limits, and the owner device's wrongs still count" (the thief's device makes 12 wrong tries over 4 windows and is admitted none, each start answering `not-enrolled`, no lock note goes out and the enrolment stays unconfirmed; then the owner device's 3 wrong codes lock a window, 3 more in the next window close the path, and its right code answers `locked`). It fails on `2bda9022`, run under that commit's own helpers as for item 1: 6 of the thief's tries are admitted where 0 are expected, and a scratch copy of the test measured what they did there (the "code entry paused" then "code entry closed" notes to the owner, and the owner's right code answering 423 `locked`). It fails on `97ad5276` too (3 pending tries admitted, the owner's path open) and passes from `88aa4e8b` on. "probe F4 NEGATIVE CONTROL: before the first accepted code the owner device's right code still confirms after the thief's tries" passes on all three.

**Decisions for Kaleb (re-review).**

| # | Point | Default now | Where |
|---|---|---|---|
| 1 | The account's first device, the owner device, is registered only from the sign-up email link; the password alone never registers a first device | As written | `src/signup.js`, `src/devices.js`, `src/signin.js` |
| 2 | The note when the password signs in to an account with no device: subject "Horae Zone: sign-in refused", then "The password for this account was used to sign in.", "The account has no device yet, so the sign-in was refused and no device was added.", "An account's first device is registered only from the sign-up email." At most one an hour per account | As written | `OWNER_ALERT` in `src/signin.js` |
| 3 | A pending device no longer blocks the owner's enrolment (the sole-device rule of A5 security review item 1 is retired, since only the owner device may enrol before the first accepted code) | As written | `src/otp.js` |
| 4 | Before the first accepted code a pending device gets no try at all (`not-enrolled`), so the owner device is the one that confirms the enrolment; a second phone of the owner's waits for that code | As written | `src/unlock.js` |
| 5 | The pending devices of an account get 6 code tries a day between them (each device still at most 3), counted by account id | 6 a day | `PENDING_TRIES_PER_ACCOUNT_DAY` in `src/unlock.js` |
| 6 | The note when a pending device's code is wrong or refused at a cap: subject "Horae Zone: code refused on a new device", then "A device signed in with this account's password tried an authenticator code, and the code was not accepted.", "Devices that have not yet proved the code get 6 tries a day for this account, all of them together.", "The device can change nothing on the account until it proves a code." At most one an hour per account | As written | `pendingNote` in `src/lockout.js` |
| 7 | 12 wrong codes in 24 hours, from every device in the account's lockout together, close the code path until the emailed link; after the link, the next wrong code that day closes it again. A pending device's tries are not counted here (they have their own 6 a day) | 12 a day | `WRONG_PER_ACCOUNT_DAY` in `src/lockout.js` |
| 8 | The closed-path note for the day cap opens "12 wrong authenticator codes were entered for this account in one day." and goes on as the other closed-path notes | As written | `closedLine` in `src/lockout.js` |
| 9 | R1 stays: the sign-in ceiling per address is 1000 wrong passwords an hour from everyone. Guessing a password of 12 or more characters at that rate is negligible, the requester and pair caps still bound one guesser, and the code behind the password is now held by the account-wide caps (6 pending tries a day, item 3; 12 wrong codes a day, item 4), so a password that does fall opens no more than a pending device | 1000 an hour | `SIGNIN_LIMITS.perAddressHour` in `src/signin.js` |

### The final A5 re-review: merge, then MEDIUM-1 fixed on its own branch

The final security re-review of PR #244 said merge, and PR #244 merged to `dev` on 4 Oct 2026 (`1c4aae05`). It left one MEDIUM finding and one LOW finding. MEDIUM-1 is fixed on `fix/horae-owner-ticket`, off `dev`, in its own PR. LOW-1 is accepted.

| Item | Change | Commit | Suites after |
|---|---|---|---|
| 1 | A start for an account that has never had a device mails a fresh, live link | `076ea0e0` | Horae Zone 282/282, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 2 | That link, verified with the account's password, answers a new owner ticket and voids any older one still unspent | `ace329bb` | Horae Zone 288/288, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 3 | Accounts with a registered device are unchanged (a negative control) | `df0ad913` | Horae Zone 289/289, engine 68 (67 pass, 1 skip), profile-api 195/195 |

The engine suite runs under node, Chromium and workerd (`test/runtimes.test.mjs`).

**MEDIUM-1 (medium): a client that missed the owner ticket left the account dead until A6.** The sign-up verify hands out the owner ticket, live 5 minutes (`OWNER_TICKET_TTL_MS`). If the client crashed or was slow and did not register in that time, `/device/register` answered 401 `bad-ticket`, the owner's `/signin` answered 403 `no-owner-device` (re-review item 1), and a fresh sign-up start for the same address mailed nothing, since the address had an account (M1, security review). Nothing could reissue a ticket, so the account had no way in until A6 recovery. No attacker is involved, and the fix must not open a way for one.

The root rule stays: ownership comes from the email inbox, not the password. So for an account that has never had a device, removed ones included (the rule the owner ticket is spent under in `src/devices.js`, kept exactly), a fresh single-use email link is the way back in.

What changed:
- `src/signup.js` `mintCode`: the row a start writes is born spent only when the address has an account that has had a device (`HAS_HAD_DEVICE`, removed ones included). An account that has never had a device gets a live row and the link is mailed, as for an address with no account. It is the same single `INSERT`, so the mint rules hold unchanged: one live link at a time, the 10-minute link life, the re-send and mailbox caps, the closed wording, and the answer `{ok:true}` for every start. A start runs the same statements for a deviceless account, a deviced account and no account, so an outsider learns nothing about whether the address has an account.
- `src/signup.js` `verifySignup`: once the link is spent, an address that has an account goes to the new `reissueOwnerTicket`. It checks the password against the account's login hash and salt. A wrong password answers `bad-login` (401), the link is already spent, and the account is unchanged. A right one runs one batch that voids every unspent owner ticket of the account and inserts a new owner ticket bound to the presented `keyDigest`, live 5 minutes, only while the account still has no device, removed ones included. If a device landed after the link was minted, no ticket is stored and the answer is `bad-code` (401). The account itself (its password and sealed address) is not touched, and the sign-up path for a new address is unchanged.
- `schema.sql`: the `challenge` comment names the deviceless-account case. No column changed.

Tests (new file `test/relink.test.mjs`, 11 tests). These were RED first, on the commit before each item:
- "MEDIUM-1: a start for an account that has no device mails a fresh, live link" and "MEDIUM-1: a deviceless account keeps the mint rules: one live link at a time, re-sent inside the re-send cap" fail on `1c4aae05` (nothing is mailed).
- "MEDIUM-1: the review's sequence ends with a fresh link, verify, a new owner ticket, register 200 and one owner device" runs the review's sequence (verify, no register, 6 minutes later register 401 and signin 403) and then a fresh link, verify 200 with a new ticket, register with other keys 401, register with the bound keys 200, and one owner device that is not pending. "MEDIUM-1: a wrong password spends the fresh link and issues nothing", "MEDIUM-1: a new owner ticket voids an older one still unspent" and "MEDIUM-1 NEGATIVE CONTROL: two verifies of one fresh link together issue one ticket" fail with them on `076ea0e0` (the verify answers `bad-code` and issues no ticket).

The negative controls pass on the commit before their item and after it (the deviced-link control needs item 1's fresh link, so it runs from `076ea0e0` on):
- "MEDIUM-1 NEGATIVE CONTROL: the password alone still gets no ticket" (`/signin` answers `no-owner-device`, a made-up code answers `bad-code`, no live ticket of any kind).
- "MEDIUM-1 NEGATIVE CONTROL: a start for an account with a device, a removed one included, mails nothing" and "MEDIUM-1 NEGATIVE CONTROL: a link for an account that has a device, a removed one included, issues nothing".
- "MEDIUM-1: a start answers and runs the same statements for a deviceless account, a deviced account and no account".
- "MEDIUM-1 NEGATIVE CONTROL: an account with a registered owner device gets the same refusals as before" (item 3). A test that pins behaviour as unchanged cannot be RED before the fix, so it was checked two ways: it passes on `1c4aae05`, and it fails ("nothing mailed") when `HAS_HAD_DEVICE` is replaced with `0`.

The agent also checked that each control catches its own regression: dropping the `NOT EXISTS` device guard from the ticket insert fails only the deviced-link control, and making the void `UPDATE` a no-op fails only the void test.

In `test/signup.test.mjs` the four account-exists tests (A3 item 3, "no answer says whether an address has an account", M1 and the A3 item 5 alert) now give the account its owner device first, since their claim is about an account that has one.

What the fix does not open:
- A password thief without the inbox gets nothing new: `/signin` still answers `no-owner-device`, and a verify needs a code only the inbox holds.
- Whoever holds the inbox but not the password has a guess at the password per link, and links are capped by the mint rules (one at a time, each live 10 minutes, so at most 6 an hour). A wrong guess spends the link.
- `bad-login` for a wrong password on a fresh link, not `bad-code`, is the agent's call. Only the holder of a live link reaches the password check, so the answer tells an outsider nothing, and it tells the client the password was the problem.

Left as is (accepted, for Kaleb): the mint rules are kept, and a sign-up link that was already verified still counts as unexpired for its 10 minutes. So the owner's start between the ticket's expiry (5 minutes after the verify, at the latest) and the sign-up link's expiry answers `{ok:true}` and mails nothing, a gap of at most 5 minutes. A start after that mails the fresh link. An account whose owner device was registered and then removed is not covered (see re-review item 2), by the rule this fix keeps.

**LOW-1 (low), accepted: the shared pending cap lets a password thief spend the owner's new-device tries for a day.** The pending devices of an account share 6 code tries a day (re-review item 3, `PENDING_TRIES_PER_ACCOUNT_DAY`), so a thief who has the password can spend them and hold back the owner's next new device until a day after the thief's tries. Kaleb accepts it because the owner's existing devices are unaffected, the owner is mailed on each wrong or refused pending try (at most one note an hour), and a cap per account is the price of closing F3: a cap per device gave a thief with 8 devices 24 tries a day.

### Out of scope for A5

- The PIN and the 12-hour rule (A5b), admin actions (A5c), recovery and vault switch (A6).
- Any change to Sass or JanusMirror, real secrets, real mail and any deploy.

---

## A5b: the PIN, server side (`apps/horae-zone`, `packages/account-engine`)

Based on `dev` (PR #255): A5 (#244) has merged, and the branch was rebased onto `dev` at `22e18525`, which also carries A5's MEDIUM-1 fix (the relink of a deviceless account, its 11 tests in `test/relink.test.mjs`). Plan §3.3 ("Every app open", "Offline and revocation"), §3.4 (the PIN) and slice 6 ("A5b, PIN"). The client side (Face ID, the PIN screen, the offline check on the device, the review modal) is the app's, in a later slice; this slice builds what the service answers.

**Commits,** one per plan test or small group, each with its RED watched in the run before the build (the RED counts are in each commit message and in the test plan): `bd7bfd7e` (test 1), `768e6acd` (test 2), `94bad54d` (test 3), `8fc3bac1` (test 4), `c4f9878c` (the online wrong-PIN lockout, §3.4), `2306a136` (test 6), `3213116b` (tests 7 and 8), `ae360501` (tests 9 and 10), `02e7258d` (test 5, last, so its sweep reaches every A5b answer), then the docs, `74ef8094`. After the last: Horae Zone 353/353 (289 on `dev` at `22e18525`, so A5b added 64), engine 69 (68 pass, 1 skip without the private package; Node, Chromium and `workerd`; the one added test asserts `PIN_LOCKED`), profile-api 195/195.

The commit messages and this section first said 342 (278 before A5b) and named the commits before the rebase (`6ad8addc`, `00efe3de`, `6bd0e23d`, `63299ecf`, `e58a3eb1`, `ddac2b93`, `06d539f5`, `bf55aa5f`, `9b3ace78`, on A5's head `95cf772a`). The rebase changed no A5b file: `git diff 9b3ace78 02e7258d` and `git diff 95cf772a 22e18525` (both over `apps/horae-zone` and `packages/account-engine`) list the same four files, `src/signup.js`, `schema.sql`, `test/relink.test.mjs` and `test/signup.test.mjs`, all from `dev`. The 11 relink tests are the whole difference between 342 and 353. The security review's three fixes (below) then took Horae Zone to 359/359.

**Plan tests**, each by its plan name:

| # | Test | File |
|---|---|---|
| 1 | "every open asks for Face ID and the PIN; the code only when the last accepted code is 12 hours old" | `test/pin.test.mjs` |
| 2 | "offline, the PIN alone opens only while the last accepted code is under 12 hours old" | `test/pin.test.mjs` |
| 3 | "ten wrong PINs offline block the device until the service answers, and the service then locks the account until an admin unlocks it" | `test/pin-block.test.mjs` |
| 4 | "a replaced PIN is refused with exactly: That PIN is locked for reuse." | `test/pin-reuse.test.mjs` |
| 5 | "no user-facing response carries a date, duration, count or hash" | `test/pin-plain.test.mjs` |
| 6 | "a forgotten PIN resets with any two of code, password and email code, never one" | `test/pin-reset.test.mjs` |
| 7 | "the first four snoozes defer seven days and later ones one day" | `test/pin-review.test.mjs` |
| 8 | "the review modal offers exactly Snooze and Change PIN" | `test/pin-review.test.mjs` |
| 9 | "no reverify comes sooner than five minutes after the last" | `test/reverify.test.mjs` |
| 10 | "a cut account locks the app at the next check" | `test/reverify.test.mjs` |

**Earlier points closed:** the A5 security review's item 4 rules for the ticket's verifier ("What the A5b verifier must do", in A5 above) are built in `src/pin.js`: the kid picks the key, a kid it does not hold is refused before any signature check, the `jti` is spent in the write that accepts the ticket, and only a request the ticket's own device signed can spend it.

### What is in it

| File | Does |
|---|---|
| `src/pin.js` | `/pin/set {pin, ticket}` sets the first PIN; `/pin/set {pin, current, ticket?}` changes it; `/pin/verify {pin, ticket?}` is every app open. Each accepted one answers `{ok: true, grant}`. The ticket verifier (kid, own device, `jti` spent once, only after a right PIN). Exports `PIN_LIMITS` (`codeEveryMs` 12 hours, `reuseLockMs` 365 days), `GRANT_LABEL` and the pieces `src/pin-reset.js` shares |
| `src/pin-lockout.js` | The online wrong-PIN lockout (§3.4): the engine's `limits.mjs` rules in their own `pin_limits` row per account, beside the code path's `limits` row and never mixed with it; the PIN notes (paused, closed with the reopen link, reopened), which carry no number |
| `src/account-lock.js` | `/pin/blocked {}`: the device's signed report of the offline block, which locks the account. `accountLocked`, and `unlockAccount`, the hook the A5c admin route will call. The lock note to the account's address, at most one an hour |
| `src/pin-reset.js` | `/pin/reset {}` mails a single-use code in a link fragment; `/pin/reset {pin, ticket?, password?, emailCode?}` resets with any two. Exports `PIN_RESET_LIMITS`, `RESET_NOTE`, `PAUSED_NOTE` and `WRONG_BUCKET_PREFIX` (the day of wrong factors, security review LOW-2) |
| `src/pin-review.js` | `/pin/review {}` answers `{review: false}` or `{review: true, actions: ["Snooze", "Change PIN"]}`; `/pin/review {action: "Snooze"}` defers it. Exports `REVIEW_LIMITS` and `REVIEW_ACTIONS` |
| `src/reverify.js` | `/reverify {}` answers `{ok: true}` at most once every 5 minutes per device, and answers a cut account's refusal first. Exports `REVERIFY_LIMITS` |
| `src/index.js`, `src/routes.js` | The A5b routes are wired in. After the device and signature checks, a device route answers `account-locked` (423) while the account is locked, except `/nonce` and `/pin/blocked`, which are marked `lockedOk`. `/admin/unlock-account` stays `not-built`, with a comment naming `unlockAccount` |
| `src/checks.js` | `Refusal` takes an optional user sentence, answered as `message` beside `error` (used only for `too-easy` and `pin-reused`) |
| `src/lockout.js`, `src/unlock.js` | The lockout's read and write take a path (`code` or `pin`, from a fixed whitelist of two tables). One reopen route, `/unlock/reopen`, serves both paths: the token's table says which path it reopens. `ticketRing(env)` and `ticketKey(env)` are exported for the verifier and the grant |
| `src/account-keys.js` | A ninth derived key, the PIN pepper; `pinVerifier(pin, salt)` is PBKDF2 (100,000 rounds, the Workers ceiling) then HMAC under that pepper, the same slow hash as the login password |
| `src/retention.js` | The purge also removes spent tickets past their expiry, PIN locks past their lock-until, and expired reset codes. `account_lock` is never purged by time. Each account's day of wrong reset factors (`pin-reset-wrong:` throttle rows) is kept a day, not the sign-in hour (security review LOW-2) |
| `schema.sql` | Nine tables, all additive and `IF NOT EXISTS`: `pin` (account_id, verifier, salt, set_at), `device_check` (device_id, account_id, proved_at), `spent_ticket` (jti, account_id, device_id, at, expires_at), `account_lock` (account_id, locked_at), `pin_lock` (account_id, verifier, locked_until), `pin_limits` (account_id, state, version, reopen_hash), `pin_reset` (account_id, digest, expires_at), `pin_review` (account_id, snoozes, due_at) and `reverify` (device_id, account_id, at). Three triggers: `spent_ticket_proves` moves `device_check.proved_at` in the write that spends a ticket, `pin_replaced_locks` locks every replaced PIN, and `pin_restarts_review` starts a fresh review cycle with every new PIN. `DEPLOY.md` now says 21 tables present |
| engine `src/pin.mjs` | `PIN_LOCKED = 'That PIN is locked for reuse.'`, so the device and the service share the one sentence |
| `bin/deploy-parts.mjs`, `DEPLOY.md`, `wrangler.toml` | The deploy script asks for `HZ_RESET_BASE`, checks it like `HZ_REOPEN_BASE` and puts it as a secret; the catalog coverage test went RED on the new env name first |

**New Worker secret:** `HZ_RESET_BASE` (the https page the reset link opens). No new key: the PIN pepper is derived from `HZ_ACCOUNT_KEY` through `src/account-keys.js`, and the grant is signed with `HZ_TICKET_KEY` under its own label.

**New refusal words:** `no-pin` (409), `pin-set` (409, a first `/pin/set` when a PIN exists), `code-needed` (401), `bad-pin` (401), `too-easy` (400, with the engine's sentence), `pin-reused` (409, with exactly "That PIN is locked for reuse."), `account-locked` (423), `two-needed` (400), `bad-reset` (401) and `not-due` (409). `shape`, `unavailable`, `bad-ticket`, `locked`, `slow-down`, `no-device` and `not-owner` are reused.

### Decisions

1. **Every open is a signed request with the PIN.** Face ID releases the device's signing key, so the signature every device route checks is the Face ID part; the PIN rides in the body, every time. A ticket alone never opens.
2. **The code is asked per device, at 12 hours.** `device_check.proved_at` is the `at` of the last ticket an open of that device spent, written by the `spent_ticket_proves` trigger in the same write that spends the `jti`. An open needs a ticket when that time is 12 hours old or more, or when the device never spent one, and another device's code never spares this one. `code-needed` comes before the PIN is compared, so a PIN guess there learns nothing.
3. **The ticket is spent only by a right PIN.** A wrong PIN leaves the ticket live, so a mistyped PIN does not cost the code. A changed, expired, unknown-kid or malformed ticket answers `bad-ticket` alike and spends nothing.
4. **The first PIN needs a fresh code, and only a device that may change the account sets it** (`ACCOUNT_CHANGER`, in the write: before the first accepted code, the owner device). A pending device never reaches any `/pin` route, so the A5 owner rule holds.
5. **The PIN is never stored, bound, logged or echoed.** The service keeps a slow, peppered verifier over a random per-account salt. The pepper is HKDF-derived from `HZ_ACCOUNT_KEY`, so a copy of the database alone cannot be searched for the PIN; a copy of the database and that key together can, since six digits are a small space, which is why the online and offline lockouts carry the weight. The salt is kept across changes, so one slow hash compares a new PIN with the current one and every live lock.
6. **The offline window is a signed grant.** Every accepted open answers `{ok: true, grant}`: base64url `{v, kid, account, device, until}`, then the service's ECDSA P-256 signature over `horae-zone-offline-grant-v1.<payload>` under `HZ_TICKET_KEY`. The label keeps a grant from passing as a ticket, and a ticket from passing as a grant. `until` is `proved_at` plus 12 hours, the moment the service starts answering `code-needed`, so an open without the code never extends it. Offline, the app checks the PIN on the device and opens only before `until`.
7. **Ten wrong PINs offline lock the account.** The app counts them on the device (client side). When it reaches the service, the device signs `/pin/blocked {}`, and one `account_lock` row locks the account: every device route of the account then answers `account-locked`, read after the device and signature checks so an unsigned request learns nothing. Time, a right code, a right PIN and the reopen link do not unlock it; only `unlockAccount`, which the A5c admin route will call. A pending device cannot report, so a password alone cannot lock an account. The report carries no count, so the service keeps none.
8. **A replaced PIN is locked from reuse for 365 days.** The `pin_replaced_locks` trigger writes a `pin_lock` row for the old verifier whenever `pin.verifier` changes, so a change, a reset and the review's change all lock it the same way. A new PIN equal to the current one or to a live lock answers `pin-reused` with exactly "That PIN is locked for reuse.", and nothing about which PIN or until when.
9. **Wrong PINs online run JanusMirror's lockout, in their own state.** Every comparison of a PIN (an open's, or a change's current PIN) is admitted into the account's `pin_limits` row first and settled after: 3 wrong in one window lock it and mail the owner, and 2 locked windows in a row or 4 in a day close PIN entry until the emailed link reopens it. Wrong PINs never close code entry, and wrong codes never close PIN entry.
10. **The forgotten PIN.** `/pin/reset` resets with any two of the code (an unlock ticket), the account password and an emailed single-use code (128 random bits, after the `#` of a link to `HZ_RESET_BASE`, kept only as a keyed digest), on a signed request from a device that may change the account. A factor key holding null, an empty value or another type answers `shape`, and one factor answers `two-needed`, both before anything is read; a reset needs at least two factors checked and right (security review HIGH-1). A wrong factor answers `bad-reset`, the same word whichever it was, and spends no factor. The private blocklist answers only after the factors were right (LOW-1), and wrong factors fill a day cap per account (LOW-2). A reset spends the ticket and the emailed code, locks the old PIN, restarts the review and mails the owner a note with no number.
11. **The annual review is the server's schedule.** Due 365 days after `set_at`. The first four snoozes of a cycle defer it 7 days and every later one 1 day, counted from the snooze. The state is one `pin_review` row per account (a count and a due time), and the device keeps nothing. While due, `/pin/review` names exactly the two actions "Snooze" and "Change PIN".
12. **`/reverify`, the check.** A signed `{}` from a live device that is not pending answers `{ok: true}`, at most once every 5 minutes per device, keyed on the device's last answered check. A cut answers first: a removed device `no-device`, a locked account `account-locked`, even when the cut lands while the check is in flight. A check never moves `proved_at`, so it never extends the 12 hours and hands back no grant.
13. **No user-facing answer carries a date, duration, count or hash.** Every A5b answer is a closed word, `{ok: true}`, a boolean, the two action names or one of the two fixed sentences. The A5b mails carry no number either, so "paused for a short while" and "works once, for a short time" stand in for the code path's "30 seconds" and "24 hours". The grant is the one exception, and the user never sees it (decision 6).

### Decisions for Kaleb

Choices the plan leaves open, each with the safe default now in the code. Each is one line to change.

| # | Point | Default now | Where |
|---|---|---|---|
| 1 | The offline block is reported on a route of its own, `/pin/blocked`, which is not in the plan's §3.6 route table | New route, signed, empty body | `src/routes.js`, `src/account-lock.js` |
| 2 | A locked account refuses every device route but `/nonce` and `/pin/blocked`, `/device/remove` and the account's admin routes included, so an admin whose own device locked the account needs another admin (or a deploy-time command, row 24) to unlock it | As written | `src/index.js` |
| 3 | The lock is read before the handler runs, so an open already in flight when the lock lands can still finish; `/reverify` alone re-reads it in its write | As written | `src/index.js`, `src/reverify.js` |
| 4 | The account-locked note goes to the account's address (the plan names no recipient): "The app blocked itself on one of this account's devices after wrong PINs were entered while it could not reach the service.", "The account is now locked on every device.", "It stays locked until an administrator unlocks it." At most one an hour | As written | `lockedNote` in `src/account-lock.js` |
| 5 | A change rides on `/pin/set {pin, current, ticket?}`, not a new route; choosing the current PIN as the new one answers the same "That PIN is locked for reuse." | As written | `src/pin.js` |
| 6 | The reuse lock lasts 365 x 24 hours, not a calendar year. The number is a literal inside the SQL trigger, and a test holds it equal to `PIN_LIMITS.reuseLockMs` | 365 days | `schema.sql` `pin_replaced_locks` |
| 7 | The online PIN lockout also takes the code path's day cap: 12 wrong PINs a day close PIN entry, though the plan names only JanusMirror's window rules | 12 a day | `src/pin-lockout.js`, `WRONG_PER_ACCOUNT_DAY` in `src/lockout.js` |
| 8 | One reopen route, `/unlock/reopen`, on the one `HZ_REOPEN_BASE` page, serves both paths; the token's table says which path it reopens | As written | `src/lockout.js`, `src/unlock.js` |
| 9 | `/pin/verify` and a change answer `unavailable` without the mailer or a valid `HZ_REOPEN_BASE`, since the lockout could not mail its link; the first `/pin/set` compares no PIN and is outside the lockout | As written | `src/pin.js` |
| 10 | The reset needs its own link base, `HZ_RESET_BASE`, a new deploy prompt, because the emailed code has to be read on the signing device, not on the sign-up or reopen page | New secret | `bin/deploy-parts.mjs`, `DEPLOY.md` |
| 11 | The reset mail and the reset share the one plan route `/pin/reset`; an empty body asks for the mail | As written | `src/pin-reset.js` |
| 12 | A reset answers `{ok: true}` with no grant, so the next open is a `/pin/verify` (with the code at 12 hours), and a reset never extends the offline window. All three factors together are accepted too. A reset does not reopen PIN entry the online lockout closed (the emailed reopen link does that) | As written | `src/pin-reset.js` |
| 13 | The reset limits: 5 tries and 3 mails per account an hour, 12 wrong factors per account a day (security review LOW-2, row 26), and a 10-minute life for the emailed code | 5, 3, 12, 10 minutes | `PIN_RESET_LIMITS` in `src/pin-reset.js` |
| 14 | The review state rides on its own `/pin/review` call after an accepted open, and the open's answer stays `{ok, grant}`. "Change PIN" is served by `/pin/set`'s change, so `/pin/review` accepts only `Snooze` | As written | `src/pin-review.js` |
| 15 | A snooze defers from the moment of the snooze, not from the due time; the snooze count restarts with every new PIN (change, reset or the review's change); a snooze when nothing is due answers `not-due` | As written | `src/pin-review.js`, `schema.sql` `pin_restarts_review` |
| 16 | A signed request (Face ID) is enough to read or snooze the review, with no PIN, since the answer is one boolean and the plan allows unlimited snoozes | As written | `src/pin-review.js` |
| 17 | "A cut account" means the device removed or the account locked by the offline block; an admin's revocation of access beyond those is A5c's | As written | `src/reverify.js` |
| 18 | The 5-minute gate is per device and keyed on the last answered check; a check too soon answers `slow-down` (429) with no time in it; a pending device answers `no-device` | As written | `REVERIFY_LIMITS` in `src/reverify.js` |
| 19 | `/reverify` does not carry the offline PIN verifier, so how a PIN changed on another device reaches this device's offline check is left to the client slice | Not built | `src/reverify.js` |
| 20 | Owner mails count as user-facing, so the A5b PIN notes carry no number, while the A5 code notes (in #244's review) keep JanusMirror's numbers; the two paths' notes now differ. The closed note no longer says which rule closed PIN entry | As written | `src/pin-lockout.js` |
| 21 | The PIN notes: "Horae Zone: PIN entry paused" ("Wrong app PINs were entered for this account in quick succession.", "PIN entry for this account is paused for a short while.", "No PIN was accepted."); "Horae Zone: PIN entry closed" (which kind of rule, the link, "Works once, for a short time.", "Opening it reopens PIN entry only. The right PIN is still needed on the device."); "Horae Zone: PIN entry reopened"; "Horae Zone: app PIN reset link"; "Horae Zone: app PIN reset" ("The app PIN for this account was reset on one of its devices.", "The old PIN no longer opens the app.") | As written | `src/pin-lockout.js`, `src/pin-reset.js` |
| 22 | The no-number sweep does not treat "once", "single use" (the plan's single-use rule) or the reason word `two-needed` (the plan's any-two rule) as counts, and leaves the signed grant out, since the device reads it and never shows it although its payload holds a time | As written | `test/pin-plain.test.mjs` |
| 23 | The PIN rules (the engine's `createPinRules` over the private blocklist) are injected into the handler; the deployed Worker needs the private package wired in before a PIN can be set, and without it `/pin/set` answers `unavailable` | Not wired in the deploy | `src/index.js` `createHandler({pinRules})` |
| 24 | **MEDIUM-1 from the A5b security review.** A device that is not pending can lock its own account through `/pin/blocked`, and the unlock (A5c's `/admin/unlock-account`) is not built, so today only a D1 command unlocks it. Option A: keep `/pin/blocked` routed now, with the break-glass runbook in `DEPLOY.md` ("Break glass: unlock an account the offline block locked", the exact `wrangler d1 execute` command). Option B: leave `/pin/blocked` unrouted (`not-built`) until A5c ships, so nothing can lock an account before something can unlock it; the A8 client then has nowhere to report the offline block, and its ten-wrong block stays on the device alone | A (routed, runbook written), pending his ruling | `src/routes.js` `/pin/blocked`, `DEPLOY.md` |
| 25 | HIGH-1's reading of "two real plus one null": the review listed it among the RED tests, and the fix refuses any factor key holding null, so two right factors beside a third key set to null answer `shape` and spend nothing. Two right factors with the third key left out reset. The other reading (null means not given, and two right ones pass) would put back the null-as-absent path HIGH-1 came through | Refused as `shape` | `resetBody` in `src/pin-reset.js` |
| 26 | LOW-2's day cap is its own per-account count of wrong reset factors (12 a day, the code path's number, `WRONG_PER_ACCOUNT_DAY`), not the PIN lockout's day in `pin_limits`. Sharing that day would let wrong reset factors close PIN entry on an owner who only forgot the PIN. Right factors give their day place back, and a too-easy PIN after right factors takes none | Separate, 12 a day | `PIN_RESET_LIMITS.wrongPerDay` in `src/pin-reset.js` |
| 27 | A full reset day refuses right factors too (`slow-down`, no time in it) until the oldest wrong tries age past 24 hours, and no link reopens it. So a device that holds one factor can keep the owner from resetting for a day per 12 wrong guesses; the owner's PIN, the open and the code path are untouched. The owner is mailed "Horae Zone: app PIN reset paused" ("Wrong reset factors were entered for this account too often.", "PIN reset for this account is paused for a while.", "No PIN was changed.") when the day fills, and at most once an hour while it is full | As written | `src/pin-reset.js` `PAUSED_NOTE` |
| 28 | LOW-1's order costs the owner a try: a too-easy PIN on `/pin/reset` is answered after the try took its hourly place (the factors had to be checked first), so an owner who picks a listed PIN with right factors uses one of the 5 tries that hour | As written | `resetPin` in `src/pin-reset.js` |

### Open points for the reviewer

| # | Point | Proposed resolution |
|---|---|---|
| 1 | Six digits under a database-and-key leak (decision 5): the pepper protects a database copy alone, not one taken with `HZ_ACCOUNT_KEY` | Accept for A5b: the lockouts bound the online guesser, and the device still needs its signing key and Face ID. Revisit if the threat model adds a full Worker compromise |
| 2 | The lock read before the handler (Kaleb point 3) leaves an open in flight when the lock lands able to finish | Accept: the lock comes from a report after ten offline wrongs, so the in-flight open is the same device's and the next request is refused |
| 3 | The A5 code notes and the A5b PIN notes differ in whether they carry numbers (Kaleb point 20) | Align the A5 notes once #244's review closes, in their own commit |

### The A5b security review (head `74ef8094`)

A security review of PR #255 at `74ef8094` said fix first. It found one HIGH, one MEDIUM and three LOW. HIGH-1, LOW-1 and LOW-2 are fixed test first, one commit each: each new test was watched failing before its fix and passes after. LOW-3 is a rule for the A8 client, and MEDIUM-1 is a choice for Kaleb (Decisions for Kaleb, row 24). Nothing was merged or deployed, and the live service was not touched.

| Item | Finding | Commit | Suites after |
|---|---|---|---|
| HIGH-1 | A null factor counted as given but was never checked, so `/pin/reset` replaced the PIN with no factor | `a5af066d` | Horae Zone 354/354, engine 69 (68 pass, 1 skip; Node, Chromium, `workerd`), profile-api 195/195 |
| LOW-1 | The private blocklist answered `too-easy` before the ticket, the current PIN or the reset factors were checked | `559fb63b` | Horae Zone 357/357, engine 69 (68 pass, 1 skip), profile-api 195/195 |
| LOW-2 | Wrong reset factors had an hourly cap only (5 an hour, so 120 a day) | `8cf86b8f` | Horae Zone 359/359, engine 69 (68 pass, 1 skip), profile-api 195/195 |
| LOW-3 | The signed grant's `until` is checked against the device clock offline | None (A8) | |
| MEDIUM-1 | A device that is not pending can lock its own account, and only a D1 command unlocks it | None (Kaleb's ruling) | |

**HIGH-1 (high): three nulls reset the PIN.** `resetBody` counted a factor as given when its key was present (`Object.hasOwn`), its type checks let null through, and `factorsRight` skipped a null as not given. So a signed device sent `{"pin":"385062","ticket":null,"password":null,"emailCode":null}`, the count said three, nothing was compared, and the reset answered 200 with the PIN replaced. One real factor beside nulls passed the same way, and the RED probe on `74ef8094` found worse than the review's three-key cases: `{pin, ticket, password: null}`, one right factor and one null key, reset too.

What changed (`src/pin-reset.js`):
- `resetBody` refuses a factor key holding null, an empty value or any type but a string of the factor's shape (`FACTOR_SHAPE`) as `shape` (400), before anything is read, throttled or spent. Fewer than two factors still answer `two-needed`.
- `factorsRight` counts only the factors it actually compared, and answers right only when at least two were checked and every one was right, never one. This sits behind the shape check, so a later change to the shape rules cannot bring the null path back on its own.

Test (`test/pin-reset.test.mjs`): "a null or empty factor is refused as shape, never counted, and the refusals spend nothing" sends ten bodies (three nulls; each right factor beside two nulls; the ticket and one null; two right factors and a null, both ways; an empty ticket, password and email code), each one round more than the hour's tries, and expects `shape` every time, the PIN unchanged, and as its NEGATIVE CONTROL the same ticket and email code with no third key resetting afterwards (no refusal spent a factor or a try place). It fails on `74ef8094` with "three nulls" (200 where 400 `shape` was expected), and passes from `a5af066d`.

**LOW-1 (low): the private blocklist answered before any proof.** `setPin` and `resetPin` asked the PIN rules (`allowedOrRefuse`, over the private blocklist) before the ticket or the factors and before the throttle, so a signed device with a junk ticket could learn which PINs are on the list, one request per PIN, without limit. `changePin`, the sibling branch `/pin/set` dispatches to, had the same order (the rules before the current PIN was compared), and the review did not name it; it is fixed in the same commit.

What changed (`src/pin.js`, `src/pin-reset.js`):
- Each of the three checks the PIN's public shape first (`shape`), since the shape is no secret.
- `setPin` then checks the ticket (`bad-ticket`), and only then the PIN rules.
- `changePin` runs the PIN rules inside the replace, after the current PIN was right in the lockout, so a wrong current PIN answers `bad-pin` for a listed PIN.
- `resetPin` admits the try into the throttle, checks the factors (`bad-reset`), and only then the PIN rules. A too-easy answer after right factors spends no factor (Decisions for Kaleb, row 28, for the try place it uses).

Test (`test/pin-blocklist-order.test.mjs`, new): "the first PIN: a junk or foreign ticket answers bad-ticket for a listed PIN, never too-easy", "a change: a wrong current PIN answers bad-pin for a listed new PIN, never too-easy" and "a reset: wrong factors answer bad-reset for a listed PIN and take a try place, never too-easy" run every PIN of the engine's public fixture list and a run (`123456`), with a junk ticket and another account's ticket for the first. Each also holds a NEGATIVE CONTROL: the right proof with a listed PIN still answers `too-easy` and spends nothing. All three fail on `74ef8094` and on `a5af066d`, each answering 400 `too-easy` for a listed PIN, and pass from `559fb63b`.

**LOW-2 (low): wrong reset factors had no day cap.** `PIN_RESET_LIMITS.triesPerHour` is 5, so a device holding one factor could guess another 120 times a day, every day, while the code path stops at 12 wrong codes a day.

What changed:
- `src/pin-reset.js`: every reset try takes a place in the hourly try bucket and in a new day bucket per account, `pin-reset-wrong:<account>` (`PIN_RESET_LIMITS.wrongPerDay`, the code path's `WRONG_PER_ACCOUNT_DAY`, 12), in one `admitThrottle` statement, so tries sent together cannot pass the cap. Right factors give the day place back (`releaseThrottle`), so only wrong factors count. A full day answers `slow-down` (429, with no time in it), right factors included.
- The try that fills the day, and any try refused while it is full, mail the owner `PAUSED_NOTE` ("Horae Zone: app PIN reset paused", no number and no link), at most once an hour (its own `pin-reset-paused:<account>` bucket). The hourly cap alone mails nobody, as before.
- `src/retention.js`: the hourly purge deleted every throttle row older than the sign-in window, except the daily sign-up and alert rows, so a day bucket would never have filled in production. It now keeps rows whose bucket starts with `WRONG_BUCKET_PREFIX` for a day. The review did not name this, and a route test with no purge cannot see it, so it has its own test.

Tests: "wrong reset factors are capped per account each day at the code path's 12, and the owner is told at most each hour" (`test/pin-reset.test.mjs`) walks a whole day: a too-easy PIN with right factors takes no day place, the hourly cap mails nobody, the 12th wrong try mails the note, the note's hourly gate holds, right factors wait while the day is full, and the day ends at exactly 24 hours after the first wrong try. "LOW-2: a purge keeps each account's wrong reset rows for a day and clears them after" (`test/purge.test.mjs`) has as its NEGATIVE CONTROL that the hourly try bucket still goes after its hour. Plan test 5's run (`test/pin-plain.test.mjs`) now drives the reset day cap and requires the paused note among the mails it sweeps. On `559fb63b` the day test fails with "the twelfth wrong tells the owner", the purge test with "the wrong rows stay a day", and the plan-test-5 coverage with "the run mails Horae Zone: app PIN reset paused". On `74ef8094` the same three fail (the day test at "the hour is full", since the null probe of HIGH-1 is still open there). All pass from `8cf86b8f`. The choices this fix made are rows 26 and 27 of Decisions for Kaleb.

**LOW-3 (low), a must for A8: the offline grant trusts the device clock.** The grant's `until` (decision 6) is checked by the app offline, against the device's clock. Rolling the device clock back extends the offline window past the 12 hours, for as long as the clock is held back. The service cannot see an offline open, so the fix belongs to the client. **A8 must** check `until` against a trusted or monotonic clock offline: for example the time of the last service answer carried forward by a monotonic clock (one that a user's clock change does not move), and the app must treat a clock that runs backwards, or a reboot that loses the monotonic reference, as past `until`, so only the code reopens it. This is recorded as a requirement for A8, with no change in A5b.

**MEDIUM-1 (medium): a device can lock its own account, and nothing in the product unlocks it.** `/pin/blocked` locks the account on the signed word of any device that is not pending (decision 7), as the plan asks, so the owner's own device, or a thief holding it, can lock the account. Every device route then answers `account-locked`, and `unlockAccount` waits for A5c's admin route, which is not built. Until A5c ships, the only unlock is a D1 command run by hand. The two ways forward are row 24 of Decisions for Kaleb: keep the route with the break-glass runbook (written now in `DEPLOY.md`, since the code routes it today), or leave `/pin/blocked` unrouted until A5c ships.

### Out of scope for A5b

- The client: Face ID, the PIN screen, the offline check against the grant (on a trusted or monotonic clock, LOW-3 above), the ten-wrong count on the device, the review modal (A8).
- `/admin/unlock-account` and the other admin routes (A5c), recovery and the vault switch (A6), the gatekeeper's use of the ticket (A7).
- Any change to Sass or JanusMirror, real secrets, real mail and any deploy.
