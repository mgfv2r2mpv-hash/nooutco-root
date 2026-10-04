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

## What it asks

1. The Cloudflare account it found (type `y`, or the account's number when you have more than one). It stops here and creates nothing if you say no.
2. The Resend API key, on a hidden prompt (nothing shows as you type, arrow keys do nothing, and Ctrl-C or Ctrl-D cancels).
3. The from-address for sign-up mail, on the domain you verified in Resend (`Horae Zone <mail@your-domain>` works).
4. The alert address, mailed once a day when sign-ups reach half the daily cap.
5. The sign-up link base: the https page that reads the code after `#`.
6. The mail plan's daily send limit (blank keeps 3000).
7. Whether the rate rule is in place. The script prints the exact clicks for it before the route goes live, so you can add it in the dashboard while it waits.

A bad answer is asked again, up to 3 times. All answers are asked before anything is created.

## What it does

1. Finds the D1 database `horae-zone`, or creates it (from an empty temp folder, so wrangler cannot edit `wrangler.toml`).
2. Writes `wrangler.deploy.toml` next to `wrangler.toml`: the real database id, the route `horae-zone.nooutco.me` as a Custom domain (always proxied, so `cf-connecting-ip` comes from the Cloudflare edge), `workers_dev = false`, and the daily limit when you gave one. It holds no secret and is gitignored. The committed `wrangler.toml` keeps its zero id and no route (`test/config.test.mjs`).
3. Applies `schema.sql` to the remote database. Every statement is `IF NOT EXISTS`, so a rerun changes nothing.
4. Reads the Worker's secret list (names only), then deploys the Worker and puts each secret (keeping an `HZ_ACCOUNT_KEY` already set) with `wrangler secret put`, the value on stdin: `HZ_ACCOUNT_KEY`, `RESEND_KEY`, `HZ_MAIL_FROM`, `HZ_ALERT_TO`, `HZ_LINK_BASE`. A list the script cannot read stops the run before the deploy, with the Worker and its secrets untouched ("could not read the secret list; nothing was changed"); only wrangler's "Worker not found" on a first deploy reads as no secrets yet.
5. Skips the owner's admin role (A5c is not built yet) and says so.
6. Checks everything and prints the checklist.

`HZ_ACCOUNT_KEY` is the one internal secret: 32 random bytes the script makes itself. The PIN pepper, the ticket key and the sealing keys are all derived from it (`src/account-keys.js`), so there is no separate pepper or ticket key to set, and the seed sealing key arrives with A5. A new account key would make every stored account unreadable, so a rerun keeps the one already set and says "Kept HZ_ACCOUNT_KEY". `node bin/deploy.mjs --new-account-key` replaces it (fine after a test deploy, never once real accounts exist). When a key is already set, or the secret list cannot be read, the script prints that every enrolment, ticket and account becomes unusable and goes on only if the owner types `replace`; any other answer stops the run before the deploy, with nothing changed.

## What to expect at the end

```
CHECKLIST
  PASS    Cloudflare account                 <name> (confirmed by you)
  PASS    Database present                   created
  PASS    Worker deployed                    horae-zone, route horae-zone.nooutco.me (Custom domain)
  SKIPPED Owner as administrator             A5c not built (see step 6)
  PASS    Schema applied                     8 tables present
  PASS    Secret HZ_ACCOUNT_KEY              set (name only)
  ...
  PASS    Cron trigger                       0 * * * * (hourly purge)
  PASS    Route answers                      GET /account refused as method (405) through the Cloudflare edge
  PASS    Edge rule on /account and /signin  confirmed by you

RESULT: PASS
```

Any FAIL line names what is wrong. A fresh Custom domain can take a minute to answer, and the route check tries 6 times, 10 seconds apart, before it fails.

The script never prints a secret value, never puts one on a command line or in a file, and fails a check whose output carries one (`test/deploy.test.mjs`, "NEGATIVE CONTROL: a planted token in a check's output is caught").

## By hand, in the dashboard

The script prints these with exact clicks: the rate rule on POST `/account` and `/signin` (required at the first deploy, `docs/horae-zone/DESIGN-REVIEW.md` A3 item 13), confirming the hostname shows as Proxied, and a skip rule only if a managed rule or Bot Fight Mode challenges the app's calls (D-22).
