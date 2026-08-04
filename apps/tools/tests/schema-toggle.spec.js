import { test, expect } from '@playwright/test';

// ?schema=off drops SAP back to the model hand-writing its own JSON - which is
// not a new mode, it is exactly what production shipped before the schema. It
// exists so the constrained and unconstrained drafts can be generated in one
// deployment, minutes apart, on the same login: without it an A/B depends on
// capturing a baseline from prod BEFORE merging, and that baseline cannot be
// recovered once the merge has happened.
//
// Admin-only so a clinician can never land on it by accident. That gate is
// NotesGate.isAdmin(), which decodes the session token in the browser without
// verifying its signature - a UI control, not a security boundary. It does not
// need to be one: the only thing the flag can do is select the behaviour
// production already had, so a bypass gains nothing.

// A token is `<base64url payload>.<sig>`; tokenPayload() decodes the payload and
// never checks the signature, so a payload alone is enough to drive isAdmin().
function tokenFor(role) {
  const payload = { role, exp: Math.floor(Date.now() / 1000) + 3600, tools: ['sap'] };
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}

// Returns the body the browser posted to /api/llm-call for a SAP turn, driving
// the gate exactly as engine.jsx's runTurn does.
async function requestBodyFor(page, { role, search }) {
  let body = null;
  await page.route('**/api/llm-call**', async (route) => {
    body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/notes/bcba/index.html?tool=sap');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
  await page.goto('/notes/bcba/index.html?tool=sap' + search);
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length && window.schemaDisabled));

  await page.evaluate(async () => {
    const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
    await window.NotesGate.generateConversation({
      system: sap.buildSystem(),
      messages: [{ role: 'user', content: 'x' }],
      tool: sap.id,
      responseSchema: window.schemaDisabled() ? null : (sap.responseSchema || null),
    }).catch(() => {});
  });
  return body;
}

test.describe('admin ?schema=off toggle', () => {
  test('an admin with ?schema=off generates unconstrained', async ({ page }) => {
    const body = await requestBodyFor(page, { role: 'admin', search: '&schema=off' });

    expect('output_config' in body, 'schema=off did not disable the constraint').toBe(false);
  });

  test('the same admin without the flag generates constrained', async ({ page }) => {
    // Pins that the test above proves the FLAG, not a broken schema wiring.
    const body = await requestBodyFor(page, { role: 'admin', search: '' });

    expect(body.output_config).toBeTruthy();
    expect(body.output_config.format.type).toBe('json_schema');
  });

  test('a non-admin cannot reach it - the flag is ignored', async ({ page }) => {
    const body = await requestBodyFor(page, { role: 'user', search: '&schema=off' });

    expect(body.output_config, 'a clinician was able to turn the schema off').toBeTruthy();
  });

  test('a logged-out visitor cannot reach it either', async ({ page }) => {
    let body = null;
    await page.route('**/api/llm-call**', async (route) => {
      body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/notes/bcba/index.html?tool=sap&schema=off');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length && window.schemaDisabled));
    await page.evaluate(async () => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      await window.NotesGate.generateConversation({
        system: 'sys',
        messages: [{ role: 'user', content: 'x' }],
        tool: 'sap',
        responseSchema: window.schemaDisabled() ? null : sap.responseSchema,
      }).catch(() => {});
    });

    expect(body.output_config).toBeTruthy();
  });

  test('an admin running unconstrained is told so on screen', async ({ page }) => {
    // The whole point is comparing two tabs. A tab that does not say which mode
    // it is in invites mislabelling the very samples the toggle exists to
    // produce, so the state has to be visible rather than inferred from the URL.
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor('admin'));

    await page.goto('/notes/bcba/index.html?tool=sap&schema=off');
    await expect(page.getByText(/schema off/i)).toBeVisible();

    // ...and an ordinary constrained session shows nothing.
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    await expect(page.getByText(/schema off/i)).toHaveCount(0);
  });
});
