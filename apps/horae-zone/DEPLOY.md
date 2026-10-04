# Horae Zone deploy

You must be logged in to Cloudflare with wrangler (`wrangler login`) on the Mac you run this from, and you need the Resend API key at hand. The script deploys a live Worker at `horae-zone.nooutco.me`, so run it only when you mean to.

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

## What it asks

The script first prints the wrangler version it found (`wrangler --version`) and stops there if wrangler is missing. Every wrangler call runs with `WRANGLER_LOG_SANITIZE=true`, so a shell that turned wrangler's log redaction off cannot turn it off for this run.

1. The Cloudflare account it found (type `y`, or the account's number when you have more than one). It stops here and creates nothing if you say no. When that account already has a Worker named `horae-zone` (`wrangler deployments list --name horae-zone --json`), the script prints "Worker horae-zone already exists; this will replace its code" and goes on only on `y`; anything else, or a check that cannot tell, stops the run with nothing changed.
2. The Resend API key (`RESEND_KEY`), on a hidden prompt (nothing shows as you type, arrow keys do nothing, and Ctrl-C or Ctrl-D cancels).
3. The from-address for sign-up mail (`HZ_MAIL_FROM`), on the domain you verified in Resend (`Horae Zone <mail@your-domain>` works).
4. The alert address (`HZ_ALERT_TO`), mailed once a day when sign-ups reach half the daily cap.
5. The sign-up link base (`HZ_LINK_BASE`): the https page that reads the code after `#`.
6. The reopen link base (`HZ_REOPEN_BASE`): the https page that reads the reopen token after `#`, mailed when a code path closes. The script checks it with the Worker's own check (`reopenBaseOk` in `src/unlock.js`): https, no `?` and no `#`.
7. The mail plan's daily send limit (`HZ_CODES_PER_DAY`, blank keeps 3000).
8. Whether the rate rule is in place. The script prints the exact clicks for it before the route goes live, so you can add it in the dashboard while it waits.

A bad answer is asked again, up to 3 times. All answers are asked before anything is created.

## What it does

1. Finds the D1 database `horae-zone`, or creates it (from an empty temp folder, so wrangler cannot edit `wrangler.toml`).
2. Writes `wrangler.deploy.toml` next to `wrangler.toml`: the real database id, the route `horae-zone.nooutco.me` as a Custom domain (always proxied, so `cf-connecting-ip` comes from the Cloudflare edge), `workers_dev = false`, and the daily limit when you gave one. It holds no secret and is gitignored. The committed `wrangler.toml` keeps its zero id and no route (`test/config.test.mjs`).
3. Applies `schema.sql` to the remote database. Every statement is `IF NOT EXISTS`, so a rerun changes nothing.
4. Reads the Worker's secret list (names only), then deploys the Worker and puts each secret with `wrangler secret put`, the value on stdin: `HZ_ACCOUNT_KEY`, `HZ_SEED_KEY`, `HZ_TICKET_KEY`, `RESEND_KEY`, `HZ_MAIL_FROM`, `HZ_ALERT_TO`, `HZ_LINK_BASE`, `HZ_REOPEN_BASE`. A key already set is kept (below). A list the script cannot read stops the run before the deploy, with the Worker and its secrets untouched ("could not read the secret list; the Worker and its secrets were not changed"); only wrangler's answer that the Worker is not found, on a first deploy, reads as no secrets yet.
5. Skips the owner's admin role (A5c is not built yet) and says so.
6. Checks everything and prints the checklist.

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
  PASS    Worker deployed                    horae-zone, route horae-zone.nooutco.me (Custom domain)
  SKIPPED Owner as administrator             A5c not built (see step 6)
  PASS    Schema applied                     16 tables present
  PASS    Secret HZ_ACCOUNT_KEY              set (name only)
  ...
  PASS    Cron trigger                       0 * * * * (hourly purge)
  PASS    Route answers                      GET /account refused as method (405) through the Cloudflare edge
  PASS    Edge rule on /account and /signin  confirmed by you

RESULT: PASS
```

Any FAIL line names what is wrong. A fresh Custom domain can take a minute to answer, and the route check tries 6 times, 10 seconds apart, before it fails.

The script never prints a secret value, never puts one on a command line or in a file, and fails a check whose output carries one (`test/deploy.test.mjs`, "NEGATIVE CONTROL: a planted token in a check's output is caught"). The mask also covers each value's JSON-escaped and URL-encoded forms, so an address like `"Horae Zone" <mail@...>` echoed back as `\"Horae Zone\"` or `%22Horae%20Zone%22` is masked too.

## By hand, in the dashboard

The script prints these with exact clicks: the rate rule on POST `/account` and `/signin` (required at the first deploy, `docs/horae-zone/DESIGN-REVIEW.md` A3 item 13), confirming the hostname shows as Proxied, and a skip rule only if a managed rule or Bot Fight Mode challenges the app's calls (D-22).
