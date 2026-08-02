# AI-detection baseline

## What this is for

Notes drafted by this tool should read as the technician's own writing. Low
scores on public AI detectors (Grammarly, Scribbr, GPTZero) are the measurable
proxy for that, not the objective in themselves — the note is the technician's,
they review and own it, and the on-page disclaimer stays.

## The honest limits, stated first

**No number here can be guaranteed.** Grammarly and Scribbr have no public API,
no published algorithm and no version pinning. They can change what they report
on any given day, with no notice and no changelog. Anything built against them
is a moving target.

**`scripts/style-score.mjs` is not a detector.** It is a regression gate. It
measures the surface property the detectors react to — uniformity — and tells
you whether a prompt change made the prose more uniform than it was before. It
cannot tell you what Grammarly will say. Only the manual pass below can do that.

**Real perplexity is not available.** Anthropic's API does not return token
log-probabilities, so a genuine perplexity score would mean shipping an open
model into CI: a ~500MB download and a new dependency, in a repo with no build
step. The heuristics were chosen instead, deliberately.

## The tension this sits inside

Detectors score uniformity: even sentence lengths, low word-choice surprise, no
hedging, no idiosyncrasy. Clinical documentation is *structurally* that. A human
RBT writing textbook-clean prose scores as machine-written too.

The resolution the tool takes: **hold the clinical vocabulary fixed and vary
everything around it.** Precise verbs and named prompt types are what a payer
audits, so they stay non-negotiable. Sentence architecture, information order
and opener variety are what detectors read, and those are free to move.

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
prompt styles — they are *not* model output. What the table establishes is that
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
   after any change to a `SYSTEM_CORE` block — that pairing is the only thing
   that gives the local number meaning.
3. **Then gate it in CI.** Once live fixtures exist and a threshold is
   justified by the calibration, fail the build when the mean regresses past it.
   Gating before that would be pinning a number nobody has checked against
   anything real.

## Per-technician voice (phase 2)

The largest remaining lever is the technician style profile: correction-derived,
content-free rules injected into the system prompt so two technicians' notes
diverge in rhythm while holding the same clinical vocabulary. That is where the
scores should move furthest, and it is not built yet.
