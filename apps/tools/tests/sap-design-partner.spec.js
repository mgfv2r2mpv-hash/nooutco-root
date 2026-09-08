import { test, expect } from '@playwright/test';

/* THE SAP DRAFTER STOPPED DELETING THE PLAN, AND STARTED DESIGNING IT.
 *
 * THE BUG, in his words: "the expert is deleting most of the company-required
 * sections as soon as any clarification or revision is added", and then, when I
 * had it wrong: "It shrinks, not deletes", and "it deletes as red strikethrough
 * changes through entire sections, presented for review."
 *
 * That last sentence is the whole diagnosis. Nothing was erasing anything. A
 * revision asked the model to return the COMPLETE updated JSON object with
 * every unaffected section copied verbatim - roughly 2,500 tokens of prose to
 * change one sentence. Models do not re-type 2,500 tokens, they paraphrase.
 * Every paraphrase was an honest diff against the previous text, so the
 * clinician was shown whole sections struck through in red for a change they
 * never asked for, on every turn. The diff was telling the truth.
 *
 * THE FIX is the edits contract: a revision names the sections it changes and
 * carries their complete new text, and mergeRevision lays those over the note
 * as it stands. A section the model does not name is carried across
 * byte-identical and produces no diff at all, because it was never re-typed.
 *
 * THE OTHER HALF is his: "It should be very generous in helping for the SAP
 * tool as this is a *design* area... It was boring before." The tool used to
 * inherit a rule forbidding it to supply any fact the clinician had not
 * reported, plus its own rule against offering a clinical opinion. It was
 * structurally unable to design anything. It designs now, marks every block it
 * designed, and names the one lever that would change each - and it reads the
 * clinician's own input back for places where it disagrees with itself.
 */

const SECTIONS = [
  'refinedGoal', 'purpose', 'teachingStrategy', 'lessonSetUp', 'sd',
  'correctResponse', 'incorrectResponse', 'masteryCriteria', 'promptHierarchy',
  'generalizationCriteria', 'maintenanceCriteria',
  'errorCorrectionInitial', 'errorCorrectionMaintenance',
];

function tokenFor(tools = ['sap']) {
  const payload = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}

function reply(obj) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(obj) }],
      usage: { output_tokens: 100 },
      stop_reason: 'end_turn',
    }),
  };
}

// A complete plan, every section distinguishable from every other so a diff
// cannot pass by accident.
function plan(overrides = {}) {
  const out = {};
  for (const id of SECTIONS) out[id] = `The ${id} block, written out in full and left alone.`;
  return {
    ...out,
    reentryRule: 'After 3 consecutive weekly probes below 80%, contact the BCBA.',
    hints: [],
    design: [],
    conflicts: [],
    ...overrides,
  };
}

async function sapPage(page) {
  await page.goto('/notes/bcba/index.html?tool=sap');
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
}

const sapTool = (page, fn, arg) =>
  page.evaluate(([f, a]) =>
    // eslint-disable-next-line no-new-func
    new Function('sap', 'arg', `return (${f})(sap, arg);`)(window.NOTE_TOOLS.find((t) => t.id === 'sap'), a),
  [fn.toString(), arg]);

async function acceptScrubGate(page) {
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await expect(ack).toBeEnabled();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1500 }).catch(() => false)) await review.click();
}

// Triage, then the first draft, then whatever the caller wants for every turn
// after that.
async function draft(page, first, onRevision) {
  let calls = 0;
  await page.route('**/api/llm-call**', async (route) => {
    calls++;
    if (calls === 1) return route.fulfill(reply({ sufficient: true, questions: [] }));
    if (calls === 2) return route.fulfill(reply(first));
    return onRevision(route, JSON.parse(route.request().postData() || '{}'));
  });
  await sapPage(page);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await sapPage(page);
  await page.getByRole('textbox', { name: /Treatment Goal/i })
    .fill('The learner will label 10 common objects in 80% of opportunities across 3 sessions.');
  await page.getByRole('button', { name: /Generate SAP/i }).click();
  await acceptScrubGate(page);
  await expect(page.getByText('Generated SAP Draft')).toBeVisible({ timeout: 30000 });
}

async function revise(page, heading, instruction) {
  await page.getByText(heading, { exact: true }).click();
  await expect(page.locator('.revision-panel')).toBeVisible();
  await page.locator('.revision-input').fill(instruction);
  await page.locator('.revision-send').click();
}

/* ── The bug itself ──────────────────────────────────────────────────────── */

test.describe('a revision changes what it names and nothing else', () => {
  test('a section the model does not name is carried across byte-identical', async ({ page }) => {
    await sapPage(page);
    const out = await sapTool(page, (sap) => {
      const current = {};
      for (const id of ['refinedGoal', 'purpose', 'masteryCriteria']) {
        current[id] = `The ${id} block, written out in full and left alone.`;
      }
      const merged = sap.mergeRevision(
        { edits: [{ section: 'masteryCriteria', content: '90% across 3 consecutive sessions.', why: 'you asked for 90' }] },
        current,
      );
      return { refinedGoal: merged.refinedGoal, purpose: merged.purpose, masteryCriteria: merged.masteryCriteria };
    });

    // The named one changed.
    expect(out.masteryCriteria).toBe('90% across 3 consecutive sessions.');
    // The unnamed ones are identical strings, which is what produces no diff.
    // Not "similar", not "still populated" - identical. Everything the old
    // whole-note contract got wrong lived in the gap between those.
    expect(out.refinedGoal).toBe('The refinedGoal block, written out in full and left alone.');
    expect(out.purpose).toBe('The purpose block, written out in full and left alone.');
  });

  test('and it shows exactly one diff on the page, not thirteen', async ({ page }) => {
    await draft(page, plan(), (route) => route.fulfill(reply({
      edits: [{ section: 'masteryCriteria', content: '90% across 3 consecutive sessions.', why: 'you asked for 90' }],
    })));

    await revise(page, 'Mastery Criteria', 'make it 90%');
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 20000 });
    // The symptom he reported was "entire sections" struck through. One edit,
    // one diff.
    await expect(page.locator('.diff-view')).toHaveCount(1);
  });

  test('an edit that returns nothing is dropped rather than emptying the block', async ({ page }) => {
    await sapPage(page);
    const out = await sapTool(page, (sap) => sap.mergeRevision(
      { edits: [{ section: 'promptHierarchy', content: '   ', why: 'blanked' }] },
      { promptHierarchy: 'Full physical, partial physical, gestural, independent.' },
    ).promptHierarchy);

    // Under the old contract an emptied section and a section the model chose
    // not to repeat were the same thing on the wire. Under this one an empty
    // edit can only mean the model returned nothing for a block it said it was
    // changing, and blanking a company-required block is never the ask.
    expect(out).toBe('Full physical, partial physical, gestural, independent.');
  });

  test('a repeated section takes the first write, loudly, not the last silently', async ({ page }) => {
    await sapPage(page);
    const out = await sapTool(page, (sap) => sap.mergeRevision(
      { edits: [
        { section: 'sd', content: 'FIRST', why: 'a' },
        { section: 'sd', content: 'SECOND', why: 'b' },
      ] },
      { sd: 'original' },
    ).sd);
    expect(out).toBe('FIRST');
  });
});

/* ── The dependent, which is what the edits contract cost and how it is paid ── */

test.describe('a change that forces another change says so', () => {
  test('the dependent is applied and named, in the same turn', async ({ page }) => {
    // The cost of the edits contract: the model no longer re-reads the whole
    // note on a revision, so a mastery criterion moved to 90% could leave a
    // generalization block still quoting 80% and nothing would notice. A
    // `dependents` array riding in the same reply fixes it for no extra call.
    await sapPage(page);
    const out = await sapTool(page, (sap) => {
      const merged = sap.mergeRevision(
        {
          edits: [{ section: 'masteryCriteria', content: '90% across 3 sessions.', why: 'you asked for 90' }],
          dependents: [{ section: 'generalizationCriteria', content: 'Generalization probed at 90%.', why: 'it quoted the old 80%' }],
        },
        { masteryCriteria: '80% across 3 sessions.', generalizationCriteria: 'Generalization probed at 80%.' },
      );
      return {
        mastery: merged.masteryCriteria,
        generalization: merged.generalizationCriteria,
        dependentSections: merged.dependentSections,
        reasons: merged.editReasons,
      };
    });

    expect(out.mastery).toBe('90% across 3 sessions.');
    expect(out.generalization).toBe('Generalization probed at 90%.');
    // Named, so the engine marks it rather than re-deriving the intent from a
    // diff. A change that arrives unannounced in a section the clinician was
    // not looking at is the thing this whole file exists to prevent.
    expect(out.dependentSections).toEqual(['generalizationCriteria']);
    expect(out.reasons.generalizationCriteria).toBe('it quoted the old 80%');
  });

  test('and it reaches the page as a second diff with its reason', async ({ page }) => {
    await draft(page, plan(), (route) => route.fulfill(reply({
      edits: [{ section: 'masteryCriteria', content: 'Mastery at 90% across 3 sessions.', why: 'you asked for 90' }],
      dependents: [{ section: 'generalizationCriteria', content: 'Generalization probed at 90%.', why: 'it quoted the old 80%' }],
    })));

    await revise(page, 'Mastery Criteria', 'make it 90%');
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.diff-view')).toHaveCount(2);
    await expect(page.locator('.revision-panel-body')).toContainText('it quoted the old 80%');
  });
});

/* ── The one line the company form requires ──────────────────────────────── */

test.describe('the re-entry rule survives a rewrite of the block it lives in', () => {
  test('a model that drops the Note line while editing has it carried back', async ({ page }) => {
    await sapPage(page);
    const out = await sapTool(page, (sap) => sap.mergeRevision(
      { edits: [{ section: 'errorCorrectionMaintenance', content: '(1) Re-present the SD once.', why: 'shortened' }] },
      { errorCorrectionMaintenance: '(1) Re-present twice.\n\nNote: After 3 consecutive weekly probes below 80%, contact the BCBA.' },
    ).errorCorrectionMaintenance);

    // The rule lives inside the block's prose, so a model rewriting the block
    // can lose it while doing exactly what it was asked. This is a floor, not a
    // lock: the clinician can still delete the line by hand.
    expect(out).toContain('(1) Re-present the SD once.');
    expect(out).toContain('Note: After 3 consecutive weekly probes below 80%, contact the BCBA.');
  });

  test('a model that writes its own Note line keeps that one, not the old one', async ({ page }) => {
    await sapPage(page);
    const out = await sapTool(page, (sap) => sap.mergeRevision(
      { edits: [{ section: 'errorCorrectionMaintenance', content: '(1) Re-present once.\n\nNote: After 2 probes below criteria, contact the BCBA.', why: 'changed the rule' }] },
      { errorCorrectionMaintenance: '(1) Re-present twice.\n\nNote: After 3 consecutive weekly probes below 80%, contact the BCBA.' },
    ).errorCorrectionMaintenance);

    expect(out).toContain('After 2 probes below criteria');
    expect(out, 'the floor must not staple the old rule onto a deliberate new one')
      .not.toContain('After 3 consecutive weekly probes');
  });
});

/* ── The EHR fields, which did not change and must not ───────────────────── */

test.describe('splitting for editing did not split the clipboard', () => {
  test('Copy All reassembles the four fields the EHR has, with labels typed inside', async ({ page }) => {
    await draft(page, plan(), (route) => route.fulfill(reply({ edits: [] })));

    // Read what actually reaches the clipboard rather than what the tool
    // declares. The declaration is asserted below; this is the wire.
    await page.evaluate(() => {
      window.__copied = [];
      navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); };
    });
    await page.getByRole('button', { name: 'Copy All' }).click();
    const text = await page.evaluate(() => (window.__copied || []).join(''));

    // Four EHR fields, in the order the form takes them. Thirteen cards on the
    // page and four blocks on the clipboard: the split was for editing, and the
    // EHR must not be able to tell it happened.
    expect(text).toContain('Treatment Goal (Refined)');
    expect(text).toContain('Exercise');
    expect(text).toContain('Generalization');
    expect(text).toContain('Error Correction');
    expect(text.indexOf('Exercise')).toBeGreaterThan(text.indexOf('Treatment Goal (Refined)'));
    expect(text.indexOf('Error Correction')).toBeGreaterThan(text.indexOf('Generalization'));

    // The eight Exercise parts arrive as labels typed inside one field, which
    // is his ruling: "Copy must still reassemble the four blocks exactly as it
    // does today."
    for (const label of ['Purpose:', 'Teaching Strategy:', 'Lesson Set Up:', 'SD (Demand / Discriminative Stimulus):',
      'Correct Response:', 'Incorrect Response:', 'Mastery Criteria:', 'Prompt Hierarchy:']) {
      expect(text, `the Exercise field lost its ${label} label`).toContain(label);
    }

    // And nothing was dropped on the way: every section's prose is in there.
    for (const id of SECTIONS) {
      expect(text, `${id} never reached the clipboard`).toContain(`The ${id} block, written out in full and left alone.`);
    }
  });

  test('every section belongs to exactly one EHR field', async ({ page }) => {
    await sapPage(page);
    const groups = await sapTool(page, (sap) => sap.copyGroups.map((g) => ({
      heading: g.heading, parts: g.parts.map((p) => p.id),
    })));
    expect(groups.map((g) => g.heading))
      .toEqual(['Treatment Goal (Refined)', 'Exercise', 'Generalization', 'Error Correction']);
    // Sorted set equality catches both halves at once: a section in no group
    // silently stops being copied, and one in two groups is pasted twice.
    expect(groups.flatMap((g) => g.parts).sort()).toEqual([...SECTIONS].sort());
  });

  test('the eight Exercise parts stay in the order the form expects', async ({ page }) => {
    await sapPage(page);
    const exercise = await sapTool(page, (sap) =>
      sap.copyGroups.find((g) => g.heading === 'Exercise').parts.map((p) => p.id));
    expect(exercise).toEqual([
      'purpose', 'teachingStrategy', 'lessonSetUp', 'sd',
      'correctResponse', 'incorrectResponse', 'masteryCriteria', 'promptHierarchy',
    ]);
  });
});

/* ── The design channel: "it was boring before" ──────────────────────────── */

test.describe('the tool marks what it designed, and offers another way', () => {
  test('a designed block shows the choice, the lever, and a way out', async ({ page }) => {
    await draft(page, plan({
      design: [{
        section: 'promptHierarchy',
        choice: 'A four-level most-to-least hierarchy',
        lever: 'the learner already tolerates a delay without escalating',
        proposed: true,
      }],
    }), (route) => route.fulfill(reply({ edits: [] })));

    const note = page.getByTestId('design-promptHierarchy');
    await expect(note).toBeVisible();
    await expect(note).toContainText('A four-level most-to-least hierarchy');
    // The lever is the whole reason this beats a silent block: a BCBA can tell
    // at a glance whether the call applies to their learner, which is the one
    // thing the tool cannot know.
    await expect(note).toContainText('the learner already tolerates a delay');
    await expect(page.getByTestId('another-way-promptHierarchy')).toBeVisible();
  });

  test('nothing is pending: a proposal arrives accepted, with no tick to take it', async ({ page }) => {
    // His ruling, and the generous reading of it: "on by default, one click to
    // drop. Maximum generosity, and the plan is complete without you touching
    // anything." Marking a block as the tool's work is a disclosure, never a
    // request.
    await draft(page, plan({
      design: [{ section: 'promptHierarchy', choice: 'A four-level hierarchy', lever: 'the learner tolerates a delay', proposed: true }],
    }), (route) => route.fulfill(reply({ edits: [] })));

    const note = page.getByTestId('design-promptHierarchy');
    await expect(note).toBeVisible();
    await expect(note, 'a proposal that has to be accepted is a proposal that blocks the plan')
      .not.toContainText(/accept|approve|pending/i);
    // And the block itself is drafted, not empty and waiting.
    await expect(page.getByText('The promptHierarchy block, written out in full and left alone.')).toBeVisible();
  });

  test('a block the tool did not design carries no note', async ({ page }) => {
    await draft(page, plan({
      design: [{ section: 'promptHierarchy', choice: 'A four-level hierarchy', lever: 'the learner tolerates a delay', proposed: true }],
    }), (route) => route.fulfill(reply({ edits: [] })));

    await expect(page.getByTestId('design-promptHierarchy')).toBeVisible();
    // The clinician wrote this one in their specifications. Claiming it would
    // be the tool taking credit for their clinical judgement.
    await expect(page.getByTestId('design-refinedGoal')).toHaveCount(0);
  });
});

/* ── The coherence check ─────────────────────────────────────────────────── */

test.describe('where the plan disagrees with itself, it asks', () => {
  const NET_CONFLICT = {
    sections: ['teachingStrategy', 'lessonSetUp'],
    kind: 'label_vs_description',
    question: 'You wrote "NET" and then described going to the table for 5 to 10 trials. Which is running?',
    readings: [
      { name: 'Natural environment teaching', consequence: 'Trials are embedded in play and the technician follows the learner.' },
      { name: 'Discrete trial teaching with a play break', consequence: 'The technician runs a massed block at the table, then returns to play.' },
      { name: 'Both, a mixed format', consequence: 'The block runs at the table and maintenance targets are probed in play.' },
    ],
  };

  test('it names each reading as the procedure it actually is', async ({ page }) => {
    await draft(page, plan({ conflicts: [NET_CONFLICT] }), (route) => route.fulfill(reply({ edits: [] })));

    const panel = page.getByTestId('conflicts');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Named one thing, described another');
    await expect(panel).toContainText('Natural environment teaching');
    await expect(panel).toContainText('Discrete trial teaching with a play break');
    // A check that cannot say "you are running a mixed format" argues with a
    // correct plan. His example, and the reason the third chip is there.
    await expect(panel).toContainText('Both, a mixed format');
  });

  test('it changes nothing on its own: the plan stands until the clinician answers', async ({ page }) => {
    await draft(page, plan({ conflicts: [NET_CONFLICT] }), (route) => route.fulfill(reply({ edits: [] })));

    await expect(page.getByTestId('conflicts')).toBeVisible();
    // No diff, because nothing was applied. A mistyped direction and a
    // deliberate prompt delay are clinically different and only the person who
    // wrote it knows which they meant.
    await expect(page.locator('.diff-view')).toHaveCount(0);
    await expect(page.getByText('The teachingStrategy block, written out in full and left alone.')).toBeVisible();
  });

  test('a conflict with only one reading is not a conflict', async ({ page }) => {
    // One reading is an assertion that the clinician got it wrong, which is the
    // one thing this must never do.
    await sapPage(page);
    const kept = await sapTool(page, (sap) => sap.normalizeOutput({
      conflicts: [
        { sections: ['sd'], kind: 'figures', question: 'only one way to read this', readings: [{ name: 'the right one', consequence: 'x' }] },
        { sections: ['sd'], kind: 'figures', question: 'genuinely ambiguous', readings: [{ name: 'a', consequence: 'x' }, { name: 'b', consequence: 'y' }] },
      ],
    }).conflicts);

    expect(kept).toHaveLength(1);
    expect(kept[0].question).toBe('genuinely ambiguous');
  });

  test('an unknown kind falls back to a label rather than rendering blank', async ({ page }) => {
    await sapPage(page);
    const kind = await sapTool(page, (sap) => sap.normalizeOutput({
      conflicts: [{ sections: [], kind: 'something_new', question: 'q', readings: [{ name: 'a' }, { name: 'b' }] }],
    }).conflicts[0].kind);
    expect(kind).toBe('label_vs_description');
  });
});
