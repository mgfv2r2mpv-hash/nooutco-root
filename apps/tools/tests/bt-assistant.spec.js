import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';
import { refusedKeywords } from './helpers/schema.js';

// The BT tool used to be its own 800-line page with no revision loop. It is now
// a NOTE_TOOLS entry on the shared engine, which is what buys it the 5-minute
// prompt cache, the scrub gate and structured output. These tests pin the parts
// of that move that a refactor could silently undo - and the two behaviours the
// move added: the triage questions asked before drafting, and the annotate +
// panel revision surface.
//
// Every LLM call is intercepted. Nothing here reaches Anthropic.

function tokenFor(role = 'user', tools = ['bt']) {
  const payload = { role, kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}

// Shape of a real /v1/messages reply, which is what the worker proxies back.
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

// A complete BT note - every key the tool's formSections contract for, because
// the engine's shape gate rejects a response that is missing any of them.
function note(overrides = {}) {
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand.',
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: 'Elopement occurred on two occasions.',
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
    hints: [],
    ...overrides,
  };
}

// Drive the tool past its own validate() and the scrub acknowledge/review gate.
async function fillRequiredAndGenerate(page) {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  // The scrub gate shows an acknowledge dialog once per page load, then a name
  // review only when it finds candidates. Accept whatever it puts up.
  await acceptScrubGate(page);
}

// The scrub gate is two modals, both of which must be cleared before anything
// reaches the API: a once-per-page-load PHI acknowledgement whose Continue
// button stays disabled until its checkbox is ticked, and - only when the
// detector finds candidate names - a review step. Driven by id because both are
// injected as raw HTML by notes-scrub.js.
async function acceptScrubGate(page) {
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await expect(ack).toBeEnabled();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1500 }).catch(() => false)) {
    await review.click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
});

test.describe('BT tool on the shared engine', () => {
  test('renders through the engine with every EHR section and no tool ribbon', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const shape = await page.evaluate(() => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      return {
        registered: window.NOTE_TOOLS.map((t) => t.id),
        sections: bt.formSections.length,
        hasSchema: !!bt.responseSchema,
        copyAll: bt.copyAll,
      };
    });

    // Only BT is on this page, so the ribbon would be a single dead tab.
    expect(shape.registered).toEqual(['bt']);
    await expect(page.locator('.tool-ribbon')).toHaveCount(0);
    // 15 EHR fields, top to bottom.
    expect(shape.sections).toBe(15);
    // Structured output, not the model hand-writing JSON.
    expect(shape.hasSchema).toBe(true);
    // This EHR takes one field at a time; a combined blob is never pasted.
    expect(shape.copyAll).toBe(false);
  });

  test('the facts section is kept out of the expected-response shape', async ({ page }) => {
    // sessionFacts echoes the clinician's own quick-picks and is never in the
    // model's reply. Including it in expectKeys would fail every generation on
    // a key the model was never asked for.
    let body = null;
    await page.route('**/api/llm-call**', async (route) => {
      body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill(reply({ sufficient: true, questions: [] }));
    });

    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const keys = await page.evaluate(() => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      return bt.formSections.map((s) => s.key || s.group);
    });

    expect(keys).toContain('sessionFacts');
    expect(Object.keys(note())).not.toContain('sessionFacts');
  });

  test('place of service defaults to Home without counting as unsaved work', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    // Home is preselected - most sessions are in-home, and making every
    // technician pick it every time is friction for no information gain.
    const home = page.getByRole('button', { name: 'Home', exact: true });
    await expect(home).toHaveCSS('background-color', 'rgb(55, 69, 40)');
    // ...but a default is not content, so Clear must stay hidden.
    await expect(page.getByRole('button', { name: 'Clear' })).toHaveCount(0);

    // Typing is what makes it content. Confirm the text actually landed before
    // reading anything into Clear: the PHI highlight overlay used to wrap this
    // textarea mid-fill and swallow the keystrokes, and that showed up here as
    // a missing Clear button rather than as the empty field it really was.
    const sessionStart = page.getByRole('textbox', { name: /Session Start/i });
    await sessionStart.fill('arrived tired');
    await expect(sessionStart).toHaveValue('arrived tired');

    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();
  });
});

test.describe('triage questions before drafting', () => {
  test('asks, then folds the answer into the note request', async ({ page }) => {
    const posted = [];
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      posted.push(body);
      // First call is triage (it declares its own two-key shape).
      if (posted.length === 1) {
        return route.fulfill(reply({
          sufficient: false,
          questions: [{ field: 'fBehavior', question: 'You mentioned elopement - how many times?' }],
        }));
      }
      // Every later call gets a note. The follow-up triage reads that as
      // "nothing still missing" and drafts, which is the path under test here.
      return route.fulfill(reply(note()));
    });

    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);

    // The question lands in the panel, which opens itself.
    await expect(page.locator('.revision-panel')).toBeVisible();
    await expect(page.getByText(/how many times/i)).toBeVisible();
    // Only triage has run - the note has not been drafted yet.
    expect(posted).toHaveLength(1);

    await page.locator('.revision-input').fill('twice');
    await page.locator('.revision-send').click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 15000 });

    // Answering now re-runs triage with the answer folded in, so there is a
    // second triage call before the note. That is the point of it: someone
    // answers two of three and the third only becomes answerable afterwards.
    // What matters is the note call, which is the last one.
    expect(posted.length).toBeGreaterThanOrEqual(2);
    const noteCall = posted[posted.length - 1];
    // The answer rides in the FIRST user message, so the conversation stays one
    // linear prefix and every later revision hits the same cached prefix.
    expect(noteCall.messages).toHaveLength(1);
    expect(noteCall.messages[0].role).toBe('user');
    expect(noteCall.messages[0].content).toContain('twice');
    /* Triage is a separate call with a separate prompt - splicing it into the
       note conversation would poison the very cache it exists alongside.

       This used to compare the two `system` fields. Since bt migrated neither
       call carries one, so undefined equalled undefined and the assertion
       started passing nothing. What separates them now is the field itself:
       triage names a prompt in the store and sends no text, the note sends the
       block it measured today and names no kind. */
    expect(posted[0].prompt_kind, 'the first call is triage').toBe('triage');
    expect(posted[0].system_suffix, 'triage carries nothing measured in the page').toBeUndefined();
    expect(noteCall.prompt_kind, 'the note asks for the tool\'s own prompt').toBeUndefined();
    expect(typeof noteCall.system_suffix, 'the note carries its measured block').toBe('string');
    expect(posted[0].system, 'no migrated call sends prompt text').toBeUndefined();
    expect(noteCall.system, 'no migrated call sends prompt text').toBeUndefined();
  });

  test('skipping generates anyway', async ({ page }) => {
    const posted = [];
    await page.route('**/api/llm-call**', async (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      if (posted.length === 1) {
        return route.fulfill(reply({
          sufficient: false,
          questions: [{ field: 'fBehavior', question: 'How many times?' }],
        }));
      }
      return route.fulfill(reply(note()));
    });

    await page.clock.install();
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);

    // The escape hatch has to be present, and it now COSTS A MOMENT. It used to
    // be one click, and the audit trail is why it is not: two technicians, ten
    // gap-question rounds, zero revisions ever. Skipping was cheaper than
    // reading. So the button locks briefly, shows the wait, and then works.
    const skip = page.getByRole('button', { name: /Nothing to add/i });
    await expect(skip).toBeVisible();
    await expect(skip).toBeDisabled();
    await expect(skip).toHaveText(/\(\d+s\)/);
    await expect(page.locator('.skip-cooldown-bar')).toBeVisible();

    // Still a delay and NOT a trap: the tired technician at 7pm gets out, just
    // a few seconds later than before.
    await page.clock.runFor(31_000);
    await expect(skip).toBeEnabled();
    await expect(page.locator('.skip-cooldown-bar')).toHaveCount(0);
    await skip.click();

    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 15000 });
    expect(posted).toHaveLength(2);
  });

  test('the cooldown drains rather than sitting still', async ({ page }) => {
    // Guards the thing that makes the wait tolerable instead of infuriating:
    // it has to visibly be going somewhere. A frozen disabled button with no
    // countdown reads as a broken page, and a technician reloads it.
    await page.route('**/api/llm-call**', (route) => route.fulfill(reply({
      sufficient: false,
      questions: [{ field: 'fBehavior', question: 'How many times?' }],
    })));

    await page.clock.install();
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);

    const skip = page.getByRole('button', { name: /Nothing to add/i });
    await expect(skip).toHaveText(/\(30s\)/);

    const width = () => page.locator('.skip-cooldown-bar > span').evaluate((el) => el.style.width);
    const before = await width();
    await page.clock.runFor(10_000);
    await expect(skip).toHaveText(/\(20s\)/);
    const after = await width();
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
  });

  /* The second half of what he asked for: "the closer the note is to being
     ready, the shorter the button emptying is." The readiness number is the
     model's, returned by the same triage call, which is the version he picked
     over counting questions - "the readiness number determination can be
     adjusted as needed", meaning it stays a line of prompt rather than becoming
     arithmetic in the code.

     These pin the mapping in both directions and, more importantly, pin the
     fallback: a triage reply with no readiness must get the LONGER wait, not
     the shorter one. */
  test.describe('the wait scales with how ready the note already is', () => {
    const triageWith = (extra) => ({
      sufficient: false,
      questions: [{ field: 'fBehavior', question: 'How many times?' }],
      ...extra,
    });

    async function openQuestions(page, triageBody) {
      await page.route('**/api/llm-call**', (route) => route.fulfill(reply(triageBody)));
      await page.clock.install();
      await page.goto('/notes/bt/');
      await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
      await page.goto('/notes/bt/');
      await fillRequiredAndGenerate(page);
      return page.getByRole('button', { name: /Nothing to add/i });
    }

    /* READ THE COUNTDOWN FAST. The clock is installed but not paused, so it
       ticks in real time - and a toHaveText that FAILS keeps retrying while the
       number drains. The first version of this file expected 25s from a
       readiness of 20, and it passed against the build with no readiness at all,
       because that build's 30 drifted down to 25 inside the five-second retry
       window. A tight timeout is what makes the read a measurement rather than
       a race the wrong answer can win. */
    const startsAt = (skip, seconds) =>
      expect(skip).toHaveText(new RegExp(`\\(${seconds}s\\)`), { timeout: 2000 });

    test('a ready note does not wait at all', async ({ page }) => {
      // His ruling, 2026-08-06: "the floor is 0 for 85% or better." It reverses
      // the five second floor I built and argued for. The wait exists because
      // skipping was cheaper than reading; on a note the model calls complete
      // there is nothing to read, so the price would land on the person who did
      // the work properly.
      const skip = await openQuestions(page, triageWith({ readiness: 90 }));
      await expect(skip).toBeEnabled();
      await expect(skip).toHaveText(/generate anyway/i);
      // No bar either. A drained bar on a button that was never locked is a
      // progress indicator for nothing.
      await expect(page.locator('.skip-cooldown-bar')).toHaveCount(0);
    });

    test('85 is the threshold, and 84 does not fall off a cliff', async ({ page }) => {
      // Ramped to zero AT his threshold rather than stepping there, so a single
      // readiness point is never the difference between free and a long wait.
      const skip = await openQuestions(page, triageWith({ readiness: 85 }));
      await expect(skip).toBeEnabled();
    });

    test('a middling note still waits', async ({ page }) => {
      const skip = await openQuestions(page, triageWith({ readiness: 40 }));
      await startsAt(skip, 16);
      // The moment that separates the two: the ready note above was through
      // immediately and this one is not.
      await page.clock.runFor(9_000);
      await expect(skip).toBeDisabled();
      await page.clock.runFor(8_000);
      await expect(skip).toBeEnabled();
    });

    test('a triage reply with no readiness gets the full wait, not the short one', async ({ page }) => {
      // The fallback has to fail toward the longer wait. A dropped field, a
      // malformed reply or an older tool must never hand out the shortcut that
      // a genuinely ready note earns.
      //
      // This one is a one-sided guard and cannot be otherwise: the full thirty
      // is exactly what the build before this change did on every note, so no
      // assertion here can tell them apart. What it pins is the future - the
      // day someone makes the fallback the SHORT wait for convenience.
      const skip = await openQuestions(page, triageWith({}));
      await startsAt(skip, 30);
      await page.clock.runFor(29_000);
      await expect(skip).toBeDisabled();
    });

    test('answering shortens the next round, because the note got closer', async ({ page }) => {
      // Readiness is re-read every round rather than carried forward. Answering
      // two of three questions is exactly the case where the note improved, and
      // the wait has to move with it or the number is decorative.
      const posted = [];
      await page.route('**/api/llm-call**', (route) => {
        posted.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill(reply(posted.length === 1
          ? triageWith({ readiness: 40 })
          : { ...triageWith({ readiness: 90 }), questions: [{ field: 'fBehavior', question: 'For how long?' }] }));
      });
      await page.clock.install();
      await page.goto('/notes/bt/');
      await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
      await page.goto('/notes/bt/');
      await fillRequiredAndGenerate(page);

      const skip = page.getByRole('button', { name: /Nothing to add/i });
      await startsAt(skip, 16);

      await page.locator('.revision-input').fill('twice');
      await page.locator('.revision-send').click();
      await expect(page.getByText(/for how long/i)).toBeVisible();
      // Answering carried it over his threshold, so the second round is free.
      await expect(skip).toBeEnabled();
    });
  });

  test('a failed triage call still drafts the note', async ({ page }) => {
    // Triage is an assist, not a gate. Losing a question is a far smaller harm
    // than refusing to draft.
    let calls = 0;
    await page.route('**/api/llm-call**', async (route) => {
      calls++;
      if (calls === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
      return route.fulfill(reply(note()));
    });

    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);

    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
  });

  /* Copy All is hidden on this tool because the EHR takes one field at a time,
     so a combined blob is never what a technician pastes. He reversed it for
     himself on 2026-08-06: "I was wrong - for admin mode I do want copy all on
     the notes." The reason for hiding it is about the technician's workflow, and
     he is not doing that job when he opens the tool. */
  test.describe('Copy All comes back for an admin', () => {
    async function drafted(page, role) {
      let calls = 0;
      await page.route('**/api/llm-call**', (route) => {
        calls++;
        if (calls === 1) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
        return route.fulfill(reply(note()));
      });
      await page.goto('/notes/bt/');
      await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
      await page.goto('/notes/bt/');
      await fillRequiredAndGenerate(page);
      await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
      return page.getByRole('button', { name: /^Copy All$/ });
    }

    test('a technician does not get it, because their EHR takes one field at a time', async ({ page }) => {
      await expect(await drafted(page, 'user')).toHaveCount(0);
    });

    test('an admin does', async ({ page }) => {
      await expect(await drafted(page, 'admin')).toBeVisible();
    });

    test('the per-section Copy is there for everyone either way', async ({ page }) => {
      // The reason Copy All could be dropped at all. If this ever goes, a
      // technician has no way to move a single narrative into their form.
      await drafted(page, 'user');
      expect(await page.getByRole('button', { name: /^Copy$/ }).count()).toBeGreaterThan(0);
    });
  });
});

test.describe('annotate + panel revision', () => {
  async function draft(page, onRevision) {
    let calls = 0;
    await page.route('**/api/llm-call**', async (route) => {
      calls++;
      if (calls === 1) return route.fulfill(reply({ sufficient: true, questions: [] }));
      if (calls === 2) return route.fulfill(reply(note()));
      return onRevision(route, JSON.parse(route.request().postData() || '{}'));
    });
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
  }

  test('clicking a section targets it and a revision lands as an inline diff', async ({ page }) => {
    let revisionBody = null;
    await draft(page, (route, body) => {
      revisionBody = body;
      return route.fulfill(reply(note({
        lessonProgressNarrative: 'The behavior technician used a three-item array.',
      })));
    });

    // Click the section - not a button inside it.
    await page.getByText('Narrative of Lesson Progress', { exact: true }).click();
    await expect(page.locator('.revision-panel')).toBeVisible();
    await expect(page.locator('.revision-chip')).toContainText('Narrative of Lesson Progress');

    await page.locator('.revision-input').fill('drop the word utilized');
    await page.locator('.revision-send').click();

    // The change is marked in place, against what was there before.
    const diff = page.locator('.diff-view').first();
    await expect(diff).toBeVisible({ timeout: 15000 });
    await expect(diff.locator('.diff-del')).toContainText('utilized');
    await expect(diff.locator('.diff-ins')).toContainText('used');

    // The revision replays the whole conversation, so the cached prefix holds.
    expect(revisionBody.messages.length).toBeGreaterThan(1);
    expect(revisionBody.messages[0].role).toBe('user');
    // ...and it names the section it is scoped to.
    expect(revisionBody.messages[revisionBody.messages.length - 1].content).toContain('lessonProgressNarrative');
  });

  test('Accept applies the change; Discard leaves the note alone', async ({ page }) => {
    await draft(page, (route) => route.fulfill(reply(note({
      lessonProgressNarrative: 'The behavior technician used a three-item array.',
    }))));

    const field = page.locator('textarea[data-section-id="lessonProgressNarrative"]');
    await expect(field).toHaveValue(/utilized/);

    await page.getByText('Narrative of Lesson Progress', { exact: true }).click();
    await page.locator('.revision-input').fill('drop the word utilized');
    await page.locator('.revision-send').click();
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /^Discard$/ }).click();
    // Discard reverts the render only - the original text is still there.
    await expect(field).toHaveValue(/utilized/);

    await page.getByText('Narrative of Lesson Progress', { exact: true }).click();
    await page.locator('.revision-input').fill('drop the word utilized');
    await page.locator('.revision-send').click();
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Accept$/ }).click();

    await expect(field).toHaveValue(/used a three-item array/);
    await expect(field).not.toHaveValue(/utilized/);
  });

  test('selecting a phrase scopes the revision to that phrase', async ({ page }) => {
    let revisionBody = null;
    await draft(page, (route, body) => {
      revisionBody = body;
      return route.fulfill(reply(note()));
    });

    const field = page.locator('textarea[data-section-id="behaviorPlanNarrative"]');
    // Select "two occasions" inside the narrative.
    await field.evaluate((el) => {
      const i = el.value.indexOf('two occasions');
      el.focus();
      el.setSelectionRange(i, i + 'two occasions'.length);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const chip = page.locator('[data-revise-chip]');
    await expect(chip).toBeVisible();
    await chip.click();

    await expect(page.locator('.revision-chip')).toContainText('two occasions');
    await page.locator('.revision-input').fill('say twice instead');
    await page.locator('.revision-send').click();
    await expect(page.locator('.revision-panel-body')).toContainText(/No change was needed|Updated/i, { timeout: 15000 });

    const sent = revisionBody.messages[revisionBody.messages.length - 1].content;
    // The model is told which phrase was highlighted, and to leave the rest.
    expect(sent).toContain('two occasions');
    expect(sent).toContain('highlighted');
  });

  test('the panel floats over the note instead of reflowing it', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    await expect(page.locator('.revision-fab')).toBeVisible();

    // The page must be exactly as wide with the panel open as with it shut.
    // Docking used to inset #root, which cost the note a third of the window
    // and reflowed it under the reader mid-sentence.
    const widthBefore = await page.evaluate(() => document.getElementById('root').getBoundingClientRect().width);

    await page.locator('.revision-fab').click();
    await expect(page.locator('.revision-panel')).toBeVisible();

    const widthAfter = await page.evaluate(() => document.getElementById('root').getBoundingClientRect().width);
    expect(widthAfter).toBe(widthBefore);

    const inset = await page.evaluate(() => parseInt(getComputedStyle(document.getElementById('root')).paddingRight, 10));
    expect(inset).toBeLessThan(60);

    await page.locator('.revision-panel-close').click();
    await expect(page.locator('.revision-panel')).toHaveCount(0);
    await expect(page.locator('.revision-fab')).toBeVisible();
  });

  test('tapping off the panel collapses it and keeps what was typed', async ({ page }) => {
    // The whole point of a panel that floats: getting back to the page must not
    // cost the technician the instruction they were part-way through writing.
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    await page.locator('.revision-fab').click();
    await page.locator('.revision-input').fill('shorten the behaviour section');

    // Click the page background, not a section: clicking a section means
    // "revise this" and deliberately keeps the panel open.
    await page.locator('h1').first().click();
    await expect(page.locator('.revision-panel')).toHaveCount(0);

    await page.locator('.revision-fab').click();
    await expect(page.locator('.revision-input')).toHaveValue('shorten the behaviour section');
  });

  /* The triage schema is shared by all five tools, so one bad keyword in it
     took gap questions and the readiness reading off every one of them between
     2026-08-19 and 2026-09-01. Nothing looked broken: the draft still arrived,
     because the engine treats a failed triage as "no questions to ask".

     Asserted on the posted payload rather than on the constant, because what
     the API refuses is what the API is sent. */
  test('the triage call posts a schema the API will accept', async ({ page }) => {
    const posted = [];
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      posted.push(body);
      return route.fulfill(
        reply(isTriageCall(body) ? { sufficient: true, readiness: 90, questions: [] } : note()),
      );
    });

    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');

    await fillRequiredAndGenerate(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    const triage = posted.find(isTriageCall);
    expect(triage, 'no triage call was posted').toBeTruthy();
    /* The whole body, not just the schema key. It rides inside
       output_config.format.schema, which is the path the API named in the
       error, and walking the body means this keeps working wherever the
       payload puts it next. */
    const schema = triage.output_config?.format?.schema;
    expect(schema, 'the triage call carried no output_config schema').toBeTruthy();
    expect(refusedKeywords(triage, 'triage body')).toEqual([]);
    /* Dropping the keyword must not drop the bound with it: the model is still
       told the range, and clampReadiness holds it on the way back in. */
    expect(JSON.stringify(schema)).toContain('0 to 100');
  });

  test('a readiness the model puts out of range is clamped, not passed on', async ({ page }) => {
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      return route.fulfill(
        reply(
          isTriageCall(body)
            ? { sufficient: false, readiness: 480, questions: [{ field: 'behavior', question: 'How many times?' }] }
            : note(),
        ),
      );
    });

    await page.goto('/notes/bt/');
    await page.evaluate((t) => {
      localStorage.setItem('notes_auth_token', t);
      localStorage.removeItem('noaba.audit.buffer.v1');
    }, tokenFor());
    await page.goto('/notes/bt/');

    await fillRequiredAndGenerate(page);
    await expect(page.getByText('How many times?')).toBeVisible({ timeout: 20000 });

    /* 480 buys a skip cooldown no note has earned, and it reaches the audit
       trail as itself. skipSecondsFor clamped its own copy and nothing else,
       which is why the clamp moved to the boundary. */
    const audited = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]')
        .filter((e) => e.type === 'gap_questions' && 'readiness' in e.data)
        .map((e) => e.data.readiness),
    );
    expect(audited.length, 'no gap_questions audit event was recorded').toBeGreaterThan(0);
    for (const r of audited) expect(r).toBeLessThanOrEqual(100);
  });

  test('the collapsed pill carries the note quality, not just a label', async ({ page }) => {
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      return route.fulfill(reply(isTriageCall(body) ? { sufficient: true, questions: [] } : note()));
    });

    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');

    // Before a note exists there is nothing to judge.
    await expect(page.locator('.revision-fab')).toHaveClass(/quality-idle/);

    await fillRequiredAndGenerate(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    // note() carries no hints and no empty narrative, so this reads as complete.
    await page.locator('.revision-panel-close').click();
    await expect(page.locator('.revision-fab')).toHaveClass(/quality-good/);
  });

  test('the pill says what to fix, not how many things are wrong', async ({ page }) => {
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      return route.fulfill(
        reply(
          isTriageCall(body)
            ? { sufficient: true, questions: [] }
            : note({
                hints: [
                  { section: 'behaviorPlanNarrative', code: 'no_strategy_outcome', detail: '', rank: 1, kind: 'thin' },
                ],
              }),
        ),
      );
    });

    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');

    await fillRequiredAndGenerate(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    await page.locator('.revision-panel-close').click();

    const fab = page.locator('.revision-fab');
    await expect(fab).toHaveClass(/quality-thin/);
    /* One hint used to make this tooltip read "1 spot could use more detail",
       which is the count and no instruction: the only way to act on it was to
       open the panel and read the hint anyway. */
    await expect(fab).toHaveAttribute(
      'title',
      'Strategy described without its outcome, say what happened as a result of trying it',
    );
  });
});
