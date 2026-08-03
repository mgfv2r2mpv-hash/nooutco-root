# bt-profile-api

The technician style profile store. It learns how a given behavior technician
writes — from the corrections they make to generated notes — and hands the tools
app a short block of abstract style rules to fold into the system prompt.

## What it may never hold

Clinical text. Note prose. Client identifiers. Anything a technician typed.

Every column in `schema.sql` is a number, a timestamp, a login-code id, or a
value drawn from the closed list in `src/features.js`. The browser measures a
diff and sends a **feature name plus a direction** — never the words that
changed. `src/validate.js` rebuilds every payload from an allowlist and *drops*
anything that is not already a number or boolean rather than coercing it, because
coercion is exactly how a note ends up stored as `[object Object]`.

Treat "is this column content-free?" as a review gate on any future migration.

## Why it has no public URL

`wrangler.toml` sets `workers_dev = false` and deliberately declares no
`[[routes]]`. **Ingress is the security control.** The only way to reach this
Worker is the `PROFILE` service binding on the tools Pages project, so a
technician holding a valid session token still cannot read or forge another
technician's profile — there is no address to send the request to.

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
correction. If the evidence later flips the *direction*, the mute is cleared —
the rule has become its own opposite, and the technician never objected to that
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

# 4. Bind it on the tools Pages project, under env.production AND env.preview:
#      "services": [{ "binding": "PROFILE", "service": "bt-profile-api" }]
```

## Local development

No account resources needed — miniflare keeps an on-disk sqlite:

```bash
npm run db:local     # apply schema.sql to the local D1
npm run dev          # http://127.0.0.1:8787
npm test             # derivation + validation unit tests
```

`npm test` is plain `node --test` with no dependencies, matching the repo's
no-build-step convention.
