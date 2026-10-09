# Horae Zone deploy

You must be logged in to Cloudflare with wrangler (`wrangler login`) on the Mac you run this from, and you need the Resend API key at hand. The script also asks for the Turnstile widget's two keys; it prints the clicks to make the widget first (item 8 below). The script deploys a live Worker at `horae-zone.nooutco.me`, so run it only when you mean to.

## The one command

From the repo root, in Mac Terminal:

```
cd apps/horae-zone
node bin/deploy.mjs
```

To see every step and command first, with nothing run, asked, written or fetched:

```
node bin/deploy.mjs --dry-run
```

The dry run lists each prompt with the rule its answer is checked against, each generated key and each secret put as `[masked]` (it generates no key), and the tables and secret names the checklist expects.

After a deploy, to run only the checks and the checklist again (step 6 below), with nothing asked, changed or written:

```
node bin/deploy.mjs --check-only
```

It needs no secret: it reads the account, the table list and the secret names (never a value), and fetches the route. It picks the account without asking (the only one logged in, else the one `CLOUDFLARE_ACCOUNT_ID` names) and stops when it cannot tell which. Before the first deploy it stops at once ("wrangler.deploy.toml is not here"). The cron trigger and the rate rule show as SKIPPED with where to look in the dashboard, since a checks-only run has no deploy output and asks nothing.

## What it asks

The script first prints the wrangler version it found (`wrangler --version`) and stops there if wrangler is missing. Every wrangler call runs with `WRANGLER_LOG_SANITIZE=true`, so a shell that turned wrangler's log redaction off cannot turn it off for this run.

1. The Cloudflare account it found (type `y`, or the account's number when you have more than one). It stops here and creates nothing if you say no. When that account already has a Worker named `horae-zone` (`wrangler deployments list --name horae-zone --json`), the script prints "Worker horae-zone already exists; this will replace its code" and goes on only on `y`; anything else, or a check that cannot tell, stops the run with nothing changed.
2. The Resend API key (`RESEND_KEY`), on a hidden prompt (nothing shows as you type, arrow keys do nothing, and Ctrl-C or Ctrl-D cancels).
3. The from-address for sign-up mail (`HZ_MAIL_FROM`), on the domain you verified in Resend (`Horae Zone <mail@your-domain>` works).
4. The alert address (`HZ_ALERT_TO`), mailed once a day when sign-ups reach half the daily cap.
5. The sign-up link base (`HZ_LINK_BASE`): the https page that reads the code after `#`.
6. The reopen link base (`HZ_REOPEN_BASE`): the https page that reads the reopen token after `#`, mailed when a code path closes. The script checks it with the Worker's own check (`reopenBaseOk` in `src/unlock.js`): https, no `?` and no `#`.
7. The PIN reset link base (`HZ_RESET_BASE`): the page on the device that reads the emailed reset code after `#`, mailed when a device asks to reset a forgotten app PIN. Checked the same way: https, no `?` and no `#`.
8. The Turnstile widget's keys, after the clicks to make the widget (dashboard > Turnstile > Add widget: name horae-zone, hostname `horae-zone.nooutco.me` only, mode Managed, pre-clearance No):
   - the site key (`HZ_TURNSTILE_SITEKEY`), a public value the challenge page shows, kept as a Worker var in `wrangler.deploy.toml`;
   - the secret key (`HZ_TURNSTILE_SECRET`), on a hidden prompt, put as a Worker secret.

   Each must be a production key (it starts `0x`). Cloudflare's test keys (`1x`, `2x`, `3x`) are refused: the `1x` secret passes every token, so one set by mistake would switch the check off. Until both are set, `POST /account` and an unsigned `POST /signin` answer `not-configured` (503) and `GET /challenge` shows the same sentence; nothing fails open.
9. The mail plan's daily send limit (`HZ_CODES_PER_DAY`, blank keeps 100, the Resend free plan's daily limit; type the plan's limit on a paid plan).
10. Whether the rate rule is in place. The script prints the exact clicks for it before the route goes live, so you can add it in the dashboard while it waits.
11. Which account is yours, only when Step 6 finds accounts and no administrator yet (below). It lists them oldest first by creation time and device count; type the number, or leave it blank to set none. The script reads your pick back and sets it only on `y`, since the first administrator is set once.

A bad answer is asked again, up to 3 times. All answers are asked before anything is created.

## What it does

1. Finds the D1 database `horae-zone`, or creates it (from an empty temp folder, so wrangler cannot edit `wrangler.toml`).
2. Writes `wrangler.deploy.toml` next to `wrangler.toml`: the real database id, the route `horae-zone.nooutco.me` as a Custom domain (always proxied, so `cf-connecting-ip` comes from the Cloudflare edge), `workers_dev = false`, the Turnstile site key, and the daily limit when you gave one. It holds no secret and is gitignored. The committed `wrangler.toml` keeps its zero id and no route (`test/config.test.mjs`).
3. Applies `schema.sql` to the remote database in two passes, with a column step between them. Every statement is `IF NOT EXISTS`, so a rerun changes nothing, and so a table already there keeps the columns it had: `CREATE TABLE IF NOT EXISTS` never adds a column. On 9 Oct 2026 that left production's `device` table without `confirmed_at` while the deployed code wrote it, and every unlock answered 500 until the column was added by hand. A `CREATE INDEX` on a column a table lacks would fail outright with `no such column`, so the order is:
   - First pass: only the `CREATE TABLE` statements of `schema.sql`, as one `wrangler d1 execute --command`. A new table is made here; a table already there is left as it is.
   - The column step: the script reads each table's columns on the remote database (`PRAGMA table_info`, one table at a time) and compares them with the columns `schema.sql` declares (`bin/deploy-columns.mjs` runs `schema.sql` on an empty in-memory SQLite database and reads the same `PRAGMA` there, so both sides are SQLite's own report).
   - A missing column that is nullable, or has a constant `DEFAULT` (a number, a string, `TRUE` or `FALSE`), is added with `ALTER TABLE <table> ADD COLUMN`, using the definition `schema.sql` gives it. The script prints each one it adds, and each is a checklist line, for example `Column added device.confirmed_at`.
   - Anything else stops the run before the Worker deploys, with nothing altered and one plain sentence per table and column: a missing `NOT NULL` column with no constant `DEFAULT` (the rows already there would have no value for it), a missing `PRIMARY KEY` or `UNIQUE` column (SQLite cannot add one), a column whose type, `NOT NULL`, `DEFAULT` or key differs, or a column `schema.sql` no longer declares. The old Worker keeps running. Fix the database by hand or change `schema.sql`, then run the command again.
   - An `ALTER TABLE` that fails stops the run before the Worker deploys, naming the table and column and printing wrangler's own reason after `wrangler said:`. A column added before it stays.
   - Then the check: every table it added a column to is read again, and a table that still differs from `schema.sql` stops the run there, also before the Worker deploys. When every table matches, the checklist shows `Columns match schema.sql` as PASS.
   - Second pass: the whole of `schema.sql` with `--file`, for its indexes and triggers, once every column they name is there.
4. Reads the Worker's secret list (names only), then deploys the Worker and puts each secret with `wrangler secret put`, the value on stdin: `HZ_ACCOUNT_KEY`, `HZ_SEED_KEY`, `HZ_TICKET_KEY`, `RESEND_KEY`, `HZ_MAIL_FROM`, `HZ_ALERT_TO`, `HZ_LINK_BASE`, `HZ_REOPEN_BASE`, `HZ_RESET_BASE`, `HZ_TURNSTILE_SECRET`. A key already set is kept (below). A list the script cannot read stops the run before the deploy, with the Worker and its secrets untouched ("could not read the secret list; the Worker and its secrets were not changed"); only wrangler's answer that the Worker is not found, on a first deploy, reads as no secrets yet.
5. Sets your account as the first administrator (A5c), once. When an administrator is already set it changes nothing and asks nothing. When no account exists yet (the first deploy, before you sign up in the app) it shows SKIPPED and names `node bin/deploy.mjs --owner-admin` to run after sign-up. Otherwise it asks which account is yours (item 11 above) and runs one write that adds the role only while no account holds it.
6. Checks everything and prints the checklist. The Turnstile site key is a Worker var, so the secret list cannot show it: the checklist reads it from `wrangler.deploy.toml` instead.

The script makes three keys itself, puts each through stdin and never prints one:

- `HZ_ACCOUNT_KEY`: 32 random bytes, base64url. The PIN pepper, the ticket digest key and the address and link sealing keys are all derived from it (`src/account-keys.js`), so there is no separate pepper to set.
- `HZ_SEED_KEY`: 32 random bytes of its own, base64url. A5 seals each authenticator seed under an AES-GCM key derived from it (`seedBoxKey` in `src/otp.js`), not from the account key.
- `HZ_TICKET_KEY`: an ECDSA P-256 private key the script makes with WebCrypto, as a JWK. A5 signs each ticket with it (`src/unlock.js`); a derived key cannot stand in for a signing key, so it is generated rather than derived.

A new account key would make every stored account unreadable, a new seed key every enrolled authenticator code unusable, and a new ticket key would void every ticket already issued, so a rerun keeps each one already set and says "Kept HZ_ACCOUNT_KEY", "Kept HZ_SEED_KEY" or "Kept HZ_TICKET_KEY".

`node bin/deploy.mjs --new-account-key` replaces `HZ_ACCOUNT_KEY` and `HZ_SEED_KEY` together (fine after a test deploy, never once real accounts exist). When either is already set, or the secret list cannot be read, the script prints that every enrolment, ticket and account becomes unusable and goes on only if the owner types `replace`; any other answer stops the run before the deploy ("HZ_ACCOUNT_KEY not replaced; the Worker and its secrets were not changed").

`node bin/deploy.mjs --new-ticket-key` replaces `HZ_TICKET_KEY` alone. Every ticket already issued stops working (each lives 5 minutes), and accounts are not affected. When a ticket key is already set the script says so and goes on only on `y`; anything else stops the run before the deploy ("HZ_TICKET_KEY not replaced; the Worker and its secrets were not changed").

## What to expect at the end

```
CHECKLIST
  PASS    Cloudflare account                 <name> (confirmed by you)
  PASS    Database present                   created
  PASS    Columns match schema.sql           27 tables, every column as schema.sql declares it
  PASS    Worker deployed                    horae-zone, route horae-zone.nooutco.me (Custom domain)
  SKIPPED Owner as administrator             no account yet: sign up, then node bin/deploy.mjs --owner-admin
  PASS    Schema applied                     27 tables present
  PASS    Secret HZ_ACCOUNT_KEY              set (name only)
  ...
  PASS    Turnstile site key HZ_TURNSTILE_SITEKEY  a Worker var in wrangler.deploy.toml
  PASS    Cron trigger                       0 * * * * (hourly purge)
  PASS    Route answers                      GET /account refused as method (405) through the Cloudflare edge
  PASS    Edge rule on /account, /signin and /recover  confirmed by you

RESULT: PASS
```

Any FAIL line names what is wrong. A fresh Custom domain can take a minute to answer, and the route check tries 6 times, 10 seconds apart, before it fails.

The script never prints a secret value, never puts one on a command line or in a file, and fails a check whose output carries one (`test/deploy.test.mjs`, "NEGATIVE CONTROL: a planted token in a check's output is caught"). The mask also covers each value's JSON-escaped and URL-encoded forms, so an address like `"Horae Zone" <mail@...>` echoed back as `\"Horae Zone\"` or `%22Horae%20Zone%22` is masked too.

## Set yourself as administrator (after sign-up)

The admin routes (`/admin/status`, `/admin/unlock-pins`, `/admin/unlock-account`) answer only a device whose account holds the admin role. You sign up in the app like anyone else, so the first deploy has no account to make administrator. Once you have signed up, from the repo root, in Mac Terminal, on a Mac where `node bin/deploy.mjs` has run:

```
cd apps/horae-zone
node bin/deploy.mjs --owner-admin
```

It runs Step 6 alone: no deploy, no secret, no other write. It picks the Cloudflare account the way `--check-only` does, reads the role and account tables, lists the accounts oldest first by creation time and device count (the database keeps no address in the clear, so pick yours by when you signed up), asks for the number of yours, and reads the pick back for a `y`. The one write adds the admin role to that account only while no account holds it, so it sets the first administrator once and never a second. An administrator already set is reported as PASS with nothing changed.

## Break glass: unlock an account the offline block locked

An administrator unlocks an account that a device locked through `/pin/blocked`, or through `/offline/report` with ten wrong offline PINs (ten wrong PINs offline, then the device's report), with `/admin/unlock-account` (A5c), from a device of another account. Every device route of the locked account answers `account-locked` (423), the admin routes included, so when the locked account is the only administrator's own, or no administrator is set yet, nothing in the product unlocks it. This runbook is the way out then, and it writes to the live database, so run it only for an owner who asked, after the owner has shown the inbox is theirs (for example by forwarding the "Horae Zone: account locked" note). Kaleb's ruling on `/pin/blocked` is `docs/horae-zone/DESIGN-REVIEW.md`, A5b, Decisions for Kaleb row 24, MEDIUM-1.

The database keeps no address in the clear, so the lock is found by its time. From the repo root, in Mac Terminal, on a Mac where `node bin/deploy.mjs` has run (it writes the gitignored `wrangler.deploy.toml` with the real database id):

1. List the locks, newest first:

   ```
   cd apps/horae-zone
   wrangler d1 execute horae-zone --remote --config wrangler.deploy.toml --command "SELECT account_id, locked_at FROM account_lock ORDER BY locked_at DESC"
   ```

   `locked_at` is milliseconds since 1970 (UTC). Pick the row whose time matches the owner's "account locked" note. When more than one row is near that time, stop and do not guess.

2. Delete that one row, the same statement `unlockAccount` in `src/account-lock.js` runs, with the id from step 1 in place of `ACCOUNT_ID`:

   ```
   wrangler d1 execute horae-zone --remote --config wrangler.deploy.toml --command "DELETE FROM account_lock WHERE account_id = 'ACCOUNT_ID' RETURNING account_id"
   ```

   One row back means the account is unlocked; no row means the id did not match and nothing changed. The owner's devices then answer as before, the PIN included (unlocking resets no PIN and reopens no closed PIN or code entry, which keep their own emailed links).

## By hand, in the dashboard

The script prints each of these with its exact clicks, so you can do them while it waits.

1. The rate rule on POST `/account`, `/signin` and `/recover`, required at the first deploy (`docs/horae-zone/DESIGN-REVIEW.md` A3 item 13; `/recover` joined it with A6, so the rule live since 8 Oct 2026 at 2 requests per 10 seconds per IP needs `"/recover"` added to its expression). Turnstile (`src/turnstile.js`) is the check that bounds a stranger with many addresses on `/account`, `/signin` and the `/recover` start (#301); the rate rule stays as the backstop on all three, stopping a one-address flood at the edge before the Worker spends a siteverify call. Step 4 prints it before the route goes live and asks whether it is in place.
   The Turnstile widget itself is made before Step 2's prompts; the script prints those clicks there (item 8 under What it asks).
2. The hostname and DNS checks, printed in the checks step under "Check after the deploy". The Worker and its Custom domain exist only once the deploy has run, so Workers & Pages > horae-zone > Settings > Domains & Routes (the hostname) and DNS (shown as Proxied) are checked then, not before.
3. The skip rule, required when the zone runs Super Bot Fight Mode. Its definitely automated setting (a managed challenge) answers GET `/account` with a 403 and `cf-mitigated: challenge` before the Worker sees the request, so the route check fails (D-22, seen on the first real deploy, 4 Oct 2026). The script reads that header (or a challenge page) and its FAIL line says "Cloudflare's bot protection is answering before the Worker", then prints the rule:
   1. dash.cloudflare.com > the nooutco.me zone > Security > Security rules > Create rule > Custom rule.
   2. Name it horae-zone skip bot protection, click "Edit expression" and paste `(http.host eq "horae-zone.nooutco.me")`.
   3. Then take action: Skip. Under WAF components to skip, tick only "All Super Bot Fight Mode Rules" and leave "All rate limiting rules" unticked, so the rate rule (item 1) still applies.
   4. Place at: First, then Deploy.

   Once the rule is in place, type `y` at the script's re-check prompt and it fetches the route again, alone (no other step runs twice). After the run has ended, check again with `node bin/deploy.mjs --check-only`.

   Free Bot Fight Mode (Security > Settings > Bot traffic) runs outside the rule engine, so it cannot be skipped by any custom rule and the skip rule does nothing for it. On a zone running Bot Fight Mode, turn Bot Fight Mode off (or move the zone to Super Bot Fight Mode and add the skip rule), then check again.
