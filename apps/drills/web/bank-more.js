/* Clinical typing drills: the bank, filled out to the whole outline.
 *
 * bank.js held questions for 54 of the outline's 104 items. These cover the
 * other 50, one each, so the map's emptiest cell is always one the bank can
 * ask about and spaced review has every domain to bring back.
 *
 * Same rules as bank.js: one question, two bullets, a source on every bullet.
 * A paper is named only where it is certain to exist; Cooper, Heron & Heward
 * by chapter TITLE; the Ethics Code by section; and "general practice
 * knowledge" where a line is common practice with no single source. Never an
 * invented citation.
 */

const CHH = "Cooper, Heron & Heward (2020), Applied Behavior Analysis, 3rd ed.";
const CODE = "BACB Ethics Code for Behavior Analysts (2020)";
const TCO = "BACB BCBA Test Content Outline, 6th ed.";
const GPK = "general practice knowledge";

export const BANK_MORE = Object.freeze([
  /* A. Philosophy */
  { id: "a-05", outline: "A.4", tag: "parent",
    question: "A mom asks whether you are 'a behaviorist'. Sort out behaviorism, the experimental analysis of behavior, ABA and your own practice in words she would follow.",
    bullets: [
      { text: "Behaviorism is the philosophy, EAB the basic science, ABA the applied science, and practice is service guided by all three.", source: CHH + ", ch. Definition and Characteristics of ABA" },
      { text: "The basic science started in the laboratory, with operant behavior studied under tight control.", source: "Skinner (1938), The Behavior of Organisms" },
    ] },

  /* B. Concepts and principles */
  { id: "b-13", outline: "B.1", tag: "vignette",
    question: "The team counts 'hitting' as one behavior, but he slaps for attention and punches when a demand lands. One response class or two, and what changes in the plan?",
    bullets: [
      { text: "A response class is a group of responses with the same function, whatever their form.", source: CHH + ", ch. Basic Concepts and Principles" },
      { text: "Behavior is the activity; a response is one instance of it.", source: CHH + ", ch. Basic Concepts and Principles" },
    ] },
  { id: "b-14", outline: "B.2", tag: "explain",
    question: "A red cup, a blue mug and a paper cup all set the occasion for 'drink'. Stimulus or stimulus class, and why does the difference matter when you teach?",
    bullets: [
      { text: "Stimulus classes can share form, a place in time, or a function.", source: CHH + ", ch. Basic Concepts and Principles" },
      { text: "Teach the class with varied examples, or you teach one cup.", source: "Stokes & Baer (1977), JABA" },
    ] },
  { id: "b-15", outline: "B.3", tag: "vignette",
    question: "Her heart races when the dentist's chair tilts back, and she has learned to say 'bathroom' to get out of it. Which part is respondent, which is operant?",
    bullets: [
      { text: "Respondent behavior is elicited by what comes before it; operant behavior is selected by what comes after.", source: CHH + ", ch. Basic Concepts and Principles" },
      { text: "Both kinds are often at work in the same moment.", source: GPK },
    ] },
  { id: "b-16", outline: "B.5", tag: "vignette",
    question: "A BT takes the tablet away when he spits, and the teacher makes him wipe the whole table after. Name each contingency, and say how you would know either one is punishment.",
    bullets: [
      { text: "Positive punishment adds a stimulus, negative punishment removes one; both are defined by a decrease in future behavior.", source: CHH + ", ch. Basic Concepts and Principles" },
      { text: "No decrease in the data, no punishment, whatever it was meant to be.", source: GPK },
    ] },
  { id: "b-17", outline: "B.8", tag: "explain",
    question: "'No' stops him cold at home and does nothing at school. What kind of punisher is 'no', and why does it travel so badly?",
    bullets: [
      { text: "A conditioned punisher gets its function from pairing with other punishers.", source: CHH + ", ch. Positive Punishment" },
      { text: "A generalized conditioned punisher is paired with many, so it depends less on any one condition.", source: CHH + ", ch. Positive Punishment" },
    ] },
  { id: "b-18", outline: "B.10", tag: "explain",
    question: "Explain concurrent, multiple, mixed and chained schedules to a BT using only things that happen in one Tuesday session.",
    bullets: [
      { text: "Concurrent: two or more schedules available at once, for different responses.", source: CHH + ", ch. Schedules of Reinforcement" },
      { text: "Multiple and chained schedules signal each component; mixed and tandem do not.", source: CHH + ", ch. Schedules of Reinforcement" },
    ] },
  { id: "b-19", outline: "B.12", tag: "vignette",
    question: "He sits beautifully for his teacher and climbs the shelves the minute the sub walks in. Behavior problem or stimulus control problem, and why does the answer change your move?",
    bullets: [
      { text: "Stimulus control: a behavior occurs more often in the presence of a stimulus than in its absence.", source: CHH + ", ch. Stimulus Control" },
      { text: "Transfer control on purpose: the new adult runs the old contingencies alongside the old adult first.", source: GPK },
    ] },
  { id: "b-20", outline: "B.15", tag: "parent",
    question: "Six months after discharge, a dad asks why his son still uses the picture schedule when nobody rewards it anymore. What is keeping it going?",
    bullets: [
      { text: "Response maintenance: behavior that continues after the intervention is withdrawn.", source: CHH + ", ch. Generalization and Maintenance of Behavior Change" },
      { text: "Behavior that contacts natural reinforcers gets kept by them.", source: "Stokes & Baer (1977), JABA" },
    ] },
  { id: "b-21", outline: "B.18", tag: "vignette",
    question: "A teen follows 'finish the worksheet and you get your phone' perfectly, until the day nobody checks. Rule-governed or contingency-shaped, and what does that predict?",
    bullets: [
      { text: "Rule-governed behavior is controlled by a verbal description of a contingency, not by contact with it.", source: "Skinner (1969), Contingencies of Reinforcement" },
      { text: "Rule following can stay put when the real contingencies change.", source: "Hayes (Ed.) (1989), Rule-Governed Behavior" },
    ] },
  { id: "b-22", outline: "B.20", tag: "vignette",
    question: "He says 'train!' when he sees a train AND wants the train. Tact or mand, and why is 'both' a respectable answer?",
    bullets: [
      { text: "Multiple control: one response can be under more than one variable at once, such as an MO and a nonverbal stimulus.", source: "Skinner (1957), Verbal Behavior" },
      { text: "Pull the variables apart to test it: the train in view with no MO, and the MO with no train.", source: GPK },
    ] },
  { id: "b-23", outline: "B.21", tag: "explain",
    question: "You taught picture to word and word to object. Now he matches object to picture with no training. Explain where that came from to a skeptical SLP.",
    bullets: [
      { text: "Stimulus equivalence: reflexivity, symmetry and transitivity emerge from trained conditional discriminations.", source: "Sidman & Tailby (1982), JEAB" },
      { text: "Train some relations, get more for free.", source: CHH + ", ch. Equivalence-based Instruction" },
    ] },
  { id: "b-24", outline: "B.24", tag: "vignette",
    question: "His brother gets a sticker for sitting, and he sits too, without being asked. Imitation or observational learning, and what makes the difference?",
    bullets: [
      { text: "Imitation: the model's behavior evokes similar behavior soon after, and the model is the controlling variable.", source: CHH + ", ch. Imitation, Modeling, and Observational Learning" },
      { text: "Observational learning also turns on the consequences the model received.", source: CHH + ", ch. Imitation, Modeling, and Observational Learning" },
    ] },

  /* C. Measurement */
  { id: "c-07", outline: "C.2", tag: "vignette",
    question: "The teacher sends finished worksheets, a parent fills in a checklist, and you watch for twenty minutes. Which is direct, indirect and product, and which do you trust for what?",
    bullets: [
      { text: "A permanent product measures what the behavior leaves behind, after the fact.", source: CHH + ", ch. Measuring Behavior" },
      { text: "Indirect measures rest on someone's report and need checking against direct observation.", source: CHH + ", ch. Functional Behavior Assessment" },
    ] },
  { id: "c-08", outline: "C.3", tag: "supervise",
    question: "Two BTs both wrote '12' for hand flapping, one in ten minutes and one in forty. Teach them why the count alone tells you almost nothing.",
    bullets: [
      { text: "Rate is count per unit of time.", source: CHH + ", ch. Measuring Behavior" },
      { text: "When observation periods vary, report rate, not count.", source: CHH + ", ch. Measuring Behavior" },
    ] },
  { id: "c-09", outline: "C.4", tag: "vignette",
    question: "He starts the worksheet four minutes after the instruction, works on it for ninety seconds, and waits a long time between bites at lunch. Name the three measures.",
    bullets: [
      { text: "Latency runs from the stimulus to the start of the response; duration from its start to its end.", source: CHH + ", ch. Measuring Behavior" },
      { text: "Interresponse time is the time between two responses of the same class.", source: CHH + ", ch. Measuring Behavior" },
    ] },
  { id: "c-10", outline: "C.5", tag: "design",
    question: "Your BT runs partial interval on a behavior that fills most of each interval. Over or under, and what do you switch to?",
    bullets: [
      { text: "Partial interval tends to overestimate total duration; whole interval tends to underestimate it.", source: CHH + ", ch. Measuring Behavior" },
      { text: "Continuous duration recording needs no estimate at all.", source: CHH + ", ch. Measuring Behavior" },
    ] },
  { id: "c-11", outline: "C.7", tag: "design",
    question: "Two teaching procedures both reach mastery. One takes 40 trials, the other 25 but twice the prep. How do you decide which one is 'better'?",
    bullets: [
      { text: "Efficiency: trials, sessions or minutes to criterion, not only whether criterion was met.", source: GPK },
      { text: "Count the cost to staff and family, not only the learner's trials.", source: GPK },
    ] },
  { id: "c-12", outline: "C.10", tag: "design",
    question: "The team summed up the month in one bar graph. What would an equal-interval line graph of the same data show that the bar hides?",
    bullets: [
      { text: "A line graph shows level, trend and variability across time.", source: CHH + ", ch. Constructing and Interpreting Graphic Displays of Behavioral Data" },
      { text: "A bar summarizes, and a summary can hide a trend.", source: CHH + ", ch. Constructing and Interpreting Graphic Displays of Behavioral Data" },
    ] },

  /* D. Experimental design */
  { id: "d-04", outline: "D.1", tag: "supervise",
    question: "A new BT asks what 'the IV' is on the graph you just showed. Explain IV and DV using his token board.",
    bullets: [
      { text: "The IV is what the analyst changes; the DV is the behavior measured.", source: CHH + ", ch. Analyzing Behavior Change: Basic Assumptions and Strategies" },
      { text: "Change one variable at a time, or you cannot say which one worked.", source: CHH + ", ch. Analyzing Behavior Change: Basic Assumptions and Strategies" },
    ] },
  { id: "d-05", outline: "D.2", tag: "explain",
    question: "Your reversal design is airtight for one learner in one clinic. A funder asks if it will work for every kid on your caseload. Which validity is she asking about, and what is the honest answer?",
    bullets: [
      { text: "Internal validity: the change came from the IV. External validity: it holds across people, settings and behaviors.", source: CHH + ", ch. Planning and Evaluating Applied Behavior Analysis Research" },
      { text: "Single-case research builds external validity by replication.", source: CHH + ", ch. Planning and Evaluating Applied Behavior Analysis Research" },
    ] },
  { id: "d-06", outline: "D.4", tag: "explain",
    question: "A psychology student says n of 1 is 'just an anecdote'. Name what makes a single-case design an experiment.",
    bullets: [
      { text: "Prediction, verification and replication, with repeated measures and the person as their own control.", source: CHH + ", ch. Analyzing Behavior Change: Basic Assumptions and Strategies" },
      { text: "A steady baseline predicts what would happen without the intervention.", source: CHH + ", ch. Analyzing Behavior Change: Basic Assumptions and Strategies" },
    ] },
  { id: "d-07", outline: "D.5", tag: "explain",
    question: "When would you want a group design over a single-case one, as a BCBA, and when would you refuse one?",
    bullets: [
      { text: "A group average can hide the people who got worse; single-case data show each person's effect.", source: CHH + ", ch. Planning and Evaluating Applied Behavior Analysis Research" },
      { text: "Group designs answer questions about populations, e.g., how many improve.", source: GPK },
    ] },
  { id: "d-08", outline: "D.6", tag: "vignette",
    question: "The treatment phase has a higher mean, but baseline was already climbing. Would you call it an effect? Say what you look at before you say yes.",
    bullets: [
      { text: "Visual analysis weighs level, trend and variability within and across phases, and how immediate the change was.", source: CHH + ", ch. Constructing and Interpreting Graphic Displays of Behavioral Data" },
      { text: "Structured criteria, such as the dual-criterion method, cut visual analysis errors.", source: "Fisher, Kelley & Lomas (2003), JABA" },
    ] },
  { id: "d-09", outline: "D.8", tag: "design",
    question: "Your package works: a visual schedule, a token board and FCT. The school can only run one. What analysis tells you which part is doing the work?",
    bullets: [
      { text: "A component analysis tests the parts of a package, dropping or adding one at a time.", source: CHH + ", ch. Planning and Evaluating Applied Behavior Analysis Research" },
      { text: "Parametric asks how much; comparative pits two treatments against each other.", source: CHH + ", ch. Planning and Evaluating Applied Behavior Analysis Research" },
    ] },
  { id: "d-10", outline: "D.9", tag: "design",
    question: "You want to show that raising his work requirement step by step raises his output. Pick the design and say what the criterion lines must do.",
    bullets: [
      { text: "Changing criterion: behavior should track each change in the criterion closely.", source: "Hartmann & Hall (1976), JABA" },
      { text: "Vary the phase lengths and step sizes, so the match cannot be coincidence.", source: CHH + ", ch. Multiple Baseline and Changing Criterion Designs" },
    ] },

  /* E. Ethics */
  { id: "e-07", outline: "E.1", tag: "ethics",
    question: "Name one moment this week when 'benefit others' and 'treat others with dignity' pulled in different directions. Which one won, and should it have?",
    bullets: [
      { text: "Four core principles: benefit others; treat others with compassion, dignity and respect; behave with integrity; ensure competence.", source: CODE + ", Core Principles" },
      { text: "When two principles conflict, reason it through and consult; a rule lookup will not settle it.", source: GPK },
    ] },
  { id: "e-08", outline: "E.2", tag: "ethics",
    question: "A colleague bills a 'parent training' hour that was a chat in the driveway. List who gets hurt, from the family to the field.",
    bullets: [
      { text: "Unethical conduct risks the client, the certificant's credential, and public trust in the profession.", source: GPK },
      { text: "Accurate billing and documentation are part of the Code.", source: CODE + ", section 2, Responsibility in Practice" },
    ] },
  { id: "e-09", outline: "E.8", tag: "parent",
    question: "A parent snaps that the program is 'robotic'. Write the first three things you say, before you defend anything.",
    bullets: [
      { text: "Listen, reflect and ask before explaining; the relationship is part of the treatment.", source: "Taylor, LeBlanc & Nosik (2019), Behavior Analysis in Practice" },
      { text: "Accepting feedback and listening actively are skills the outline names.", source: TCO + ", E.8" },
    ] },
  { id: "e-10", outline: "E.10", tag: "ethics",
    question: "A family asks you not to target eye contact, because in their culture it is disrespectful toward elders. What happens to your goal?",
    bullets: [
      { text: "Services are adapted to the client's culture and values.", source: CODE + ", 1.07" },
      { text: "Cultural awareness starts with the analyst's own history and assumptions.", source: "Fong, Catagnus, Brodhead, Quigley & Field (2016), Behavior Analysis in Practice" },
    ] },
  { id: "e-11", outline: "E.11", tag: "ethics",
    question: "Which families do you find it easiest to like, and how would you catch that shaping your recommendations?",
    bullets: [
      { text: "Behavior analysts evaluate their own biases and how those affect their work.", source: CODE + ", 1.10" },
      { text: "Data on your own decisions, e.g., hours recommended by family, can surface a bias you cannot feel.", source: GPK },
    ] },
  { id: "e-12", outline: "E.12", tag: "ethics",
    question: "You are moving to a state that licenses behavior analysts. What do you check before your first session there, beyond your BCBA?",
    bullets: [
      { text: "Certification and licensure are separate; the law where you practice governs.", source: GPK },
      { text: "Know the funder's rules as well: authorizations, supervision requirements, billing codes.", source: GPK },
    ] },

  /* F. Assessment */
  { id: "f-07", outline: "F.1", tag: "vignette",
    question: "Intake file: an IEP, a neuropsych report from three years ago, and a note that he 'had ear infections'. What do you pull from each before you meet him?",
    bullets: [
      { text: "Records at intake: educational, medical, historical.", source: TCO + ", F.1" },
      { text: "Rule out medical contributors, such as pain, before building a behavior plan.", source: GPK },
    ] },
  { id: "f-08", outline: "F.2", tag: "parent",
    question: "The family's first language is Tagalog, and the grandmother runs the house. How does that change who you interview, and how?",
    bullets: [
      { text: "Assessment integrates cultural variables: language, family structure, values.", source: TCO + ", F.2" },
      { text: "Use a trained interpreter, never the child, and ask who makes the decisions.", source: GPK },
    ] },
  { id: "f-09", outline: "F.3", tag: "design",
    question: "Your assessment lists forty deficits and no strengths. Rewrite the summary's first line so a parent keeps reading.",
    bullets: [
      { text: "Assess strengths as well as needs; strengths are what you build on.", source: TCO + ", F.3" },
      { text: "Pick targets for social significance, and favor behavioral cusps.", source: "Rosales-Ruiz & Baer (1997), JABA" },
    ] },

  /* G. Behavior-change procedures */
  { id: "g-11", outline: "G.1", tag: "design",
    question: "His work is maintained by escape. Design a negative reinforcement procedure that gets more work out of him, not less.",
    bullets: [
      { text: "Breaks follow completed work or a request for a break, never problem behavior.", source: CHH + ", ch. Negative Reinforcement" },
      { text: "Positive reinforcers for compliance can compete with escape.", source: "Lalli et al. (1999), JABA" },
    ] },
  { id: "g-12", outline: "G.5", tag: "design",
    question: "You teach manding for juice right after lunch, and it goes nowhere. Rebuild the session using an MO and an SD on purpose.",
    bullets: [
      { text: "Teach the mand when the MO is in effect, and contrive one if you must.", source: CHH + ", ch. Verbal Behavior" },
      { text: "The SD signals reinforcement is available; the MO makes it worth asking for.", source: "Michael (1982), JEAB" },
    ] },
  { id: "g-13", outline: "G.6", tag: "design",
    question: "He touches the cup card when it is the only card, and scores at chance in an array of three. What has he learned, and what do you teach next?",
    bullets: [
      { text: "One card on the table teaches nothing about its name: he can be right by touching whatever is there.", source: GPK },
      { text: "A conditional discrimination: the correct choice depends on the sample, e.g., the spoken word.", source: CHH + ", ch. Stimulus Control" },
    ] },
  { id: "g-14", outline: "G.9", tag: "design",
    question: "He has no imitation repertoire. Plan the first week of building one, and say what you do when he does not copy.",
    bullets: [
      { text: "Start with actions on objects, prompt and fade, and mix in untrained models to check for generalized imitation.", source: CHH + ", ch. Imitation, Modeling, and Observational Learning" },
      { text: "Generalized imitation shows when he copies models that were never reinforced.", source: CHH + ", ch. Imitation, Modeling, and Observational Learning" },
    ] },
  { id: "g-15", outline: "G.10", tag: "design",
    question: "Write the screen-time rule you would post for a twelve-year-old that actually controls behavior. What makes a rule work?",
    bullets: [
      { text: "A rule works best when it names the behavior, the consequence and the time, and the consequence is likely and big enough.", source: GPK },
      { text: "A rule about a delayed consequence needs something immediate behind it.", source: GPK },
    ] },
  { id: "g-16", outline: "G.13", tag: "vignette",
    question: "The school wants table DTT all day; the family wants teaching at the park. Make the case for mixing trial-based and free-operant teaching on one skill.",
    bullets: [
      { text: "Trials give many learning opportunities fast; free-operant teaching favors initiation and generalization.", source: GPK },
      { text: "Incidental teaching follows the learner's lead in the natural setting.", source: "Hart & Risley (1975), JABA" },
    ] },
  { id: "g-17", outline: "G.14", tag: "design",
    question: "A class of twelve is loud at every transition. Design an interdependent group contingency, and name one way it can go wrong.",
    bullets: [
      { text: "Independent, dependent and interdependent contingencies differ in whose behavior earns the reward.", source: CHH + ", ch. Token Economy, Group Contingency, and Contingency Contracting" },
      { text: "Watch for peer pressure on the one who misses the criterion.", source: CHH + ", ch. Token Economy, Group Contingency, and Contingency Contracting" },
    ] },
  { id: "g-18", outline: "G.15", tag: "design",
    question: "He says 'hi' to his teacher and nobody else, and only 'hi'. Plan one step for stimulus generalization and one for response generalization.",
    bullets: [
      { text: "Stimulus generalization is the same response under new stimuli; response generalization is new responses under the same stimulus.", source: CHH + ", ch. Generalization and Maintenance of Behavior Change" },
      { text: "Train sufficient exemplars, of people and of greetings.", source: "Stokes & Baer (1977), JABA" },
    ] },
  { id: "g-19", outline: "G.19", tag: "design",
    question: "Teach two relations and get four more for free. Which two do you train, and which four do you test?",
    bullets: [
      { text: "Train A to B and B to C; test B to A and C to B (symmetry), A to C (transitivity) and C to A (equivalence).", source: "Sidman & Tailby (1982), JEAB" },
      { text: "Equivalence-based instruction is built for efficiency.", source: CHH + ", ch. Equivalence-based Instruction" },
    ] },

  /* H. Selecting and implementing interventions */
  { id: "h-08", outline: "H.4", tag: "design",
    question: "You are about to start extinction for attention-maintained yelling in a home with a new baby. Which unwanted effects do you plan for, and how?",
    bullets: [
      { text: "Bursting and aggression both showed up during extinction, and bursts were less common when it was combined with other procedures.", source: "Lerman, Iwata & Wallace (1999), JABA" },
      { text: "Plan for safety, and for what the caregivers can actually hold at 3 a.m.", source: GPK },
    ] },
  { id: "h-09", outline: "H.6", tag: "supervise",
    question: "Your fidelity checks read 95%, and the kid is not improving. What do you look at before you change the plan?",
    bullets: [
      { text: "Treatment integrity is whether the plan was carried out as written; without it, no conclusion about the plan holds.", source: CHH + ", ch. Planning and Evaluating Applied Behavior Analysis Research" },
      { text: "Look at which steps were missed, not only the percent: one missed step can carry the treatment.", source: GPK },
    ] },

  /* I. Supervision */
  { id: "i-05", outline: "I.1", tag: "supervise",
    question: "Your agency wants to cut supervision hours to save money. Make the case to the regional director, in outcomes.",
    bullets: [
      { text: "Supervision is tied to client outcomes, staff performance and staff retention.", source: TCO + ", I.1" },
      { text: "Turnover costs hiring, training and the client's progress.", source: GPK },
    ] },
  { id: "i-06", outline: "I.3", tag: "supervise",
    question: "Two supervisees, one confident and one quiet. Who gets more of your feedback time, and how would you check that it is fair?",
    bullets: [
      { text: "Equity in supervision covers access, feedback and opportunity, and it is tracked, not assumed.", source: TCO + ", I.3" },
      { text: "A plain log of minutes and feedback by supervisee will show it.", source: GPK },
    ] },
  { id: "i-07", outline: "I.4", tag: "supervise",
    question: "A new supervisee is great with kids and freezes with parents. Pick her first supervision goal, and say how you assessed it.",
    bullets: [
      { text: "Goals come from an assessment of the supervisee's skills, cultural variables and environment.", source: TCO + ", I.4" },
      { text: "Watching her with a parent beats asking her how it goes.", source: GPK },
    ] },
  { id: "i-08", outline: "I.7", tag: "supervise",
    question: "You gave a BT feedback on prompting three weeks running. How do you know your supervision is working, and what do you change if it is not?",
    bullets: [
      { text: "Judge supervision by the supervisee's performance and the client's outcomes.", source: TCO + ", I.7" },
      { text: "If telling is not changing it, model and rehearse: BST to criterion.", source: "Parsons, Rollyson & Reid (2012), Behavior Analysis in Practice" },
    ] },
]);
