/* ── Think or Say? - the staff guide ───────────────────────────────────
   ONE source, rendered TWICE.

   The guide ships as a screen inside the game (beside 📖 Learn) and as a
   standalone HTML file a service can put in an onboarding packet. Both are
   produced by buildBody() from the SECTIONS array below - not merely from the
   same data but through the same code path, so the two cannot drift. The
   standalone renderer builds a detached document, hands it to buildBody(), and
   serializes it; there is no second copy of the prose anywhere.

   Audience: behaviour technicians. The Skill Acquisition Plan is the programme
   and this app is the materials. Every entry below says what a setting DOES.
   None of them says what to prefer - that decision belongs to the BCBA, and
   where a plan is silent the guide says to ask, never to choose.
   ---------------------------------------------------------------------- */

(function () {
  'use strict';

  const TITLE = 'Think or Say? - Staff Guide';
  const SUBTITLE =
    'For behaviour technicians. Which switch in the app corresponds to which ' +
    'part of the Skill Acquisition Plan, and what each one does on screen.';
  const FILENAME = 'think-or-say-staff-guide.html';

  // ── The guide ────────────────────────────────────────────────────────
  // Block shapes: {t:'p'}, {t:'h'}, {t:'ul'|'ol'}, {t:'table'}, {t:'note'},
  // {t:'figure'}. List items are strings, or {term, text} for a definition.
  const SECTIONS = [

    {
      id: 'before',
      heading: 'Before you start',
      blocks: [
        { t: 'p', text:
          'The Skill Acquisition Plan is the programme. This app is the materials it runs on. ' +
          'Your BCBA has already decided what is being taught, how it is prompted, how errors are ' +
          'handled, and what counts as data. This guide tells you which switch corresponds to each ' +
          'of those decisions, and what that switch does on screen.' },
        { t: 'p', text:
          'It does not tell you which setting to choose. If your plan does not name a setting, ' +
          'leave it as you found it and ask your BCBA. That is not caution for its own sake: a ' +
          'prompting procedure or a probe condition changed part way through makes the data before ' +
          'and after the change describe two different programmes.' },
        { t: 'h', text: 'Words used in this guide' },
        { t: 'ul', items: [
          { term: 'Skill Acquisition Plan (SAP)', text:
            'the written programme for one skill: the target, the teaching procedure, the prompting ' +
            'procedure, the error correction, the reinforcement, and the criterion. Your BCBA writes it.' },
          { term: 'Trial', text: 'one card, from reading it aloud to pressing Next.' },
          { term: 'Prompt', text:
            'help delivered before or after the response. In this app a prompt is the correct tile ' +
            'being highlighted, whether you pressed Prompt or the app delivered it automatically.' },
          { term: 'Trained trial', text:
            'an ordinary teaching trial, with whatever supports the plan has switched on.' },
          { term: 'Probe (generalization) trial', text:
            'an item the learner has not been taught, run with the teaching supports withheld, so a ' +
            'correct answer is evidence about the repertoire rather than about the prompt.' },
          { term: 'Level', text:
            'which pool of cards is in play - 1 Clear, 2 Nuanced, 3 Explain. A card belongs to ' +
            'exactly one level.' },
          { term: 'Learner slot', text:
            'A, B or C. An unnamed store of settings, and nothing else. There is no name field in ' +
            'this app and there will not be one.' },
        ] },
        { t: 'note', text:
          'Nothing here leaves the device. There is no account, no upload and no sync. Session data ' +
          'sits in this browser until you print it or clear it.' },
      ],
    },

    {
      id: 'setup',
      heading: 'Setting up a session',
      blocks: [
        { t: 'ol', items: [
          'Choose the Learner slot your handover names. The slot loads the settings last saved in it.',
          'Set Level to the level the plan names.',
          'Set Category if the plan names one situation type; otherwise leave it on All categories.',
          'Set Order - Shuffle, or In order.',
          'Open ⚙ Settings and check every switch against the plan, using the table in the next section.',
          'Press ▶ Play. 📖 Learn shows the teaching screen first and then the same trials.',
        ] },
        { t: 'p', text:
          'Settings save as you change them, into the learner slot in force. Switching slots loads ' +
          'that slot’s settings and leaves the others alone.' },
        { t: 'figure', src: 'guide-panel.png', alt:
          'The Think or Say? settings bar and the ⚙ Settings panel, showing the Level, Learner, ' +
          'Category and Order selectors and the options panel.', caption:
          'The settings bar and the ⚙ Settings panel. The probe block at the foot of the panel is ' +
          'the one for the level in play.' },
      ],
    },

    {
      id: 'core',
      heading: 'If the SAP specifies…',
      blocks: [
        { t: 'p', text:
          'Find the row that names what your plan specifies. If your plan names something that is ' +
          'not in this table, ask your BCBA rather than choosing a nearby row.' },
        { t: 'table',
          columns: ['If the SAP specifies…', 'Set this', 'What it does on screen'],
          rows: [
            ['Least-to-most prompting',
             '⚙ Settings → Prompting method → Independent First (Least to Most)',
             'No prompt is delivered automatically. The Prompt button in the header stays live. A trial where you press it is recorded as prompted.'],
            ['Most-to-least prompting',
             '⚙ Settings → Prompting method → Immediate (Most to Least)',
             'The correct tile is highlighted as soon as the choices are shown, on every trial. The trial is recorded as prompted.'],
            ['Constant time delay',
             '⚙ Settings → Prompting method → Delayed (Fixed Time Delay), then set Prompt Delay to the number of seconds the plan names and leave it there',
             'The choices appear unprompted. If the delay elapses with no response, the correct tile is highlighted and the trial is recorded as prompted. If the learner answers first, no prompt fires.'],
            ['Progressive time delay',
             'Same as constant time delay, and change the Prompt Delay seconds at each step the plan schedules',
             'The app holds one delay at a time and does not step it for you. The plan says when the delay moves; the number in force is stored with the learner slot.'],
            ['Errorless teaching',
             '⚙ Settings → Errorless (on)',
             'An incorrect tile, when tapped, is disabled and dimmed and the correct tile is highlighted, so the trial cannot end on an error. The tap is still counted in the Errors column.'],
            ['Error correction with re-presentation',
             '⚙ Settings → Re-Present Errors (on)',
             'A card answered with an error or with a prompt comes back once, at the end of the deck, with a fresh surface - the same criterial item, a different person, place or thing - so the repeat cannot be passed on a remembered detail.'],
            ['No re-presentation',
             '⚙ Settings → Re-Present Errors (off)',
             'Each card runs once. Errors are recorded and the deck moves on.'],
            ['A suppressed error signal',
             '⚙ Settings → No Incorrect Animation (on)',
             'An incorrect tap produces no wiggle and no red flash. The error is still counted in the Errors column.'],
            ['A generalization phase',
             '⚙ Settings → Probes - Level N → Run probes (on), then set Probes per session, Placement and the tags the plan names',
             'Generated, untrained items are added to the deck for that level. On a probe trial the automatic prompt, errorless, the reason reveal, re-presentation and the stated rule are all withheld, and a banner on screen says so.'],
            ['No generalization phase',
             '⚙ Settings → Probes - Level N → Run probes (off). This is how it starts, at every level',
             'The deck is the teaching pool only, and every trial is recorded as a trained trial.'],
            ['Reinforcement withheld on probe trials',
             '⚙ Settings → Probes - Level N → Tokens on probe trials (off)',
             'A correct answer on a probe trial does not add a token. Teaching trials are unaffected.'],
            ['A reinforcement schedule (FR or VR)',
             '⭐ Token Board → Schedule and the number beside it, then Goal Tokens',
             'Tokens accumulate on correct responses at the ratio set. When the goal is reached a Finish & SR button appears.'],
            ['A fixed position array',
             '⚙ Settings → Counterbalance Tile Positions (off)',
             'THINK IT stays on the left and SAY IT on the right for every card.'],
            ['Counterbalanced positions',
             '⚙ Settings → Counterbalance Tile Positions (on). This is how it starts',
             'The two tiles swap sides between cards. The labels never move: THINK IT is always the brain tile and SAY IT always the mouth tile.'],
            ['Rationale targets at Level 3',
             'Level → 3 - Explain',
             'After the learner taps a tile the card asks “Tell me why.” You score what they said as Correct, Partly correct or Not yet, and may add a short note. The trial is not recorded until it is scored.'],
            ['Example rationales withheld',
             '⚙ Settings → Show Reason After (off)',
             'The “Show example reasons” button is not offered at Level 3, and the reason line is not shown at Levels 1 and 2. The “Tell me why.” ask and the scoring still happen.'],
          ] },
      ],
    },

    {
      id: 'prompting',
      heading: 'The three prompting hierarchies, step by step',
      blocks: [
        { t: 'p', text:
          'The Prompting method buttons set the Auto-Prompt and Prompt Delay switches beneath them. ' +
          'Changing those switches directly moves the method, and the method follows.' },

        { t: 'h', text: 'Independent first (least to most)' },
        { t: 'ol', items: [
          'Read the card aloud, then tap the panel to show the two tiles.',
          'Wait. No prompt is delivered.',
          'If the wait time in the plan passes with no response, press Prompt in the header. The correct tile is highlighted.',
          'The learner answers. The trial is recorded as prompted.',
        ] },
        { t: 'p', text:
          'The app does not time your wait in this procedure. Prompt Delay applies only when ' +
          'Auto-Prompt is on, so with least to most it is inert.' },

        { t: 'h', text: 'Immediate (most to least)' },
        { t: 'ol', items: [
          'Read the card aloud, then tap the panel to show the two tiles.',
          'The correct tile is highlighted straight away, on every trial.',
          'The learner answers with the prompt in place. The trial is recorded as prompted.',
          'When the plan says to fade, change the Prompting method to what the plan names next.',
        ] },
        { t: 'p', text:
          'The app does not fade for you. It delivers the prompt on every trial until the method ' +
          'is changed.' },

        { t: 'h', text: 'Delayed (constant and progressive time delay)' },
        { t: 'ol', items: [
          'Set Prompt Delay to the seconds the plan names.',
          'Read the card aloud, then tap the panel. The delay starts when the tiles appear.',
          'If the learner answers before the delay elapses, no prompt fires and the trial is recorded as independent.',
          'If the delay elapses, the correct tile is highlighted and the trial is recorded as prompted.',
        ] },
        { t: 'p', text:
          'Constant time delay holds one value throughout. Progressive time delay increases it on ' +
          'the schedule the plan sets - the app holds whatever number is in the box, and you change ' +
          'the number when the plan says to.' },
        { t: 'p', text:
          'Whichever procedure is running, the printed report shows only whether a prompt was ' +
          'delivered. The stored trial also carries which procedure delivered it - gesture for ' +
          'least to most, model for immediate, delay for a time delay - and your BCBA can read it ' +
          'from the saved data.' },
      ],
    },

    {
      id: 'errors',
      heading: 'Error correction, and what each option records',
      blocks: [
        { t: 'table',
          columns: ['Option', 'On screen', 'In the report'],
          rows: [
            ['Errorless (on)',
             'The incorrect tile is disabled and dimmed on the tap, and the correct tile is highlighted.',
             'The tap is counted in Errors. Because the highlight is a prompt, the Prompted column reads Yes and Outcome reads “Prompted”.'],
            ['Errorless (off)',
             'Both tiles stay live until the correct one is tapped.',
             'Each incorrect tap is counted in Errors. Outcome reads “Error then correct” unless a prompt was also delivered.'],
            ['No Incorrect Animation (on)',
             'An incorrect tap produces no wiggle and no red flash.',
             'No change. The error is recorded exactly as it is with the animation on.'],
            ['Re-Present Errors (on)',
             'A card answered with an error or a prompt returns once at the end of the deck, with a different person, place or thing and the same underlying item.',
             'Two rows: the original trial and the re-presentation, each recorded on its own.'],
            ['Re-Present Errors (off)',
             'The deck moves on.',
             'One row.'],
          ] },
        { t: 'p', text:
          'A card is re-presented once per session at most, and never on a probe trial. If the ' +
          'plan calls for a different error-correction procedure - a re-do straight away, a ' +
          'transfer trial, a specific number of repetitions - ask your BCBA how they want it run ' +
          'with these materials.' },
      ],
    },

    {
      id: 'probes',
      heading: 'Running probes when the plan calls for them',
      blocks: [
        { t: 'p', text:
          'Probes are off at every level until a plan calls for a generalization phase, and they ' +
          'are configured separately for each level. A learner probing at Level 1 and not probing ' +
          'at Level 3 is an ordinary state of affairs.' },
        { t: 'ol', items: [
          'Set Level to the level the phase belongs to. The probe block shown is the one for that level.',
          'Switch on Run probes.',
          'Set Probes per session to the number the plan names.',
          'Set Placement - Before the teaching trials, Interleaved among them, or After them.',
          'Tick the tags the plan names.',
        ] },
        { t: 'h', text: 'What the tags mean' },
        { t: 'ul', items: [
          { term: 'near', text:
            'every varied detail in the item - the person, the place, the thing, the sentence form - ' +
            'is one this level’s teaching pool already pairs with this underlying item.' },
          { term: 'far', text:
            'at least one of those details is one the teaching pool never pairs with it.' },
          { term: 'deictic', text:
            'the item asks the learner to speak from one person’s side to another’s - an ' +
            'I-and-you statement. Every Level 3 item carries this tag.' },
        ] },
        { t: 'p', text:
          'The tags combine: an item can be far and deictic at once. Ticking two tags puts items ' +
          'carrying either in play, and the report groups results by the exact combination an item ' +
          'carried, never by a single tag.' },
        { t: 'h', text: 'During a probe trial' },
        { t: 'ul', items: [
          'A banner reads “Probe - supports off”, followed by the tags the item carries.',
          'The automatic prompt, errorless, the reason reveal and re-presentation are all withheld.',
          'At Level 1, the stated rule comes off the screen too. A probe run with the rule still up would measure reading it, not holding it.',
          'The Prompt button stays live. Prompting a probe is a clinical call you are entitled to make.',
        ] },
        { t: 'p', text:
          'If you press Prompt on a probe, the trial is recorded as a trained trial with the note ' +
          '“prompt delivered”, and it is not a generalization datum. That is not an error on your ' +
          'part; it is the record saying what happened.' },
        { t: 'p', text:
          'An item yields its generalization datum once. If the same item comes round again in the ' +
          'same session it is recorded as a trained trial with the note “re-exposure”. Nothing is ' +
          'discarded and nothing goes uncounted.' },
        { t: 'p', text:
          'There is no counter of unused probes and no probe reset. Probe items are generated from ' +
          'the plan’s tags each session, so a fresh one is always available and there is nothing ' +
          'to run out of.' },
      ],
    },

    {
      id: 'rationale',
      heading: 'Recording a Level 3 rationale score',
      blocks: [
        { t: 'p', text:
          'At Level 3 the tile is half the trial. The response the programme targets is the spoken ' +
          'reason, and the trial cannot advance until you have scored it.' },
        { t: 'ol', items: [
          'The learner taps THINK IT or SAY IT.',
          'The card asks “Tell me why.”',
          'The learner answers out loud.',
          'You score what they actually said: Correct, Partly correct, or Not yet.',
          'Add a short note in your own words if it is worth recording. It is optional, and it must not contain a name.',
          'Press Next.',
        ] },
        { t: 'p', text:
          'The “Show example reasons” button is there for you, not for the learner, and the ' +
          'examples are not a scoring key. Do not read them aloud before the learner has spoken. A ' +
          'correct reason that is not on the list scores fully Correct.' },
        { t: 'h', text: 'What the three points mean' },
        { t: 'ul', items: [
          { term: 'Correct', text:
            'the reason names the thing that decides this card - who would hear it, whether it can ' +
            'be changed, whether it is private, how the other person would feel.' },
          { term: 'Partly correct', text:
            'the reason is about the right situation but does not name what decides it, or the ' +
            'learner reached it only after you asked again.' },
          { term: 'Not yet', text:
            'no reason, an unrelated reason, or the tile choice said back to you as though it were ' +
            'a reason.' },
        ] },
        { t: 'p', text:
          'If your plan defines these three points differently, your plan is what you score against. ' +
          'Ask your BCBA.' },
        { t: 'h', text: 'Worked examples' },
        { t: 'p', text:
          'Card L3-07 - you and your close friend are in the middle of a crowded assembly, the label on ' +
          'their sweater is sticking up at the back, and the thought is “Your label is sticking ' +
          'up!”. The answer is THINK IT, and what decides it is who else can hear.' },
        { t: 'table',
          columns: ['What the learner said', 'Score', 'Why'],
          rows: [
            ['“Everybody in the assembly would hear and they would go red.”', 'Correct',
             'Names who else can hear, which is what decides this card.'],
            ['“Not here - there are too many people.”', 'Correct',
             'Names the same thing in fewer words. It is not on the example list, and that does not matter.'],
            ['“Because it would be rude.”', 'Partly correct',
             'About the right situation, but it does not name what decides it - the same words are a SAY IT when the two of them are on their own.'],
            ['“Because you should not say it.”', 'Not yet',
             'The tile choice said back, not a reason.'],
            ['(no answer)', 'Not yet',
             'Score what was said. Nothing was said.'],
          ] },
      ],
    },

    {
      id: 'report',
      heading: 'Handing the report to the BCBA',
      blocks: [
        { t: 'p', text:
          'The Print button produces the session report in a new tab. Give it to the BCBA as it ' +
          'comes out.' },
        { t: 'figure', src: 'guide-report.png', alt:
          'The printed Think or Say? session report: a table of trials with Level, Category, ' +
          'Scenario, Answer, Errors, Prompted, Time, Outcome, Trial, Tags and Reason columns, a ' +
          'summary line, and a trained-versus-generalization table.', caption:
          'The printed report. The trained-and-generalization table appears only when the session ' +
          'contained probe trials.' },
        { t: 'ul', items: [
          { term: 'Outcome', text: '“Independent” means no prompt and no error, “Prompted” means a prompt was delivered, “Error then correct” means an incorrect tap with no prompt.' },
          { term: 'Trial', text: 'trained, or generalization.' },
          { term: 'Tags', text: 'the exact tag combination a probe item carried. Blank on a teaching trial.' },
          { term: 'Reason (L3)', text: 'the rationale score, with your note beside it. Blank at Levels 1 and 2, where no reason is asked for.' },
        ] },
        { t: 'p', text:
          'Below the table is a summary line, and - when the session contained probes - a table ' +
          'splitting trained from generalization trials and breaking generalization out by the ' +
          'exact tag combination. Supported probes and re-exposures appear inside the trained ' +
          'bucket, with the reason they are there.' },
        { t: 'p', text:
          'Describe the data; do not interpret it. “Eight of twelve independent, three prompted, ' +
          'one error, and both far-plus-deictic probes were prompted” is a description, and it is ' +
          'what the BCBA needs from you. Whether the learner has generalized is a conclusion, and ' +
          'drawing it is the BCBA’s job.' },
        { t: 'p', text:
          'Clear data wipes the stored session from this device. Do it when your service’s ' +
          'records procedure says to, not to tidy up: once it is gone there is no other copy.' },
      ],
    },

    {
      id: 'appendix',
      heading: 'Every switch, one line each',
      blocks: [
        { t: 'table',
          columns: ['Switch', 'What it does'],
          rows: [
            ['Level', 'Chooses the card pool: 1 Clear, 2 Nuanced, 3 Explain.'],
            ['Learner', 'Loads the settings saved in slot A, B or C. Holds no name.'],
            ['Category', 'Limits the deck to one situation type, or uses all of them.'],
            ['Order', 'Shuffles the deck, or presents it in the authored order.'],
            ['Re-Present Errors', 'Brings a missed card back once at the end of the deck with a fresh surface.'],
            ['Errorless', 'Disables the incorrect tile on the tap and highlights the correct one.'],
            ['No Incorrect Animation', 'Removes the wiggle and red flash from an incorrect tap.'],
            ['Prompting method', 'Sets Auto-Prompt and Prompt Delay together to one of the three procedures.'],
            ['Auto-Prompt', 'Delivers the prompt without you pressing anything.'],
            ['Prompt Delay', 'Holds the automatic prompt back for the number of seconds beside it.'],
            ['Prompt style', 'Draws the prompt as a sparkle or as an outline.'],
            ['Show Reason After', 'Shows the card’s reason line after the answer at Levels 1 and 2, and offers the example reasons at Level 3.'],
            ['Show the Rule', 'Keeps the level’s stated rule on screen through the trial. Level 1 states its rule; Levels 2 and 3 state none, so the switch does nothing there. Turn it off to fade the support once the rule is held.'],
            ['Counterbalance Tile Positions', 'Swaps which side each tile sits on between cards. The labels do not move.'],
            ['Run probes', 'Adds generated, untrained probe items to this level’s deck.'],
            ['Probes per session', 'How many probe trials the deck contains.'],
            ['Placement', 'Puts the probes before, among, or after the teaching trials.'],
            ['Tags in play', 'Which kinds of probe item are in play: near, far, deictic, or a combination.'],
            ['Tokens on probe trials', 'Whether a correct probe answer adds a token.'],
            ['Token Board', 'Shows the token tracker and its settings.'],
            ['Schedule', 'Fixed Ratio or Variable Ratio, and the number of correct responses per token.'],
            ['Starting Tokens', 'How many tokens the board opens with.'],
            ['Goal Tokens', 'How many tokens end the run. Finish & SR appears when the goal is reached.'],
            ['Token Emoji', 'Which symbol the tokens are drawn as.'],
            ['Prompt (header button)', 'Highlights the correct tile now. Records the trial as prompted.'],
            ['Pause / Reset (timer)', 'Stops and restarts the per-trial timer shown in the header.'],
            ['Print', 'Opens the session report in a new tab.'],
            ['Clear data', 'Deletes the stored session data from this device.'],
          ] },
      ],
    },

    {
      id: 'not',
      heading: 'What this is not',
      blocks: [
        { t: 'ul', items: [
          { term: 'Not an assessment', text:
            'it scores each answer against the card’s key. Nothing it prints is a score on a ' +
            'test, and no number in it describes a skill level.' },
          { term: 'Not a substitute for the Skill Acquisition Plan', text:
            'if the app and the plan disagree, the plan is right and the settings are wrong.' },
          { term: 'Not a decision aid', text:
            'it will not tell you whether to prompt, whether to move a level, or whether a learner ' +
            'has met criterion. Those are the BCBA’s decisions, written in the plan.' },
          { term: 'Not connected to anything', text:
            'no account, no upload, no sync, no names. Everything stays on this device until you ' +
            'print it or clear it.' },
          { term: 'Not the teaching itself', text:
            'the cards are materials. You read them, the learner responds, and you record what ' +
            'happened.' },
        ] },
      ],
    },
  ];

  // ── Rendering ────────────────────────────────────────────────────────
  // Built as DOM nodes with textContent, never as a markup string: the prose
  // is authored content and putting it in as text means there is no escaping
  // step a later edit can be written to slip past.

  function elem(doc, tag, className, text) {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function listItem(doc, item) {
    const li = doc.createElement('li');
    if (typeof item === 'string') { li.textContent = item; return li; }
    li.appendChild(elem(doc, 'strong', 'guide-term', item.term));
    li.appendChild(doc.createTextNode(' - ' + item.text));
    return li;
  }

  function renderTable(doc, block) {
    const table = elem(doc, 'table', 'guide-table');
    const thead = doc.createElement('thead');
    const hrow = doc.createElement('tr');
    for (const col of block.columns) hrow.appendChild(elem(doc, 'th', null, col));
    thead.appendChild(hrow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const row of block.rows) {
      const tr = doc.createElement('tr');
      row.forEach((cell, i) => tr.appendChild(elem(doc, i === 0 ? 'th' : 'td', i === 0 ? 'guide-rowhead' : null, cell)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function renderFigure(doc, block) {
    const fig = elem(doc, 'figure', 'guide-figure');
    const img = doc.createElement('img');
    img.setAttribute('src', block.src);
    img.setAttribute('alt', block.alt);
    img.setAttribute('loading', 'lazy');
    fig.appendChild(img);
    fig.appendChild(elem(doc, 'figcaption', null, block.caption));
    return fig;
  }

  function renderBlock(doc, block) {
    switch (block.t) {
      case 'p':      return elem(doc, 'p', null, block.text);
      case 'h':      return elem(doc, 'h3', null, block.text);
      case 'note':   return elem(doc, 'p', 'guide-note', block.text);
      case 'figure': return renderFigure(doc, block);
      case 'table':  return renderTable(doc, block);
      case 'ul':
      case 'ol': {
        const list = elem(doc, block.t, 'guide-list');
        for (const item of block.items) list.appendChild(listItem(doc, item));
        return list;
      }
      default:
        throw new Error('staff-guide: unknown block type "' + block.t + '"');
    }
  }

  /**
   * The whole guide, as a fragment, for whichever document is passed in.
   *
   * Both renderings go through here. The in-game screen passes the live
   * document; the standalone file passes a detached one. There is no second
   * traversal of SECTIONS anywhere, which is what makes "one source" a
   * property of the code rather than a promise in a comment.
   */
  function buildBody(doc) {
    const frag = doc.createDocumentFragment();
    frag.appendChild(elem(doc, 'h1', 'guide-title', TITLE));
    frag.appendChild(elem(doc, 'p', 'guide-subtitle', SUBTITLE));
    for (const section of SECTIONS) {
      const sec = elem(doc, 'section', 'guide-section');
      sec.id = 'guide-' + section.id;
      sec.appendChild(elem(doc, 'h2', null, section.heading));
      for (const block of section.blocks) sec.appendChild(renderBlock(doc, block));
      frag.appendChild(sec);
    }
    return frag;
  }

  function renderInto(node) {
    node.replaceChildren(buildBody(node.ownerDocument));
  }

  // ── The standalone file ──────────────────────────────────────────────

  const STANDALONE_CSS = [
    ':root{color-scheme:light}',
    'body{margin:0;background:#f6f4ef;color:#20242c;',
    'font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    'main{max-width:52rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}',
    '.guide-title{font-size:1.9rem;line-height:1.2;margin:0 0 .35rem}',
    '.guide-subtitle{margin:0 0 2.25rem;color:#55606f;font-size:1.05rem}',
    '.guide-section{margin:0 0 2.5rem}',
    '.guide-section h2{font-size:1.3rem;margin:0 0 .75rem;padding-bottom:.35rem;',
    'border-bottom:2px solid #d8d2c4}',
    '.guide-section h3{font-size:1.05rem;margin:1.5rem 0 .4rem}',
    '.guide-list{margin:.5rem 0 1rem;padding-left:1.35rem;list-style:disc}',
    'ol.guide-list{list-style:decimal}',
    '.guide-list li{margin:.35rem 0}',
    '.guide-term{font-weight:600}',
    '.guide-note{background:#fff8e2;border-left:4px solid #e0b64a;padding:.7rem .9rem;margin:1rem 0}',
    '.guide-table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.92rem}',
    '.guide-table th,.guide-table td{border:1px solid #d8d2c4;padding:.5rem .6rem;',
    'text-align:left;vertical-align:top}',
    '.guide-table thead th{background:#ebe6da}',
    '.guide-rowhead{background:#f3f0e8;font-weight:600;width:22%}',
    '.guide-figure{margin:1.25rem 0}',
    '.guide-figure img{max-width:100%;height:auto;border:1px solid #d8d2c4;border-radius:6px}',
    '.guide-figure figcaption{margin-top:.4rem;color:#55606f;font-size:.88rem}',
    '.guide-figure-missing{margin-top:.4rem;color:#8a5a12;font-size:.88rem}',
    '@media print{body{background:#fff}main{padding:0}.guide-section{page-break-inside:auto}}',
  ].join('');

  /**
   * Turn every figure into a data URI so the downloaded file is self-contained.
   *
   * An onboarding packet is a file on someone's desktop, not a page on this
   * site, so a relative <img src> in it would resolve to nothing. A fetch that
   * fails leaves a VISIBLE line naming the missing file rather than an empty
   * box - a screenshot that silently disappears from a printed guide is worse
   * than one that says it is absent.
   */
  async function inlineFigures(root, baseHref) {
    const imgs = Array.from(root.querySelectorAll('img'));
    for (const img of imgs) {
      const src = img.getAttribute('src');
      try {
        const res = await fetch(new URL(src, baseHref).href);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        img.setAttribute('src', await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }));
      } catch (err) {
        const note = root.ownerDocument.createElement('p');
        note.className = 'guide-figure-missing';
        note.textContent = 'Screenshot not embedded (' + src + '). See the Guide screen in the app.';
        img.replaceWith(note);
      }
    }
  }

  /**
   * The guide as a complete, self-contained HTML document.
   *
   * Built by handing a detached document to the same buildBody() the in-game
   * screen uses, so the file and the screen carry identical prose by
   * construction.
   */
  async function renderStandalone(baseHref) {
    const doc = document.implementation.createHTMLDocument(TITLE);
    doc.documentElement.setAttribute('lang', 'en');
    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    doc.head.appendChild(meta);
    const viewport = doc.createElement('meta');
    viewport.setAttribute('name', 'viewport');
    viewport.setAttribute('content', 'width=device-width, initial-scale=1');
    doc.head.appendChild(viewport);
    const style = doc.createElement('style');
    style.textContent = STANDALONE_CSS;
    doc.head.appendChild(style);

    const main = doc.createElement('main');
    main.id = 'guide-body';
    main.appendChild(buildBody(doc));
    doc.body.appendChild(main);

    await inlineFigures(main, baseHref || (typeof location !== 'undefined' ? location.href : ''));
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML + '\n';
  }

  window.ThinkOrSayGuide = Object.freeze({
    TITLE,
    SUBTITLE,
    FILENAME,
    SECTIONS,
    buildBody,
    renderInto,
    renderStandalone,
  });
})();
