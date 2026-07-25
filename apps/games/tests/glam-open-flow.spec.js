import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — the opening flow the refresh introduces:
 *
 *   title screen  →  Start  →  a randomly-drawn client texts in and books an
 *   appointment   →  the salon opens onto the vanity.
 *
 * The clinical spine is untouched by all of this: `window.GlamTT` still receives
 * its actions and its completion exactly as before, and the trial only exists
 * once the salon opens. What these tests pin is the WRAPPER — that the child's
 * route in is one tap, that the BT's setup is reachable but not in the child's
 * way, that the pretext really arrives as a message thread, and that every new
 * child-facing string is swept by the same congruence guard as the outro
 * (AC-10 / §3.7.1: no refutable claim about the client, no numbers, no PHI).
 */

/** Evaluate `src` with `L` bound to the component and `T` to its live Trial. */
function logic(page, src) {
  return page.evaluate(({ src }) => {
    let f = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (k) { f = el[k]; break; }
    }
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    const L = f.stateNode.logic;
    return new Function('L', 'T', src)(L, L._trial);
  }, { src });
}

async function boot(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await expect(page.getByRole('button', { name: /^Start/ })).toBeVisible();
  return errors;
}

/** The one <section> on screen during the title / texting screens. */
const screen = (page) => page.locator('section').first();

/** Start, then jump the thread to the booked state without waiting it out. */
async function bookAppointment(page) {
  await page.getByRole('button', { name: /^Start/ }).click();
  await expect(page.getByText('Booking the glam team')).toBeVisible();
  await page.getByRole('button', { name: 'Skip ahead' }).click();
  await expect(page.getByRole('button', { name: /Open the salon/ })).toBeVisible();
}

test.describe('opening flow — title → texts → salon', () => {
  test('the front door is a title screen with Start, and the clinical setup is not in the way', async ({ page }) => {
    const errors = await boot(page);

    await expect(page.getByText('Makeover', { exact: true })).toBeVisible();
    await expect(page.getByText(/The salon is open/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Start/ })).toBeVisible();

    // The BT's setup strip is collapsed: no dropdowns, no ▶ Play, and above all
    // no character dropdown — the client is drawn at random for the child (D-F).
    await expect(page.getByLabel('Character', { exact: true })).toBeHidden();
    await expect(page.getByLabel('Turns', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: /^▶ Play/ })).toBeHidden();

    // …but it is one affordance away, from the title screen itself.
    await page.getByRole('button', { name: /Session setup/ }).click();
    await expect(page.getByLabel('Character', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Turns', { exact: true })).toBeVisible();

    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('Start plays the pretext as an incoming text thread and ends with the appointment booked', async ({ page }) => {
    const errors = await boot(page);
    await page.getByRole('button', { name: /^Start/ }).click();

    // A contact header, then bubbles arriving one at a time — a thread, not a card.
    await expect(page.getByText('Booking the glam team')).toBeVisible();
    await expect(page.getByText(/^Hi glam team!/)).toBeVisible();
    await expect(page.locator('.gtm-dot').first(), 'the next message should be typing').toBeVisible();

    const total = await logic(page, 'return L.state.thread.messages.length;');
    expect(total).toBeGreaterThanOrEqual(4);

    // Both sides of the conversation: the client asks, the glam team answers.
    await expect.poll(() => logic(page, 'return L.state.threadStep;'), { timeout: 15000 }).toBe(total);
    await expect(page.getByText(/The glam team just picked up/)).toBeVisible();
    await expect(page.getByText(/You are booked/)).toBeVisible();
    await expect(page.locator('.gtm-dot'), 'nobody is still typing once it is booked').toHaveCount(0);
    await expect(page.getByText(/Appointment booked/)).toBeVisible();

    // …and the salon opens onto the real game surface.
    await page.getByRole('button', { name: /Open the salon/ }).click();
    await expect(page.getByRole('button', { name: /Go —/ })).toBeVisible();
    await expect(page.getByText(/MY TURN/)).toBeVisible();

    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('"Skip ahead" lands every message at once', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: /^Start/ }).click();
    await expect(page.getByText('Booking the glam team')).toBeVisible();
    await page.getByRole('button', { name: 'Skip ahead' }).click();

    const st = await logic(page, 'return {step:L.state.threadStep, total:L.state.thread.messages.length};');
    expect(st.step).toBe(st.total);
    await expect(page.getByRole('button', { name: 'Skip ahead' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Open the salon/ })).toBeVisible();
  });

  test('the client who texts in is the client who sits down at the vanity', async ({ page }) => {
    await boot(page);
    await bookAppointment(page);

    const before = await logic(page, 'return {name:L.state.sel.name, model:L.state.sel.model, event:L.state.sel.eventId};');
    // The name on the thread's contact header is that client's, not a second draw.
    await expect(page.getByText(before.name, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Open the salon/ }).click();
    await expect(page.getByRole('button', { name: /Go —/ })).toBeVisible();

    const after = await logic(page, 'return {name:L.state.sel.name, model:L.state.sel.model, event:L.state.sel.eventId, painted:L.state.model};');
    expect(after, 'opening the salon must not silently re-roll the client').toMatchObject(before);
    expect(after.painted).toBe(before.model);
  });

  test('D-F · Start draws a random client, and never the retired M1', async ({ page }) => {
    await boot(page);
    // Drive the real Start path repeatedly rather than the story module directly,
    // so the assertion covers the wiring (`charLock` → draw → thread), not just
    // `GlamStory.draw`.
    const out = await logic(page, `
      const names = new Set(), models = new Set(), events = new Set();
      for (let i = 0; i < 40; i++) {
        L.beginIntro();
        names.add(L.state.sel.name); models.add(L.state.sel.model); events.add(L.state.sel.eventId);
      }
      L.threadSkip();
      return { names:[...names], models:[...models], events:[...events], roster: window.GlamStory.MODELS };
    `);
    expect(out.names.length, 'the client name should vary').toBeGreaterThan(1);
    expect(out.models.length, 'the face model should vary').toBeGreaterThan(1);
    expect(out.events.length, 'the scenario should vary').toBeGreaterThan(1);
    expect(out.models).not.toContain('m1');
    expect(out.models.sort()).toEqual([...out.roster].sort());
  });

  test('the BT character lock still pins the client through the new flow', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: /Session setup/ }).click();
    await page.getByLabel('Character', { exact: true }).selectOption('m3');

    const drawn = await logic(page, `
      const seen = new Set();
      for (let i = 0; i < 20; i++) { L.beginIntro(); seen.add(L.state.sel.model); }
      L.threadSkip();
      return [...seen];
    `);
    expect(drawn).toEqual(['m3']);
  });

  test('AC-10 · every string the texting intro can put on screen is swept by the congruence guard', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      const S = window.GlamStory;
      const all = S.allStrings();
      return {
        violations: S.congruenceViolations(),
        threadStrings: all.filter((x) => /\/thread\//.test(x.where)).length,
        threadWithDigits: all.filter((x) => /\/thread\//.test(x.where) && /\d/.test(x.s)).map((x) => x.where),
        // the guard has to be live over the new pool, not merely pointed at it
        catches: S.BANNED.filter((re) => re.test('Hi glam team! My hair is frizzy and I have 2 spots.')).length,
      };
    });

    // 6 events × 12 names × (5 bubbles + the booked note)
    expect(out.threadStrings).toBe(6 * 12 * 6);
    expect(out.threadWithDigits).toEqual([]);
    expect(out.violations, JSON.stringify(out.violations, null, 2)).toEqual([]);
    expect(out.catches).toBeGreaterThanOrEqual(3);
  });

  test('§8 · the opening flow shows no number to the child and offers nowhere to type', async ({ page }) => {
    await boot(page);

    // Title screen: no text entry, and nothing numeric in the child's copy.
    expect(await screen(page).locator('input, textarea, [contenteditable="true"]').count()).toBe(0);
    expect(await screen(page).innerText()).not.toMatch(/\d/);

    await bookAppointment(page);
    expect(await screen(page).locator('input, textarea, [contenteditable="true"]').count()).toBe(0);
    const thread = await screen(page).innerText();
    expect(thread, 'the thread must carry no numbers').not.toMatch(/\d/);
    for (const word of ['prompted', 'independent', 'forfeit', 'tier', 'trial']) {
      expect(thread.toLowerCase(), `"${word}" must never appear on the child's screen`).not.toContain(word);
    }
  });

  test('"Play again" returns to the front door so the next run opens the same way', async ({ page }) => {
    await boot(page);
    await bookAppointment(page);
    await page.getByRole('button', { name: /Open the salon/ }).click();
    await expect(page.getByRole('button', { name: /Go —/ })).toBeVisible();

    await logic(page, 'L.endTrial(); return null;');
    await expect(page.getByRole('button', { name: /Play again/ })).toBeVisible();
    await page.getByRole('button', { name: /Play again/ }).click();

    await expect(page.getByRole('button', { name: /^Start/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^▶ Play/ })).toBeHidden();
  });
});
