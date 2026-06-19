# Prioritize — ranked voting Worker

A tiny Cloudflare Worker that aggregates "rank your top 3" votes for the games
hub's **Planned** section. Visitors submit a ranked ballot (1st / 2nd / 3rd);
the Worker stores each ballot in KV and returns weighted point totals
(1st = 3, 2nd = 2, 3rd = 1). Re-submitting overwrites a visitor's ballot, so
votes/ranks can be changed freely.

## Deploy

1. **Install Wrangler** (Cloudflare's CLI) and sign in:
   ```bash
   npm i -g wrangler
   wrangler login
   ```

2. **Create the KV namespace** and copy the printed `id`:
   ```bash
   wrangler kv namespace create VOTES
   ```
   Paste the `id` into `wrangler.toml` (replace `PUT_YOUR_KV_NAMESPACE_ID_HERE`).

3. **Deploy:**
   ```bash
   wrangler deploy
   ```
   Note the deployed URL, e.g. `https://noaba-prioritize.<you>.workers.dev`.

4. **Point the games hub at it.** In `games/index.html` (the Planned-section
   `<script>`), set:
   ```js
   const API_BASE = 'https://noaba-prioritize.<you>.workers.dev';
   ```
   Empty string keeps the local-only demo (votes saved per browser).

5. **Lock down CORS.** In `worker.js`, change `ALLOW_ORIGIN` from `'*'` to your
   site origin (e.g. `'https://nooutco.me'`).

## API

- `GET /api/votes` → `{ points: { id: number }, counts: { id: { first, second, third } } }`
- `POST /api/votes` body `{ clientId, ballot: { first, second, third } }` → same shape

`clientId` is an anonymous random id the front-end keeps in `localStorage` — no
accounts, no personal data. Feature ids: `vs, ft, te, cb, sc, fd`.

## Scaling note

`tally()` lists and sums every ballot per request — simple and fine for modest
traffic. For very high volume, maintain an incremental aggregate (read-modify-
write a single `totals` key per ballot change) or move to a Durable Object.
