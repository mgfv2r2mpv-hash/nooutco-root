/**
 * phi-census-corpus - synthetic BT and BCBA intakes with hand-authored ground
 * truth, for scripts/phi-census.mjs.
 *
 * EVERY WORD HERE IS INVENTED. No clinical text from a real session, no real
 * person, no real address, phone, email or record number. The names are common
 * US given names chosen to sit on top of the dictionary the scrubber ships, and
 * the identifiers are shaped to match the patterns rather than to be valid.
 *
 * THE TRUTH IS AUTHORED FROM THE CLINICAL READING, NOT FROM THE CODE. Each doc
 * says which spans a clinician would call a person and which a clinician would
 * not, and the census reports where the passes disagree. Writing the truth by
 * running the detector and copying its answer would make the whole measurement
 * a mirror, so a doc where the shipped code is wrong is written wrong on
 * purpose and shows up as a miss.
 *
 * FIELDS
 *   id, author, title  identification only
 *   text               the intake as a technician would type it
 *   names              every string detectNames SHOULD return, exactly. A two
 *                      word name lists the phrase and both words, because
 *                      detectNames deliberately emits all three so a later
 *                      lowercase mention is still covered
 *   roles              what inferRoles SHOULD return: lowercased name -> role,
 *                      and ONLY for a name carrying a role cue. A bare name has
 *                      no entry, which is the correct answer rather than a gap
 *   identifiers        [{text, type}] every identifier span and its class
 *   traps              lowercased word -> miss class, for words planted to be
 *                      mistaken for a person. Structural classes (a cue in
 *                      front, an overlap with an identifier) are computed from
 *                      the text instead and win over this map
 *   personGroups       the strings that name ONE human, so the census can count
 *                      a human who was split across two role tokens
 *   ambiguous          words that are a person in one sentence of this doc and
 *                      an ordinary word in another. Neither a hit nor a miss
 */

export const CORPUS = [
  {
    id: 'bt-01',
    author: 'bt',
    title: 'Colour matching block',
    text:
      'Client Jacob sorted Blue, Red and Yellow cards across fourteen trials.\n' +
      'BT held the field at three cards, and Jacob matched the Yellow card first on eight of those trials.\n' +
      'Errors clustered on Red, so BT dropped to a two card field and ran five more trials.\n' +
      'Jacob handed the Blue card back without a prompt at the end of the block.',
    names: ['Jacob'],
    roles: { jacob: 'Client' },
    identifiers: [],
    traps: { blue: 'colour-or-material-word', red: 'colour-or-material-word', yellow: 'colour-or-material-word' },
    personGroups: [['Jacob']],
  },

  {
    id: 'bt-02',
    author: 'bt',
    title: 'Caregiver report at pickup',
    text:
      'Mom reports the morning went badly, and dad described the evening as rough.\n' +
      'Caregiver Sarah signed the consent page at pickup, and Michael stayed in the car.\n' +
      'Client labeled three of the five photos on the first presentation.\n' +
      'Technician noticed a longer latency after the second denial and wrote it on the sheet.',
    names: ['Sarah', 'Michael'],
    roles: { sarah: 'Caregiver' },
    identifiers: [],
    traps: {},
    personGroups: [['Sarah'], ['Michael']],
  },

  {
    id: 'bt-03',
    author: 'bt',
    title: 'Data sheet and prompt level',
    text:
      'BT will mark the data sheet at the end of each block.\n' +
      'The team allowed a grace period of five seconds before the next prompt.\n' +
      'Prompting stayed at the max level for the first four trials and faded to a gesture by the eighth.\n' +
      'Joy was reported by the caregiver at pickup, and the technician logged it as a note rather than a target.',
    names: [],
    roles: {},
    identifiers: [],
    traps: {
      mark: 'dictionary-collision-with-clinical-vocabulary',
      grace: 'dictionary-collision-with-clinical-vocabulary',
      max: 'dictionary-collision-with-clinical-vocabulary',
      joy: 'dictionary-collision-with-clinical-vocabulary',
    },
    personGroups: [],
  },

  {
    id: 'bt-04',
    author: 'bt',
    title: 'Contact details typed into the note',
    text:
      'Caregiver left a message from 555-867-5309 and asked for a call back after four.\n' +
      'The billing packet was mailed to 1420 Maple Street on the same afternoon.\n' +
      'An intake form came in from caregiver.home@example.com with the wrong date of birth on it.\n' +
      'Client Jacob was not present for that call.',
    names: ['Jacob'],
    roles: { jacob: 'Client' },
    identifiers: [
      { text: '555-867-5309', type: 'PHONE' },
      { text: '1420 Maple Street', type: 'ADDRESS' },
      { text: 'caregiver.home@example.com', type: 'EMAIL' },
    ],
    traps: {},
    personGroups: [['Jacob']],
  },

  {
    id: 'bt-05',
    author: 'bt',
    title: 'Three learners, typed in lower case',
    text:
      'kaelen finished the first block without a break, and tavion joined for the last ten minutes.\n' +
      'jacob sat between them and handed over the timer when asked.\n' +
      'Neither peer needed a prompt to take a turn.',
    names: ['kaelen', 'tavion', 'jacob'],
    roles: {},
    identifiers: [],
    traps: {},
    personGroups: [['kaelen'], ['tavion'], ['jacob']],
  },

  {
    id: 'bt-06',
    author: 'bt',
    title: 'Materials and rooms',
    text:
      'Sorting ran on the jade mat with the amber container and a crystal bead jar.\n' +
      'The learner carried the ruby counter to the shelf without a prompt.\n' +
      'Generalisation is scheduled for the Sierra room next week, and the Georgia site will run the same targets.\n' +
      'Nothing in the block needed a physical prompt.',
    names: [],
    roles: {},
    identifiers: [],
    traps: {
      jade: 'colour-or-material-word',
      amber: 'colour-or-material-word',
      crystal: 'colour-or-material-word',
      ruby: 'colour-or-material-word',
      sierra: 'place-name-overlapping-span',
      georgia: 'place-name-overlapping-span',
    },
    personGroups: [],
  },

  {
    id: 'bcba-01',
    author: 'bcba',
    title: 'Supervision visit',
    text:
      'BCBA observed twenty minutes of the session and gave corrective feedback on prompt timing.\n' +
      'The technician ran mixed trials on Tolerating Delays and Requesting Breaks, and Receptive Identification was held for the next visit.\n' +
      'Fidelity was scored at eleven of twelve steps, with the miss on the reinforcement delay.\n' +
      'BCBA modelled one trial, then handed the materials back and watched two more.',
    names: [],
    roles: {},
    identifiers: [],
    traps: {
      tolerating: 'program-name-capitalised',
      delays: 'program-name-capitalised',
      requesting: 'program-name-capitalised',
      breaks: 'program-name-capitalised',
      receptive: 'program-name-capitalised',
      identification: 'program-name-capitalised',
      'tolerating delays': 'program-name-capitalised',
      'requesting breaks': 'program-name-capitalised',
      'receptive identification': 'program-name-capitalised',
    },
    personGroups: [],
  },

  {
    id: 'bcba-02',
    author: 'bcba',
    title: 'Reauthorisation paperwork',
    text:
      'The reauthorisation packet is due March 3, 2026 and the prior approval ran out on 2/28/2026.\n' +
      'MRN 4471290 and member ID A8841207 both belong on the cover sheet.\n' +
      'Insurance authorisation for the assessment block has not come back yet.\n' +
      'The family mailed the packet from GA 30303 last week.',
    names: [],
    roles: {},
    identifiers: [
      { text: 'March 3, 2026', type: 'DATE' },
      { text: '2/28/2026', type: 'DATE' },
      { text: 'MRN 4471290', type: 'ID' },
      { text: 'member ID A8841207', type: 'ID' },
      { text: 'GA 30303', type: 'ZIP' },
    ],
    traps: {},
    personGroups: [],
  },

  {
    id: 'bcba-03',
    author: 'bcba',
    title: 'Intake interview across two visits',
    text:
      'Caregiver Barbara Jean completed the intake interview over two visits.\n' +
      'Barb asked whether the assessment could be split across a morning and an afternoon.\n' +
      'The assessor scored the interview the same evening and flagged three items for follow up.\n' +
      'Barbara signed the release before leaving.',
    names: ['Barbara Jean', 'Barbara', 'Jean', 'Barb'],
    roles: { barbara: 'Caregiver' },
    identifiers: [],
    traps: {},
    personGroups: [['Barbara Jean', 'Barbara', 'Jean', 'Barb']],
  },

  {
    id: 'bcba-04',
    author: 'bcba',
    title: 'Everyone in the room',
    text:
      'Client Jacob, peer Devon and sibling Ruby were all in the room for the last activity.\n' +
      'Mom Sarah stayed for the debrief and asked about the sleep data.\n' +
      'Teacher Carter sent a note home about the same target.\n' +
      'The technician recorded the whole block on the paper sheet.',
    names: ['Jacob', 'Devon', 'Ruby', 'Sarah', 'Carter'],
    roles: { jacob: 'Client', devon: 'Peer', ruby: 'Sibling', sarah: 'Caregiver', carter: 'Teacher' },
    identifiers: [],
    traps: {},
    personGroups: [['Jacob'], ['Devon'], ['Ruby'], ['Sarah'], ['Carter']],
  },

  {
    id: 'bcba-05',
    author: 'bcba',
    title: 'Plan prose with nobody in it',
    text:
      'Reinforcement was delivered on a variable ratio and the schedule thinned across the block.\n' +
      'Data show a rising trend on the tact targets and a flat trend on listener responding.\n' +
      'The plan calls for a fade of the gestural prompt once independence holds for three sessions.\n' +
      'Nothing about the setting changed this week.',
    names: [],
    roles: {},
    identifiers: [],
    traps: {},
    personGroups: [],
  },

  {
    id: 'bcba-06',
    author: 'bcba',
    title: 'One word, two meanings',
    text:
      'The team keeps a Rose chart on the wall for the group reinforcement system.\n' +
      'Rose petals are handed out at the end of each block for independent responses.\n' +
      'Mom Rose asked for a copy of the chart at pickup.',
    names: ['Rose'],
    roles: { rose: 'Caregiver' },
    identifiers: [],
    traps: {},
    personGroups: [['Rose']],
    ambiguous: ['rose'],
    note: 'The reinforcement system and the caregiver share a word. Detection is right either way, so this doc scores as a hit. It is here for the adjacency rule in slice 3: a screened word carrying a role cue has to be flagged again.',
  },
];

export default CORPUS;
