import { test, expect } from '@playwright/test';

// Every door that sends note text off the page must tokenise identifiers
// first, even when the caller forgot to scrub. Made-up fixtures only.
// scrub-test.html loads notes-gate.js without React, so this stays fast.

const RAW = {
  phone: '(555) 213-4477',
  address: '1420 Maple Street',
  date: 'March 14',
  fullDate: 'September 3, 2026',
  email: 'parent.name@example.com',
  ssn: '123-45-6789',
  mrn: 'A8842213',
};
const TEXT = `Call ${RAW.phone}, visit ${RAW.address} on ${RAW.date}, due ${RAW.fullDate}, `
  + `write ${RAW.email}, SSN ${RAW.ssn}, MRN: ${RAW.mrn}.`;

function expectClean(body) {
  const s = JSON.stringify(body);
  for (const [kind, raw] of Object.entries(RAW)) {
    expect(s, `${kind} left the page raw`).not.toContain(raw);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/scrub-test.html');
  await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.generateConversation && window.NotesGate.outbound));
  await page.evaluate(() => localStorage.setItem('notes_auth_token', 'test-token'));
});

async function capture(page, urlGlob, respond, run) {
  const bodies = [];
  await page.route(urlGlob, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respond) });
  });
  await page.evaluate(run, TEXT);
  return bodies;
}

const NOTE = { content: [{ type: 'text', text: '{"a":"b"}' }], usage: {}, stop_reason: 'end_turn' };

test('generateConversation (drafts, revisions) tokenises messages', async ({ page }) => {
  const bodies = await capture(page, '**/api/llm-call**', NOTE, (t) =>
    window.NotesGate.generateConversation({ system: 's', messages: [{ role: 'user', content: t }], tool: 'sup' }).catch(() => null));
  expect(bodies.length).toBeGreaterThan(0);
  expectClean(bodies);
  expect(JSON.stringify(bodies)).toMatch(/\[PHONE_R1\]/);
  expect(JSON.stringify(bodies)).toMatch(/\[DATE_R\d\]/);
});

test('generateNote tokenises userPrompt', async ({ page }) => {
  const bodies = await capture(page, '**/api/llm-call**', NOTE, (t) =>
    window.NotesGate.generateNote({ systemPrompt: 's', userPrompt: t, tool: 'sup' }).catch(() => null));
  expect(bodies.length).toBeGreaterThan(0);
  expectClean(bodies);
});

test('generateProse (advice) tokenises messages', async ({ page }) => {
  const bodies = await capture(page, '**/api/llm-call**', NOTE, (t) =>
    window.NotesGate.generateProse({ system: 's', messages: [{ role: 'user', content: t }], tool: 'sup' }).catch(() => null));
  expect(bodies.length).toBeGreaterThan(0);
  expectClean(bodies);
});

test('expertPass tokenises the intake', async ({ page }) => {
  const bodies = await capture(page, '**/api/expert-pass**', { hints: [] }, (t) =>
    window.NotesGate.expertPass({ tool: 'sup', intake: t, sections: [] }));
  expect(bodies.length).toBe(1);
  expectClean(bodies);
});

test('correctionsPass tokenises intake, draft, asks and heldOut', async ({ page }) => {
  const bodies = await capture(page, '**/api/corrections-pass**', { corrections: [] }, (t) =>
    window.NotesGate.correctionsPass({ tool: 'sup', intake: t, draft: [{ section: 'x', text: t }], asks: [{ about: t, text: t }], heldOut: [t] }));
  expect(bodies.length).toBe(1);
  expectClean(bodies);
  expect(bodies[0].draft[0].section).toBe('x');
});

test('graph reader context (outbound helper) tokenises', async ({ page }) => {
  const out = await page.evaluate((t) => window.NotesGate.outbound(t), TEXT);
  expectClean(out);
});

test('a token the engine already issued is left alone and net tokens never collide with it', async ({ page }) => {
  const out = await page.evaluate(() => window.NotesGate.outbound('See [PHONE_1] and 555-213-4477 and [DATE_1] on Feb 9th'));
  expect(out).toContain('[PHONE_1]');
  expect(out).toContain('[DATE_1]');
  expect(out).toMatch(/\[PHONE_R\d\]/);
  expect(out).toMatch(/\[DATE_R\d\]/);
});
