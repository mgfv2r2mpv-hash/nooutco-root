# Think or Say? — research basis for the three-level rebuild

This document is the design contract for the expansion of **Think or Say?** from one
flat deck into a three-level teaching progression with a generalization-probe
subsystem, a generated-exemplar engine, and a staff guide. It is written first and
committed before any game code, so that every later decision about card content,
level membership, probe design, and scoring can be traced back to a stated reason.

Everything here is about **materials**. The programme is the learner's Skill
Acquisition Plan, written by a BCBA. Nothing in this document, and nothing in the
app, tells a behaviour technician how to run a programme, and the app draws no
clinical conclusions from performance (see `apps/games/CLAUDE.md` §5, Clinical
Boundary).

Sources are cited with URLs. Where a claim in the brief could not be sourced, it is
listed in [§8, Claims we could not source](#8-claims-we-could-not-source) rather
than dressed in a citation.

---

## 1. The social-cognitive target

The game teaches a discrimination between two response classes: a thought that is
kept internal ("THINK IT") and a thought that is spoken aloud ("SAY IT").

The framing comes from **Social Thinking** (Michelle Garcia Winner). Social Thinking
treats the invisible part of social exchange — what a person is thinking, what they
believe others are thinking about them — as the thing to teach, on the premise that
social thinking precedes social skill: awareness of the people and the situation
comes before the selection of a behaviour.
([What is Social Thinking?](https://www.socialthinking.com/what-is-social-thinking))

Two of its teaching devices are directly relevant:

* **Thought bubbles and speech bubbles.** Social Thinking uses the comic-strip
  convention to make the difference between thinking and saying concrete and
  discussable, and to show that what you say lands in the other person's head and
  changes what they think and feel about you.
  ([Teaching Through Thought Bubbles and Speech Bubbles](https://www.socialthinking.com/articles/teaching-through-thought-bubbles-speech-bubbles))
* **The filter / inner voice.** The methodology describes an internal step in which
  a person considers whether to say a thing, and the development of an "inner voice"
  or inner coach that runs that check.
  ([Michelle Garcia Winner, MSHA handout, 2018](https://www.michiganspeechhearing.org/docs/PPThandoutPart2-MgWinner.3.23.2018.pdf);
  [Helping Your Child Develop Their Inner Coach](https://brightandquirky.com/helping-your-child-develop-their-inner-coach-with-michelle-garcia-winner-slp/))

Social Thinking maintains its own evidence page
([peer-reviewed evidence](https://www.socialthinking.com/evidence/peer-reviewed/developmental-treatment-approach-students-learning-issues)),
but the framework is a treatment approach, not a manualised curriculum with
component-level experimental validation, and this build does not claim otherwise.
**Social Thinking supplies the vocabulary and the metaphor. Everything about how
examples are chosen, sequenced, probed, and scored in this app comes from the
generalization literature in §3–§4, which does have that kind of evidence.**

---

## 2. Development, and what it implies about teaching order

Three developmental milestones bear on the order in which this content can be
taught.

**Understanding that another person can hold a belief different from your own.**
Wellman, Cross & Watson's meta-analysis of 178 studies found a consistent
developmental pattern in false-belief performance across countries and task
variations: preschoolers move from below-chance to above-chance, consistent with
genuine conceptual change during the preschool years rather than a task artefact.
(Wellman, Cross & Watson, 2001, *Child Development*, 72, 655–684 —
[Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1111/1467-8624.00304),
[full text PDF](https://home.cs.colorado.edu/~mozer/Teaching/syllabi/3702/readings/WellmanCrossWatson2001.pdf))

**Understanding that words change how someone feels.** The clearest behavioural
marker in the developmental literature is prosocial ("white") lie-telling: a child
who suppresses a true, disappointing statement in favour of a polite one is acting
on the listener's feelings, not on the facts. Talwar, Murphy & Lee, using an
undesirable-gift paradigm with children aged 3–11, found that a majority told a
white lie and that the tendency **increased with age**; even 3-year-olds would tell
the giver they liked a disappointing gift. (Talwar, Murphy & Lee, 2007,
*International Journal of Behavioral Development* —
[SAGE](https://journals.sagepub.com/doi/abs/10.1177/0165025406073530),
[PubMed](https://pubmed.ncbi.nlm.nih.gov/18997880/))

**Articulating why.** Stating the reason another person would be hurt is a further
step beyond acting on it, and is the target of the deictic relational work in §4.

### The teaching order this implies

| | What the level asks of the learner | Developmental load |
|---|---|---|
| **Level 1** | Follow a rule on cases where the utterance is blatantly unkind or blatantly kind. | Lowest. Does not require modelling the listener's mind — the discrimination can be made on the utterance alone. |
| **Level 2** | Suppress a **true** statement because of its effect on a listener, or shift it in audience/volume/timing. | Requires that a true statement can still hurt — i.e. tracking the listener's feelings, the same competence indexed by prosocial lying. |
| **Level 3** | Say **why**, in terms of what the other person would think or feel. | Highest. Explicit perspective taking, articulated. |

This is why the levels are three **separate pools** and not one pool with a
difficulty score. A Level 2 card is not a harder Level 1 card; it asks a different
question of the learner. A card belongs to exactly one level.

---

## 3. Choosing the teaching examples: general case programming

The single most important design constraint on this build is that **card counts are
derived from coverage, never asserted as a target.**

### 3.1 Sample the range of variation, don't just add examples

Sprague & Horner compared three ways of teaching generalized vending-machine use to
six high-school students with moderate to severe disabilities: training on (a) one
machine, (b) three similar machines, and (c) three machines chosen to **sample the
range of stimulus and response variation in the defined class of vending machines**.
Only (c) produced generalized responding on the ten untrained machines. Three
similar examples were not enough; three *well-chosen* examples were.
(Sprague & Horner, 1984, *JABA*, 17, 273–278 —
[PMC1307940](https://pmc.ncbi.nlm.nih.gov/articles/PMC1307940/))

That result is the whole argument for a coverage matrix. Adding cards does not buy
generalization; adding cards that sample a dimension nothing else samples does.

A contemporary procedural write-up of the same method — define the instructional
universe, sample its range, teach, probe untrained members — is Milata et al.'s
general-case blueprint. (Milata et al., 2020, *Behavioral Interventions* —
[Wiley](https://onlinelibrary.wiley.com/doi/10.1002/bin.1719))

### 3.2 Must-have and can-have features

The applied literature splits the features of a teaching example in two:
**"must-have"** features are shared by every member of the class and define it;
**"can-have"** features are not universally present. The instruction is to hold the
must-have features constant across teaching examples and to **vary the can-have
features**, so that only the defining features can acquire stimulus control.
(Summarised, with the must-have/can-have phrasing attributed to Williams et al.,
2025, in ABAI's
[Choosing Wisely: The Importance of Selecting Effective Examples to Promote Generalization](https://behavioranalysisblogs.abainternational.org/2025/09/03/choosing-wisely-the-importance-of-selecting-effective-examples-to-promote-generalization/).
The underlying idea — sampling the defined range of variation in the instructional
universe — is Sprague & Horner's.)

The failure mode this guards against is not hypothetical. Song et al. showed
experimentally that when a **noncritical** feature is correlated with reinforcement,
it acquires control over responding and distorts generalization. (Song et al., 2021,
*JABA* — [Wiley](https://onlinelibrary.wiley.com/doi/10.1002/jaba.760))

This is exactly the defect in the current build, and the reason for Deliverable 2:
the app renders `You think: "…"` on every card. "Think" is a noncritical feature of
the card that is present on every trial and, for a learner tracking the salient word,
correlated with the correct response half the time and freely available as a
response rule. It has to go.

### 3.3 Negative examples, and minimum difference

Horner, Albin & Ralph trained six young adults to select grocery items from picture
cards and compared the effects of different kinds of **negative** teaching examples
on how precisely the class was learned — measured by correct rejection of twenty
untrained negative items in an untrained store. The finding that names the paper —
*Generalization with Precision* — is that the negative examples are not padding:
they are what defines the boundary of the class, and **minimum-difference** negative
examples (a non-member differing from a member on as little as possible) teach that
boundary most sharply. (Horner, Albin & Ralph, 1986, *JASH*, 11, 300–308 —
[SAGE](https://journals.sagepub.com/doi/10.1177/154079698601100411))

Applied here: for each criterial dimension, the deck must carry a **matched
minimum-difference pair** — two cards holding everything constant and flipping
exactly one criterial feature, so that the correct answer flips. The two pairs the
maintainer approved:

* *"You have something in your teeth."* Said quietly, standing next to a friend →
  **SAY**. Called across the lunchroom → **THINK**. Only the audience differs.
* A **new haircut**, which the person cannot change right now → **THINK**.
  **Spinach in teeth**, which they can fix right now → **SAY**. Only changeability
  differs.

Contrast is what teaches the defining feature. A deck of twenty THINK cards and
twenty SAY cards that never meet at a boundary teaches a vibe, not a rule.

### 3.4 How many examples is enough? Nobody knows.

There is **no established sufficient-N**. Stokes & Baer's foundational review names
"train sufficient exemplars" as a generalization tactic but does not, and could not,
fix a number. (Stokes & Baer, 1977, *JABA*, 10, 349–367 —
[PMC1311194](https://pmc.ncbi.nlm.nih.gov/articles/PMC1311194/),
[Wiley](https://onlinelibrary.wiley.com/doi/10.1901/jaba.1977.10-349))

The one direct test we could find compared three against five. Hupp trained object
concepts in children with severe intellectual disability and asked how many exemplars
are sufficient. Five "good" exemplars produced **slightly** higher generalization
than three — higher for five of six participants — but the difference was **not
statistically significant** (p = .08). (Hupp, 1986, *Applied Research in Mental
Retardation*, "Use of multiple exemplars in object concept training: How many are
sufficient?" —
[ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0270468486800118);
summarised in
[ABAI, 2025](https://behavioranalysisblogs.abainternational.org/2025/09/03/choosing-wisely-the-importance-of-selecting-effective-examples-to-promote-generalization/),
which recommends "a minimum of 3 exemplars with 'must have' features" as a practical
floor.)

**Therefore:** this build sets a floor of **≥3 exemplars per criterial dimension per
level**, states it as a practical floor rather than an evidence-based sufficiency
threshold, and derives every card count from the coverage matrix in §5. No total is
targeted, and no total is meaningful on its own.

---

## 4. Generalization as a repertoire: MET, probes, and deictic framing

### 4.1 Multiple exemplar training and derived responding

Relational Frame Theory treats derived relational responding as a **generalized
operant** — a repertoire established by multiple exemplar training (MET) across many
instances, rather than a capacity that simply matures. (Healy, Barnes-Holmes &
Smeets, 2000, *JEAB*, 74, 207–227 —
[Wiley](https://onlinelibrary.wiley.com/doi/10.1901/jeab.2000.74-207),
[PubMed](https://pubmed.ncbi.nlm.nih.gov/11029023/); Barnes-Holmes et al., 2004,
arbitrarily applicable comparative relations —
[PMC1868810](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1868810/))

The finding that matters most for the probe subsystem: in children with autism
taught with PEAK, **increases in derived relational responding on novel, untrained
stimuli were observed only when multiple-exemplar instruction was introduced** — the
untrained gains tracked the MET manipulation, not time or general exposure.
([Evidence From Children with Autism that Derived Relational Responding is a
Generalized Operant, *Behavior Analysis in Practice*, 2020](https://link.springer.com/article/10.1007/s40617-020-00425-y))

Marzullo-Kerth et al. give the applied-social-behaviour version: MET taught a
generalized sharing repertoire; **within**-category generalization appeared for all
three children, **across**-category generalization for only one. Generalization is
not automatic and it is not uniform — it has to be measured, per category, on
untrained members. (Marzullo-Kerth, Reeve, Reeve & Townsend, 2011, *JABA*, 44,
279–294 — [PMC3120064](https://pmc.ncbi.nlm.nih.gov/articles/PMC3120064/))

**Therefore:** untrained items must be measurable separately from trained ones. This
is the argument for Deliverable 5's trained-vs-generalization split in the report,
and for tagging probe items **near / far / deictic** as a combinable set — a "far"
result and a "deictic" result are different questions and an item can be both.

### 4.2 Multiple probes

PEAK and the wider generalization literature use multiple-probe logic: untrained
members are presented **without the instructional supports**, so that a correct
response is evidence about the repertoire rather than about the prompt. A probe
delivered with a prompt is not a null datum — it is simply a *trained* datum. That
is Deliverable 5's lifecycle rule, and the reason the Prompt button stays live during
a probe: clinical judgement is never blocked, but using it re-classifies the trial.

### 4.3 Level 3 is deictic I–YOU framing

Perspective taking in this tradition is trained as **deictic relational responding** —
the I–YOU, HERE–THERE, NOW–THEN frames. Belisle, Dixon, Stanley, Munoz & Daar taught
foundational perspective-taking to children with autism with the PEAK-T curriculum
using **single-reversal "I–you" deictic frames**. (Belisle et al., 2016, *JABA*,
49(4), 965–969.) A recent scoping review surveys the state of deictic relational
responding and perspective taking in autistic individuals.
([Deictic Relational Responding and Perspective-Taking in Autistic Individuals: A
Scoping Review, 2024](https://pubmed.ncbi.nlm.nih.gov/38660503/))

**Therefore:** Level 3's rationales are authored in I–YOU terms — *"If I said that,
**he** would feel embarrassed"* — not in rule-recitation terms (*"because it's a
think-it"*). And therefore the technician scores **what the learner actually said**,
three ways, independent of the exemplar rationales printed on the card. A correct
reason nobody wrote down is the ideal outcome and scores fully **Correct**. Scoring
against a list would train matching-to-sample on the list; the target is the
relational response.

---

## 5. The instructional universe

Stated explicitly, in this document and in code, per §3.1.

### 5.1 Criterial ("must-have") dimensions — ≥3 exemplars each, per level

| # | Key | The question the card turns on |
|---|---|---|
| 1 | `selfEsteem` | Would it hurt how the person feels about themselves? |
| 2 | `privacy` | Is it private or embarrassing? |
| 3 | `changeability` | Can the person change it right now, or not? |
| 4 | `audience` | Who else can hear — audience and volume |
| 5 | `relationship` | Who is it about — close friend, classmate, stranger, grown-up |
| 6 | `timing` | When — right now, or later in private |
| 7 | `override` | Does someone need help, or is safety at stake? (always SAY) |
| 8 | `truthNotTest` | Truth is not the test — true but hurtful is still THINK |

Dimension 7 is an **override**: when it is in play it dominates every other
dimension. Dimension 8 is a **defeater**: it exists to strip a rule the learner will
otherwise induce ("if it's true, say it").

### 5.2 Varied ("can-have") features — must genuinely vary

`setting` (school, home, bus, playground, shop) · `person` (peer, sibling, teacher,
family member, stranger) · `topic` (looks, smell, work, belongings, body) ·
`form` (statement, question, exclamation).

**Design rule, from Song et al. (§3.2):** within a level pool, no can-have value may
be perfectly confounded with the answer. If every card mentioning "the bus" is a
THINK card, "the bus" has become criterial by accident and the pool is wrong — the
pool gets fixed, not the rule.

### 5.3 Matched minimum-difference pairs

Each criterial dimension carries at least one pair within its level: two cards
identical on every criterial feature except one, with **opposite** answers. These
pairs also seed the probe pool, because a minimum-difference contrast is the sharpest
available test of whether the defining feature is actually in control.

### 5.4 Cross-labelling, and the pair constraint that bounds it

A card declares **every** criterial dimension that supplies a reason for its answer,
not only the dimension its pair happens to flip. The test of applicability is the
card's own reason line: if a technician debriefing the card would name the dimension,
the card declares it. A dimension a value could merely be *assigned* to — the person
happens to be a classmate, and nothing about the answer turns on that — is not in
play, because a label that explains nothing inflates the coverage matrix without
teaching anything.

Two consequences fall out of §5.3 and are structural rather than editorial:

1. **A cross-label cannot be added to one card alone.** A pair's two halves must
   declare the same criterial *keys* and differ on exactly one *value*, so a label
   added to one half must be added to its partner at a value that keeps exactly one
   dimension differing. Working pair by pair rather than card by card is the only
   order in which this converges.
2. **A card declaring `override: 'help-or-safety'` can sit in no pair but the
   override pair.** Its partner would have to carry the same key; carrying it at
   `help-or-safety` forces the partner to answer SAY (§5.1, dimension 7), so no THINK
   half can exist, and carrying it at `none` makes `override` the flipped dimension.
   A card that earns the safety label therefore leaves whichever other pair it held,
   and that pair is re-pointed at cards that can hold it.

Where a genuine label and a pair cannot coexist even after re-pointing — Level 1's
relationship pair is the standing example, where the SAY half is *telling a grown-up
you feel sick* and cannot say so in code because its THINK partner would have to
carry the same override — the label is left off and the reason is recorded at the
card, not silently dropped. Level 2 has two more of these: `selfEsteem: 'hurts'` on
L2-14, blocked because the defeater pair would force the same sting onto *paint on a
hand*, and `changeability: 'not-fixable'` on L2-01, blocked because the concert being
over explains nothing about why its partner's compliment gets said.

A third consequence is visible only once a whole pool has been audited: **self-esteem
and changeability are correlated in the content, not merely in the labels.** Almost
every card that answers THINK because the person cannot change the thing *also*
answers THINK because saying it would hurt — which is exactly why cross-labels were
missing in the first place. The consequence for pairs is that a `changeability` flip
holding `selfEsteem` constant needs a SAY half where the words sting and get said
anyway. Level 2 has one: telling a friend quietly about their teeth, which they can
put right in a second and nobody else hears. That card (L2-05) therefore anchors
three of the pool's eight pairs — changeability, audience and privacy — and the four
cards around it are the pool's richest, at four criterial labels each.

---

## 6. Leveling rationale, and the criteria each level's cards must satisfy

### Level 1 — "Clear"

*Early acquisition. The answer is obvious to anyone holding the rule.*

1. The discrimination is available from the utterance itself; no card requires
   weighing two criterial dimensions against each other.
2. THINK side is blatant: yelling, mean words, openly rude statements.
3. SAY side is equally obvious: thanking, asking for help, telling an adult you feel
   sick, speaking up about danger, a genuine compliment.
4. Coverage: ≥3 exemplars per criterial dimension represented at this level, plus the
   matched minimum-difference pair for each.
5. Can-have features vary across the pool and none is confounded with the answer.

### Level 2 — "Nuanced"

*The answer depends on a feature of the situation, not on the words alone.*

1. Cards turn on: true-but-hurtful observations; private things noticed; comments
   where **audience, timing or volume** decides; curious questions that would
   embarrass the person asked.
2. **Required card:** someone seems embarrassed and is covering a spot on their
   skirt, and you have noticed the spot.
3. Where the same words flip on context, **the card text must carry that context**,
   so the scored answer is determinate. A card whose answer depends on information
   the learner was never given is a broken card, not a hard one.
4. Coverage and confounding rules as Level 1.

### Level 3 — "Explain"

*The reason is the teaching target.*

1. Flow: situation → lead-in → utterance → balanced question → learner taps
   THINK IT / SAY IT → the game asks for the reason ("Tell me why.") → on reveal,
   2–4 exemplar rationales.
2. Exemplar rationales are written in deictic I–YOU terms (§4.3).
3. The technician scores **what the learner actually said**: Correct / Partly correct
   / Not yet, plus an optional free-text note. Scoring is independent of the
   exemplars; the technician is *not* picking which exemplar was matched.
4. Coverage and confounding rules as Level 1.

### Content rule — all three levels, no exceptions

Quote only **mild, non-name-calling** utterances ("Go away!", "I don't want to play
with you", "That smells gross"). Anything harsher is **described, never printed**
("You feel like calling him a mean name"). No slurs, no profanity, no specific
insults anywhere in the file. The game must not teach the vocabulary it warns
against. This is enforced by a test asserting an explicit denylist against every
card in every pool.

---

## 7. What the research requires of the build

| Research finding | Build consequence | Deliverable |
|---|---|---|
| Noncritical features correlated with reinforcement acquire control (Song 2021) | Kill the `You think: "…"` lead-in. Every card reads "You have a thought:" and asks a **balanced** question naming both actions, generated from the card's own verb pair. | 2 |
| Response topography must not drift with the stimulus | Tile **labels** stay fixed at THINK IT / SAY IT. Tile **positions** counterbalance between trials (setting, default ON) so position cannot become the discriminative stimulus. | 2 |
| Sample the range, don't count cards (Sprague & Horner 1984) | Pools are derived from the §5 coverage matrix; ≥3 per criterial dimension is a floor, not a target. | 3 |
| Minimum-difference negatives teach the boundary (Horner, Albin & Ralph 1986) | Every criterial dimension carries a matched pair; the pairs seed the probe pool. | 3, 5 |
| Developmental order (§2) | Three separate pools; a card belongs to exactly one level. | 3 |
| Untrained gains track MET, per category (2020 BAP; Marzullo-Kerth 2011) | Report splits trained vs. generalization and breaks generalization out by exact tag set. Tags are a combinable **set** (near / far / deictic), not an enum. | 5 |
| Probe validity depends on withheld supports | Supports suppressed by default on probe trials; Prompt stays live but a supported probe is recorded as a **trained** trial with the reason it was not clean. Nothing is discarded, nothing is uncounted. | 5 |
| Probe novelty cannot depend on memory of what was used | Probes and re-presentations are **generated** from criterial templates with per-template slot allow-lists; the key comes from the template, so a generated item cannot be mis-keyed by construction. Teaching cards stay hand-authored and reviewable. | 4 |
| Deictic I–YOU perspective taking (Belisle 2016) | Level 3 rationales are I–YOU framed; scoring is 3-way on what the learner said, not exemplar-matching. | 3 |

### The stem-overlap risk, recorded

"Thought" and "THINK IT" share a stem. Removing `You think:` removes the *sentence
frame*; it does not remove the word "thought" from the lead-in. The maintainer has
ruled this risk **real, irreducible, and detectable**: a learner under stem control
answers THINK to everything, which is visible in the report's answer-type split.
**No further mitigation is to be built.** It is documented here and in the staff
guide so that a BCBA reading the report knows what an all-THINK column means.

---

## 8. Claims we could not source

Stated plainly, per the brief.

1. **No experimental validation of this specific binary.** We found no study
   evaluating a THINK-IT / SAY-IT two-choice discrimination as a taught social
   target. The generalization machinery (§3–§4) is well evidenced; the *content
   framing* rests on Social Thinking practice (§1), which is a treatment approach
   rather than a component-validated curriculum.
2. **Stimulus overselectivity.** The classic demonstration that learners with autism
   may respond to a restricted subset of available cues is usually credited to Lovaas,
   Schreibman, Koegel & Rehm (1971). We did not verify a source URL for it in this
   pass and it is therefore not relied on above; the same design point is carried by
   Song et al. (2021), which we did verify.
3. **Horner & Albin general case programming, primary text.** The brief cites
   "Horner & Albin" generally. We verified Sprague & Horner (1984) and Horner, Albin
   & Ralph (1986) directly. The frequently cited Horner, Sprague & Wilcox (1982)
   *General case programming for community activities* was not verified in this pass
   and is not cited above.
4. **Belisle et al. (2016) URL.** Author list, title, journal, volume, issue and
   pages were confirmed via search; we did not fetch a stable publisher URL for the
   article itself. The citation is given without a link rather than with a guessed
   one. The 2024 scoping review is linked instead as verifiable secondary coverage.
5. **No sufficiency threshold exists.** This is not a gap in our search; it is the
   state of the literature (§3.4). Any card count presented as "enough" would be an
   invention.

**Link check, 2026-07-31.** Every URL above was requested. All returned HTTP 200
except three publisher domains — SAGE (`journals.sagepub.com`), Elsevier
(`sciencedirect.com`) and Wiley (`onlinelibrary.wiley.com`) — which return 403 to
non-browser clients as a matter of bot policy and resolve normally in a browser.
Their DOIs are embedded in the URLs given (`10.1177/154079698601100411`,
`10.1016` PII `S0270468486800118`, `10.1002/jaba.760`, `10.1002/bin.1719`,
`10.1901/jeab.2000.74-207`, `10.1901/jaba.1977.10-349`,
`10.1901/jaba.2011.44-279`, `10.1177/0165025406073530`, `10.1111/1467-8624.00304`).
Where an open mirror exists it is cited in preference to the paywalled copy — PMC for
Sprague & Horner, Stokes & Baer and Marzullo-Kerth, PubMed for Talwar and Healy.

---

## 9. Note on the existing deck

The brief refers to 33 existing cards. The actual count in `game.js` at the base
commit is **32**: 29 standard (ids `1.1`–`6.2`) plus 3 flagged `tricky` (`T1`–`T3`).
Distribution is 18 THINK / 14 SAY across six categories (`looks` 7, `kind` 13,
`work` 4, `private` 3, `smells` 2, `other` 3). All 32 are to be migrated into the
levels and re-framed per §7, not discarded. The `Include Tricky / Reasoning Cards`
checkbox is superseded by the level selector and is retired — a stored
`includeTricky` value must fold forward without breaking a settings load.

---

## 10. References

* Belisle, J., Dixon, M. R., Stanley, C. R., Munoz, B., & Daar, J. H. (2016).
  Teaching foundational perspective-taking skills to children with autism using the
  PEAK-T curriculum: Single-reversal "I–you" deictic frames. *Journal of Applied
  Behavior Analysis*, 49(4), 965–969. *(no verified URL — see §8.4)*
* [Deictic Relational Responding and Perspective-Taking in Autistic Individuals: A Scoping Review (2024)](https://pubmed.ncbi.nlm.nih.gov/38660503/)
* [Evidence From Children with Autism that Derived Relational Responding is a Generalized Operant. *Behavior Analysis in Practice* (2020)](https://link.springer.com/article/10.1007/s40617-020-00425-y)
* [Healy, O., Barnes-Holmes, D., & Smeets, P. M. (2000). Derived relational responding as generalized operant behavior. *JEAB*, 74, 207–227](https://onlinelibrary.wiley.com/doi/10.1901/jeab.2000.74-207)
* [Horner, R. H., Albin, R. W., & Ralph, G. (1986). Generalization with precision: The role of negative teaching examples in the instruction of generalized grocery item selection. *JASH*, 11, 300–308](https://journals.sagepub.com/doi/10.1177/154079698601100411)
* [Hupp, S. C. (1986). Use of multiple exemplars in object concept training: How many are sufficient? *Applied Research in Mental Retardation*](https://www.sciencedirect.com/science/article/abs/pii/S0270468486800118)
* [Marzullo-Kerth, D., Reeve, S. A., Reeve, K. F., & Townsend, D. B. (2011). Using multiple-exemplar training to teach a generalized repertoire of sharing to children with autism. *JABA*, 44, 279–294](https://pmc.ncbi.nlm.nih.gov/articles/PMC3120064/)
* [Milata, et al. (2020). A blueprint for general-case procedures. *Behavioral Interventions*](https://onlinelibrary.wiley.com/doi/10.1002/bin.1719)
* [Song, et al. (2021). The influence of correlations between noncritical features and reinforcement on stimulus generalization. *JABA*](https://onlinelibrary.wiley.com/doi/10.1002/jaba.760)
* [Sprague, J. R., & Horner, R. H. (1984). The effects of single instance, multiple instance, and general case training on generalized vending machine use. *JABA*, 17, 273–278](https://pmc.ncbi.nlm.nih.gov/articles/PMC1307940/)
* [Stokes, T. F., & Baer, D. M. (1977). An implicit technology of generalization. *JABA*, 10, 349–367](https://pmc.ncbi.nlm.nih.gov/articles/PMC1311194/)
* [Talwar, V., Murphy, S. M., & Lee, K. (2007). White lie-telling in children for politeness purposes. *IJBD*](https://journals.sagepub.com/doi/abs/10.1177/0165025406073530)
* [Wellman, H. M., Cross, D., & Watson, J. (2001). Meta-analysis of theory-of-mind development: The truth about false belief. *Child Development*, 72, 655–684](https://onlinelibrary.wiley.com/doi/abs/10.1111/1467-8624.00304)
* [Winner, M. G. — What is Social Thinking?](https://www.socialthinking.com/what-is-social-thinking)
* [Social Thinking — Teaching Through Thought Bubbles and Speech Bubbles](https://www.socialthinking.com/articles/teaching-through-thought-bubbles-speech-bubbles)
* [ABAI (2025). Choosing Wisely: The Importance of Selecting Effective Examples to Promote Generalization](https://behavioranalysisblogs.abainternational.org/2025/09/03/choosing-wisely-the-importance-of-selecting-effective-examples-to-promote-generalization/)
</content>
</invoke>
