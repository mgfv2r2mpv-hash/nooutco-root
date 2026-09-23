/* Clinical typing drills: the bank.
 *
 * Built for one or two minutes on the clock. Each item asks ONE thing, often
 * through an odd little vignette, so the answer can be typed at speed and still
 * say something the expert can use. Two quicknote bullets under each, with a
 * source on every one: a foothold, never the answer.
 *
 * Every item names the BACB 6th edition outline item it files under
 * (outline.js); that is what the knowledge map counts and what the picker
 * reads to find the emptiest cell. `tag` is the kind of prompt, for the card.
 *
 * Nothing here is generated at run time. A question is added by a person, in
 * this file, so the framing you type toward is one someone chose and can strike.
 *
 * Sources are named by author and year, and Cooper, Heron & Heward (2020) by
 * chapter TITLE rather than number, so a citation cannot be off by a chapter.
 */

const CHH = "Cooper, Heron & Heward (2020), Applied Behavior Analysis, 3rd ed.";

export const TAGS = Object.freeze(["vignette", "explain", "design", "parent", "ethics", "supervise"]);

export const BANK = Object.freeze([
  /* ── A. Philosophy ─────────────────────────────────────────────────── */
  { id: "a-01", outline: "A.1", tag: "parent",
    question: "A dad asks why you keep counting things instead of asking his son how he feels. Tell him what the counting is for.",
    bullets: [
      { text: "The science is after description, prediction and control, in that order.", source: CHH + ", ch. Definition and Characteristics of ABA" },
      { text: "Feelings are not excluded; they are behavior too, observed by one person.", source: "Skinner (1974), About Behaviorism" },
    ] },
  { id: "a-02", outline: "A.3", tag: "explain",
    question: "A new OT says ABA ignores the inner life. Where does radical behaviorism actually put thoughts and feelings?",
    bullets: [
      { text: "Private events are real and lawful; the difference is who can observe them.", source: "Skinner (1945), Psychological Review, The operational analysis of psychological terms" },
      { text: "Radical here means 'to the root', not 'extreme'.", source: "Skinner (1974), About Behaviorism" },
    ] },
  { id: "a-03", outline: "A.5", tag: "supervise",
    question: "Which of the seven dimensions does a brand new BT drop first on the floor, and what does that look like in a session?",
    bullets: [
      { text: "Applied, behavioral, analytic, technological, conceptually systematic, effective, general.", source: "Baer, Wolf & Risley (1968), JABA" },
      { text: "Twenty years on, the same authors said the dimensions still held.", source: "Baer, Wolf & Risley (1987), JABA" },
    ] },
  { id: "a-04", outline: "A.2", tag: "vignette",
    question: "One week in, the teacher says his tantrums are 'manipulative'. What simpler account do you rule out first, and why that one?",
    bullets: [
      { text: "Parsimony: the simplest account consistent with the data goes first.", source: CHH + ", ch. Definition and Characteristics of ABA" },
      { text: "A label is a description of behavior, not a cause of it.", source: CHH + ", ch. Basic Concepts and Principles" },
    ] },

  /* ── B. Concepts and principles ────────────────────────────────────── */
  { id: "b-01", outline: "B.17", tag: "vignette",
    question: "A learner mands for a break forty times a session and takes it every time. The team says he is 'checking the box'. What is going on?",
    bullets: [
      { text: "An MO alters the value of the consequence and how often the behavior it has reinforced occurs right now.", source: "Laraway, Snycerski, Michael & Poling (2003), JABA" },
      { text: "An SD signals availability; an MO changes value. Different jobs.", source: "Michael (1982), JEAB" },
    ] },
  { id: "b-02", outline: "B.16", tag: "vignette",
    question: "Lunch is at 11:30 and your edibles stop working at noon, every day. Name what happened and what you change tomorrow.",
    bullets: [
      { text: "Satiation is an abolishing operation: it lowers the value of the reinforcer and the behavior it maintained.", source: "Laraway, Snycerski, Michael & Poling (2003), JABA" },
      { text: "Rotate, restrict, or move the demand; the reinforcer did not 'stop working'.", source: CHH + ", ch. Motivating Operations" },
    ] },
  { id: "b-03", outline: "B.13", tag: "vignette",
    question: "He whines for the iPad with Grandma and never with you. Same kid, same iPad. Why?",
    bullets: [
      { text: "Discrimination: behavior occurs in the presence of a stimulus correlated with reinforcement.", source: CHH + ", ch. Stimulus Control" },
      { text: "Grandma is the SD; you are the S-delta.", source: CHH + ", ch. Stimulus Control" },
    ] },
  { id: "b-04", outline: "B.11", tag: "parent",
    question: "Mom stopped giving candy for screaming and the screaming doubled this week. She wants to quit. What do you tell her?",
    bullets: [
      { text: "An extinction burst is common but not universal; plan for it before it happens.", source: "Lerman & Iwata (1995), JABA" },
      { text: "Extinction alone is the procedure most likely to be abandoned at home.", source: CHH + ", ch. Extinction" },
    ] },
  { id: "b-05", outline: "B.4", tag: "vignette",
    question: "Every time you put the worksheet down he throws it, and you take it away 'so he can calm down'. Which contingency are you running?",
    bullets: [
      { text: "Negative reinforcement: behavior removes an aversive, and increases.", source: CHH + ", ch. Negative Reinforcement" },
      { text: "Escape-maintained problem behavior is common in demand contexts.", source: "Iwata, Dorsey, Slifer, Bauman & Richman (1982/1994), JABA" },
    ] },
  { id: "b-06", outline: "B.6", tag: "vignette",
    question: "She flaps and hums alone in her room with nobody there. What does that tell you about the contingency, and what does it not?",
    bullets: [
      { text: "Behavior that persists in the alone condition points toward automatic reinforcement.", source: "Iwata, Dorsey, Slifer, Bauman & Richman (1982/1994), JABA" },
      { text: "Automatic does not mean 'no function' or 'no treatment'.", source: CHH + ", ch. Functional Behavior Assessment" },
    ] },
  { id: "b-07", outline: "B.9", tag: "explain",
    question: "Explain to a BT why the kid who gets a sticker 'sometimes' keeps going longer than the kid who gets one every time.",
    bullets: [
      { text: "Intermittent schedules produce more resistance to extinction than continuous ones.", source: CHH + ", ch. Schedules of Reinforcement" },
      { text: "Variable ratio: high, steady responding.", source: CHH + ", ch. Schedules of Reinforcement" },
    ] },
  { id: "b-08", outline: "B.7", tag: "vignette",
    question: "Your praise does nothing for him, but his brother's 'nice!' works every time. What kind of reinforcer is praise, and how do you build yours?",
    bullets: [
      { text: "Praise is a conditioned reinforcer; it has to be paired with established ones.", source: CHH + ", ch. Positive Reinforcement" },
      { text: "Pair, then thin the backup reinforcer.", source: CHH + ", ch. Token Economy, Group Contingency, and Contingency Contracting" },
    ] },
  { id: "b-09", outline: "B.19", tag: "vignette",
    question: "He names every car on the street by make and model, and will not ask for water when he is thirsty. Which operants, and what do you teach first?",
    bullets: [
      { text: "Tact and mand are different operants under different controlling variables.", source: "Skinner (1957), Verbal Behavior" },
      { text: "A strong tact repertoire does not transfer to the mand by itself.", source: CHH + ", ch. Verbal Behavior" },
    ] },
  { id: "b-10", outline: "B.22", tag: "design",
    question: "He refuses 'put on your shoes' every morning. Use behavioral momentum to get the shoes on, in two sentences.",
    bullets: [
      { text: "A run of high-probability requests before the low-probability one increases compliance.", source: "Mace et al. (1988), JABA" },
      { text: "The high-p requests have to be reinforced for the momentum to build.", source: "Mace et al. (1988), JABA" },
    ] },
  { id: "b-11", outline: "B.23", tag: "vignette",
    question: "In group, she talks to the aide ten times as often as to peers. Read it with the matching law.",
    bullets: [
      { text: "Relative rate of responding matches relative rate of reinforcement.", source: "Herrnstein (1961), JEAB" },
      { text: "Change the reinforcement ratio, not the child.", source: CHH + ", ch. Schedules of Reinforcement" },
    ] },
  { id: "b-12", outline: "B.14", tag: "vignette",
    question: "He learned to wash his hands at the clinic sink and freezes at the home sink. Stimulus or response generalization, and why does it matter which?",
    bullets: [
      { text: "Stimulus generalization: the same response under new stimuli. Response generalization: new responses under the same stimuli.", source: CHH + ", ch. Generalization and Maintenance of Behavior Change" },
      { text: "Generalization is programmed, not hoped for.", source: "Stokes & Baer (1977), JABA" },
    ] },

  /* ── C. Measurement ────────────────────────────────────────────────── */
  { id: "c-01", outline: "C.9", tag: "vignette",
    question: "The team counts tantrums. One lasted four seconds, one lasted forty minutes. What is the count hiding?",
    bullets: [
      { text: "Pick the dimension the behavior actually varies on: count, duration, latency, IRT.", source: CHH + ", ch. Measuring Behavior" },
      { text: "A count of episodes can fall while total duration climbs.", source: CHH + ", ch. Measuring Behavior" },
    ] },
  { id: "c-02", outline: "C.6", tag: "explain",
    question: "Your BT runs partial interval on a high-rate stim. Which way will the data lean, and what would you use instead?",
    bullets: [
      { text: "Partial interval tends to overestimate; whole interval tends to underestimate.", source: CHH + ", ch. Measuring Behavior" },
      { text: "Momentary time sampling can over- or underestimate depending on the interval.", source: CHH + ", ch. Measuring Behavior" },
    ] },
  { id: "c-03", outline: "C.1", tag: "design",
    question: "Write an operational definition of 'aggression' for a kid who pinches, in one breath. Then say what you left out on purpose.",
    bullets: [
      { text: "A definition names topography, and examples and non-examples, so two observers agree.", source: CHH + ", ch. Selecting and Defining Target Behaviors" },
      { text: "Objective, clear, complete.", source: "Hawkins & Dobes (1977), in Etzel, LeBlanc & Baer (Eds.), New Developments in Behavioral Research" },
    ] },
  { id: "c-04", outline: "C.8", tag: "vignette",
    question: "Two BTs agree 95% on total count and zero percent on which minute it happened. What do you trust, and what do you fix?",
    bullets: [
      { text: "Total count IOA hides disagreement on when; interval-by-interval does not.", source: CHH + ", ch. Improving and Assessing the Quality of Behavioral Measurement" },
      { text: "Agreement is not accuracy; both can be wrong the same way.", source: CHH + ", ch. Improving and Assessing the Quality of Behavioral Measurement" },
    ] },
  { id: "c-05", outline: "C.12", tag: "supervise",
    question: "You want treatment integrity data on a BT's DTT without watching every session. What do you measure, and how often?",
    bullets: [
      { text: "Integrity is measured per component, not as one global 'did it right'.", source: CHH + ", ch. Planning and Evaluating Applied Behavior Analysis Research" },
      { text: "Low integrity can make an effective procedure look ineffective.", source: "Fryling, Wallace & Yassine (2012), JABA" },
    ] },
  { id: "c-06", outline: "C.11", tag: "vignette",
    question: "The graph drops the day you start the new plan, and also the day his cousin moved out. How do you read it?",
    bullets: [
      { text: "Level, trend and variability, read within and across phases.", source: CHH + ", ch. Constructing and Interpreting Graphic Displays of Behavioral Data" },
      { text: "A change that coincides with another event is not yet a functional relation.", source: CHH + ", ch. Analyzing Behavior Change: Basic Assumptions and Strategies" },
    ] },

  /* ── D. Experimental design ────────────────────────────────────────── */
  { id: "d-01", outline: "D.7", tag: "design",
    question: "You taught him to request help and would never take it away to prove it worked. Which design shows the effect anyway?",
    bullets: [
      { text: "A multiple baseline across settings, behaviors or people needs no withdrawal.", source: CHH + ", ch. Multiple Baseline and Changing Criterion Designs" },
      { text: "Staggered starts are what rule out history.", source: CHH + ", ch. Multiple Baseline and Changing Criterion Designs" },
    ] },
  { id: "d-02", outline: "D.7", tag: "vignette",
    question: "She drinks two sips of water a day and needs to drink a cup. Design the steps so each change shows the effect.",
    bullets: [
      { text: "A changing-criterion design shifts the criterion in steps and watches behavior follow.", source: "Hartmann & Hall (1976), JABA" },
      { text: "Vary step size and phase length so the pattern cannot be coincidence.", source: CHH + ", ch. Multiple Baseline and Changing Criterion Designs" },
    ] },
  { id: "d-03", outline: "D.3", tag: "vignette",
    question: "Six months of social skills goals, and he did better. He also turned seven and started a new school. What else could explain it?",
    bullets: [
      { text: "History and maturation are the two threats most treatment timelines invite.", source: CHH + ", ch. Planning and Evaluating Applied Behavior Analysis Research" },
      { text: "Replication is how single-case designs answer them.", source: "Horner et al. (2005), Exceptional Children" },
    ] },

  /* ── E. Ethics ─────────────────────────────────────────────────────── */
  { id: "e-01", outline: "E.3", tag: "ethics",
    question: "A family asks you to add feeding therapy. You have read about it and never done it. What do you do this week, and what do you not do?",
    bullets: [
      { text: "Practice within competence; get supervision, train, or refer.", source: "BACB Ethics Code for Behavior Analysts (2020), 1.05" },
      { text: "Referral is a service, and is documented like one.", source: "Bailey & Burch (2022), Ethics for Behavior Analysts, 4th ed." },
    ] },
  { id: "e-02", outline: "E.7", tag: "ethics",
    question: "The parent you train on Tuesdays asks you to babysit on Saturday, paid. It would help her a lot. Answer her.",
    bullets: [
      { text: "Multiple relationships risk harm and exploitation; avoid them, and address them when they arise.", source: "BACB Ethics Code for Behavior Analysts (2020), 1.11" },
      { text: "Say no warmly and say why; the relationship is the service.", source: "Bailey & Burch (2022), Ethics for Behavior Analysts, 4th ed." },
    ] },
  { id: "e-03", outline: "E.5", tag: "ethics",
    question: "A BT posts a cute video of a learner's first word, no name, just the back of his head. What do you say, and to whom?",
    bullets: [
      { text: "Public statements and social media fall under the Code; consent governs any client content.", source: "BACB Ethics Code for Behavior Analysts (2020), section 5, Public Statements" },
      { text: "No name is not no identifier.", source: "BACB Ethics Code for Behavior Analysts (2020), section 2, confidentiality" },
    ] },
  { id: "e-04", outline: "E.6", tag: "ethics",
    question: "The family has canceled seven of the last ten sessions and the goals are stalled. How do you raise discontinuing, and what do you set up first?",
    bullets: [
      { text: "Discontinue when services no longer help or are not being received; plan the transition.", source: "BACB Ethics Code for Behavior Analysts (2020), section 3, discontinuing and transitioning services" },
      { text: "Name the barrier with them before naming the end.", source: "Bailey & Burch (2022), Ethics for Behavior Analysts, 4th ed." },
    ] },
  { id: "e-05", outline: "E.9", tag: "parent",
    question: "Grandma says making him ask for food is disrespectful in their home. How do you hear that before you answer it?",
    bullets: [
      { text: "Cultural humility is a stance of learning, not a checklist.", source: "Wright (2019), Behavior Analysis in Practice" },
      { text: "Goals are socially valid when the family says so.", source: "Wolf (1978), JABA" },
    ] },
  { id: "e-06", outline: "E.4", tag: "ethics",
    question: "The school counselor calls and asks how he is doing in ABA. You have a release for the school, not for her. What now?",
    bullets: [
      { text: "Share only what the consent covers, with whom it names.", source: "BACB Ethics Code for Behavior Analysts (2020), 2.04" },
      { text: "When in doubt, get it in writing first.", source: "Bailey & Burch (2022), Ethics for Behavior Analysts, 4th ed." },
    ] },

  /* ── F. Assessment ─────────────────────────────────────────────────── */
  { id: "f-01", outline: "F.5", tag: "vignette",
    question: "Elopement from class started the week a substitute took over. Where do you start, and what do you rule out first?",
    bullets: [
      { text: "A setting-event change comes first in any antecedent account.", source: CHH + ", ch. Functional Behavior Assessment" },
      { text: "ABC data describe correlations; they do not demonstrate function.", source: CHH + ", ch. Functional Behavior Assessment" },
    ] },
  { id: "f-02", outline: "F.6", tag: "design",
    question: "Thirty minutes, new head hitting. Which conditions do you run, in what order, and what is each one's control?",
    bullets: [
      { text: "Attention, demand, alone, play: one contingency present per condition.", source: "Iwata, Dorsey, Slifer, Bauman & Richman (1982/1994), JABA" },
      { text: "A practical FA tests one synthesized contingency against one matched control.", source: "Hanley, Jin, Vanselow & Hanratty (2014), JABA" },
    ] },
  { id: "f-03", outline: "F.4", tag: "vignette",
    question: "He picks whatever item is on the left, every trial. What is wrong with your preference assessment, and what fixes it?",
    bullets: [
      { text: "Position bias; counterbalance positions, or change the format.", source: "Fisher et al. (1992), JABA" },
      { text: "MSWO gives a ranking faster with similar top items.", source: "DeLeon & Iwata (1996), JABA" },
    ] },
  { id: "f-04", outline: "F.5", tag: "vignette",
    question: "Hitting only happens on rainy days. Take that seriously for one minute. What would you look at?",
    bullets: [
      { text: "Setting events alter the value of consequences for hours.", source: CHH + ", ch. Motivating Operations" },
      { text: "Rain may mean no recess, a longer bus ride, a different room.", source: CHH + ", ch. Functional Behavior Assessment" },
    ] },
  { id: "f-05", outline: "F.7", tag: "ethics",
    question: "The 'tantrums' stop the week he gets glasses. What did your assessment miss, and when do you refer out?",
    bullets: [
      { text: "Medical and sensory causes are ruled out, or referred, before behavioral ones are assumed.", source: CHH + ", ch. Functional Behavior Assessment" },
      { text: "Records at intake: medical, educational, historical.", source: "BACB BCBA Test Content Outline, 6th ed., F.1" },
    ] },
  { id: "f-06", outline: "F.8", tag: "parent",
    question: "Mom's top goal is sitting through church. Yours was tacting colors. Whose goal goes first, and how do you decide?",
    bullets: [
      { text: "Social validity: goals, procedures and outcomes acceptable to the people they serve.", source: "Wolf (1978), JABA" },
      { text: "Applied means important to the person and those around them.", source: "Baer, Wolf & Risley (1968), JABA" },
    ] },

  /* ── G. Behavior-change procedures ─────────────────────────────────── */
  { id: "g-01", outline: "G.2", tag: "vignette",
    question: "Your DRO resets on every swear, and he swears at minute 4:59 of every five-minute interval. What is he learning, and what do you change?",
    bullets: [
      { text: "DRO reinforces the absence of the target, and anything else going on at that moment.", source: CHH + ", ch. Differential Reinforcement" },
      { text: "Start the interval shorter than the current IRT, then lengthen it.", source: CHH + ", ch. Differential Reinforcement" },
    ] },
  { id: "g-02", outline: "G.17", tag: "vignette",
    question: "Time-out is the hallway. He loves the hallway. Is it time-out, and what is it actually?",
    bullets: [
      { text: "Time-out works only if time-in is richer than time-out.", source: CHH + ", ch. Negative Punishment" },
      { text: "A procedure is defined by its effect on behavior, not by its name.", source: CHH + ", ch. Basic Concepts and Principles" },
    ] },
  { id: "g-03", outline: "G.8", tag: "supervise",
    question: "He waits for the BT's point before every response, even ones he has mastered. Plan the fade in two moves.",
    bullets: [
      { text: "Prompt dependence: fade by delay or by intensity, with a plan to transfer control.", source: CHH + ", ch. Stimulus Control" },
      { text: "Progressive time delay moves control from the prompt to the SD.", source: "Touchette (1971), JEAB" },
    ] },
  { id: "g-04", outline: "G.12", tag: "design",
    question: "Toothbrushing: forward chain, backward chain, or total task? Pick one for a kid who spits at step two.",
    bullets: [
      { text: "Backward chaining delivers the terminal reinforcer on every trial.", source: CHH + ", ch. Chaining" },
      { text: "Total task suits learners who can do most steps already.", source: CHH + ", ch. Chaining" },
    ] },
  { id: "g-05", outline: "G.11", tag: "vignette",
    question: "He says 'ba' for everything he wants. Shape 'ball' without losing the 'ba' you already have.",
    bullets: [
      { text: "Reinforce successive approximations; move the criterion only after the current one is steady.", source: CHH + ", ch. Shaping" },
      { text: "Move too fast and the behavior extinguishes; too slow and it sticks.", source: CHH + ", ch. Shaping" },
    ] },
  { id: "g-06", outline: "G.4", tag: "vignette",
    question: "The token board works until the fourth token, then he flips the table. What is it telling you?",
    bullets: [
      { text: "The exchange ratio and delay are part of the token system's design.", source: CHH + ", ch. Token Economy, Group Contingency, and Contingency Contracting" },
      { text: "Thin the ratio gradually, from where it holds.", source: CHH + ", ch. Token Economy, Group Contingency, and Contingency Contracting" },
    ] },
  { id: "g-07", outline: "G.3", tag: "vignette",
    question: "You give attention every two minutes no matter what, and the screaming drops. Why would free attention work?",
    bullets: [
      { text: "Noncontingent reinforcement abolishes the MO for the problem behavior.", source: CHH + ", ch. Antecedent Interventions" },
      { text: "Start dense, then thin the schedule.", source: CHH + ", ch. Antecedent Interventions" },
    ] },
  { id: "g-08", outline: "G.18", tag: "parent",
    question: "Dad says extinction feels cruel because the kid cries. Take that seriously. What do you plan for, and what do you change?",
    bullets: [
      { text: "Extinction can occasion emotional responding and aggression; plan for it.", source: "Lerman & Iwata (1995), JABA" },
      { text: "Pair it with reinforcement for a replacement, and think about assent.", source: "Rajaraman et al. (2022), JABA" },
    ] },
  { id: "g-09", outline: "G.16", tag: "design",
    question: "He mands for breaks every thirty seconds now. How do you thin that without losing the mand?",
    bullets: [
      { text: "Delay tolerance, chained schedules, or multiple schedules thin reinforcement after FCT.", source: "Hagopian, Boelter & Jarmolowicz (2011), Behavior Analysis in Practice" },
      { text: "Signal when reinforcement is and is not available.", source: CHH + ", ch. Differential Reinforcement" },
    ] },
  { id: "g-10", outline: "G.7", tag: "explain",
    question: "Most-to-least or least-to-most for a brand new skill with a kid who gets frustrated fast? Pick, and say why.",
    bullets: [
      { text: "Most-to-least keeps errors low while the skill is new.", source: CHH + ", ch. Stimulus Control" },
      { text: "Least-to-most gives more independent chances but more errors.", source: CHH + ", ch. Stimulus Control" },
    ] },

  /* ── H. Selecting and implementing interventions ───────────────────── */
  { id: "h-01", outline: "H.8", tag: "parent",
    question: "A parent says the plan works for you and not at home. How do you structure the next three parent sessions?",
    bullets: [
      { text: "BST: instructions, modeling, rehearsal, feedback, to a criterion, not to a time.", source: "Parsons, Rollyson & Reid (2012), Behavior Analysis in Practice" },
      { text: "Parent-implemented programs show gains when fidelity is measured at home.", source: "Bearss et al. (2015), JAMA" },
    ] },
  { id: "h-02", outline: "H.3", tag: "parent",
    question: "The caregiver wants the tantrums gone and is not interested in a replacement. What do you say, and what do you build anyway?",
    bullets: [
      { text: "FCT teaches a response that earns the same reinforcer.", source: "Carr & Durand (1985), JABA" },
      { text: "FCT works best with extinction for the problem behavior.", source: "Hagopian et al. (1998), JABA" },
    ] },
  { id: "h-03", outline: "H.5", tag: "vignette",
    question: "Aggression was at zero for three months, then they moved. It is back. What did the plan need that it did not have?",
    bullets: [
      { text: "Resurgence: an old response returns when the new one stops paying.", source: "Lieving & Lattal (2003), JEAB" },
      { text: "Plan maintenance and generalization across settings from the start.", source: "Stokes & Baer (1977), JABA" },
    ] },
  { id: "h-04", outline: "H.1", tag: "design",
    question: "Rewrite 'will improve social skills' as a goal a stranger could score. Go.",
    bullets: [
      { text: "A goal names the behavior, the condition and the criterion.", source: CHH + ", ch. Selecting and Defining Target Behaviors" },
      { text: "If two observers cannot agree it happened, it is not a goal yet.", source: CHH + ", ch. Measuring Behavior" },
    ] },
  { id: "h-05", outline: "H.2", tag: "design",
    question: "Design the assent check for a teaching program with a learner who does not use words. What counts as withdrawal?",
    bullets: [
      { text: "Assent is ongoing and observable, and the behaviors that withdraw it are named before teaching.", source: "BACB Ethics Code for Behavior Analysts (2020), 2.11" },
      { text: "Trauma-informed practice: safety, choice, and a plan for what protest changes.", source: "Rajaraman et al. (2022), JABA" },
    ] },
  { id: "h-06", outline: "H.7", tag: "vignette",
    question: "Six weeks, the line is flat, and the BT swears she runs it every session. What are the three things you check, in order?",
    bullets: [
      { text: "Integrity first, then the procedure, then the goal.", source: CHH + ", ch. Planning and Evaluating Applied Behavior Analysis Research" },
      { text: "Data-based decisions need enough data to decide.", source: CHH + ", ch. Constructing and Interpreting Graphic Displays of Behavioral Data" },
    ] },
  { id: "h-07", outline: "H.8", tag: "ethics",
    question: "The SLP wants him using sign; you have been building vocal mands. Two sessions from now you meet. What do you bring?",
    bullets: [
      { text: "Collaboration serves the client, and the data are the common language.", source: "Brodhead (2015), Behavior Analysis in Practice" },
      { text: "Pick the response form that works fastest for this learner now.", source: CHH + ", ch. Verbal Behavior" },
    ] },

  /* ── I. Supervision ────────────────────────────────────────────────── */
  { id: "i-01", outline: "I.6", tag: "supervise",
    question: "A BT's notes say 'had a great session' three days running. What feedback do you give, and what data do you show her?",
    bullets: [
      { text: "Feedback names the behavior and the condition, close in time.", source: "Reid, Parsons & Green (2012), The Supervisor's Guidebook" },
      { text: "A note that documents a mood documents nothing the plan can use.", source: "Baer, Wolf & Risley (1968), JABA" },
    ] },
  { id: "i-02", outline: "I.6", tag: "supervise",
    question: "Your best BT has started skipping the data sheet. Diagnose it like a behavior before you address it like a problem.",
    bullets: [
      { text: "Performance diagnostics ask about antecedents, equipment, knowledge and consequences.", source: "Austin (2000), in Handbook of Applied Behavior Analysis" },
      { text: "Skill deficit or performance deficit: the fix is different.", source: "Reid, Parsons & Green (2012), The Supervisor's Guidebook" },
    ] },
  { id: "i-03", outline: "I.2", tag: "supervise",
    question: "A new supervisee goes quiet every time you give feedback. What do you set up in your next meeting?",
    bullets: [
      { text: "Supervision starts with a contract, expectations, and how feedback will be given.", source: "Sellers, Valentino & LeBlanc (2016), Behavior Analysis in Practice" },
      { text: "Ask for feedback on your feedback.", source: "Sellers, Valentino & LeBlanc (2016), Behavior Analysis in Practice" },
    ] },
  { id: "i-04", outline: "I.5", tag: "supervise",
    question: "Teach a BT to run an MSWO in ten minutes of a supervision hour. What does each minute do?",
    bullets: [
      { text: "BST: instructions, modeling, rehearsal, feedback, to criterion.", source: "Parsons, Rollyson & Reid (2012), Behavior Analysis in Practice" },
      { text: "Check it in the session, not only in role play.", source: "Reid, Parsons & Green (2012), The Supervisor's Guidebook" },
    ] },
]);

/**
 * The next question. With a map (an outline id from map.js emptiestCell), the
 * bank's items filed under that cell are the pool. Without one: never a tag
 * answered in the last three drills, then never the last item.
 */
export function nextItem(recentIds, rng = Math.random, cell = null) {
  const recent = recentIds || [];
  const last = recent.slice(-1);
  if (cell) {
    const underCell = BANK.filter((b) => b.outline === cell && !last.includes(b.id));
    if (underCell.length) return underCell[Math.floor(rng() * underCell.length)];
  }
  const recentTags = new Set(recent.slice(-3).map((id) => (BANK.find((b) => b.id === id) || {}).tag));
  let pool = BANK.filter((b) => !recentTags.has(b.tag) && !last.includes(b.id));
  if (!pool.length) pool = BANK.filter((b) => !last.includes(b.id));
  if (!pool.length) pool = [...BANK];
  return pool[Math.floor(rng() * pool.length)];
}

/* Terms the Mac's own dictionary does not carry and a clinician types daily.
 * His lexicon grows on top of this. */
export const CLINICAL_SEED = Object.freeze([
  "prompting", "mand", "mands", "manding", "manded", "tact", "tacts", "tacting", "tacted", "intraverbal", "intraverbals",
  "echoic", "echoics", "elopement", "elopes", "eloped", "eloping", "dysregulation", "dysregulated", "self-injury",
  "reinforcer", "reinforcers", "reinforcement", "reinforced", "reinforcing", "punisher", "punishers", "redirection",
  "escalation", "vocalization", "vocalizations", "acquisition", "generalization", "maintenance", "extinction",
  "satiation", "deprivation", "dro", "dra", "dri", "drl", "drh", "ncr", "fct", "ioa", "abc", "fba", "fa", "bip", "sd", "sds",
  "antecedent", "antecedents", "consequence", "contingency", "contingencies", "contingent", "noncontingent", "operant",
  "operants", "respondent", "stereotypy", "perseveration", "perseverative", "echolalia", "scripting", "toileting",
  "noncompliance", "compliance", "preference", "pairing", "shaping", "chaining", "fading", "thinning", "topography",
  "latency", "bcba", "bcaba", "rbt", "bt", "bts", "caregiver", "caregivers", "learner", "learners", "iep", "aba",
  "assent", "premack", "interresponse", "irt", "mo", "mos", "eo", "eos", "ao", "mswo", "dtt", "net", "bst", "slp", "ot",
  "stim", "stims", "stimming", "overcorrection", "resurgence", "multielement", "discriminative", "nonexample", "nonexamples",
  "cusp", "cusps", "prosocial", "self-management", "fidelity", "tokens", "timeout", "time-out", "hi-p", "lo-p",
]);

/** Every word in the bank, lower-cased, plus the clinical seed. */
export function bankWords() {
  const words = new Set(CLINICAL_SEED);
  for (const b of BANK) {
    const text = [b.question, ...b.bullets.map((x) => x.text + " " + x.source)].join(" ");
    for (const w of text.match(/[A-Za-z][A-Za-z'-]*/g) || []) words.add(w.toLowerCase());
  }
  return words;
}
