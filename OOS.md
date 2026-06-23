# Out of Scope (OOS) — deferred work

Items intentionally not part of current work. Pick up later.

## PHI flag review + dynamic exclusion list (OOS items from 2026-06-23 session)

When a user certifies a detected name as "not PII" in the review modal, log it to the server for admin oversight and allow admins to add words to a per-tool exclusion list so they stop being flagged.

**Desired behavior:**
- Each "I certify this is not PII" checkbox submission sends `{ term, context (sentence snippet), tool, password label }` to a new `POST /api/oos-flags` endpoint (fire-and-forget from client).
- New admin section in `admin/index.html`: table of pending flags with Dismiss / Add to exclusions actions.
- New `GET /api/oos-excluded` endpoint returns a word list; `notes-scrub.js` fetches it on load and filters those words out of the detection results before showing the review modal.
- Admin can also manually add/remove words via `PATCH /api/oos-excluded`.

**KV structure (reuse `API_PASSWORDS` namespace):**
- `oos_flag:<timestamp>_<i>_<rand>` → JSON value: `{ id, term, context, tool, flaggedByLabel, flaggedAt }`
- `oos_excluded` → JSON array of lowercase strings

**Not built because:** user @oos-tagged mid-implementation (2026-06-23). Architecture is fully planned — add when there's enough flag volume to justify the review workflow.

---

## Cloudflare bot-block exception (so automated checks can reach `*.nooutco.me`)

**Problem:** the `nooutco.me` zone challenges non-browser requests (`403`, `cf-mitigated: challenge`), so CI / agent verification can only hit the `*.pages.dev` URLs, not the real domains.

**Fix (recommended): a WAF custom rule that SKIPs the bot products for requests carrying a secret header.**
- Dashboard → Security → WAF → **Custom rules → Create**
- Expression: `(http.host contains "nooutco.me" and http.request.headers["x-bypass"][0] eq "<LONG_SECRET>")`
- Action: **Skip** → tick *Super Bot Fight Mode*, *Managed rules*, *Rate limiting*, and "All remaining custom rules".
- Automated checks then send `-H "x-bypass: <LONG_SECRET>"` and pass; real traffic is unaffected.

**Variant:** scope by path instead — match `starts_with(http.request.uri.path, "/api/")` and Skip, so `/api/*` is never challenged for any non-browser caller (useful for real API clients too).

**Notes:**
- Use action **Skip**, not "Allow" (Allow doesn't reliably bypass the bot products).
- Plain **Bot Fight Mode** (Free plan) is global on/off and can't be exempted by a rule — the Skip-rule approach needs *Super* Bot Fight Mode / Managed Challenge, else just toggle Bot Fight Mode off.
- Alternative: IP Access Rule allowlist (Security → WAF → Tools) if the checker has a stable egress IP.
- Reversible: delete the rule when no longer needed.
