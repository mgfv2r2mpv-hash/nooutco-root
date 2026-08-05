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
- **The flag is a register problem, not a structure or template problem.** A
  fully template-compliant note can score zero, which refutes the idea that the
  mandated format forces a high score.
- **Within register, the bare imperative is the part that holds up.** This was
  first written as "imperatives and abstract passives with no actor". Measured,
  only the imperative half survives: imperative rate keeps both its sign and its
  magnitude against the detector, while agentless passive runs the *opposite*
  way to the theory and the author's own writing uses it at 24%. It is native to
  the register, not a defect in it. Do not write a prompt rule that chases
  passives. See the corpus section below.
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

Em dashes are also out of the generated prose, but **not** because they are an
AI tell. An earlier version of this file said they were. That was wrong, and the
correct mechanism is worth knowing because it kills a tempting bad heuristic.

There is no em dash key. People produce one by typing a double hyphen into
Microsoft Word, which autocorrects it. So an em dash in a `.docx` is evidence of
the *editor*, not the author, and says nothing about whether a human or a model
wrote the text. Outside an Office suite most people never emit one at all. The
absence across all 7 human plans has the same explanation from the other side:
those were typed into an EHR field, where nothing autocorrects, so a human types
a hyphen and it stays a hyphen.

Two consequences. First, **em dash density is not a usable detection signal in
either direction** for this domain, and anything built on it is measuring which
word processor was open. Second, the hyphen is house convention for a concrete
reason rather than a stylistic one: it is what the authoring surface these notes
land in actually produces, so a hyphen is what a human writing there would have
typed. That is the argument for the rule, and it is stronger than "the
maintainer asked."

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

## Calibration against a real detector, 2026-08-03

The calibration step this file asked for has now been run for SAP, using the
seven-plan human corpus and the five plans the clinician scored on QuillBot.
**The result is negative and it changes the plan below.**

| Plan | QuillBot | style-score | Burstiness | Opener variety | Mean sentence |
|---|---|---|---|---|---|
| 1 | 20% | 17 | 0.79 | 1.00 | 20.6 |
| 2 | 0% | 12 | 0.55 | 1.00 | 19.2 |
| 3 | 49% | 15 | 0.60 | 0.95 | 13.6 |
| 4 | 10% | 13 | 0.73 | 1.00 | 17.7 |
| 5 | 7% | 20 | 0.82 | 0.97 | 18.7 |

**`style-score` does not predict QuillBot on real clinical prose.** Pearson
r = 0.08 between the total and the detector (Spearman 0.30). QuillBot spans 49
points across these five; `style-score` spans eight. The plan the detector likes
least (#3, 49%) sits mid-pack locally at 15, *below* the plan it likes most
after #2 (#5, 7%, which scores worst locally at 20). Ranking documents by
`style-score` would have put these two in the wrong order.

Why, concretely: on these seven plans the scorer's two heaviest signals are
already high. Opener variety runs 0.95-1.00 and burstiness 0.55-0.82, both
comfortably in the "human" range before anything is tuned. The 11-versus-48
separation in the table above is real, but it was measured on fixtures
hand-written to sit at the two extremes, and these plans do not reach the
formulaic pole.

**An earlier version of this section generalised that into "the signals are
saturated on real clinical writing, so the scale has nothing left to
discriminate with." That generalisation is refuted; see the section below.** It
is true of these seven plans and not of human writing at large, and the
distinction matters because the false version made the null result sound
inevitable rather than measured.

No component fared better: the largest single correlation was mean sentence
length at r = -0.78, and at n = 5 significance needs |r| ≈ 0.88. Nothing here
clears that bar. Treat the whole table as direction, not measurement.

The one directional hint worth keeping is that the sign on mean sentence length
is negative: *longer* sentences went with *lower* detector scores. That agrees
with the register finding above (terseness is a cause, not a cure) and it is the
opposite of what a "keep it short and clean" instinct would predict.

**This is checked, not just recorded.** The raw signals and the clinician's
scores live in `tests/fixtures/notes/sap-detector-anchors.json`, and
`tests/sap-detector-calibration.spec.js` re-derives every total from them using
the scorer's current weights. Retune `style-score.mjs` and those tests fail,
which is the only thing stopping this section quietly describing a scorer that
no longer exists. The plans themselves are deliberately **not** in the repo,
only the derived numbers, so no clinical work product enters git history.

## What still has to be done

1. **Capture real output.** Generate ~25 notes through the live tool across a
   range of input styles and technicians, save them under
   `tests/fixtures/notes/live/`, and re-run the scorer. That is the real
   baseline; the table above is only the harness proving itself.
2. **Calibrate by hand.** Paste five of those live notes into whichever detector
   the clinician actually runs, record what it reports next to its `style-score`
   total, and add the pairs here. Repeat after any change to a `SYSTEM_CORE`
   block. That pairing is the only thing that gives the local number meaning.
   Done once for SAP; see the calibration section above.
3. **Do not gate `style-score` in CI as a detector proxy.** The 2026-08-03
   calibration measured r = 0.08 against the real detector, so a threshold on it
   would fail builds that the detector is fine with and pass ones it is not.
   Gating it as a *drift* alarm is still defensible, since it does catch prose
   collapsing toward the formulaic pole, which is what the 11-vs-48 fixture
   separation shows, but that is a different claim from "our notes will score
   low," and the file should not be read as supporting the second one.
4. **Find a signal that does track.** Detector-visible register (named actor,
   stated conditions) is the property the measured evidence actually implicates,
   and the current scorer does not measure it at all. Anything that replaces
   `style-score` as a gate has to beat r = 0.08 against real anchors first.

## Per-technician voice

The largest lever is the technician style profile: correction-derived,
content-free rules injected into the system prompt so two technicians' notes
diverge in rhythm while holding the same clinical vocabulary. That is where the
scores should move furthest, and it is not built yet.

## The 253k-word author corpus, 2026-08-04

104 graduate ABA coursework documents by the same author, 251,722 words,
PII-screened and unassisted. Measured with the same tokenizer as everything
above, deliberately: comparing corpora scored by different tokenizers is how a
previous round manufactured a false invariant.

### It refutes the saturation claim

|  | opener variety | burstiness | style-score |
|---|---|---|---|
| 7 clinical plans | 0.95 - 1.00 | 0.55 - 0.82 | 12 - 24 |
| 104 coursework docs | **0.62** - 1.00 (median 0.86) | **0.43** - 2.62 (median 0.60) | **8 - 38** |

**73% of the coursework falls at or below opener variety 0.90**, the floor all
seven plans clear. The scorer spans 30 points across real human writing, not
eight. So it is *not* true that real prose leaves the scale nothing to
discriminate with. The scorer has plenty of range; it simply does not spend that
range in a direction that tracks the detector.

That makes the r = 0.08 result worse for the scorer rather than better. "No
signal available" would have been an excuse. "Ample signal, uncorrelated with
the target" is a straightforward failure of the proxy, and it is the accurate
description.

A format explanation was tested and does not hold up: within the coursework,
bullet-line share against opener variety is r = 0.002. That test is
underpowered, though, because the coursework is only 2% bulleted against the
plans' 34%, so there is almost no variation to correlate against. Why plans sit
higher than prose is **unresolved**, not explained.

### It supports the actor thesis, with one sharp caveat

Actor density measured as a rate, heuristically (role noun or personal pronoun
in a sentence's first six words; no POS tagger is available, so this is
approximate, but the same rule is applied to every corpus).

| plan | QuillBot | names an actor | agentless passive | bare imperative |
|---|---|---|---|---|
| 1 | 20% | 10% | 20% | 15% |
| 2 | 0% | 23% | 23% | 0% |
| 3 | 49% | **35%** | 3% | 27% |
| 4 | 10% | 17% | 33% | 22% |
| 5 | 7% | 14% | 28% | 17% |

Correlation of actor density with the detector:

- **All five plans: r = +0.646.** Wrong sign for the thesis.
- **Dropping plan 3: r = -0.906.** Right sign, and the strongest correlation
  found anywhere in this work, against style-score's 0.084.

Plan 3 is the one independently suspected of AI assistance. It is the extreme on
the detector *and* on all three register measures, and with n = 5 a single
extreme point sets the correlation. Excluding it is not curve-fitting: a
document that is not human writing cannot be evidence about what makes human
writing flag. Among the four genuinely human plans, naming actors goes with
scoring lower, which is what the register change assumed.

Neither figure is significant. n = 4 needs |r| ~ 0.95. Treat this as the best
available direction, not as proof.

**The caveat is the useful part. Plan 3 has the HIGHEST actor density of all
five and still scored 49%.** Naming actors does not by itself defeat a detector,
because a model writing the text will name actors too. Actor density looks
necessary and is demonstrably not sufficient, so it should not become the single
thing the prompt optimises for.

### What this does not license

The coursework is academic prose, not program plans: 2% bare imperatives against
the plans' 13%. Its value is as evidence about the author's register, not as a
template for SAP output. Numbers derived from it (actor rate ~27% of sentences,
mean sentence length ~23 words) are reference points for what his unassisted
writing looks like, not targets to hard-code into a prompt.

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

## The comma term, measured and removed (2026-08-04)

He asked how commas factor in. They did not, and the term was doing harm.

`style-score.mjs` carried an inverted-U penalty peaking at 1.1 commas per
sentence, worth 5 of the 100 points, on the theory that ~1.1 is where machine
prose sits. Tested against the seven human plans in
`tests/fixtures/notes/sap-detector-anchors.json`:

| signal | correlation with QuillBot (n=5 scored) |
|---|---|
| opener variety | **-0.73** |
| mean sentence length | **-0.78** |
| burstiness | -0.19 |
| type-token ratio | -0.08 |
| **comma rate** | **-0.05** |

Two findings, and the second is the one that settles it.

**Comma rate carries no signal.** At -0.05 it is indistinguishable from noise.

**Six of the seven human plans sat inside the band the term called most
machine-like**, each losing 2 to 5 points for it. A term whose stated purpose is
to flag machine writing was docking almost every human document in the corpus.
That is a contradiction regardless of sample size, and it is why the term is
gone rather than retuned. The 5 points are dropped, not redistributed:
reweighting on five scored documents would only invent a new number.

Removing it moved the scorer's correlation with QuillBot from **+0.08 to +0.21**.
Better, still weak, still not a predictor, and still not a CI gate.

**The other thing worth noticing:** mean sentence length correlates -0.78, so
LONGER sentences went with LOWER detector scores across these plans. That
points the same way as the register work and directly against the terseness
instinct. It is n=5 and should be treated as a hint, not a finding, but nothing
in the corpus supports mandating short sentences.

`commaRate` is still measured and reported. It just no longer scores.
