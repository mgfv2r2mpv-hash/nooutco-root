# AI-detection baseline

## What this is for

Notes drafted by this tool should read as the technician's own writing. Low
scores on public AI detectors (Grammarly, Scribbr, GPTZero) are the measurable
proxy for that, not the objective in themselves - the note is the technician's,
they review and own it, and the on-page disclaimer stays.

## The honest limits, stated first

**No number here can be guaranteed.** Grammarly and Scribbr have no public API,
no published algorithm and no version pinning. They can change what they report
on any given day, with no notice and no changelog. Anything built against them
is a moving target.

**`scripts/style-score.mjs` is not a detector.** It is a regression gate. It
measures the surface property the detectors react to - uniformity - and tells
you whether a prompt change made the prose more uniform than it was before. It
cannot tell you what Grammarly will say. Only the manual pass below can do that.

**Real perplexity is not available.** Anthropic's API does not return token
log-probabilities, so a genuine perplexity score would mean shipping an open
model into CI: a ~500MB download and a new dependency, in a repo with no build
step. The heuristics were chosen instead, deliberately.

## What was measured on the SAP tool - read this before tuning anything

Parallel work on `notes/bcba/tools/sap.js` produced actual numbers against a
real detector, and they refine the theory below considerably.

- **The checker in practice is QuillBot AI Detector v7.1.0**, run by the
  clinician as a self-check. Its metric is *proportion of text flagged*, so it
  degrades smoothly rather than saturating.
- **A measured control corpus of 7 de-identified human-written plans scored
  0%, 7%, 10%, 20%** (median ~8.5%), plus 49% for the one plan independently
  suspected of AI assistance. **Human clinical writing is not 0%.**
- **The flag is a register problem, not a structure or template problem.** What
  flags is generic actorless procedural prose ("Targets are taught using mixed
  trials…"). What does not flag is writing with a named actor and conditions
  ("Be sure to run this program with the help of the caregiver, who will be
  delivering the prompts" - from the 0% plan). A fully template-compliant note
  can score zero, which refutes the idea that the mandated format forces a
  high score.
- **Terseness is a cause, not a cure.** Mandating short rationale-free
  sentences is what produced the flagged sections. The opposite of terse here
  is not padding - it is specificity about who did what.

**A `<5%` target is therefore stricter than measured human baseline.** Half the
human corpus scored above it. Worth deciding whether that is the number you
actually want, or whether "at or below what our own clinicians score" is the
more meaningful bar.

`SYSTEM_CORE` in `tools/bt.js` was corrected on the strength of this: an earlier
draft said "prefer a short sentence to a subordinate clause", which pushed
toward exactly the register that flags. It now requires naming the actor and the
conditions, and says explicitly not to compress at the cost of that.

Em dashes are also out of the generated prose. They are not house convention
(the hyphen is), all 7 human plans used zero, and their overuse is itself a
recognisable machine tell.

## The tension this sits inside

Detectors score uniformity: even sentence lengths, low word-choice surprise, no
hedging, no idiosyncrasy. Clinical documentation leans *structurally* that way.

The resolution the tool takes: **hold the clinical vocabulary fixed, name the
actor, and vary everything else.** Precise verbs and named prompt types are what
a payer audits, so they stay non-negotiable. Actor specificity, sentence
architecture, information order and opener variety are what the detector reads,
and those are free to move.

## What the scorer measures

| Signal | Weight | Why |
|---|---|---|
| Burstiness (sentence-length variation) | 30 | The loudest tell. Generated prose converges on a house length. |
| Opener variety | 25 | "The behavior technician…" five sentences running is the most recognisable tic in these notes. |
| Type-token ratio | 20 | Lexical range over a fixed 400-word window. |
| Function-word entropy | 10 | An evenly-shaped function-word distribution reads as machine-generated. |
| Repeated 4-grams | 10 | Phrase-level tics survive paraphrasing. |
| Comma rate | 5 | Stands in for clause complexity. |

Higher total = more machine-uniform = worse.

```
node scripts/style-score.mjs tests/fixtures/notes/*.txt
node scripts/style-score.mjs --json tests/fixtures/notes/*.txt
```

## Baseline, 2026-08-02

Captured when the BT tool moved onto the shared engine and its `TERMINOLOGY`
block was reconciled (acronyms expanded on first use, non-load-bearing jargon
cut, one idea per sentence, varied openers).

| Fixture | Score | Burstiness | Opener variety |
|---|---|---|---|
| `old-terminology-a.txt` | 48 | 0.18 | 0.25 |
| `old-terminology-b.txt` | 52 | 0.12 | 0.25 |
| `new-terminology-a.txt` | 11 | 0.54 | 1.00 |
| `new-terminology-b.txt` | 11 | 0.50 | 1.00 |

**Read this correctly.** The fixtures are hand-written to represent the two
prompt styles - they are *not* model output. What the table establishes is that
the scorer discriminates sharply between formulaic and varied clinical prose,
and which direction the terminology change pushes. It does **not** establish
what the live model actually produces.

## What still has to be done

1. **Capture real output.** Generate ~25 notes through the live tool across a
   range of input styles and technicians, save them under
   `tests/fixtures/notes/live/`, and re-run the scorer. That is the real
   baseline; the table above is only the harness proving itself.
2. **Calibrate by hand.** Paste five of those live notes into
   [Grammarly](https://www.grammarly.com/ai-detector) and
   [Scribbr](https://www.scribbr.co.uk/ai-detector/), record what each reports
   next to its `style-score` total, and add the pairs here. Repeat quarterly, or
   after any change to a `SYSTEM_CORE` block - that pairing is the only thing
   that gives the local number meaning.
3. **Then gate it in CI.** Once live fixtures exist and a threshold is
   justified by the calibration, fail the build when the mean regresses past it.
   Gating before that would be pinning a number nobody has checked against
   anything real.

## Per-technician voice

The largest lever is the technician style profile: correction-derived,
content-free rules injected into the system prompt so two technicians' notes
diverge in rhythm while holding the same clinical vocabulary.

**Built, but inert until the profile Worker is deployed.** See
`apps/profile-api/README.md`. The browser measures how a technician rewrote a
draft (`notes/bcba/style-features.js`), sends a feature name plus a direction,
and the store turns five consistent observations at 0.7 agreement into a rule.
The rule text is appended to the system prompt beneath the clinical rules, which
explicitly outrank it.

Three things about this matter for the numbers above:

1. **It should move burstiness and opener variety most**, because that is what
   the features measure and what the scorer weights heaviest. Whether it does is
   an open question until there is live output to run through
   `style-score.mjs` - nothing here has been measured yet.
2. **It cannot move the clinical vocabulary**, by construction. The house rules
   are in the prompt above it and say so. That is the resolution to the
   tension described earlier, made mechanical.
3. **Two technicians will diverge**, which is the point, but it also means a
   single baseline number stops being meaningful once cards exist. Expect to
   record a range across technicians rather than one figure.

Until a card exists for a technician, the prompt is byte-identical to the one
that shipped without any of this, so the baseline above remains the right
reference for a new technician's first notes.
