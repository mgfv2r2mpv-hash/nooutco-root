/* Copy, then respond: the passages.
 *
 * A copy round types a passage word for word; the respond round that follows
 * answers it in his own words for a minute, with the option to keep going.
 *
 * Two kinds:
 *   study  a plain-language summary of a well-known paper, written for the
 *          drill. NOT the paper's abstract: an abstract belongs to its
 *          publisher, and a summary written here can be checked line by line.
 *   take   the drill's own position on a live question, labelled as such, so
 *          there is something to agree with or push back on.
 *
 * Typed text is ASCII only (straight quotes, hyphens, no dashes or curly
 * quotes), so every character is on the keyboard. The copy round is never
 * kept: it is not his writing and never goes near the voice corpus.
 */

import { PASSAGES_MORE } from "./passages-more.js";

const CORE = [
  { id: "p-iwata", outline: "F.6", kind: "study", title: "Toward a functional analysis of self-injury",
    source: "Iwata, Dorsey, Slifer, Bauman & Richman (1982; reprinted 1994), JABA",
    text: "Iwata and his colleagues worked with nine people with developmental disabilities who engaged in self-injury. Each person was observed across brief, repeated sessions in several conditions that were arranged on purpose. In one, an adult paid attention only after self-injury, with a mild statement of concern. In another, the adult presented difficult learning tasks and removed them for a moment after self-injury. In a third, the person was alone with nothing to do. A play condition, with attention and toys freely available and no demands, served as the comparison. For most of the participants, self-injury was consistently higher in one particular condition, which pointed to what was maintaining it: attention, escape from demands, or the sensory result of the behavior itself. The point of the study was not the rates. It was the method. Instead of guessing at a cause from a description, the team changed the environment and watched the behavior change with it. That experimental logic, testing function directly, became the basis for much of the treatment work that followed.",
    respond: "Where would you start with a new client whose self-injury nobody has tested yet, and what would make you skip a full analysis?" },

  { id: "p-carr", outline: "H.3", kind: "study", title: "Reducing behavior problems through functional communication training",
    source: "Carr & Durand (1985), JABA",
    text: "Carr and Durand first looked at when problem behavior happened for children with developmental disabilities in a classroom. For some children it went up when adult attention was thin. For others it went up when the work got hard. For some it was both. They then taught each child a simple phrase that asked for the thing the problem behavior seemed to be getting, such as asking whether they were doing good work, or saying they did not understand and asking for help. When the phrase matched the function of the behavior, problem behavior dropped. When the children were taught an equally polite phrase that did not match the function, it did not. The lesson most people carry from this study is that the replacement response has to do the same job the problem behavior was doing. A child does not give up something that works in exchange for something that does not.",
    respond: "Tell a BT why teaching a child to say please did not stop the hitting, and what you would teach instead." },

  { id: "p-bwr", outline: "A.5", kind: "study", title: "Some current dimensions of applied behavior analysis",
    source: "Baer, Wolf & Risley (1968), JABA",
    text: "Baer, Wolf and Risley set out what should count as applied behavior analysis. The work should be applied, meaning the behavior studied matters to the person and to the people around them. It should be behavioral, measuring what the person actually does rather than what they say they do. It should be analytic, showing a believable demonstration that the intervention and not something else produced the change. It should be technological, described clearly enough that another trained person could carry it out. It should be conceptually systematic, tied back to the basic principles instead of being a bag of tricks. It should be effective, producing change large enough to matter in practice. And it should show generality, lasting over time, appearing in new settings, or spreading to related behavior. Decades later these seven dimensions are still the checklist many people use to decide whether a program is really behavior analytic.",
    respond: "Pick the dimension your last treatment plan was weakest on and say what you would change." },

  { id: "p-stokes", outline: "G.15", kind: "study", title: "An implicit technology of generalization",
    source: "Stokes & Baer (1977), JABA",
    text: "Stokes and Baer looked across the research of their time and noticed that generalization was mostly hoped for rather than planned. They called the common approach train and hope: teach a skill in one place, then check later whether it showed up anywhere else. They grouped the tactics that did seem to produce generalization. Some brought the skill into contact with the natural reinforcers that would keep it going. Some taught with enough examples that the learner responded to the whole class rather than to one instance. Some trained loosely, varying the teacher, the words and the setting on purpose. Some made the teaching setting and the real setting share common stimuli. Some made it hard for the learner to tell when reinforcement was available, so responding held up when it was not. Their argument was that generalization is a behavior change like any other, and should be programmed, not assumed.",
    respond: "Your client can request a break at the table but never at home. Plan the next two weeks." },

  { id: "p-wolf", outline: "F.8", kind: "study", title: "Social validity: the case for subjective measurement",
    source: "Wolf (1978), JABA",
    text: "Wolf argued that a behavior analyst cannot decide alone whether a program was worth doing. Objective data can show that a behavior changed, but only the people affected can say whether the change mattered. He proposed asking about social validity at three levels. Are the goals the ones society, the family and the client actually want. Are the procedures acceptable to the people who experience them and carry them out. Are the effects satisfying to the consumers, including any unplanned ones. The measures he described were subjective on purpose: ratings, interviews and opinions. He admitted these are harder to trust than a frequency count, but said a field that ignores them risks producing changes that are real on a graph and useless in a life. The paper is often cited as the moment applied behavior analysis made room for the person's own view of the work.",
    respond: "A mom says the program is working but she hates doing it. What do you do with that on Monday?" },

  { id: "p-deleon", outline: "F.4", kind: "study", title: "Evaluation of a multiple-stimulus presentation format for assessing reinforcer preferences",
    source: "DeLeon & Iwata (1996), JABA",
    text: "DeLeon and Iwata compared ways of finding out what a person prefers. In the paired-stimulus format, items are offered two at a time until every pair has been presented. In a multiple-stimulus format, all the items are laid out at once and the person picks one. They tested a version where the chosen item is not put back, so each later choice is made from what is left, and the order of selection gives a ranking. This without-replacement format produced rankings similar to the paired format while taking less time, and it was less likely than a with-replacement format to miss items the person would still choose if the favorite were gone. Preference assessments do not prove that an item will work as a reinforcer, but a quick and repeatable way to rank options made it practical to check preferences often, which matters because preferences shift from day to day.",
    respond: "Your learner picks the same toy every time and then ignores it during teaching. What is going on?" },

  { id: "p-lerman", outline: "H.4", kind: "study", title: "Prevalence of the extinction burst and its attenuation during treatment",
    source: "Lerman & Iwata (1995), JABA",
    text: "Lerman and Iwata went back through published cases where extinction was used to treat problem behavior and asked how often a burst actually showed up, meaning a clear increase in the behavior right after extinction started. Bursts appeared in a minority of the cases rather than in most of them. They were also less common when extinction was combined with other procedures, such as reinforcing an alternative response or delivering the reinforcer on a time-based schedule, than when extinction was used alone. The practical reading is that a burst is a real risk that should be planned for, especially with dangerous behavior, but it is not guaranteed, and the way treatment is packaged changes the odds. Telling a family that things will certainly get worse before they get better overstates the evidence; telling them it cannot happen understates it.",
    respond: "Write what you would tell a grandmother before she starts ignoring the screaming at bedtime." },

  { id: "p-tiger", outline: "G.2", kind: "study", title: "Functional communication training: a review and practical guide",
    source: "Tiger, Hanley & Bruzek (2008), Behavior Analysis in Practice",
    text: "Tiger, Hanley and Bruzek pulled together what the research says about teaching a communication response to replace problem behavior. The first step is knowing the function, because the new response has to produce the same reinforcer. The response should be easy for the learner to emit and easy for others to notice and understand. Early on it should work every time, quickly, while problem behavior no longer produces that reinforcer. The hard part comes later. A child who has learned that asking always works may ask constantly, and no caregiver can deliver attention or breaks on demand forever. So the guide spends much of its time on thinning: adding delays, teaching the child to tolerate a no or a wait, and using clear signals for when the reinforcer is and is not available. Treatment that stops at the first success tends to fall apart in real life.",
    respond: "Your client now asks for a break every ninety seconds. Lay out how you would thin it." },

  { id: "p-hart", outline: "G.13", kind: "study", title: "Incidental teaching of language in the preschool",
    source: "Hart & Risley (1975), JABA",
    text: "Hart and Risley worked in a preschool and changed when teachers taught language. Instead of setting aside lessons, teachers waited for a child to start an interaction, usually by asking for a toy or some help, and used that moment. The teacher would prompt a slightly more elaborate request before handing over the item, then give it right away. Because the child had chosen the item and started the exchange, motivation was already there and the reinforcer was the thing the child wanted, not praise for a lesson. Over time the children used more elaborate language across the day. The approach became known as incidental teaching, and it is an early example of teaching inside the natural routine and following the learner's lead, ideas that later naturalistic methods built on.",
    respond: "Explain to a teacher why you want her to wait for the kid to ask instead of running the lesson." },

  { id: "p-assent", outline: "E.1", kind: "take", title: "The drill's take: assent withdrawal should change what happens next",
    source: "The drill's own position, drawing on the BACB Ethics Code for Behavior Analysts (2020)",
    text: "Here is the position. When a learner shows clearly that they want out, by pushing materials away, leaving, crying, or saying no, that should change what the adult does next, not just get recorded. Continuing through it can teach that the learner's signals do not matter, and it can turn the teaching setting into something to escape. That does not mean every demand ends the moment a child protests. Some protests are escape-maintained behavior that a good plan is built to address, and some tasks, like getting out of the street, are not optional. The distinction is between a plan that has thought about these moments ahead of time and one that just pushes through. A plan should say what assent looks like for this learner, what withdrawal looks like, and what the adult does when it happens: pause, offer a choice, make the task easier, or stop. If staff cannot answer that, the plan is not finished.",
    respond: "Agree or push back. Where does assent withdrawal end and escape-maintained behavior begin, in your cases?" },

  { id: "p-graph", outline: "C.10", kind: "take", title: "The drill's take: graph it or stop collecting it",
    source: "The drill's own position",
    text: "Here is the position. Data that nobody graphs and nobody looks at is not data, it is paperwork. Every minute a technician spends writing tallies is a minute not spent teaching, so every measure should earn its place by changing a decision. If a program has been on the same step for a month and nobody noticed, the problem is not the learner, it is the review. The fix is not more data sheets. It is fewer measures, graphed on a schedule, with a rule written in advance for what the graph has to show before something changes. Three sessions with no progress, change the prompt. Five at criterion, move on. A supervisor who reviews graphs weekly will catch a stalled program in days, while one who reviews them at the reauthorization will catch it in months. Collect what you will use, look at it often, and let the graph tell you when to act.",
    respond: "Pick a measure you collect that nobody uses. Keep it or kill it, and say why." },

  { id: "p-punish", outline: "G.17", kind: "take", title: "The drill's take: punishment belongs behind reinforcement, not in front of it",
    source: "The drill's own position, drawing on the BACB Ethics Code (2020) and Cooper, Heron & Heward (2020), ch. Positive Punishment",
    text: "Here is the position. A punishment procedure should never be the first thing on a plan and should never stand alone. Before it is considered, the team should know the function of the behavior, have taught a replacement that meets the same need, and have made the reinforcer for the replacement richer than the one for the problem behavior. Often that is enough, and punishment is never needed. When it is considered, the reason should be written down, the least restrictive option should be tried first, and the data should show quickly whether it is working, because a punisher that is not suppressing the behavior is just a harm with no benefit. Punishment can also produce side effects, like aggression, escape from the person delivering it, or a child who learns only what not to do. A plan that leans on it first is usually a plan that skipped the assessment.",
    respond: "Is there a case where you would reach for response cost early? Make the argument either way." },

  { id: "p-prompt", outline: "G.8", kind: "take", title: "The drill's take: prompt dependence is a fading problem",
    source: "The drill's own position, drawing on Cooper, Heron & Heward (2020), ch. Stimulus Control",
    text: "Here is the position. When a learner waits for a prompt before responding, the usual story is that the learner is prompt dependent, as if it were a trait. Most of the time it is a teaching history. If the prompt reliably comes, and a prompted response earns the same reinforcer as an independent one, then waiting is the efficient choice, and the learner has learned exactly what was taught. The fix lives in the procedure. Plan the fade before the first session, using a delay or a least-to-most sequence that actually moves. Reinforce independent responses more richly than prompted ones. Watch for staff who prompt faster than the plan says because the session is running long. When fading stalls, look at the adult before the child. A learner who is still fully prompted after weeks is telling you something about the plan.",
    respond: "Tell a new BT why her learner waits for her, without making her feel blamed." },

  /* Written to lean on the keys his first drills missed most (w, m, b, u, c,
     2026-09-23). The picker below finds the heaviest passage for whatever his
     tricky keys are NOW, so these are extra weight, not the mechanism. */
  { id: "p-herrnstein", outline: "B.23", kind: "study", title: "Relative and absolute strength of response as a function of frequency of reinforcement",
    source: "Herrnstein (1961), Journal of the Experimental Analysis of Behavior",
    text: "Herrnstein worked with pigeons that could peck either of two keys, each one paying off on its own variable-interval schedule. He changed how much reinforcement each key could produce and measured how the birds spread their pecking between them. The birds did not simply pick the better key and stay there. Instead, the share of pecks on each key came to match the share of reinforcement that key produced. When one key paid off about twice as much, it drew about twice as much behavior. This became known as the matching law, and it changed how behavior analysts think about choice. Behavior is always allocated among competing sources of reinforcement, not emitted in a vacuum. In clinic terms, a problem behavior that is maintained by a much richer schedule than the replacement will win the competition, which is why a new behavior must be reinforced more quickly, more often, or with more value than the old one.",
    respond: "Use the matching law to explain to a parent why the new skill is losing to the old behavior at home." },

  { id: "p-mace", outline: "B.22", kind: "study", title: "Behavioral momentum in the treatment of noncompliance",
    source: "Mace, Hock, Lalli, West, Belfiore, Pinter & Brown (1988), JABA",
    text: "Mace and his colleagues borrowed the idea of momentum from physics and asked whether it could build compliance. Before a request that a person usually refused, staff delivered a quick series of brief requests the person almost always followed, each one met with praise, and then made the difficult request right away. This became known as the high-probability request sequence. Compliance with the difficult request went up compared with making the same request on its own. The timing mattered: the momentum held up best when the difficult request came quickly behind the easy ones, and a long gap between them weakened the effect. The practical lesson is simple to use but easy to misuse. The easy requests must be truly easy for that person, the praise must be real, and the sequence builds compliance best when the whole routine is embedded in a rich schedule of reinforcement rather than used as a trick to get past one task.",
    respond: "Your BT uses high-p requests but the kid still bolts at the last one. Walk through what you would check." },

  { id: "p-multiple", outline: "D.7", kind: "study", title: "Multiple baseline designs",
    source: "Baer, Wolf & Risley (1968), JABA; Cooper, Heron & Heward (2020), ch. Multiple Baseline and Changing Criterion Designs",
    text: "A multiple baseline design is built for behavior that cannot be withdrawn. Once a child has learned to wash hands or buckle a seat belt, the skill usually does not go away when the teaching stops, so a reversal design would not work and would not be welcome. Instead, the analyst measures two or more baselines at once, across behaviors, across settings, or across people, and begins the intervention on one baseline at a time. If each baseline changes only when, and not before, the intervention reaches it, the pattern makes a believable case that the intervention caused the change, and not the calendar, maturation, or a change at home. The design is weaker when the baselines are not independent, because a skill taught in one setting may spread to the next before its turn. It is also slower, because the last baseline waits the longest, which is a cost to weigh when the behavior matters to the client now.",
    respond: "You have three kids and one new procedure. Would you stagger it, and how would you explain the wait to the third family?" },
];

// The first sixteen, then the ones written for his weak keys (passages-more.js).
export const PASSAGES = Object.freeze([...CORE, ...PASSAGES_MORE]);

/* ---- aiming at his weak keys ------------------------------------------- */

/**
 * His weak keys right now: letters he has pressed at least `minPresses` times
 * over the recent drills (panel.keyboardRates) that cost him a miss, highest
 * miss rate first.
 */
export function weakKeys(rates, { minPresses = 20, top = 5 } = {}) {
  return Object.entries(rates || {})
    .filter(([k, r]) => /^[a-z]$/.test(k) && r && r.presses >= minPresses && r.misses > 0)
    .sort((a, b) => b[1].rate - a[1].rate || b[1].misses - a[1].misses)
    .slice(0, top)
    .map(([k]) => k);
}

/** The share of a passage's letters that are among `keys`. */
export function keyLoad(text, keys) {
  const letters = String(text || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!letters.length || !keys || !keys.length) return 0;
  const set = new Set(keys);
  let n = 0;
  for (const c of letters) if (set.has(c)) n += 1;
  return n / letters.length;
}

/**
 * His tricky areas NOW, read from the recent drills, so it moves as he does:
 * a key he has fixed drops out of the last twenty drills and stops being aimed
 * at, and a new one takes its place.
 *   keys         weakKeys over the last 20 drills
 *   pairs        letter pairs that ran slow in 2 or more of the last 10
 *   capitals     same-side Shift on 20% or more of capitals, last 10 drills
 *   punctuation  the punctuation tip fired in 2 or more of the last 10
 */
export function trickyProfile(history, rates) {
  const recent = (history || []).filter(Boolean).slice(-10);
  const pairCount = new Map();
  for (const h of recent) for (const p of new Set(h.slowPairs || [])) pairCount.set(p, (pairCount.get(p) || 0) + 1);
  const pairs = [...pairCount.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => p);
  let ok = 0, same = 0;
  for (const h of recent) { ok += Number(h.shift && h.shift.ok) || 0; same += Number(h.shift && h.shift.same) || 0; }
  const capitals = same >= 3 && same / (same + ok) >= 0.2;
  const punctuation = recent.filter((h) => (h.tips || []).includes("punctuation")).length >= 2;
  return { keys: weakKeys(rates), pairs, capitals, punctuation };
}

/** Plain words for the tag and the Keys tab: "w m b \u00b7 pairs br, ck \u00b7 capitals". */
export function describeProfile(p) {
  if (!p) return "";
  const parts = [];
  if (p.keys && p.keys.length) parts.push(p.keys.join(" "));
  if (p.pairs && p.pairs.length) parts.push("pairs " + p.pairs.join(", "));
  if (p.capitals) parts.push("capitals");
  if (p.punctuation) parts.push("punctuation");
  return parts.join(" \u00b7 ");
}

/**
 * How hard a passage works a profile: the share of letters on his weak keys,
 * plus his slow pairs, capitals and punctuation marks per letter when those
 * are in the profile. Each part is a share of the letters, so they add.
 */
export function passageLoad(text, profile) {
  const p = Array.isArray(profile) ? { keys: profile } : profile || {};
  const raw = String(text || "");
  const letters = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters.length) return 0;
  let load = keyLoad(raw, p.keys || []);
  if (p.pairs && p.pairs.length) {
    const flat = raw.toLowerCase().split(/[^a-z]+/);
    let n = 0;
    for (const w of flat) for (let i = 0; i + 1 < w.length; i++) if (p.pairs.includes(w.slice(i, i + 2))) n += 1;
    load += (2 * n) / letters.length;
  }
  if (p.capitals) load += (raw.match(/[A-Z]/g) || []).length / letters.length * 4;
  if (p.punctuation) load += (raw.match(/[,.;:!?]/g) || []).length / letters.length * 4;
  return load;
}

/**
 * The next passage. The last few he copied are set aside; of the rest, the one
 * that works his tricky areas hardest wins, and with none yet (a new player)
 * the one least recently copied does. The last third he copied sit out. `profile` is a trickyProfile, or a plain
 * list of keys. `shelved` ids are left out: they come back through the shelf.
 */
export function nextPassage(recentIds = [], profile = null, shelved = []) {
  const last = new Map();
  recentIds.forEach((id, i) => last.set(id, i));
  const age = (p) => (last.has(p.id) ? last.get(p.id) + 1 : 0);
  // A third of the passages sit out after he copies them (never fewer than
  // three), so an aimed player rotates through a dozen heavy passages, not
  // the same four.
  const sitOut = Math.min(Math.max(3, Math.floor(PASSAGES.length / 3)), PASSAGES.length - 1);
  const skip = new Set(recentIds.slice(-sitOut));
  // A shelved passage waits for its turn on the shelf, never sooner.
  const wait = new Set(shelved);
  const open = PASSAGES.filter((p) => !wait.has(p.id));
  const base = open.length ? open : PASSAGES;
  const fresh = base.filter((p) => !skip.has(p.id));
  const pool = fresh.length ? fresh : base;
  const aimed = profile && (Array.isArray(profile) ? profile.length : describeProfile(profile));
  if (aimed) return pool.slice().sort((a, b) => passageLoad(b.text, profile) - passageLoad(a.text, profile) || age(a) - age(b))[0];
  return pool.slice().sort((a, b) => age(a) - age(b))[0];
}
export const passageById = (id) => PASSAGES.find((p) => p.id === id) || null;
