# Register-keyed style card, rewritten against main

Kaleb ruled 2026-09-26 that `db5b0bc4` on `feat/bt-note-assistant` is abandoned
and this work is written fresh against today's main. The clinical decisions come
from his ruling of 2026-08-06; only the code is new.

The three defects that commit also fixed are already on main by other work, and
the client-side half of the metrics loss landed separately as PR #207.

## The decision being implemented

A learned style rule belongs to a document class, not to a person. `style_card`
was keyed `(kid, feature)`, so one pool per technician bled across every note
type. Per register, not per tool: his 66 corrections were sup 57, assess 6, and
one each for sap, parent and bt, so per tool would have kept sup's rules and
dropped every other tool below the five-evidence bar. Per register keeps 63 of
the 66 together.

## Slices

1. **`src/registers.js` + test.** `TOOL_REGISTER`, `KNOWN_TOOLS`, `registerFor`.
   The map lives here and not in the KV voice block it mirrors: a register is
   half of a primary key, so reading it from a fetch that can fail would write
   rows under a different key and fragment a card silently. The test pins every
   tool to an entry, so adding a tool without deciding its class fails.
2. **Schema.** `register` joins the primary key of `style_card` and of
   `style_card_suppression`.
3. **Migration**, written and never run. Drops `style_card` and lets it rebuild,
   because every row is derived and assigning a register to an old row would be
   guessing. Migrates the suppressions, because a supervisor's removal is a
   judgement that cannot be recomputed.
4. **`src/index.js`.** Every read and write keyed by register. Mute and remove
   scoped to one register: muting "prefer shorter sentences" while writing a
   supervision note must not mute it for SAP, and a supervisor's removal must
   not hit every register at once, which is a judgement they never made.
5. **Cohort insights.** `COUNT(DISTINCT kid)`, as a direct consequence: one
   person can now hold a feature in two registers, and counting rows would
   report them as two technicians, floating a feature over `MIN_COHORT` that
   only one person actually has. That breaks the anonymity the route exists to
   protect, not just the arithmetic.
6. **The correction carries its tool** from the browser to D1, instead of the
   server labelling a whole batch from the oldest entry of a buffer shared
   across tools and reloads.

## Standing constraints

- The migration is written and never run. Running it is Kaleb's call.
- `main` is live. Ship through a PR, rebase only.
- Every tool file on main is `assess, bt, parent, sap, sup`, which is exactly
  what the August map covers, so no new register decision is outstanding.
