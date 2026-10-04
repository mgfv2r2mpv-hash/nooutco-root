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
   - Decision: `mailer`, `replay`, `jwt` and `sealed-events` each move with the first slice that uses it (A3, A5, and Phase 9 respectively).
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
| 1 | ~~Redistributing the blocklist in a public repository~~ | — | **Decided** 2026-10-03, "private package" (see the rulings above) |
| 2 | ~~The "no runs" definition~~ | — | **Decided** 2026-10-03, runs wrap (see the rulings above) |
| 3 | `pake.mjs` still uses JanusMirror's channel (`janusmirror-e2e|…`) and DST (`JanusMirror-CPace-…`), so JanusMirror can adopt the engine unchanged (A7) | `src/pake.mjs` | Add a channel parameter or a Horae Zone channel label before A5. Keep the DST, or version it with a RED test |
| 4 | The `limits` renames diverge from JanusMirror until A7 | `src/limits.mjs` | A7 maps JanusMirror's callers to the new names |
| 5 | `src/probe.mjs` is test support that ships in `src/` | `src/probe.mjs` | Keep it (it is tiny and pure), or move it under `test/` and have the browser and `workerd` loaders embed it from there |
| 6 | `vendor/refresh-noble.sh` uses BSD `sed -i ''` and `shasum`, so it runs on macOS only (as in JanusMirror) | `vendor/refresh-noble.sh` | Leave it, and document that the refresh runs on a Mac |
| 7 | The `workerd` test finds a free port by closing a probe listener, which leaves a small race, and waits up to 10 s. The browser test needs a Chromium that Playwright can find (when it could not, the test used to hang the run with its server open; since `df1f0d5` it fails promptly) | `test/runtimes.test.mjs` | Accept it for now. If the race ever fires, pass `127.0.0.1:0` and read the bound port from `workerd`'s output |
| 8 | ~~There is no CI workflow for the package~~ | — | **Decided** 2026-10-03, "ye": `account-engine-test.yml` |
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
| 1 | `/device/register` is `open`: a device has no key before it registers | `src/routes.js` | A4 must require the ticket from `/signin` before building a handler. A RED test for that goes first in A4 |
| 2 | `/nonce` needs only a known device id, so anyone holding an id can mint nonces. The purge is **decided** (hourly, decision 6); the cap is not | `src/checks.js` `issueNonce` | A per-device cap on live nonces (for example 5) in A4, and the WAF rate rule at the first deploy |
| 3 | ~~The `audit` table grows without limit~~ | — | **Decided** 2026-10-03: kept 6 years, purged by the hourly cron (decision 6) |
| 4 | The signed-bytes builder lives in the service, but Sass and JanusMirror must build the same bytes | `src/checks.js` `signedBytes` | Move it into `packages/account-engine` in A4, with a shared test vector |
| 5 | The size check trusts `content-length` only as a fast path. The body is still buffered before the real size is known (the Workers platform caps request bodies) | `src/checks.js` `readBody` | Accept, or stream-read with a byte counter |
| 6 | The tests import the profile-api helper by relative path, which couples the two apps | `test/helpers.mjs` | Move it to `packages/shared/worker` if a third app needs it |
| 7 | The D1 id is a zero placeholder | `wrangler.toml` | The deploy script writes the real id. Deploy only on the owner's word |
| 8 | Not yet run under `wrangler dev --local`, because wrangler is not installed in the authoring environment. A `workerd` smoke test with no D1 bound loaded the Worker, which answered `unavailable` and printed nothing | — | The reviewer runs the `wrangler dev` smoke test in the test plan |
| 9 | ~~There is no CI workflow~~ | — | **Decided** 2026-10-03, "ye": `horae-zone-test.yml` |

### Out of scope for A2

- Every route handler except `/nonce`.
- Accounts, email, codes and PINs.
- Any deploy.
