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
    // 30 s, not 15: TUNING fix 2 slowed the thread to a readable pace (a typing
    // burst plus a length-scaled read dwell per message, ~12 s all in), and the
    // old ceiling sat close enough to that to flake.
    await expect.poll(() => logic(page, 'return L.state.threadStep;'), { timeout: 30000 }).toBe(total);
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

  /* ── TUNING fix 2 — the intro is a handset, paced to be read ──────────────
     Maintainer report: "bubbles floating on a plain square card", too fast to
     read, and the dots sat up permanently instead of announcing a message.  */

  test('TUNING 2 · the intro is a phone mockup — bezel, status bar, island, home bar', async ({ page }) => {
    const errors = await boot(page);
    await page.getByRole('button', { name: /^Start/ }).click();
    await expect(page.getByText('Booking the glam team')).toBeVisible();

    // The device chrome, not a card: a bezel with a screen inset in it…
    await expect(page.locator('.gtm-phone')).toBeVisible();
    await expect(page.locator('.gtm-phone > .gtm-screen')).toBeVisible();
    // …a status bar with an island and drawn signal / wifi / battery glyphs…
    await expect(page.locator('.gtm-screen > .gtm-statusbar')).toBeVisible();
    await expect(page.locator('.gtm-statusbar .gtm-island')).toBeVisible();
    for (const glyph of ['.gtm-sig', '.gtm-wifi', '.gtm-batt']) {
      await expect(page.locator(`.gtm-statusbar ${glyph}`)).toBeVisible();
    }
    // …and a home indicator under the app.
    await expect(page.locator('.gtm-screen > .gtm-home')).toBeVisible();

    // The thread lives INSIDE the screen — the phone is the frame, not decoration.
    expect(await page.locator('.gtm-screen .gtm-scroll').count()).toBe(1);

    // §8 holds on the new chrome: a real clock would print digits, so the
    // status bar draws everything except the carrier word.
    expect(await page.locator('.gtm-statusbar').innerText()).not.toMatch(/\d/);

    // The bezel is a phone shape, and it does not push the page sideways.
    const box = await page.locator('.gtm-phone').boundingBox();
    expect(box.height / box.width, 'a handset is taller than it is wide').toBeGreaterThan(1.2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('TUNING 2 · a brief typing indicator announces BOTH sides, then blinks out', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: /^Start/ }).click();
    await expect(page.getByText('Booking the glam team')).toBeVisible();

    /* Sample the thread while it plays: which side the dots sat on, whether
       they ever went away between messages, and when each message landed. */
    const samples = [];
    const t0 = Date.now();
    for (;;) {
      samples.push({
        t: Date.now() - t0,
        ...(await page.evaluate(() => {
          const row = [...document.querySelectorAll('.gtm-scroll > div')].find((r) => r.querySelector('.gtm-dot'));
          return {
            side: row ? getComputedStyle(row).justifyContent : '',
            skip: [...document.querySelectorAll('button')].some((b) => /Skip ahead/.test(b.textContent)),
            done: /Appointment booked/.test(document.body.innerText),
          };
        })),
      });
      if (samples[samples.length - 1].done || Date.now() - t0 > 40000) break;
      await page.waitForTimeout(90);
    }

    const sides = new Set(samples.map((s) => s.side).filter(Boolean));
    expect([...sides].sort(), 'the client types on the left AND the glam team types on the right')
      .toEqual(['flex-end', 'flex-start']);

    // BRIEF: the dots are an announcement, not furniture — they are down for a
    // real stretch of the run while the message that just landed is read.
    const running = samples.filter((s) => !s.done);
    const quiet = running.filter((s) => !s.side).length;
    expect(quiet / running.length, 'the dots must blink out between messages').toBeGreaterThan(0.35);

    // …and "Skip ahead" stays reachable the whole time, dots or no dots.
    for (const s of running) expect(s.skip).toBe(true);
  });

  test('TUNING 2 · at phone size the full thread stays scrollable and pinned to the newest message', async ({ page }) => {
    await boot(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await bookAppointment(page);

    const box = await page.evaluate(() => {
      const el = document.getElementById('gtm-thread');
      return { scrollH: el.scrollHeight, clientH: el.clientHeight, top: el.scrollTop };
    });
    // Five messages do not fit a handset — which is the case that matters.
    expect(box.scrollH, 'the full thread should overflow the screen at 390 px').toBeGreaterThan(box.clientH);
    // Pinned to the bottom, the way a messages app is.
    expect(box.scrollH - (box.top + box.clientH), 'the newest message must be in view').toBeLessThanOrEqual(2);
    // …and the top is REACHABLE. `justify-content:flex-end` bottom-anchors just
    // as well but clips the overflow off the top of a scroller for good.
    await page.evaluate(() => { document.getElementById('gtm-thread').scrollTop = 0; });
    await expect(page.getByText('Today', { exact: true })).toBeInViewport();
    await expect(page.getByText(/^Hi glam team!/)).toBeInViewport();
  });

  test('TUNING 2 · the thread is paced to be read, not fired off', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: /^Start/ }).click();

    // When each message landed, sampled off the component's own reveal counter.
    const landed = [];
    const t0 = Date.now();
    let step = 0;
    let total = 0;
    for (;;) {
      const s = await logic(page, 'return {step:L.state.threadStep, total:(L.state.thread&&L.state.thread.messages.length)||0};');
      total = s.total;
      while (step < s.step) { landed.push(Date.now() - t0); step++; }
      if (total && step >= total) break;
      expect(Date.now() - t0, 'the thread should finish well inside 30 s').toBeLessThan(30000);
      await page.waitForTimeout(80);
    }

    const gaps = landed.slice(1).map((t, i) => t - landed[i]);
    // The old build fired one bubble every 900 ms flat. Every gap now carries a
    // typing burst AND a read dwell, so none of them may be that quick again.
    expect(Math.min(...gaps), `message gaps: ${gaps.join(', ')}`).toBeGreaterThan(1400);
    // …but the whole booking still has to be over in a sitting.
    expect(landed[landed.length - 1]).toBeLessThan(20000);
    expect(landed.length).toBe(total);
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

  /* TUNING fix 1 — the child must not see a model picker. The stage used to carry
     M2/M3/M4 chips in its top-right corner, which let a child swap the client's
     face mid-appointment: it contradicts the pretext (this client texted in and
     booked THIS appointment) and it is a clinical knob on a child-facing surface.
     Random-at-Start + the BT's Character lock are the only two routes left, and
     both are covered by the two tests above. What is left to pin is the absence. */
  test('TUNING · the child surface offers no model picker, and none is reachable in code', async ({ page }) => {
    const errors = await boot(page);
    await bookAppointment(page);
    await page.getByRole('button', { name: /Open the salon/ }).click();
    await expect(page.getByRole('button', { name: /Go —/ })).toBeVisible();

    // No model chip, on the salon surface or anywhere else on the page. The old
    // chips were <button>s labelled with the bare model id, upper-cased.
    await expect(page.getByRole('button', { name: /^M\d$/ })).toHaveCount(0);

    /* …and no leftover setter. A picker deleted from the template but left on the
       component is one `sc-for` away from coming back, so the guarantee is that
       nothing outside the draw can write `state.model` at all. */
    const api = await logic(page, `
      return { setter:typeof L.setArtModel, list:typeof L.artModelList, gate:typeof L.artGated };
    `);
    expect(api).toEqual({ setter: 'undefined', list: 'undefined', gate: 'undefined' });
    expect(errors).toEqual([]);
  });

  test('TUNING · the client drawn at Start stays fixed for the whole session', async ({ page }) => {
    await boot(page);
    await bookAppointment(page);
    await page.getByRole('button', { name: /Open the salon/ }).click();
    await page.getByRole('button', { name: /Go —/ }).click();

    const drawn = await logic(page, 'return L.state.sel.model;');

    // Play some of the appointment through the real UI, then re-read the face.
    await page.getByRole('button', { name: /Shape brows/ }).click();
    await page.locator('div[style*="gtm-target"]').first().click();
    await expect(page.locator('[style*="gtm-mirror-"]')).toBeVisible();

    const still = await logic(page, 'return {painted:L.state.model, sel:L.state.sel.model};');
    expect(still).toEqual({ painted: drawn, sel: drawn });
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
