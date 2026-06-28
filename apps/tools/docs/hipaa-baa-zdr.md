# HIPAA posture for the notes tools

**Working assumption: no Business Associate Agreement (BAA) and no Zero Data
Retention (ZDR) with the LLM provider.** Under that assumption the only compliant
path is that **Protected Health Information (PHI) never reaches the API at all.**
De-identifying the clinician's input *before* anything is sent is the compliance
control. Everything below documents how that is enforced, and — because it was
asked for — what a BAA and ZDR are if that ever changes.

## The control: de-identify before send

There is **no `anthropic-beta` header or request parameter that makes an API call
"HIPAA compliant."** Compliance is achieved by the data, not a flag: if the payload
contains no PHI, it isn't PHI, and no BAA is required to send it.

Flow (all client-side until the de-identified prompt leaves the browser):

```
clinician types notes
  → acknowledge() ........ once-per-page legal notice; must accept (NotesScrub)
  → detectNames() ........ flag candidate names (notes-gate.js)
  → review() ............. clinician confirms each: edit replacement, pick a role,
                           or check "I certify this is not PII" to leave it
  → applyScrub() ......... replace confirmed names everywhere (case-insensitive)
  → de-identified prompt sent to /api/llm-call over HTTPS
  → _worker.js ........... injects the server key; NEVER logs the prompt/PHI
  → Anthropic ............ only ever sees role tokens (CLIENT, CAREGIVER, …)
```

Both actions are gated this way:
- **Generate Prompt** (copyable / "bring your own key" path) — the output is scrubbed,
  so pasting into the clinician's own LLM no longer leaks names. This is the main
  lever for minimizing user-key risk; the user's own provider terms then govern.
- **Generate Note** (server key path) — the scrubbed prompt is sent through the worker.

Tokens are **kept in the output** (de-identified *and* retrievable): the clinician
substitutes real names back in their own EHR. Drafts are not re-hydrated with names.

## The one remaining PHI artifact: the name → token map

The map that links `CLIENT` back to "Jacob" is itself PHI. It is **ephemeral**: it
lives only for the duration of one action and is **never stored or transmitted**.

`NotesScrub.persistMap()` is an inert hook. If a "restore real names later" feature
is ever added, encrypt the map at rest there (Web Crypto **AES-GCM**, key derived
from a clinician passphrase via **PBKDF2**) — never store it in plaintext, never
transmit it. Until then it is a no-op by design.

## Worker hardening

`_worker.js` never logs the request body, `systemPrompt`, or `userPrompt`. The
`/api/llm-call` catch block logs only `error.message` (see the PRIVACY comment).
Keep it that way — any future logging must exclude prompt content.

## Defense-in-depth UI controls

- **Acknowledgment gate** — first Generate per page load shows a real notice that
  submitting PHI to a third-party AI service without a BAA can violate HIPAA, HITECH,
  and other federal/state/local law; the clinician must check a box to proceed.
- **Per-name review** — every detected name is shown with an editable replacement, a
  role dropdown, and an **"I certify this is not PII (?)"** checkbox whose tooltip
  lists the HIPAA identifiers.
- **Standing disclaimers** on each tool already say "Do not enter PHI."

## Detection coverage & known limitation

Detection (`notes-gate.js → detectNames`) handles: Title-case names, internal
capitals (McKenzie, DeShawn, MacArthur), apostrophes (O'Brien, D'Angelo), hyphens
(Anne-Marie), two-word names (John Smith), names after punctuation/newlines,
possessives ("Jacob's" → Jacob), and case-insensitive repeat scrubbing (a name
flagged once is replaced in every spelling, including lowercase). A broad stoplist
keeps sentence-initial words and clinical verbs from being mistaken for names; the
review step backstops any remaining false positives.

**Known limitation:** a name that appears **only in lowercase and never capitalized**
is not auto-detected. The safety net is (a) any capitalized occurrence elsewhere
triggers case-insensitive replacement everywhere, and (b) the clinician's own review.
Reinforce "capitalize names or don't enter them" in guidance. Stress-test page:
`notes/scrub-test.html`.

## Background: BAA and ZDR (not currently relied on)

If a BAA/ZDR is obtained later, it *adds* assurance but does not replace
de-identification — keep scrubbing on regardless.

- **BAA (Business Associate Agreement).** A signed contract with the LLM provider
  (Anthropic) that makes the provider a Business Associate under HIPAA for the
  account whose `ANTHROPIC_API_KEY` is used. It is arranged through the provider
  (sales/support, generally a commercial/enterprise agreement) — **not** a code
  change or header. Without it, treat the server path as **not** HIPAA-covered and
  rely on the de-identification above. With it, sending limited PHI could become
  permissible, but we would still scrub by default.
- **ZDR (Zero Data Retention).** An **org/account-level** setting requested from the
  provider; when enabled, request inputs/outputs are not retained beyond serving the
  request. Also **not** a header. (Note: some models require ≥30-day retention and
  are incompatible with ZDR — not relevant here; the tools use
  `claude-haiku-4-5-20251001`.)

## Operational checklist

- [ ] Keep `assets/notes-scrub.js` (acknowledge + review) loaded on every notes page.
- [ ] Never add prompt/body logging to `_worker.js`.
- [ ] Leave the map ephemeral; if persistence is added, implement `persistMap()` with
      AES-GCM + PBKDF2 and never store/transmit plaintext.
- [ ] Periodically run `notes/scrub-test.html` after detection changes.
- [ ] If a BAA/ZDR is ever signed, record it here — and still keep scrubbing on.
