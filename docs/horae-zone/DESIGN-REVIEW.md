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
   - Decision: `mailer`, `replay`, `jwt` and `sealed-events` each move with the first slice that uses it (A3, A5, and Phase 9 respectively). The mailer moved in A3; `replay` and `jwt` are still in JanusMirror, since neither A3 nor A4 uses them.
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
| 3 | `pake.mjs` still uses JanusMirror's channel (`janusmirror-e2e|…`) and DST (`JanusMirror-CPace-…`), so JanusMirror can adopt the engine unchanged (A7) | `src/pake.mjs` | Add a channel parameter or a Horae Zone channel label before A5. Keep the DST, or version it with a RED test |
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
| `wrangler.toml` | No route, no environment, no secret. One `[triggers]` cron for the purge (a cron opens no URL). The D1 id is a zero placeholder that the plan §4 deploy script replaces |

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
| 7 | The D1 id is a zero placeholder | `wrangler.toml` | The deploy script writes the real id. Deploy only on the owner's word |
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
| `src/account-keys.js` | `accountKeys(env)`. HKDF from the one Worker secret `HZ_ACCOUNT_KEY` gives a separate key for each use: the address key, the address box, the code digest, the requester key and the login pepper (A4 adds the ticket digest). `hashLogin` is PBKDF2-SHA256 at 100,000 iterations over a random 16-byte salt per account, then HMAC under the pepper |
| `src/throttle.js` | `admitThrottle(db, now, windowMs, buckets)`: one `INSERT ... SELECT` that checks every bucket and records a row in each only when all are under their limit. A bucket may carry its own window (the daily cap, M2) |
| `src/index.js` | A URL with any query string is refused `shape` before any check. Handlers get `env`, the request and a mailer. A handler may return `after`, work that runs through `ctx.waitUntil` after the answer and its `ok` audit row, and that audits a failure word of its own (`mail-failed`) |
| `src/retention.js` | The hourly purge also removes spent, used-up and expired email codes, and rate-limit rows past their window (a day for the daily cap) |
| `schema.sql` | `account` (id, address_key unique, address_box, login_hash, login_salt, created_at), `challenge` (address_key, digest, expires_at, tries, used) and `throttle` (bucket, at) |
| engine `src/mailer.mjs`, `src/limits.mjs` | See the provenance table under A1 |
| `.github/workflows/horae-zone-test.yml` | Also runs when `packages/account-engine/src/**` or `vendor/**` changes, since the service now imports the engine |

**New refusal words:** `bad-code` (401) and `slow-down` (429). New audit-only word: `mail-failed`.

### Decisions

1. **Sign-up needs the email code.** `/account` makes no account, it mails a code. Only `/account/email/verify` with the live code makes the account, and the password is set in that same request (plan §3.3, first device, steps 1 and 2).
2. **The code rides in the fragment.** The mail carries `HZ_LINK_BASE#<code>`, built by the engine's `fragmentLink`, which refuses a base that is not https or already has a query or fragment. The code is also in the mail as text, so it can be typed. It is never in a query string (the service refuses any query string), a response body, an audit row or a log.
3. **Codes:**
   - 6 digits, drawn uniformly (32-bit values past the last whole million are drawn again).
   - Single use, alive 10 minutes. Up to 3 are live for an address at once, and a newer code never replaces an older one (changed by H1 below).
   - Stored only as an HMAC digest under a key derived from the service secret, bound to the address key.
   - Compared with the engine's `sameHex`, never `===`.
4. **A try is counted before the compare.** The verify takes its places in the try limits and a try on every live code (`UPDATE ... RETURNING`) and only then compares, so guesses sent together cannot pass the try limits. It compares with every live code's digest, with no early exit. The first right try spends that code with a second `UPDATE ... WHERE used = 0`.
5. **No answer says whether an address has an account.** `/account` answers `{ok:true}` for a new address and an existing one, takes the same rate-limit places for both, sends the same statements for both (M1 below), and mails only a new address. A verify for an address that was never sent a code is `bad-code`, like a wrong code.
6. **Rate limits are atomic, and a refused request is not counted.** Starts are limited per address and per requester, per mailbox for a tagged address, and per day across everyone (M2). Tries are limited per requester, per address, and per address for one requester (H1). Before a device has a key, the requester is the connecting address (`cf-connecting-ip`), stored only as a keyed hash. A request without one is refused as `shape` (L3 below).
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
| 2 | Code tries at one address per hour, from everyone (H1) | 15 | `triesPerAddressHour` |
| 3 | Codes mailed to one address per hour, and codes live at once | 3 and 3 | `codesPerAddressHour`, `liveCodes` |
| 4 | Sign-up starts per connecting address per hour | 10 | `startsPerRequesterHour` |
| 5 | Code tries per connecting address per hour, and at one address from one connecting address (H1) | 20 and 5 | `verifiesPerRequesterHour`, `triesPerAddressRequesterHour` |
| 6 | Account password length | 12 to 256 characters | `passwordMin`, `passwordMax` |
| 7 | The mail wording: subject "Horae Zone sign-up code", then "Sign-up code: <code>", "Works once. Expires 10 minutes after it was sent.", the link, and "No account is made without this code." | As written | `codeMessage` |
| 8 | Codes mailed per hour across every `+tag` of one mailbox (M2) | 3 | `codesPerMailboxHour` |
| 9 | Codes sent per day across every address and requester (M2) | 500, or `HZ_CODES_PER_DAY` when set (a plain Worker variable, not a secret) | `codesPerDay` |

### Security review findings and what changed

A security review of `3c3cac63` asked for these fixes before merge. Each one was test first: the tests below fail on `3c3cac63` and pass after the fix.

**H1 (high): anyone could lock a chosen address out of sign-up.** `startSignup` deleted the live code for the address before storing a new one, and five wrong tries ended a code, so a stranger could end the owner's code with one start or five guesses.

What changed (`src/signup.js`):
- A start never deletes or replaces a live code. Up to `liveCodes` (3) codes are live for an address at once, each with its own try count, and the insert checks that count in the same statement. The start limit (3 per address per hour) keeps the cap from being reached inside one window, and every code a stranger starts is mailed to the owner, who can use it.
- A verify compares with every live code's digest (`sameHex`, no early exit), so the owner's code works whichever start made it.
- A wrong guess no longer ends a code. Guessing is bounded by the kept per-address try cap (`triesPerAddressHour`, 15, the same total as 3 codes times the old 5 tries) and a share for one requester at one address (`triesPerAddressRequesterHour`, 5). Each code's own ceiling (`codeTries`, now 15) is never reached first, since a code lives inside one window.

Tests (`test/signup.test.mjs`): "H1: a second start leaves the first code live, so the owner's code still works", "H1: every live code for an address works, the newest included", "H1: wrong guesses from another requester do not end the owner's code", "H1: tries at one address are still capped across requesters", and "H1: the address cap stops tries before any one code reaches its own try limit". They replace "wrong tries end a code" and "a newer code replaces the older one", which pinned the old behaviour.

Left as is (residual): 15 wrong guesses at one address within an hour, from 3 or more connecting addresses, still hold that address's verifies at `slow-down` until the window passes. No guess ends the owner's code, so a code still inside its 10 minutes works once the cap lifts. Any cap on guesses is a cap a stranger can fill; this one bounds a 6-digit code to 45 in a million per address per hour (15 tries against up to 3 live codes).

**M1 (medium): the time to answer said which addresses have accounts.** `startSignup` looked the address up and, for one with an account, answered before the challenge write, so that path skipped a D1 round trip and a write.

What changed (`src/signup.js`): the separate account lookup is gone. The account check rides inside the challenge `INSERT ... SELECT` (`used` is `EXISTS (SELECT 1 FROM account ...)`), so both paths send the same statements in the same order and write one row. A row for an address with an account is born spent (`used = 1`): it never verifies, never counts toward the live cap, no mail goes out for it, and the hourly purge removes it.

Test (`test/signup.test.mjs`): "a start sends the same statements whether or not the address has an account" compares the statements each start binds (the D1 test double keeps every bound statement) and checks that only the new address holds a code that can verify.

Left as is (residual): the mail for a new address runs after the answer (`ctx.waitUntil`), so it adds no time to the answer, but the two paths still differ in work after the answer is sent.

**M2 (medium): the per-address limits could be stepped around.** `addressOf` took any non-space, non-control character, so a zero-width or soft-hyphen character, a look-alike letter in the local part, or a new `+tag` each made a new address key for the same mailbox, with fresh limits. Nothing capped the codes sent in a day across every address.

What changed:
- `addressOf` (`src/signup.js`) refuses, as `shape`, an address holding a format character (`\p{Cf}`: zero-width space, joiner and non-joiner, word joiner, byte-order mark, soft hyphen) anywhere, and a local part that is not printable ASCII. Sign-in uses the same check, so it refuses the same addresses before any write.
- A start for a tagged address (`name+tag@domain`) also takes a place in a per-mailbox bucket keyed on the address with the tag stripped (`codesPerMailboxHour`, 3). That key is for the limit only: the account key stays the full address, tag included. An untagged address is its own mailbox and keeps its own per-address bucket, so a flood of tags cannot stop the owner's sign-up at the plain address. Mail to one mailbox is bounded at 3 an hour for the plain address plus 3 an hour across all its tags.
- Every start takes a place in one global bucket, `codes-day`, over a 24-hour window. The cap is `HZ_CODES_PER_DAY` when set and `SIGNUP_LIMITS.codesPerDay` (500) when not. A value that is set but is not a whole number of 1 or more answers `unavailable` and writes nothing, so a typo stops starts instead of opening the cap. Both paths of M1 take this place, so the statements still match. `admitThrottle` takes a window per bucket for this, and the hourly purge keeps `codes-day` rows for a day.

Tests: in `test/signup.test.mjs`, "M2: an address with a format or zero-width character, or a non-ASCII local part, is refused as shape" (at `/account`, `/account/email/verify` and `/signin`, with nothing written or counted), "M2: starts for every +tag of one mailbox share one limit, and the plain address is not held by it", "M2: codes sent are capped per day across every address and requester" and "M2: without configuration the daily cap is the default, and a bad value refuses starts"; in `test/purge.test.mjs`, "M2: a purge keeps daily-cap rows for a day and clears them after". Two NEGATIVE CONTROLs pass before and after: an ASCII local part with a dot, a plus or a non-ASCII domain still starts, and the account key stays the full address.

Left as is (residual):
- A non-ASCII domain is still taken as written. Mail systems map some spellings of a domain (full-width letters, for one) to the same ASCII domain, so those spellings still make new address keys for one mailbox. They still pay the requester and daily limits. Converting the domain to its ASCII form at the boundary would close it (open point 6).
- Providers that ignore dots in the local part (`first.last` and `firstlast`) give two address keys for one mailbox. Only `+tag` is stripped, because dot rules differ by provider.
- Anyone can fill the daily cap from many connecting addresses (each at 10 starts an hour) and stop sign-up for everyone until the day passes. The cap trades that for a bound on mail sent, and the WAF rate rule at the first deploy is the second layer.

**M5 (medium): one password could hash two ways.** `hashLogin` hashed the password's code points as sent. The same password typed on two keyboards can arrive composed (`é` as one point) or decomposed (`e` plus a combining accent), or with a compatibility form (a ligature, a full-width letter), so an owner who set it on one device was refused on another.

What changed (`src/account-keys.js`): `hashLogin` normalises the password with NFKC before PBKDF2. Sign-up, sign-in and the throwaway hash for an address with no account all go through `hashLogin`, so all three hash the same form. No database exists yet, so no stored hash needs moving.

Tests (`test/devices.test.mjs`, since a sign-in is needed to check the stored hash): "M5: a password set in NFC form signs in from its NFD form, and the other way round" and "M5: a compatibility form (a ligature) signs in as its plain letters" fail on `3c3cac63` (401, expected 200). "M5 NEGATIVE CONTROL: a password that differs after normalising is still refused" passes on both.

Left as is (residual): the length rules (12 to 256 at sign-up, 1 to 256 at sign-in) read the password as sent, not its normalised form. A decomposed password counts its combining marks, and a few compatibility characters expand under NFKC (one Arabic ligature becomes 18 characters), so the hashed form can be shorter than 12 or longer than 256. Neither changes what the hash accepts, and PBKDF2 takes any length.

**L3 (low): a request with no connecting address shared one bucket.** `requesterOf` read a missing `cf-connecting-ip` as the word `none`, so every such request (a misrouted call, a test client, a future service binding) was counted under one requester, and a few of them filled that bucket for all the rest.

What changed (`src/signup.js`, `src/signin.js`): `requesterOf` refuses a missing or blank `cf-connecting-ip` as `shape`. `/account`, `/account/email/verify` and `/signin` call it with the other shape checks, before the account key is read and before any throttle row, code, ticket or mail. Cloudflare sets the header on every request through its edge, so a real client never meets this refusal.

Test (`test/signup.test.mjs`): "L3: a start, verify or sign-in without a connecting address is refused as shape and writes nothing" (no header, an empty one and a blank one, at all three routes). On a `3c3cac63` extract the three routes answered 200, `bad-code` and `bad-login` and wrote throttle rows. "L3 NEGATIVE CONTROL: the same start with a connecting address is admitted and counted under it" passes on both.

Left as is (residual): the header is trusted as Cloudflare sets it. A request reaching the Worker by a path that lets the caller set the header would choose its own bucket; no such path exists (no route but the edge, no service binding).

### Open points for the reviewer

| # | Point | Where | Proposed resolution |
|---|---|---|---|
| 1 | Before a device has a key, "per device" means per connecting address. Users behind one address (a clinic network) share a bucket, and a changing address escapes it | `requesterOf` in `src/signup.js` | Accept for now; the WAF rate rule at the first deploy adds a second layer |
| 2 | When two right tries race, the loser answers `bad-code` though its code was right | `verifySignup` | Accept; the winner made the account |
| 3 | The mail goes out through `ctx.waitUntil`. If the Worker is stopped before the send, the code is stored but never mailed, and nothing is audited | `src/index.js` | Accept; the user asks for another code |
| 4 | Not run against a real Resend or a real `wrangler dev`, because wrangler is not installed in the authoring environment, so the bundle with its `../../../packages/account-engine` imports is unchecked by wrangler. The engine's runtimes test loads `mailer.mjs` in `workerd` and Chromium | - | The reviewer runs the `wrangler dev` smoke test in the test plan |
| 5 | Changing `HZ_ACCOUNT_KEY` makes every stored address key, address box, code digest and login hash unusable | `src/account-keys.js` | A rotation plan (keep the old secret to re-derive) before the first real account |
| 6 | A non-ASCII domain is taken as written, so spellings a mail system maps to one domain make separate address keys (M2 residual) | `addressOf` in `src/signup.js` | Convert the domain to its ASCII form (`new URL`'s host does this in Workers) before the address key, RED first |

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
3. **Sign-in does not say whether an account exists.** A wrong password and an unknown address both answer `bad-login`, and the unknown address still runs one full password hash with a fixed throwaway salt, so both take the same time. Every try is limited per requester (across addresses). Wrong passwords are limited per address (from any requester), and a success is not counted there. A sign-in signed by a registered device of the account skips the address limit (changed by H2 below). A sign-in without a connecting address is `shape`, as at sign-up (A3, L3).
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
| 2 | Wrong sign-in passwords per address per hour, from everyone; a success and a sign-in signed by a device of the account are not counted (H2) | 10 | `SIGNIN_LIMITS.perAddressHour` |
| 3 | Sign-in tries per connecting address per hour | 20 | `SIGNIN_LIMITS.perRequesterHour` |
| 4 | Live nonces per device | 5 | `LIVE_NONCES_PER_DEVICE` |
| 5 | Who may remove a device: any signed device of the account, itself included, with no fresh Face ID, password or code. Plan §3.5 says "Remove it on the admin or account screen" and does not say what proof that screen asks for | No extra proof | `removeDevice` |
| 6 | How long removed device rows are kept | No purge | `src/retention.js` |

### Security review findings and what changed

The same review of `3c3cac63` (see A3) asked for these fixes before merge, each test first: the tests below fail on `3c3cac63` and pass after the fix.

**H2 (high): anyone could lock the owner out of `/signin`.** The per-address bucket counted every try, from any requester, a success included. Ten wrong passwords from ten connecting addresses held the owner's right password at `slow-down` for the hour, and the owner's own sign-ins filled the same bucket.

What changed:
- A new route kind, `signable` (`src/routes.js`, `src/index.js`), used only by `/signin`. A request without `x-hz-device` is `open` as before. A request that names a device passes every signed check (the device is registered and not removed, the nonce is fresh and its own, the signature covers `/signin` and the body), and a bad one is refused (`no-device`, `stale-nonce`, `bad-signature`), never treated as unsigned.
- `signIn` (`src/signin.js`) looks the account up first. When the request was signed by a device of that account, only the per-requester bucket is taken; otherwise both buckets are, in one statement as before.
- A success takes back its place in the address bucket, in the same batch that stores the ticket (`releaseThrottle` in `src/throttle.js`). Taking the place first and giving it back on success keeps the cap atomic: tries sent together still cannot pass it.

Tests (`test/devices.test.mjs`): "H2: after ten wrong passwords from ten requesters, the owner signs in from a registered device", "H2: a successful sign-in is not counted against the address", "H2: wrong passwords alone still fill the address bucket, and a success does not empty it", and "H2: a sign-in that names a device must carry its good signature, never falling back to unsigned" fail on `3c3cac63`. "H2 NEGATIVE CONTROL: a device of another account does not lift the address bucket" and "H2 NEGATIVE CONTROL: a signed sign-in still pays the per-requester bucket" pass on both, and guard the bypass from widening. `test/checks.test.mjs` now lists `signable` among the route kinds and pins `/signin` as its only route.

Left as is (residual): a first device has no key to sign with, so strangers who fill the address bucket still hold back the owner's first sign-in on a new device for up to an hour. A device of the account that has been stolen (its key with it) can try passwords at the per-requester rate without the address cap; removing it (A4 decision 5) stops that at once.

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
| 1 | Sign-in asks no authenticator code yet, because no account has one until A5 (plan §3.6: "Email + password + code") | `src/signin.js` | A5 adds the code to `/signin`, RED first |
| 2 | `/device/register` has no rate limit of its own | `src/devices.js` | Accept: the ticket is 256-bit and single use |
| 3 | ~~A ticket is not bound to the keys it will register, so whoever holds it during its 5 minutes picks the keys~~ | `src/devices.js` | **Closed by M3** (security review, RED first): `/signin` takes the key digest and the ticket registers only those keys |
| 4 | No cap on devices per account | `src/devices.js` | Decide with the account screen slice |
| 5 | App Attest is not checked (plan §3.6: "later") | `src/devices.js` | A later slice |
| 6 | `device.agree_key` is nullable, because the A2 tests and the vector test add devices without one. `/device/register` always sets it | `schema.sql` | Make it `NOT NULL` once the test helpers pass one |
| 7 | Removing a device does not revoke its Cloudflare and Anthropic tokens; the plan puts that in a runbook | - | The runbook in Sass `docs/ios.md` |
| 8 | The A2 leak sweep now lets each unspent nonce expire between routes, because open routes never spend the nonce the sweep fetches for them, and the cap would refuse the sixth | `test/leak.test.mjs` | None; what the sweep checks is unchanged |

### Out of scope for A4

- The authenticator code, unlock and its lockout (A5), the PIN (A5b), admin actions (A5c) and recovery (A6).
- Bringing a vault to a new device (`/pair/offer`, `/pair/take`).
- Any change to Sass or JanusMirror, and any deploy.
