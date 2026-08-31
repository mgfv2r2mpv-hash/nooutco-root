import { test, expect } from '@playwright/test';
import { serverPromptRequest, serverPromptTools, promptKeyFor } from '../_worker.js';

/* Triage is a call too, and the migration forgot it.
 *
 * WHAT WENT WRONG. Moving a tool's prompt into the store made the Worker refuse
 * any /api/llm-call for that tool carrying `system` or `systemPrompt`, which is
 * right: accepting one would leave the hole open for anyone still sending the
 * old shape. But the note is not the only call the engine makes. Before it
 * drafts, it runs triage - "is anything here too thin to write from" - and that
 * call built its own system prompt in the browser and sent it, unconditionally.
 *
 * So from the day sup migrated, sup triage got a 400. The engine catches it on
 * purpose, because triage is an assist and losing a question is smaller than
 * refusing to draft for a technician with eight notes left. The note still came
 * out. What was lost was the gap questions, and the readiness number the skip
 * cooldown runs on, and the audit recorded asked:0 - which reads exactly like a
 * session where nothing was missing.
 *
 * WHY THE SUITE MISSED IT. Every spec that drives triage - triage-rounds,
 * bt-assistant, ask-the-bcba - routes '**\/api\/llm-call**' in the browser and
 * answers it from the test. The Worker's refusal never runs, so a request shape
 * the Worker rejects looks identical to one it accepts.
 *
 * So this spec captures the request the browser actually builds and hands it to
 * the Worker's own gate. No interception in the middle, no second copy of the
 * rule to drift.
 */

const tokenFor = (tools) => {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
};

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

// The first call the engine makes after Generate is triage. It is the only one
// whose reply carries `sufficient`, so answering every call with that shape is
// enough to get the first body out and stop.
async function captureFirstCall(page, { path, toolId, fill }) {
  const bodies = [];
  await page.route('**/api/llm-call**', async (route) => {
    bodies.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill(reply({ sufficient: true, readiness: 90, questions: [] }));
  });

  await page.goto(path);
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor([toolId]));
  await page.goto(path);
  await fill(page);
  await page.getByRole('button', { name: /Generate/i }).first().click();

  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();

  await expect.poll(() => bodies.length, { timeout: 10000 }).toBeGreaterThan(0);
  return bodies[0];
}

const FILL_BCBA = (label, text) => async (page) => {
  await page.getByRole('textbox', { name: label }).first().fill(text);
};

const FILL_BT = async (page) => {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, two minute warning');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked and redirected');
};

test.describe('the triage call obeys the same rule the note call does', () => {
  test('bt triage is a request the Worker accepts', async ({ page }) => {
    const body = await captureFirstCall(page, { path: '/notes/bt/', toolId: 'bt', fill: FILL_BT });

    // It really is the triage call and not the draft.
    expect(JSON.stringify(body.messages || []), 'the captured call should be triage').toMatch(/RAW NOTES/i);

    const gate = serverPromptRequest(body, 'bt');
    expect(gate.serverSide, 'bt is migrated, so the Worker composes its prompt').toBe(true);
    expect(
      gate.error,
      'the browser sent a shape the Worker refuses, so triage returns 400 and the engine swallows it: ' +
      'no gap questions, no readiness, and an audit that records asked:0'
    ).toBeUndefined();
  });

  test('no migrated tool sends a system prompt on any call', async ({ page }) => {
    // Written as a roster rather than as one test per tool, so the next
    // migration is covered the moment its id lands in SERVER_PROMPT_TOOLS.
    // Every migrated tool is driven now. assess, parent and sap share the bcba
    // page and are selected with ?tool=, which is how the page picks one.
    const PAGES = {
      bt: { path: '/notes/bt/', fill: FILL_BT },
      assess: {
        path: '/notes/bcba/index.html?tool=assess',
        fill: FILL_BCBA(/Summary Notes of Activities/i, 'ran the VB-MAPP milestones, mand level 2, sat for 20 minutes'),
      },
      parent: {
        path: '/notes/bcba/index.html?tool=parent',
        fill: FILL_BCBA(/Session Notes/i, 'worked on requesting with the picture cards, 6 of 10 independent'),
      },
      sap: {
        path: '/notes/bcba/index.html?tool=sap',
        fill: FILL_BCBA(/Treatment Goal/i, 'client will request a preferred item using a full sentence, 80% across 3 sessions'),
      },
    };
    for (const toolId of serverPromptTools()) {
      const spec = PAGES[toolId];
      // sup and the rest are driven by their own specs; this one owns the tools
      // it can fill. A tool with no entry here is skipped loudly rather than
      // quietly passing.
      test.info().annotations.push({ type: 'triage-roster', description: `${toolId}: ${spec ? 'driven' : 'NOT DRIVEN - add a filler'}` });
      if (!spec) continue;
      const body = await captureFirstCall(page, { path: spec.path, toolId, fill: spec.fill });
      expect(typeof body.system, `${toolId} still builds a system prompt in the browser`).not.toBe('string');
      expect(typeof body.systemPrompt, `${toolId} still builds a systemPrompt in the browser`).not.toBe('string');
    }
  });
});

/* SAP TRIAGE ASKS FOR SAP'S PROMPT, and this is the only test that watches the
   wire rather than the source.
 *
 * server-prompt.spec.js proves sap.js declares the key and the Worker knows it.
 * Neither of those proves the engine actually SENDS it: the ternary in
 * triageSystemFor could fall back to "triage" and every source-level assertion
 * would still be green. So this drives a real SAP turn and reads what left the
 * browser. */
test.describe('sap triage asks for its own stored prompt', () => {
  test('the SAP triage call names sap_triage and carries no prompt text', async ({ page }) => {
    const body = await captureFirstCall(page, {
      path: '/notes/bcba/index.html?tool=sap',
      toolId: 'sap',
      fill: FILL_BCBA(/Treatment Goal/i, 'client will request a preferred item using a full sentence, 80% across 3 sessions'),
    });

    expect(body.prompt_kind, 'SAP triage fell back to the generic prompt').toBe('sap_triage');
    expect(typeof body.system, 'a migrated tool must send no prompt text').not.toBe('string');
    expect(typeof body.systemPrompt).not.toBe('string');

    // And the Worker accepts that exact body, which is the half the browser
    // cannot tell you. A kind it does not know is refused, the engine's catch
    // swallows it, and the clinician silently loses the gap questions.
    const gate = serverPromptRequest(body, 'sap');
    expect(gate.serverSide).toBe(true);
    expect(gate.error, 'the Worker refused the body the browser actually sent').toBeUndefined();
    expect(promptKeyFor('sap', gate.kind), 'the store would be asked for the wrong key').toBe('sap_triage');
  });
});
