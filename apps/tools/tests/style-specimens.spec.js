import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* WHERE THE STYLE MEASUREMENT FIRES (slice 5b).
 *
 * style-features.js used to be handed one pair per note, the model's draft
 * against the note that was copied. A rejected correction, a reworded one and
 * hand typing are each their own paired specimen now, and a correction nobody
 * touched is not measured as anyone's prose. See notes/bcba/specimens.js.
 *
 * WHAT IS NOT WIDENED is what leaves the page. Every assertion on the wire
 * below reads the same five keys the store has always taken.
 *
 * Every LLM call is intercepted. Nothing here reaches Anthropic.
 */

const BT_PAGE = '/notes/bt/';

function tokenFor(role = 'user', tools = ['bt']) {
  const payload = { role, kid: 'specimen-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

const PLAN = 'Elopement occurred on two occasions and the technician blocked the door.';
// Six hedges in one sentence, so a note that gains or loses it moves `hedging`
// by far more than the noise floor whichever way it goes.
const HEDGED = ' The client appeared to perhaps feel somewhat unsettled and possibly may have tended to leave the table.';
const PLAIN = ' The client left the table twice.';
const FOLLOW = 'Direct staff do not report new questions or concerns for the BCBA.';
const WORDY = ' Additionally, comprehensive documentation substantiated considerable generalization throughout.';

function note() {
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
    behaviorPlanNarrative: PLAN,
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: FOLLOW,
    hints: [],
  };
}

const HEDGE_ADDED = [{ section: 'behaviorPlanNarrative', text: PLAN + HEDGED, why: 'test' }];

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

/* Draft one note with `corrections` as the pass's answer, and collect every
   usage event and style correction the page posts. */
async function draft(page, { corrections = HEDGE_ADDED, role = 'user' } = {}) {
  const wire = { events: [], corrections: [], bodies: [] };
  await page.route('**/api/audit**', async (route) => {
    const raw = route.request().postData() || '{}';
    const body = JSON.parse(raw);
    wire.bodies.push(raw);
    (body.events || []).forEach((e) => wire.events.push(e));
    (body.corrections || []).forEach((c) => wire.corrections.push(c));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":1,"profile":"ok"}' });
  });
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    return route.fulfill(reply(note()));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ corrections, dropped: 0, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }),
    }));

  await page.goto(BT_PAGE);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
  await page.goto(BT_PAGE);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked the door');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
  if (corrections.length) {
    await expect(page.locator('[data-corrections-section]').first()).toBeVisible({ timeout: 20000 });
  } else {
    await expect(page.locator('textarea[data-section-id="behaviorPlanNarrative"]')).toBeVisible({ timeout: 20000 });
  }
  return wire;
}

const insertKey = (page, section) =>
  page.locator(`[data-corrections-section="${section}"] [data-correction-type="ins"]`).first().getAttribute('data-correction');

async function undo(page, key) {
  await page.locator(`[data-correction-tick="${key}"]`).click();
  await page.locator(`[data-correction-undo="${key}"]`).click();
  await expect(page.locator(`[data-correction="${key}"]`)).toHaveAttribute('data-correction-reverted', 'true');
}

async function putBack(page, key) {
  await page.locator(`[data-correction-tick="${key}"]`).click();
  await page.locator(`[data-correction-undo="${key}"]`).click();
  await expect(page.locator(`[data-correction="${key}"]`)).toHaveAttribute('data-correction-reverted', 'false');
}

async function reword(page, key, text) {
  await page.locator(`[data-correction-tick="${key}"]`).click();
  await page.locator(`[data-correction-pencil="${key}"]`).click();
  await page.locator(`[data-correction-edit="${key}"]`).fill(text);
  await page.locator(`[data-correction-save="${key}"]`).click();
  await expect(page.locator(`[data-correction="${key}"]`)).toContainText(text.trim());
}

/* Copy, then wait for the note_copied event, which leaves on the same flush
   path the style evidence does. Waiting on it is what makes an empty
   corrections list a reading rather than a race. */
async function copyAndSettle(page, wire) {
  await page.getByRole('button', { name: /^Copy$/ }).first().click();
  await expect
    .poll(() => wire.events.filter((e) => e.type === 'note_copied').length, { timeout: 10000, message: 'the copy never reached the audit route' })
    .toBe(1);
  await page.waitForTimeout(1500);
}

const hedging = (wire) => wire.corrections.filter((c) => c.feature === 'hedging');

// ───────────────────────────────────────────── the three firing sites

test.describe('each paired specimen reaches the store', () => {
  test('a REJECTED correction teaches, as a revision, in the direction the technician went', async ({ page }) => {
    const wire = await draft(page);
    await undo(page, await insertKey(page, 'behaviorPlanNarrative'));
    await copyAndSettle(page, wire);

    // The hedged sentence was offered and put back out, so hedging went DOWN.
    expect(hedging(wire), 'the rejection taught nothing').toEqual([
      expect.objectContaining({ feature: 'hedging', direction: -1, source: 'revision' }),
    ]);
    expect(wire.corrections.every((c) => c.source === 'revision'), 'something other than the rejection fired').toBe(true);
  });

  test('an ACCEPTED THEN EDITED correction teaches, as the technician\'s own prose', async ({ page }) => {
    const wire = await draft(page);
    await reword(page, await insertKey(page, 'behaviorPlanNarrative'), PLAIN);
    await copyAndSettle(page, wire);

    // Offered hedged, kept plain. Measured against the model's draft instead,
    // which never held a hedge, hedging would not move at all.
    expect(hedging(wire), 'the rewording taught nothing').toEqual([
      expect.objectContaining({ feature: 'hedging', direction: -1, source: 'manual' }),
    ]);
    expect(wire.corrections.some((c) => c.source === 'revision'), 'a rewording was taught as a rejection').toBe(false);
  });

  test('a MANUAL OVERTYPE teaches, as the technician\'s own prose', async ({ page }) => {
    const wire = await draft(page, { corrections: [] });
    await page.locator('textarea[data-section-id="behaviorPlanNarrative"]').fill(PLAN + HEDGED);
    await copyAndSettle(page, wire);

    expect(hedging(wire), 'the overtype taught nothing').toEqual([
      expect.objectContaining({ feature: 'hedging', direction: 1, source: 'manual' }),
    ]);
  });
});

// ───────────────────────────────────────────── what is not taught

test.describe('what the partition keeps out', () => {
  test('a correction left standing is not taught as the technician\'s prose', async ({ page }) => {
    const wire = await draft(page);

    // Not vacuous: the old comparison, the model's draft against the note with
    // the correction standing, finds a hedging change on this very fixture.
    const n = note();
    const narratives = (plan) => [n.clinicalStatusNarrative, n.lessonProgressNarrative, n.antecedentNarrative, plan, n.followUpNarrative].join('\n\n');
    const old = await page.evaluate(
      ([drafted, offered]) => window.NoteStyleFeatures.compare(drafted, offered, 'manual').map((f) => f.feature),
      [narratives(PLAN), narratives(PLAN + HEDGED)],
    );
    expect(old, 'the fixture would not have moved hedging under the old comparison either').toContain('hedging');

    await copyAndSettle(page, wire);
    expect(wire.corrections).toEqual([]);
  });

  test('a correction undone and then put back teaches nothing, because it was not rejected', async ({ page }) => {
    const wire = await draft(page);
    const key = await insertKey(page, 'behaviorPlanNarrative');
    await undo(page, key);
    await putBack(page, key);
    await copyAndSettle(page, wire);
    expect(wire.corrections).toEqual([]);
  });

  test('a section finished by hand after an undo still teaches the rejection', async ({ page }) => {
    const wire = await draft(page);
    await undo(page, await insertKey(page, 'behaviorPlanNarrative'));
    // "Edit by hand" puts the marks away, and with them the only record of what
    // was offered. The book is what still knows.
    await page.locator('[data-corrections-done="behaviorPlanNarrative"]').click();
    await expect(page.locator('textarea[data-section-id="behaviorPlanNarrative"]')).toHaveValue(PLAN);
    await copyAndSettle(page, wire);

    expect(hedging(wire)).toEqual([
      expect.objectContaining({ feature: 'hedging', direction: -1, source: 'revision' }),
    ]);
  });

  test('a new note starts a new book, so the last note\'s corrections cannot teach on this one', async ({ page }) => {
    const wire = await draft(page);
    // The second note's pass finds nothing. Registered last, so it answers first.
    await page.route('**/api/corrections-pass**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [], dropped: 0, usage: {}, model: 'test' }) }));
    await page.getByRole('button', { name: 'Generate Note' }).click();
    await acceptScrubGate(page);
    await expect(page.locator('[data-corrections-section]')).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('textarea[data-section-id="behaviorPlanNarrative"]')).toHaveValue(PLAN);

    // Nothing touched on this note. A book carried over from the first one
    // would read its hedged offer as the baseline and teach a hedge removed.
    await copyAndSettle(page, wire);
    expect(wire.corrections).toEqual([]);
  });

  test('a page that failed to load the specimen module still drafts and copies, and throws nothing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    // Headless Chromium refuses the clipboard by default, and that rejection is
    // an error of its own that has nothing to do with this module.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/notes/bcba/specimens.js', (route) => route.abort());
    const wire = await draft(page);
    await undo(page, await insertKey(page, 'behaviorPlanNarrative'));
    await copyAndSettle(page, wire);
    expect(await page.evaluate(() => typeof window.NoteSpecimens)).toBe('undefined');
    expect(errors).toEqual([]);
  });

  test('a rejection is never filed as the owner\'s own prose in the voice capture', async ({ page }) => {
    const wire = await draft(page, { role: 'admin' });
    await page.evaluate(() => {
      window.__captured = [];
      const real = window.VoiceCapture.capture;
      window.VoiceCapture.capture = (before, after, meta) => {
        window.__captured.push(meta && meta.source);
        return real(before, after, meta);
      };
    });
    await undo(page, await insertKey(page, 'behaviorPlanNarrative'));
    await copyAndSettle(page, wire);

    // The rejection did reach the style store, so the pair existed.
    expect(hedging(wire).length, 'no rejection was measured, so this checks nothing').toBe(1);
    expect(await page.evaluate(() => window.__captured)).toEqual([]);
  });
});

// ───────────────────────────────────────────── the shape did not grow

test.describe('what leaves the page is the same shape it always was', () => {
  test('all three kinds on one note post only feature, direction, magnitude, source and ts', async ({ page }) => {
    const corrections = [
      { section: 'behaviorPlanNarrative', text: PLAN + HEDGED, why: 'test' },
      { section: 'followUpNarrative', text: FOLLOW + WORDY, why: 'test' },
    ];
    const wire = await draft(page, { corrections });
    await undo(page, await insertKey(page, 'behaviorPlanNarrative'));
    await reword(page, await insertKey(page, 'followUpNarrative'), PLAIN);
    await page.locator('textarea[data-section-id="lessonProgressNarrative"]')
      .fill('The behavior technician ran the three item array. Eight right of ten, with a gestural prompt on each of the two misses, and it was a good day.');
    await copyAndSettle(page, wire);

    const sources = new Set(wire.corrections.map((c) => c.source));
    expect(sources.has('revision'), 'the rejection did not fire, so this proves less than it says').toBe(true);
    expect(sources.has('manual'), 'neither manual kind fired, so this proves less than it says').toBe(true);

    for (const c of wire.corrections) {
      expect(Object.keys(c).sort()).toEqual(['direction', 'feature', 'magnitude', 'source', 'ts']);
      expect(['revision', 'manual']).toContain(c.source);
    }
    // And no word of any of the three pairs rode along in any request body.
    const all = wire.bodies.join('\n');
    for (const fragment of ['unsettled', 'table', 'generalization', 'gestural', 'Elopement', 'BCBA']) {
      expect(all, `"${fragment}" left the page`).not.toContain(fragment);
    }
  });
});

// ───────────────────────────────────────────── the module, without the page flow

test.describe('the chain the pairs are cut from', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BT_PAGE);
    await page.waitForFunction(() => !!window.NoteSpecimens && !!window.NoteCorrections && !!window.NoteDiff);
  });

  test('a note with no marks yields exactly the old comparison, and nothing else', async ({ page }) => {
    const out = await page.evaluate(() => window.NoteSpecimens.pairs({
      ids: ['a', 'b'],
      draft: { a: 'one', b: 'two' },
      book: null,
      shipped: { a: 'one', b: 'two typed' },
    }));
    expect(out).toEqual([{ kind: 'overtyped', source: 'manual', own: true, before: 'one\n\ntwo', after: 'one\n\ntwo typed' }]);
  });

  test('the three links chain end to end, so no difference is measured twice', async ({ page }) => {
    const out = await page.evaluate(() => {
      const S = window.NoteSpecimens;
      const C = window.NoteCorrections;
      const built = C.build({
        before: { a: 'First sentence here.', b: 'Second one here.' },
        corrections: [
          { section: 'a', text: 'First sentence here. Added to a.' },
          { section: 'b', text: 'Second one here. Added to b.' },
        ],
      });
      const ka = built.marks.find((m) => m.id === 'a' && m.type === 'ins').key;
      const kb = built.marks.find((m) => m.id === 'b' && m.type === 'ins').key;
      let state = C.toggle(built.sections, {}, ka);
      state = C.edit(state, kb, ' Reworded in b.');
      const book = S.observe(null, built, state);
      const shipped = { ...C.outputFor(built.sections, state) };
      shipped.b = shipped.b + ' Typed by hand.';
      return S.pairs({ ids: ['a', 'b'], draft: { a: 'First sentence here.', b: 'Second one here.' }, book, shipped });
    });
    expect(out.map((p) => p.kind)).toEqual(['rejected', 'edited', 'overtyped']);
    expect(out[0].before).toBe('First sentence here. Added to a.\n\nSecond one here. Added to b.');
    expect(out[0].after).toBe(out[1].before);
    expect(out[1].after).toBe(out[2].before);
    expect(out[1].after).toBe('First sentence here.\n\nSecond one here. Reworded in b.');
    expect(out[2].after).toBe('First sentence here.\n\nSecond one here. Reworded in b. Typed by hand.');
  });

  test('a section whose marks were put away keeps its entry in the book', async ({ page }) => {
    const out = await page.evaluate(() => {
      const S = window.NoteSpecimens;
      const C = window.NoteCorrections;
      const built = C.build({ before: { a: 'Kept here.' }, corrections: [{ section: 'a', text: 'Kept here. Offered too.' }] });
      const first = S.observe(null, built, {});
      const later = S.observe(first, { sections: {} }, {});
      return { first: first.a, later: later.a, same: first !== later };
    });
    expect(out.later).toEqual(out.first);
    expect(out.first.offered).toBe('Kept here. Offered too.');
    expect(out.same, 'observe handed back the book it was given rather than a new one').toBe(true);
  });

  test('a rejection is the one kind whose after side is not the technician\'s prose', async ({ page }) => {
    const kinds = await page.evaluate(() => window.NoteSpecimens.KINDS);
    expect(kinds).toEqual({
      rejected: { source: 'revision', own: false },
      edited: { source: 'manual', own: true },
      overtyped: { source: 'manual', own: true },
    });
  });
});

test('both note pages load the specimen module', async ({ page }) => {
  for (const path of ['/notes/bt/', '/notes/bcba/']) {
    await page.goto(path);
    await page.waitForFunction(() => document.readyState === 'complete');
    expect(await page.evaluate(() => typeof window.NoteSpecimens?.pairs), path).toBe('function');
  }
});
