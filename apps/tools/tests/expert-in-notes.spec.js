import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The expert runs on the note pages now, beside the draft rather than instead
 * of it.
 *
 * WHAT THIS PINS. /api/expert-pass has existed since 2026-08-24 with one caller,
 * the admin bench. The note engine is the second, and the whole point of the
 * phase is a comparison: the hint catalog has eight fixed codes per tool and
 * between them they cannot say "you wrote 'he wanted attention', and that is a
 * function claim". Whether the expert beats that is only answerable if BOTH
 * channels speak on the SAME note, so several of these tests are two-sided -
 * they assert the expert appeared AND that the catalog is still there beside it.
 *
 * The rest guard the three things most likely to go quietly wrong:
 *
 *   THE SECTION IDS come out of the tool's responseSchema and not out of
 *   formSections. The bench learned this the hard way: formSections is right for
 *   bt alone, so a caller reading it sends the wrong ids for every other tool,
 *   every finding comes back filed under "note", and the expert looks unable to
 *   tell one section from another. That failure is invisible on bt, which is the
 *   page this test drives, so the assertion reads the schema rather than a
 *   hardcoded list.
 *
 *   IT IS NEVER AWAITED. A slow or broken second opinion must cost nobody a
 *   note.
 *
 *   A LATE REPLY does not attach itself to a different note.
 */

const PAGE = '/notes/bt/';

function tokenFor(role, tools) {
  const p = { role, kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

/* A note carrying ONE catalog hint on a known section, so "the catalog is still
   speaking" is checkable rather than assumed. The code has to be a real one:
   a hint whose catalog wording is empty renders nothing, and would make a
   living channel look dead. */
const NOTE = {
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client met the technician at the door and settled quickly.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
};

const EXPERT = {
  terms: [{ token: 'DTT', reading: 'Discrete Trial Training', status: 'resolved', why: 'Named beside the trial count.' }],
  register: [
    { quote: 'he wanted attention', action: 'reframe', why: 'A function claim, not an observation.', move: 'Say what happened and who responded.' },
  ],
  hints: [
    { section: 'note', rank: 1, kind: 'blocks-claim', ask: 'What was the prompt level on the failed trials?', why: 'A payer reads a trial count with no prompt level as unsupported.' },
    { section: 'behaviorPlanNarrative', rank: 2, kind: 'thin', ask: 'How long did each elopement last?', why: 'Duration is what a rate comparison needs.' },
  ],
  hintsDropped: 0,
  usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 17000, cache_creation_input_tokens: 0 },
  model: 'claude-haiku-4-5-20251001',
};

/* Drive one whole draft. `expert` is either a findings object, the string
   "fail", or a function given the route so a test can hold the reply open.
   `tools` is the login's own tool list, which is the boundary that decides
   whether the expert runs at all now that the admin gate is gone. */
async function draft(page, { role = 'admin', expert = EXPERT, query = '', note = NOTE, tools = ['bt'] } = {}) {
  const llm = [];
  const sent = [];

  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    llm.push(b);
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(note));
  });

  await page.route('**/api/expert-pass**', async (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}'));
    if (typeof expert === 'function') return expert(route);
    if (expert === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(expert) });
  });

  await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ['notes_auth_token', tokenFor(role, tools)]);
  await page.goto(PAGE + query);

  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i })
    .fill('elopement x2 with client Jacob, blocked and redirected, he wanted attention');
  await page.getByRole('button', { name: 'Generate Note' }).click();

  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();

  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
  return { llm, sent };
}

test.describe('the expert reads the same intake the draft was written from', () => {
  test('one call goes out, carrying the tool and the clinician own words', async ({ page }) => {
    const { sent } = await draft(page);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].tool).toBe('bt');
    // The clinician's own text, labelled by the field they typed it into. The
    // same body triage was given, so a disagreement between the two channels is
    // about the note rather than about what each of them read.
    expect(sent[0].intake).toContain('elopement x2');
    expect(sent[0].intake).toContain('two minute warning');
  });

  test('the name never crosses the wire, because the page scrubbed before either call', async ({ page }) => {
    const { sent, llm } = await draft(page);
    await expect.poll(() => sent.length).toBe(1);
    // "client Jacob" is a name with a role label in front of it. Whatever token
    // replaced it, the name itself is gone.
    expect(sent[0].intake).not.toContain('Jacob');
    // Two-sided: this is not a caller that sends nothing. The clinical words are
    // all still there, and the DRAFTING call was scrubbed by the same gate, so
    // the two are reading one text rather than two.
    expect(sent[0].intake).toContain('blocked and redirected');
    const drafting = llm.filter((b) => !isTriageCall(b));
    expect(drafting.length).toBeGreaterThan(0);
    expect(JSON.stringify(drafting)).not.toContain('Jacob');
  });

  test('the section ids come out of the responseSchema, never out of formSections', async ({ page }) => {
    const { sent } = await draft(page);
    await expect.poll(() => sent.length).toBe(1);
    const fromSchema = await page.evaluate(() => {
      const bt = (window.NOTE_TOOLS || []).filter((t) => t.id === 'bt')[0];
      return bt.responseSchema.properties.hints.items.properties.section.enum.filter((s) => s !== 'note');
    });
    expect(sent[0].sections).toEqual(fromSchema);
    // "note" is added by the Worker's schema builder; sending it too would put
    // the same value in the enum twice.
    expect(sent[0].sections).not.toContain('note');
  });
});

test.describe('both channels speak on the same note', () => {
  test('the expert findings land in the section they name, beside the catalog', async ({ page }) => {
    await draft(page, { note: { ...NOTE, hints: [{ section: 'behaviorPlanNarrative', code: 'no_rate_comparison', detail: '', rank: 1, kind: 'thin' }] } });
    // The expert's section finding.
    await expect(page.getByTestId('expert-behaviorPlanNarrative')).toBeVisible();
    await expect(page.getByTestId('expert-behaviorPlanNarrative')).toContainText('How long did each elopement last?');
    // And the catalog's, on the same section, still there.
    await expect(page.getByTestId('hints-behaviorPlanNarrative')).toBeVisible();
  });

  test('a whole-note finding sits above the grid rather than under the nearest heading', async ({ page }) => {
    await draft(page);
    await expect(page.getByTestId('expert-note')).toContainText('What was the prompt level');
  });

  test('the register findings quote the clinician back, which is what the catalog cannot do', async ({ page }) => {
    await draft(page);
    const reg = page.getByTestId('expert-register');
    await expect(reg).toBeVisible();
    await expect(reg).toContainText('he wanted attention');
    await expect(reg).toContainText('Say what happened and who responded.');
  });

  test('an empty register list reads as a finding, not as a broken call', async ({ page }) => {
    await draft(page, { expert: { ...EXPERT, register: [] } });
    await expect(page.getByTestId('expert-register-empty')).toBeVisible();
  });

  test('the abbreviations it resolved are shown with the reading it used', async ({ page }) => {
    await draft(page);
    await expect(page.getByTestId('expert-terms')).toContainText('Discrete Trial Training');
  });
});

test.describe('a second opinion never costs anyone a note', () => {
  test('the note arrives while the expert is still out', async ({ page }) => {
    let release;
    const held = new Promise((r) => { release = r; });
    const { sent } = await draft(page, {
      expert: async (route) => {
        await held;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EXPERT) });
      },
    });
    // draft() already waited for "Generated Note", so the note landed without
    // the pass. This is the assertion that fails if anyone ever awaits it.
    await expect(page.getByTestId('expert-running')).toBeVisible();
    await expect(page.getByTestId('expert-note')).toHaveCount(0);
    release();
    await expect(page.getByTestId('expert-note')).toContainText('What was the prompt level');
    expect(sent.length).toBe(1);
  });

  test('a failed pass says so rather than drawing an empty verdict', async ({ page }) => {
    await draft(page, { expert: 'fail' });
    await expect(page.getByTestId('expert-failed')).toBeVisible();
    // The note is untouched, which is the half that matters.
    await expect(page.getByText('Generated Note')).toBeVisible();
    await expect(page.locator('textarea[data-section-id="behaviorPlanNarrative"]')).toHaveValue(/Elopement occurred/);
  });
});

/* WIDENED ON 2026-08-26, so the first assertion here is inverted from what it
   said an hour earlier. It read "a technician never meets it", which was my
   scope call rather than his; he read the callout offering to widen it and
   answered in one word. What remains below is the boundary he did not lift. */
test.describe('who it runs for', () => {
  test('a technician gets it, on a tool their own login carries', async ({ page }) => {
    const { sent } = await draft(page, { role: 'user', expert: EXPERT });
    expect(sent).toHaveLength(1);
    await expect(page.getByTestId('expert-reading')).toBeVisible();
  });

  /* The boundary that survives the widening, and the reason the browser asks
     canUseTool rather than merely whether somebody is logged in: the route
     answers 403 to a login whose list does not carry this tool, so a looser
     gate would show the clinician a failed reading for a reason that was
     knowable before the call went out.

     ASSERTED AT THE GATE, not through a draft, and the first attempt at this
     test is why. Driving `draft()` with a non-covering login times out waiting
     for Generate Note, because such a login cannot reach the form at all - the
     page turns it away first. So a whole-draft test here would pass on the
     strength of a door that closed several steps earlier and would keep passing
     if the gate itself were removed. */
  test('the gate refuses a login whose tools do not carry this one', async ({ page }) => {
    await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ['notes_auth_token', tokenFor('user', ['sap'])]);
    await page.goto(PAGE);
    await page.waitForFunction(() => typeof window.expertEnabled === 'function');
    expect(await page.evaluate(() => window.expertEnabled('bt'))).toBe(false);
  });

  test('the gate admits a login whose tools do carry it, which is the half that changed', async ({ page }) => {
    await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ['notes_auth_token', tokenFor('user', ['bt'])]);
    await page.goto(PAGE);
    await page.waitForFunction(() => typeof window.expertEnabled === 'function');
    expect(await page.evaluate(() => window.expertEnabled('bt'))).toBe(true);
  });

  test('an admin still gets it, because widening added people rather than moving the gate', async ({ page }) => {
    const { sent } = await draft(page, { role: 'admin' });
    expect(sent).toHaveLength(1);
  });

  test('?expert=off gives the catalog alone, for a clean comparison', async ({ page }) => {
    const { sent } = await draft(page, { query: '?expert=off' });
    expect(sent).toHaveLength(0);
    await expect(page.getByTestId('expert-reading')).toHaveCount(0);
  });

  test('?expert=off holds for a technician too, not only for the person who set it up', async ({ page }) => {
    const { sent } = await draft(page, { role: 'user', query: '?expert=off' });
    expect(sent).toHaveLength(0);
  });
});
