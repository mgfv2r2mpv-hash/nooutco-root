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
| 8 | Codes mailed per hour across every `+tag` of one mailbox (M2) | 3 | `codesPerMailboxHour` |
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
- A start for a tagged address (`name+tag@domain`) also takes a place in a per-mailbox bucket keyed on the address with the tag stripped (`codesPerMailboxHour`, 3). That key is for the limit only: the account key stays the full address, tag included. An untagged address is its own mailbox and keeps its own per-address bucket, so a flood of tags cannot stop the owner's sign-up at the plain address. Mail to one mailbox is bounded at 3 an hour for the plain address plus 3 an hour across all its tags. (Since the third review, item 2, the plain address has no start bucket: it mints at most 6 links an hour, one live at a time, plus 3 re-sends. The mailbox bucket still bounds minting across the tags.)
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
- The address bucket is only the load ceiling (`perAddressHour`, 100 wrong passwords an hour). A try refused by any bucket is still not counted, and a success still gives back its pair and address places.
- A sign-in signed by a registered device of the account pays the pair bucket with its backoff (it paid the pair bucket since item 7) and still skips the address ceiling.

Tests (`test/devices.test.mjs`): "third review, item 1: six strangers polling every second never hold the owner's right password from a fresh connecting address" is the probe. On `17577851` the owner tried 480 times over 4 simulated hours and never signed in; now the first try gets a ticket. "third review, item 1: one requester hammering one address backs off on its own pair, then is capped at perPairHour" holds each step 1 ms before its delay and admits it at the delay, checks that the right password and a wrong one get the same `slow-down`, that another requester signs in meanwhile, and that the pair stays capped until its first failure leaves the hour. On `17577851` the pair had no backoff (`backoffAfter` 10 was not below `perPairHour` 5). The H2 tests that filled the address bucket now fill the ceiling with rows, and the item 4 test of the address backoff is replaced by the pair test.

Left as is (residual): the address ceiling is still a cap strangers can fill. Twenty connecting addresses at 5 wrong passwords each (about 3 minutes per pair) fill it, and for as long as they keep refilling it the owner's first sign-in on a new device answers `slow-down`; six reach only 30. Registered devices are not held (H2). The review allowed a high ceiling for load, and the edge rule at the first deploy (A3 Decision for Kaleb 13, now required) bounds a stranger with that many addresses.

**Item 2: the start cap could leave the owner without a link.** The probe: strangers' 3 starts minted the hour's 3 links, and their next 3 used the re-send cap. Eleven minutes later, with those links expired, the owner's start answered `{ok:true}` and mailed nothing until the hour ended.

What changed (`src/signup.js`):
- The per-address mint cap (`codesPerAddressHour`), the live cap (`liveCodes`) and the `start-address` bucket are gone. `mintCode` inserts a code only where the address has no code inside its life, checked in the same `INSERT ... SELECT`, so two starts together cannot both mint. One link is live at a time, so at most 6 are minted an hour at a 10-minute life.
- A start that does not mint goes to `resendCode` as before: a place under the re-send caps (`resend-address`, and `resend-mailbox` for a tagged address, 3 an hour each), then the live link mailed again. So every start mints a link or re-sends the live one, and past the re-send cap it mails nothing while a link already mailed to the address is still live.
- M1 holds: a code inside its life counts whether live or spent, so an address with an account (its row is born spent) takes the re-send path with the same statements as an address with a live link.
- A tagged address still needs a place under its mailbox cap (`codesPerMailboxHour`, 3) to mint.
- Mail to one address is bounded at 6 minted plus 3 re-sent an hour (was 3 plus 3).

Tests (`test/signup.test.mjs`): "third review, item 2: strangers' 3 mints and 3 re-sends, then the owner's start 11 minutes later mails a working link" is the probe (on `17577851` 6 mails went out, expected 7; now the owner's link verifies). "third review, item 2: strangers starting every 10 s for an hour never leave the owner without a working link" (on `17577851` the newest link mailed to the owner answered 401; now 200) and "third review, item 2: one link is live at a time, and mail to one address stays bounded each hour" (a start a minute for an hour: on `17577851` two links were live at minute 1; now one at a time, 6 minted and 9 mailed) are new too. The H1, limits and item 3 tests that pinned the mint cap now pin one live link, the re-send cap, an expired link never sent again with the next start minting, and the same statements for an account address inside a code's life and an address with a live link.

Left as is (residual):
- A tagged address still needs a mailbox place to mint, so strangers starting other `+tag`s of the same mailbox (3 an hour) can keep a tagged address from minting for up to an hour. The plain address is never held. Dropping that cap would leave mail to one mailbox unbounded across its tags.
- The re-send cap is still a cap strangers can fill, but only while a link is live, and that link has already gone to the address, so the owner's mailbox holds a working link the whole time.
- The hourly purge removes spent codes before they expire, so after a purge an address with an account mints a born-spent row instead of re-sending, as an address with no live link does. Both still send the same statements as their counterpart (M1).

**L-new-1 (low), accepted: a live link can be opened with the Worker secret.** Since the second review, item 3, each live code is also sealed in `challenge.link_box`, AES-GCM under a key derived from `HZ_ACCOUNT_KEY`, so a later start can mail it again. Whoever holds a copy of the table and that secret can open a live link. The box is cleared when the code is spent and the hourly purge removes expired rows, so a box lives at most 10 minutes, and whoever holds both can already open every address box. Accepted as is; nothing changed.

**Required at the first deploy:** Cloudflare Turnstile or a WAF rate rule on `/account` and `/signin` (A3 Decision for Kaleb 13, a recommendation until this review). The daily start cap and the sign-in address ceiling are both caps a stranger with enough connecting addresses can fill, and only an edge rule bounds that stranger.

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
| 2 | Wrong sign-in passwords per address per hour, from everyone; a success and a sign-in signed by a device of the account are not counted (H2). A ceiling since the second review, item 4, and a load bound only since the third review, item 1 (no quiet period; strangers with 20 connecting addresses can still fill it, so the edge rule in A3 row 13 is required) | 100 (was 10) | `SIGNIN_LIMITS.perAddressHour` |
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

Left as is (residual): a first device has no key to sign with, so strangers who fill the address bucket still hold back the owner's first sign-in on a new device for up to an hour (narrowed by the second review, item 4: no hard lock, a backoff of at most 15 minutes after the latest wrong password; narrowed again by the third review, item 1: no address backoff, only the 100-an-hour ceiling, which takes about 20 connecting addresses to fill). A device of the account that has been stolen (its key with it) can try passwords without the address cap; since the second review, item 7, it pays the pair cap (5 wrong passwords an hour from each connecting address, not the requester's 20), and removing it (A4 decision 5) stops it at once.

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

**Commits:** `a11c7cdc` (RED: Horae Zone 126 tests with 16 failing, the engine's `pake.test.mjs` failing to load; every A2 to A4 test, the security review's included, still passing), then `e1676fdd` (GREEN). After GREEN: Horae Zone 151/151, engine 68 (67 pass, 1 skip without the private package), profile-api 195/195. The RED count of 126 is lower than 151 because `otp.test.mjs` and `unlock.test.mjs` could not load (their modules did not exist yet), and a file that cannot load reports as one failure. Then `7d5ff057` (RED for open points 8 and 9, the security review's L2 and M3 carried to A5: Horae Zone 161 tests with 7 failing, every other test passing) and the GREEN commit after it. After that GREEN: Horae Zone 161/161, engine 68 (67 pass, 1 skip), profile-api 195/195. Then one commit per item of the A5 security review of `92deff6f`, each RED first (see "The A5 security review" below).

**Plan tests:** "the seed is returned once and never again" (`test/otp.test.mjs`), "NEGATIVE CONTROL: a correct code, account and device returns a ticket" (`test/unlock.test.mjs`), "three wrong codes in one window lock it and email; two in a row or four a day close the path until the link" and "the reopen link is single use and hands out no key" (both `test/lockout.test.mjs`).

**Earlier open points closed, each RED first:** A1 open point 3 (a Horae Zone channel for `pake.mjs`) and A4 open point 1 (a further device needs the code; see decision 6).

### What is in it

| File | Does |
|---|---|
| `src/otp.js` | `POST /otp/enrol {ticket}`, signed, answers `{secret, uri}` once. Exports `OTP_LABEL`, `seedBoxKey(env)` and `openSeed(env, accountId, box)` |
| `src/unlock.js` | `POST /unlock/start {sid, Ya, clock}` answers `{exchange, replies}` (two replies). `POST /unlock/finish {exchange, tagA}` answers `{ticket}`. `POST /unlock/reopen {token}` answers `{ok:true}`. Exports `UNLOCK_LIMITS`, `TICKET_LABEL` and `PENDING_TRIES_PER_DAY` (A5 security review, item 2) |
| `src/lockout.js` | The engine's `limits.mjs` rules over one D1 row per account, the lock notes, and after-work that mails them to the account's address |
| `src/devices.js` | A device registered for an account that already has a code starts `pending` |
| `src/routes.js`, `src/index.js` | The A5 handlers are wired in. `/nonce`, `/unlock/start` and `/unlock/finish` are marked `pendingOk`, and a pending device gets `no-device` on every other route. A `Refusal` can carry after-work (a lock mail), which runs after the refusal's own audit row |
| `src/checks.js` | `Refusal(reason, status, after)` |
| `src/account-keys.js` | A seventh derived key, the tag digest: HMAC of an expected CPace confirmation tag, bound to its exchange id |
| `src/retention.js` | The purge also removes finished and expired code exchanges, and a pending device's tries once a day old |
| `schema.sql` | `otp` (account_id, box, last_step, created_at), `exchange` (id, account_id, device_id, candidates, expires_at, used), `limits` (account_id, state, version, reopen_hash), `pending_try` (device_id, at; A5 security review, item 2) and `device.pending` (changed in place, since no database exists yet) |
| engine `src/pake.mjs` | `unlockChannelFor(device)` returns `horae-zone-unlock-v1|<device>`, and throws `TypeError` for anything but a device id |

**New Worker secrets** (none is set anywhere; the tests use fake or per-run values): `HZ_SEED_KEY` (base64url, at least 32 bytes), `HZ_TICKET_KEY` (a P-256 private key as a JWK) and `HZ_REOPEN_BASE` (the https page the reopen link opens). A missing or bad value answers `unavailable`, and nothing is written.

**New refusal words:** `enrolled` (409), `enrol-blocked` (409, A5 security review item 1), `not-enrolled` (409), `locked` (423) and `bad-link` (401). `bad-code` (401) and `bad-ticket` (401) are reused.

**Provenance.**

| Piece | Source | Changes from the source |
|---|---|---|
| The steps offered (current and previous, never the next) | JanusMirror `gatekeeper/src/totp.mjs` (`candidateCodes`, "Never the next window") | None in the rule. Horae Zone also withholds any step at or before the account's last accepted one |
| The lockout rules | Engine `src/limits.mjs` (A1, from JanusMirror `pairing-limits.mjs`) | None. The state lives in D1 instead of a file, written by compare-and-swap |
| The lock notes | JanusMirror `gatekeeper/src/mailer.mjs` (`messageFor`, `clockLine`) | New wording for an account rather than one Mac, sent through the engine mailer (A3). The clock line is kept for a skewed device clock |
| The reopen link | Engine `fragmentLink` (A3), JanusMirror `phone/unlock.mjs` pattern | None: the token rides only after `#` |
| `replay.mjs` and `jwt.mjs` | JanusMirror | **Not moved.** `replay.mjs` is an in-memory ledger for sealed relay messages, and a Worker keeps no memory across requests, so the A5 replay rule is the per-account `last_step` in D1 instead. `jwt.mjs` verifies Cloudflare Access RS256 tokens for the Mac relay, which Horae Zone does not do. Both stay in JanusMirror until a slice uses them (Phase 9) |

### Decisions

1. **The seed is handed out once, and only to a signed device with a fresh sign-in.** `/otp/enrol` is a signed route and takes exactly `{ticket}`, a live `/signin` ticket. The ticket is spent first, by the same `UPDATE ... RETURNING` that checks it was issued to the signing device's account and bound to the signing device's own two keys (`deviceKeyDigest`, as `/device/register` checks since M3), so another account's ticket, or one named for other keys, is refused and stays live. The `otp` row is inserted `ON CONFLICT DO NOTHING`, so a second enrolment answers `enrolled` and carries no seed. Both writes also require the signing device to be the account's sole live device (A5 security review, item 1), and a second live device answers `enrol-blocked`.
2. **The seed is stored only sealed.** 20 random bytes, sealed with AES-GCM under a key HKDF derives from `HZ_SEED_KEY` (its own secret, apart from `HZ_ACCOUNT_KEY`), with the account id as associated data, so a box moved to another account does not open. The seed is opened only inside `/unlock/start` to build the replies, and its bytes are zeroed after use. No answer after the first, no row, bound value, audit row or log carries it (leak canary).
3. **The code never crosses the wire.** The device proves it with CPace, the engine's `pake.mjs`, keyed by the code under `unlockChannelFor(device)`. The channel names the one device that signs start and finish, so an exchange cannot finish for another device, and its label keeps it apart from every JanusMirror channel. The DST is unchanged.
4. **Drift: zero forward, one step back.** `/unlock/start` offers the current 30-second step and the previous one, never the next, which is JanusMirror's rule. A step the service withholds (at or before the last accepted one) still gets a reply, built from a random code, so the two answers look alike.
5. **A code is accepted once.** Acceptance is one atomic `UPDATE otp SET last_step = ? WHERE last_step < ?`, so a code accepted once is refused again in the same step on any device, and of two exchanges proving one code only the first finished wins.
6. **A further device must prove the code before it can do anything else** (A4 open point 1). Enrolment happens only on the account's sole live device (item 1 of the A5 security review), and a device registered later starts `pending`. A pending device reaches only `/nonce`, `/unlock/start` and `/unlock/finish`, and every other route answers `no-device`, as for an unknown device. An accepted code clears the flag. So the plan's "email + password + code" for a further device (§3.3) is `/signin` with the password, then the code through `/unlock`, which keeps the code inside CPace and bound to a registered device signature.
7. **Exchanges keep no tag.** An exchange row holds only keyed digests of the `tagA` values the service expects, with their steps. It dies at `CONFIRM_MS` (20 s, the lockout's confirm time) and is spent by its first finish, from its own device only. Every expected digest is compared with the engine's `sameHex`, with no early exit, so the time taken does not say which step matched.
8. **Every refusal at finish is `bad-code`.** A wrong code, an unknown, spent or expired exchange, and another device's exchange all answer the same. Nothing says whether the account, the device or the code was the wrong part.
9. **The lockout is the engine's, per account.** 3 wrong codes in one 30-second window lock that window, and 2 locked windows in a row or 4 in a day close the code path until the single-use emailed link reopens it (`limits.mjs`, unchanged). The state is one `limits` row per account, written by compare-and-swap on a version column, so tries sent together each see the others (6 parallel starts admit exactly 3). An exchange left unfinished counts as a wrong code once its confirm time passes. A state that cannot be read fails closed: the path counts as closed, and a link is mailed. A pending device's tries are not in this state: each pending device gets 3 a day of its own, and a closed path refuses it too (A5 security review, item 2).
10. **The lock mails go through the engine mailer, after the answer.** A window lock mails a plain note with no link. A closed path mails the link `HZ_REOPEN_BASE#<token>`, and a refused try mails a fresh link when the old one is missing or has expired. A reopen mails a note. No note carries a code, the seed, a tag, a ticket or any six-digit number. A failed send is audited `mail-failed`, after the refusal's own row, and the lock holds.
11. **The reopen link reopens the path and nothing else.** `/unlock/reopen` is open, takes exactly `{token}`, and answers exactly `{ok:true}`: no ticket, key or seed. The token is stored only as the engine's hash (in the state and in `reopen_hash`), it works once, and it expires after 24 hours (the engine's `UNLOCK_TTL_MS`). An unknown, spent or expired token answers `bad-link` alike. A failed reopen try renews no link, since a renewed token would reach no one.
12. **The ticket.** A right code answers `{ticket}`: base64url JSON `{v, account, device, at, exp}`, then `.`, then the service's raw ECDSA P-256 signature over `${TICKET_LABEL}.${payload}`, made with `HZ_TICKET_KEY`. A changed payload does not verify.
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
| 1 | The enrolling device is not marked pending, so plan §3.3 step 4 ("type one code to confirm") is a client step only. A QR that is never scanned leaves the account enrolled with a seed nobody holds, and a second enrolment answers `enrolled` | `src/otp.js` | A follow-up, RED first: keep enrolment unconfirmed (and repeatable with a fresh ticket) until the first accepted code. Until then, A6 recovery enrols a new authenticator |
| 2 | `/signin` itself still asks no code (plan §3.6 says "Email + password + code"). The pending rule (decision 6) gives the same gate | `src/signin.js`, `src/routes.js` | Accept the pending rule; revisit only if the client flow needs the code on the sign-in screen |
| 3 | Nothing consumes the unlock ticket yet, and its public key is not published. The ticket carries no key id | `src/unlock.js` | A5b (`/pin/verify`) and A7 (the gatekeeper pins the key) consume it. Add a key id before A7 so `HZ_TICKET_KEY` can rotate |
| 4 | Changing `HZ_SEED_KEY` makes every seed box unopenable, and a start that cannot open its box fails after its try was admitted | `src/otp.js`, `src/unlock.js` | A rotation plan with the A3 one (A3 open point 5), before the first real account |
| 5 | Any registered device of the account that has proved the code can spend the account's tries and close the path for every device. That is the JanusMirror rule, and the lock notes tell the owner. A pending device no longer can (A5 security review, item 2) | `src/lockout.js` | Accept; removing the device (A4) stops it |
| 6 | The lock mail goes out through `ctx.waitUntil` (as A3 open point 3). If it is lost while the link is still live, the next refused try does not mail it again, so the path stays closed until the link expires and a fresh one is mailed (up to 24 hours) | `src/lockout.js` | Accept for now, or re-mail a live link at most once an hour on a refused try |
| 7 | Not run against a real Resend or a real `wrangler dev`, as in A3 open point 4 | - | The reviewer runs the `wrangler dev` smoke test in the test plan |

Fixed in this PR, RED first, so no longer open: points 8 (L2) and 9 (M3), below. The numbers of the other points are kept.

### Security review findings carried to A5

A5 was written before the A3 and A4 security review fixes landed and was rebased onto them. Two of those fixes had to reach the A5 routes too.

| Finding | Open point | RED | GREEN | Suites after |
|---|---|---|---|---|
| M3, enrol ticket not bound to keys | 9 | `7d5ff057` | the commit after `7d5ff057` | Horae Zone 161/161 |
| L2, removal mid-flight | 8 | `7d5ff057` | the commit after `7d5ff057` | Horae Zone 161/161 |

**M3 (medium), carried: `/otp/enrol` spent any live sign-in ticket of the account.** `/device/register` takes only the keys a ticket names, but enrolment took any live `/signin` ticket of the signing device's account, so a ticket seen in its 5 minutes could be spent by another of the account's devices to take the seed. Fix: `src/otp.js` reads the signing device's `sign_key` and `agree_key` and adds `AND key_digest = ?` (their `deviceKeyDigest`) to the spend. A ticket for other keys, or one bound to no device, answers `bad-ticket`, stores no seed and stays unspent. Every A5 test now enrols with a ticket signed in for the enrolling device's keys (`enrolTicket` in `test/helpers.mjs`).

Tests (`test/otp.test.mjs`): "enrolment spends only a ticket bound to the signing device's own keys" fails on `7d5ff057` (200 with a seed, expected 401 bad-ticket). "NEGATIVE CONTROL: a ticket bound to the signing device's keys enrols" passes on both.

**L2 (low), carried: a removal landing mid-flight did not stop an A5 write.** The A5 writes a device's request makes ran after `findDevice` and did not look again, so a device removed between the checks and its writes could still enrol or be handed an unlock ticket. Fix: the enrol ticket spend and the `otp` insert (`INSERT ... SELECT ... WHERE LIVE_DEVICE`), the exchange insert, the exchange spend, the `last_step` update and the pending clear each re-check `LIVE_DEVICE` in the same statement. When one finds no row, `findDevice` runs again, so a removed device answers `no-device` and a live one keeps its old answer (`bad-ticket`, `enrolled`, `bad-code`). A removal noticed by the exchange spend or the step update leaves the code unused for the account's live devices. A removal noticed only by the pending clear comes after the code was accepted, so that code is used up, but the device stays pending and gets no ticket. A start or exchange left unfinished by a removal ages past `CONFIRM_MS` and counts as a try, as any abandoned one does (decision 9).

Tests (`test/otp.test.mjs`, `test/unlock.test.mjs`): the removal lands right after a named statement, through the `removedMidFlight` helper, now shared in `test/helpers.mjs`. "L2: a device removed after its signed enrol passed the checks gets no seed, and the ticket stays unspent", "L2: a device removed after its enrol ticket was spent stores no seed", "L2: a device removed after its signed start passed the checks gets no exchange", "L2: a device removed after its signed finish passed the checks gets no ticket, and the code is not used up", "L2: a device removed after its exchange was spent does not use up the code" and "L2: a device removed after its code was accepted gets no ticket and stays held back" fail on `7d5ff057`. Each failure is a 200 carrying a seed, an exchange or a ticket. The two L2 negative controls (a removal of some other device stops nothing) pass on both.

### The A5 security review (head `92deff6f`)

A security review of PR #244 at `92deff6f` asked for six fixes before merge. Each is test first: the new tests fail on `92deff6f` and pass after the fix, one commit per item.

| Item | Finding | Commit | Suites after |
|---|---|---|---|
| 1 | HIGH, a password thief can enrol the authenticator first | the commit after `92deff6f` | Horae Zone 164/164, engine 68 (67 pass, 1 skip), profile-api 195/195 |
| 2 | MEDIUM, a pending device (password only) can keep the code path closed | the commit after item 1's | Horae Zone 170/170, engine 68 (67 pass, 1 skip), profile-api 195/195 |

**Item 1 (high): a password thief could enrol the authenticator first.** On an account with no `otp` row, a device registered with the password alone was not pending, since nothing marks a device pending before enrolment. So whoever held the password signed in, registered a device of its own, enrolled, and took the seed. Enrolment then marked the owner's devices pending, and a pending device cannot reach `/device/remove`, so the owner could not remove the thief's device.

What changed (`src/otp.js`):
- `/otp/enrol` succeeds only for the account's sole live device. The ticket spend and the `otp` insert each carry `(SELECT COUNT(*) FROM device WHERE account_id = ? AND removed_at IS NULL) = 1` beside `LIVE_DEVICE`, in the same statement, so a device registered between the two still blocks the enrolment.
- A second live device answers the new refusal `enrol-blocked` (409). A spend refused that way leaves the ticket live, so once one device has removed the other the sole one enrols with the same ticket. When the insert is what refuses, the answer is `enrolled` if the account has a seed and `enrol-blocked` if not.
- Before enrolment no device is pending, so either of two live devices can remove the other through `/device/remove`, as A4 already allowed. The statement that marked the other devices pending at enrolment is gone: with the sole-device rule there are none to mark. A device registered after enrolment still starts pending (`src/devices.js`, unchanged).

Tests (`test/otp.test.mjs`): "A5 review 1: a second registered device cannot enrol", "A5 review 1: the probe (password thief registers and tries to enrol first) ends with the thief refused and removed" and "A5 review 1: a device registered between the ticket spend and the seed insert blocks the enrolment" fail on `92deff6f`, each with a 200 carrying a seed where `enrol-blocked` is expected. "A5 review 1 NEGATIVE CONTROL: a removed device does not count, so the sole live device enrols" passes on both. The old test "a device registered before enrolment must prove a code after it" described the hole and is replaced by the first of these. The two L2 enrol tests no longer register a second device first, since a second device now blocks the enrolment before the removal could matter. `test/helpers.mjs` gains `landsMidFlight`, the general form of `removedMidFlight`.

Left as is (residual, for Kaleb): before enrolment the thief's device can remove the owner's device just as the owner can remove the thief's, and then enrol as the sole live device. The owner would then sign in again with the password, and the new device would be pending once the thief's enrolment is confirmed (item 3). The sole-device rule turns a silent race into a visible one (the owner sees a device it did not add, or loses its own); closing it needs a second factor before the first enrolment, such as the email code, which the review did not ask for.

**Item 2 (medium): a pending device could keep the code path closed.** A pending device has shown only the password, yet its tries at `/unlock/start` went into the account's lockout like any other device's. So a password thief who registered a device after enrolment could spend 3 wrong codes in one window and 3 in the next, close the path for the owner's devices, and do it again each time the owner opened the reopen link.

What changed:
- `src/unlock.js`: a start from a pending device is counted against that device's own cap, `PENDING_TRIES_PER_DAY` (3 in any 24 hours, a right code included), and never in the account's `limits` state. The count and the insert are one statement (`INSERT INTO pending_try ... WHERE LIVE_DEVICE AND (SELECT COUNT(*) ...) < 3`), so tries arriving together cannot pass the cap. Past the cap the start answers `locked` (423), the same word the account's lockout uses. A pending device's tries lock no window, close nothing and mail nothing. A non-pending device's start is admitted into the account's lockout exactly as before.
- A closed path still refuses a pending device (`pathClosed` in `src/lockout.js`, a read that writes nothing and counts an unreadable state as closed), and that refusal spends none of its tries and renews no link.
- `schema.sql`: new table `pending_try (device_id, at)`. `src/retention.js` purges rows a day old.
- `/unlock/finish` is unchanged: rejecting an exchange the account's state does not hold is a no-op in `limits.mjs`, so a pending device's wrong code is counted only by its start.

Tests: "A5 review 2: the probe (a pending device burns tries in two windows) leaves the owner's path open" and "A5 review 2: a pending device gets 3 tries a day, a right code included, then the next day 3 more" (`test/lockout.test.mjs`), "A5 review 2: a pending device's 3 tries a day hold when more arrive together" (`test/unlock.test.mjs`) and "a purge removes a pending device's tries once they are a day old" (`test/purge.test.mjs`) fail on `92deff6f`'s `unlock.js`, `lockout.js`, `retention.js` and `schema.sql`: the owner's right code in the thief's window answers 423 where 200 is expected, a fourth start is admitted where `locked` is expected, and `pending_try` does not exist. "A5 review 2 NEGATIVE CONTROL: a non-pending device's wrongs still close the path, for pending devices too" and "A5 review 2 NEGATIVE CONTROL: a pending device's tries are its own, so another pending device keeps its 3" pass on both. The existing test "three tries in one window are admitted even when more arrive together" used a pending second device to hold six nonces at once; that device now proves the code first, so all six starts still count in the account's window.

Left as is (residual, for Kaleb): the cap is per device, and a password thief can register more devices. `/signin` admits 20 tries per requester per hour (A4), so one address could add up to 20 pending devices an hour, each with 3 tries a day, and each try is checked against two steps. That cannot close the owner's path any more, but it is still a guess at the code. A per-account cap on pending tries would end it, at the price of letting the thief use up the owner's new-device tries too, and the sign-in limits are being changed on `feat/horae-a3-a4`. Nothing tells the owner about a pending device's tries either; the lock notes cover only the account's lockout.

### Out of scope for A5

- The PIN and the 12-hour rule (A5b), admin actions (A5c), recovery and vault switch (A6).
- Any change to Sass or JanusMirror, real secrets, real mail and any deploy.
