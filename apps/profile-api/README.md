# bt-profile-api

The technician style profile store. It learns how a given behavior technician
writes - from the corrections they make to generated notes - and hands the tools
app a short block of abstract style rules to fold into the system prompt.

## What it may never hold

Clinical text. Note prose. Client identifiers. Anything a technician typed.

Every column in `schema.sql` is a number, a timestamp, a login-code id, or a
value drawn from the closed list in `src/features.js`. The browser measures a
diff and sends a **feature name plus a direction** - never the words that
changed. `src/validate.js` rebuilds every payload from an allowlist and *drops*
anything that is not already a number or boolean rather than coercing it, because
coercion is exactly how a note ends up stored as `[object Object]`.

Treat "is this column content-free?" as a review gate on any future migration.

## Why it has no public URL

`wrangler.toml` sets `workers_dev = false` and deliberately declares no
`[[routes]]`. **Ingress is the security control.** The only way to reach this
Worker is the `PROFILE` service binding on the tools Pages project, so a
technician holding a valid session token still cannot read or forge another
technician's profile - there is no address to send the request to.

That is also why this Worker does not verify the session token itself: it has no
access to `ADMIN_SECRET` and no independent way to. It trusts the caller for
*identity* only, and validates everything else.

Adding a route here would silently undo all of that.

## Routes (internal)

| Route | Purpose |
|---|---|
| `GET /health` | Liveness, used by the caller's fail-open probe |
| `POST /events` | Record corrections and usage metrics; rebuilds the card when corrections arrive |
| `GET /style-card?kid=…` | The card plus the rendered `block` for prompt injection |
| `POST /style-card/mute` | Technician switches one rule off |

## How a rule is earned

A signal becomes a rule only when it clears **both** bars in `src/features.js`:
at least `MIN_EVIDENCE` (5) observations, and at least `MIN_CONFIDENCE` (0.7)
agreement among them. Recent corrections outweigh old ones on a 90-day
half-life, so a technician whose style genuinely changes is not held to what they
did six months ago.

These are deliberately strict. A wrong rule quietly degrades every note that
technician writes, and they have no way to tell it is the cause.

A muted rule keeps its evidence, so it can resurface if they keep making that
correction. If the evidence later flips the *direction*, the mute is cleared - the rule has become its own opposite, and the technician never objected to that
one.

## Setup

```bash
# 1. Create the database (one time, on the Cloudflare account)
npx wrangler d1 create bt-profiles
#    → copy the printed uuid into database_id in wrangler.toml

# 2. Apply the schema
npm run db:remote

# 3. Deploy
npm run deploy

# 4. Bind it on the tools Pages project. THIS IS A DASHBOARD STEP, not a repo
#    change: CI deploys with `pages deploy apps/tools` from the repo root and
#    never reads apps/tools/wrangler.jsonc, so a "services" entry there deploys
#    nothing. Workers & Pages -> the project -> Settings -> Bindings -> Add ->
#    Service binding -> name PROFILE -> service bt-profile-api. Do it for
#    Production and Preview, then redeploy for it to take effect.
```

Verify what is actually bound, rather than trusting the repo file:

```bash
npx wrangler pages download config dev-tools-nooutco-me
```

If the output has no `services` entry, the binding is not live and
`/api/admin/style-insights` will return `available: false`.

## Local development

No account resources needed - miniflare keeps an on-disk sqlite:

```bash
npm run db:local     # apply schema.sql to the local D1
npm run dev          # http://127.0.0.1:8787
npm test             # derivation + validation unit tests
```

`npm test` is plain `node --test` with no dependencies, matching the repo's
no-build-step convention.

`test/suppression.live.test.js` applies `schema.sql` **and every file in
`migrations/`** to the local D1 before it starts, which the section below
explains. Skipping the migrations is not theoretical: that test began failing
with an undefined `rules` the moment `shape_profile` grew a column.

## Migrations

`schema.sql` is re-runnable and every statement in it is `CREATE TABLE IF NOT
EXISTS`, so it can create a table and it can never alter one. Anything that
changes an existing table is a dated file in `migrations/`, run once:

```bash
npx wrangler d1 execute bt-profiles --local  --file migrations/<name>.sql
npx wrangler d1 execute bt-profiles --remote --file migrations/<name>.sql
```

Write them so a second run **fails on its first statement**. SQLite refuses to
add a column that already exists, so putting the `ALTER TABLE` lines first makes
an accidental re-run stop before it reaches anything destructive. That ordering
is load bearing, not stylistic.

Keep `schema.sql` and the migration in step: a fresh database gets the finished
shape from `schema.sql` alone and never runs the migration at all.

## Weekly self-audit email

Fires Friday 20:00 America/New_York and emails a summary of the week against the
prior four. Lives here rather than in the tools Pages worker because Pages
Functions cannot carry a cron trigger, and because the data being summarised is
already in this Worker's D1.

**It reads numbers only.** `usage_metric` and `correction_event` contain
counts, ratios, timestamps and closed-list enums. No note text exists in this
database, which is what makes emailing a summary acceptable at all.

### What it needs before it will send

Two secrets, neither of which is set yet. Until `RESEND_API_KEY` exists the
scheduled run still executes and still logs what it would have sent, it just
does not deliver.

```sh
npx wrangler secret put RESEND_API_KEY   --config apps/profile-api/wrangler.toml
npx wrangler secret put AUDIT_TO_EMAIL   --config apps/profile-api/wrangler.toml   # optional, defaults to the maintainer
```

The from address is `noreply@nooutco.me`, matching the sender the tools worker
already uses, so no new domain verification is required.

### Daylight saving

Cron is UTC and has no notion of DST, so a single fixed hour would deliver at
20:00 for half the year and 19:00 for the other half. Both candidate hours fire
(`0 0 * * 6` and `0 1 * * 6`) and `isSendHour` in `src/weekly.js` decides which
firing is really 20:00 in New York. The other firing is a no-op costing one
`Intl` call. `test/weekly.test.js` pins both the summer and winter cases.

### Checking it without waiting for Friday

```sh
npx wrangler dev --config apps/profile-api/wrangler.toml --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+0+*+*+6"
```
