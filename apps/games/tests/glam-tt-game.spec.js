import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — the hardened criteria AS PLAYED, through the real game
 * surface.
 *
 * tests/glam-tt-scoring.spec.js proves the measurement engine implements the
 * rules; this file proves the SCREENS are wired to that engine — that a BT who
 * opens the game and plays it gets the hardened behaviour rather than the
 * pre-redesign turn loop. Every assertion here comes from driving real buttons.
 *
 * Authority: docs/glam-team-makeover-redesign-hardened-claims.md (AC-1…AC-27).
 * Where a criterion exists to close a specific attack from the adversarial
 * review, that attack's id (A5/B2/B3/C1/C2/D1/E1/F1/G1) is named — please do not
 * relax an assertion without re-reading the attack it descends from.
 */

/* The component instance, reached through the React fiber. The game mounts a
   vendored React + design-canvas runtime and exposes no test hook, so the fiber
   walk (documented in docs/eval/glam-team-makeover-playtest.md) is how a spec
   reads what the engine actually scored. Anchored on "the first element that has
   a fiber" rather than a specific node, because the game screen unmounts on the
   done screen. */
const FIBER = `
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const L = f && f.stateNode.logic;
`;

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

/** Boot the game and start collecting console/page errors. */
async function boot(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  return errors;
}

/** Set the BT settings by their accessible names, then start the trial.
    The refresh put the child's title screen in front and collapsed the setup
    strip behind the ⚙, so a BT-driven start opens it first. This is the
    clinician's route in — it starts the trial directly and skips the child's
    texting intro, which tests/glam-open-flow.spec.js covers on its own. */
async function start(page, cfg = {}) {
  await ensureSetupOpen(page);
  const defaults = { Routine: 'free', Turns: '10', 'Their turn': 'count', Wait: '2' };
  for (const [label, value] of Object.entries({ ...defaults, ...cfg })) {
    await page.getByLabel(label, { exact: true }).selectOption(value);
  }
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await expect(page.getByRole('button', { name: /Go —/ })).toBeVisible();
}

async function goMyTurn(page) {
  await page.getByRole('button', { name: /Go —/ }).click();
  await expect(page.getByRole('button', { name: /Done — their turn/ })).toBeVisible();
}

/** Tap a palette tool and, if it arms a target zone, apply it — one charged action.
    Addressed by `title`, because a tool whose effect is already on the doll grows
    a "✓ " prefix on its visible label. */
async function useTool(page, name) {
  await page.getByTitle(name, { exact: true }).first().click();
  const target = page.locator('div[style*="gtm-target"]').first();
  if (await target.count()) await target.click();
}

/** Re-open the BT settings strip, which collapses when the trial starts. */
async function openSettings(page) {
  await page.getByTitle('Show / hide setup').click();
}

/** Open the setup strip only if it is closed — the ⚙ is a toggle, and the strip
    now starts collapsed behind the child's title screen. */
async function ensureSetupOpen(page) {
  const turns = page.getByLabel('Turns', { exact: true });
  if (!(await turns.isVisible())) await openSettings(page);
  await expect(turns).toBeVisible();
}

/** Give-back = "they forget": wait out the staff-idle onset, then mand. Closes
    the partner's turn without needing anyone to take it. */
async function askBack(page) {
  await expect.poll(() => logic(page, 'return T.turn && T.turn.onsetAt != null'), { timeout: 9000 }).toBe(true);
  await page.getByRole('button', { name: /I asked/ }).click();
}

/** Four one-tap tools that Free play always offers and that charge distinct keys. */
const TOOLS = ['Eyeliner', 'Mascara', 'Lip liner', 'Shape brows'];

test.describe('game surface — over-cap feedback (D-B)', () => {
  test('AC-3 (B2) · an over-cap tap is refused with GENTLE kid feedback even in count-HIDDEN mode', async ({ page }) => {
    const errors = await boot(page);
    // Count hidden is the mode where the old build was silent: 0 of 43 tools said
    // anything at the cap, which is eval defect 2. Turns=10 → a 4-action budget.
    await start(page, { 'My turn': 'hidden' });
    await goMyTurn(page);
    expect(await logic(page, 'return T.turn.budget')).toBe(4);

    for (const tool of TOOLS) await useTool(page, tool);
    expect(await logic(page, 'return T.turn.actions')).toBe(4);

    // A fifth distinct tool is over the cap.
    await page.getByTitle('Brow pencil', { exact: true }).first().click();

    const toast = page.getByText(/That was everything for this turn/);
    await expect(toast, 'the child is told, in hidden mode too').toBeVisible();

    // Gentle, not an error: no red, and no clinical vocabulary on the child's screen.
    const style = await toast.evaluate((el) => getComputedStyle(el).color + '|' + getComputedStyle(el).backgroundColor);
    expect(style, 'feedback must not be a red error').not.toMatch(/rgb\(2[0-9]{2}, [0-5][0-9]?, /);
    const body = await page.evaluate(() => document.body.innerText);
    for (const word of ['prompted', 'independent', 'forfeit', 'over-cap', 'violation']) {
      expect(body.toLowerCase(), `"${word}" must never appear on the child's screen`).not.toContain(word);
    }

    // …and the violation really is logged, with the prompt delivered (D-B).
    expect(await logic(page, 'const t=T.turn; return {over:t.overCap, forfeit:t.forfeit, cue:t.cueAt!=null}'))
      .toEqual({ over: 1, forfeit: 'overcap', cue: true });
    expect(errors).toEqual([]);
  });

  test('AC-23 (E1) · the over-cap forfeit is TURN-DURABLE — a resume action cannot launder it', async ({ page }) => {
    await boot(page);
    await start(page);
    await goMyTurn(page);

    for (const tool of TOOLS) await useTool(page, tool);
    await page.getByTitle('Brow pencil', { exact: true }).first().click();
    expect(await logic(page, 'return T.turn.forfeit')).toBe('overcap');

    // Re-touch an ALREADY-CHARGED article: a legal, free action mid-turn. In the
    // pre-hardening model any resume cleared the cue and handed back `independent`.
    await useTool(page, 'Eyeliner');
    expect(await logic(page, 'return T.turn.forfeit'), 'a free re-touch must not clear the forfeit').toBe('overcap');

    await page.getByRole('button', { name: /Done — their turn/ }).click();
    expect(await logic(page, 'return T.turns[0].passScore')).toBe('prompted@full');
  });
});

test.describe('game surface — pass scoring (D-A)', () => {
  test('AC-19 (B3) · an early pass with the budget unspent scores independent, and records what was left', async ({ page }) => {
    await boot(page);
    await start(page);
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');   // 1 of 4 — the budget is a CAP, not a quota

    await page.getByRole('button', { name: /Done — their turn/ }).click();
    expect(await logic(page, `
      const t = T.turns[0];
      return { score: t.passScore, used: t.actions, budget: t.budget };
    `)).toEqual({ score: 'independent', used: 1, budget: 4 });
  });

  test('AC-20 (C2) · a 0-action pass scores no-engagement, never independent, and cannot reach Tier 1', async ({ page }) => {
    await boot(page);
    await start(page, { Turns: '2', 'Give-back': 'forgets', Wait: '2' });
    await goMyTurn(page);
    // Go, take nothing, hand over. Nothing was ever possessed, so there is no
    // relinquish to credit — the C2 attack was that this read as perfect.
    await page.getByRole('button', { name: /Done — their turn/ }).click();
    await askBack(page);   // closes turn 2 of 2 → the trial ends on its hard bound
    await expect(page.getByRole('button', { name: /Print report/ })).toBeVisible();

    expect(await logic(page, 'return T.turns[0].passScore')).toBe('no-engagement');
    expect(await logic(page, 'return T.tier()')).toBe(3);
  });

  test('AC-1 (D1) · a silent-probe stall past the wait window scores prompted@silent with nothing shown', async ({ page }) => {
    await boot(page);
    await start(page, { Cue: 'silent', Wait: '2' });
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');     // possession taken, 1 of 4 — sub-budget

    // Stall. At `silent` the app shows nothing at all, yet the prompt IS
    // delivered by window-elapse. Scoring on visibility (the old build) returns
    // `independent` here — that is F-22, and it is the whole reason for AC-1.
    await expect.poll(() => logic(page, 'return T.turn.cueAt != null'), { timeout: 8000 }).toBe(true);
    expect(await logic(page, 'return T.promptVisible()'), 'silent shows nothing').toBe(false);
    await expect(page.getByText(/It's my turn now, please/)).toHaveCount(0);

    await page.getByRole('button', { name: /Done — their turn/ }).click();
    expect(await logic(page, 'return T.turns[0].passScore')).toBe('prompted@silent');
  });

  test('AC-21/AC-23 · a real BT prompt from the staff strip makes the pass staff-prompted, durably', async ({ page }) => {
    await boot(page);
    await start(page);
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');

    await page.getByRole('button', { name: 'Prompt given', exact: true }).click();
    await expect(page.getByText(/Prompt recorded for this turn/)).toBeVisible();

    await useTool(page, 'Mascara');     // resume — must not launder the BT prompt
    await page.getByRole('button', { name: /Done — their turn/ }).click();
    expect(await logic(page, 'return T.turns[0].passScore')).toBe('staff-prompted');
  });
});

test.describe('game surface — the ask-back (D-K)', () => {
  test('AC-27 (G1 MUST-TEST) · counted partner turn + give-back=forgets + 0 partner actions → the ask window OPENS and a correct ask scores the mand', async ({ page }) => {
    await boot(page);
    // Exactly the scenario the mode is named for: the partner is meant to take a
    // COUNTED turn, and genuinely forgets — doing 0 of their allotted actions.
    await start(page, { 'Their turn': 'count', 'Give-back': 'forgets', Wait: '2' });
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');
    await page.getByRole('button', { name: /Done — their turn/ }).click();

    expect(await logic(page, 'return {actor:T.turn.actor, budget:T.turn.budget, spent:T.turn.actions}'))
      .toEqual({ actor: 'staff', budget: 2, spent: 0 });

    // Wrong outcome #1 the G1 attack predicted: the window never opens, because
    // the onset was anchored to "allotted staff actions spent" — which never
    // happens on a real forget. It must open on STAFF IDLE instead.
    await expect.poll(() => logic(page, 'return T.turn.onsetAt != null'), { timeout: 8000 }).toBe(true);
    expect(await logic(page, `
      const e = T.log.filter((e) => e.type === 'forget-onset').pop();
      return { source: e.source, staffActions: e.staffActions };
    `)).toEqual({ source: 'staff-idle', staffActions: 0 });

    // Wrong outcome #2: the clinically correct mand under the contrived MO gets
    // filed as the error code `early-ask`. It must score the mand.
    await page.getByRole('button', { name: /I asked/ }).click();
    expect(await logic(page, 'return T.turns[1].askScore')).toBe('independent');
    await expect(page.getByRole('button', { name: /Go —/ }), 'no deadlock — play continues').toBeVisible();
  });

  test('AC-25 (F-33) · asking while the partner is still actively taking their turn is a recordable early-ask', async ({ page }) => {
    await boot(page);
    await start(page, { 'Give-back': 'forgets', Wait: '8' });
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');
    await page.getByRole('button', { name: /Done — their turn/ }).click();

    // Interrupt immediately: the 8s idle interval has not elapsed, so no forget
    // onset exists yet and this is not the taught response.
    expect(await logic(page, 'return T.turn.onsetAt == null')).toBe(true);
    await page.getByRole('button', { name: /I asked/ }).click();
    expect(await logic(page, 'return T.turns[1].askScore')).toBe('early-ask');
  });

  test('AC-24 (F1/F-22) · a silent ask-back after the window scores prompted@silent, not independent', async ({ page }) => {
    await boot(page);
    await start(page, { 'Give-back': 'forgets', Cue: 'silent', Wait: '2' });
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');
    await page.getByRole('button', { name: /Done — their turn/ }).click();

    // Onset at +2s, then the ask window runs another 2s. A learner who says
    // nothing for that whole time was prompted — silently, but prompted. The
    // original F-22 report was exactly this: a 37s silent ask scored independent.
    await expect.poll(() => logic(page, 'return T.turn.cueAt != null'), { timeout: 12000 }).toBe(true);
    expect(await logic(page, 'return T.promptVisible()')).toBe(false);

    await page.getByRole('button', { name: /I asked/ }).click();
    expect(await logic(page, 'return T.turns[1].askScore')).toBe('prompted@silent');
    // AC-26 — the ask-back is reported, never tiered.
    expect(await logic(page, `
      return T.report().totals.asks['prompted@silent'];
    `)).toBe(1);
  });
});

test.describe('game surface — completion, turns and the outro (D-D / D-G)', () => {
  test('AC-7/AC-17 (A5) · the BT sets TURNS and the per-turn budget auto-scales — one fixed cap, no second lever', async ({ page }) => {
    await boot(page);
    await ensureSetupOpen(page);
    // The action-count dropdowns are gone: a budget the BT could raise mid-trial
    // is the A5 attack (the old `actionGoal + bonus` band).
    await expect(page.getByLabel('Turns', { exact: true })).toBeVisible();
    await expect(page.getByText(/auto: \d+ actions mine · \d+ theirs/)).toBeVisible();

    for (const [turns, learner, staff] of [['4', 10, 5], ['6', 7, 4], ['10', 4, 2]]) {
      await page.getByLabel('Turns', { exact: true }).selectOption(turns);
      await expect(page.getByText(`auto: ${learner} actions mine · ${staff} theirs`)).toBeVisible();
      const share = (Math.floor(+turns / 2) * learner) /
        (Math.floor(+turns / 2) * learner + (+turns - Math.floor(+turns / 2)) * staff);
      expect(share, `turns=${turns} should favour the learner ~2:1`).toBeGreaterThan(0.6);
      expect(share).toBeLessThan(0.72);
    }

    // The cap never rises across turns.
    await start(page, { Turns: '10', 'Give-back': 'forgets', Wait: '2' });
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');
    await page.getByRole('button', { name: /Done — their turn/ }).click();
    await askBack(page);
    await page.getByRole('button', { name: /Go —/ }).click();
    expect(await logic(page, 'return T.turn.budget'), 'the second learner turn has the same cap').toBe(4);
  });

  test('AC-5/AC-16 (A4/C1) · finishing the LOOK ends the trial; an unfinished one is marked incomplete and still scores its turn-taking', async ({ page }) => {
    await boot(page);
    await start(page, { Turns: '2', 'Give-back': 'forgets', Wait: '2' });
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');

    // Perfect turn-taking, unfinished look.
    await page.getByRole('button', { name: /Done — their turn/ }).click();
    await askBack(page);
    await expect(page.getByRole('button', { name: /Print report/ })).toBeVisible();

    expect(await logic(page, 'return {tier:T.tier(), complete:T.lookComplete, reason:T.endReason}'))
      .toEqual({ tier: 1, complete: false, reason: 'turns-exhausted' });

    // AC-18 — the Tier-1 turn-taking line still fires, and the completion beat
    // (the event-success flavour) does not. Telling a child who never got made
    // over that "picture day was a hit" is eval F-30.
    const outro = await logic(page, 'return L.state.story');
    expect(outro.completionBeat, 'no completion beat on an unfinished look').toBe('');
    expect(outro.tier).toBe(1);
    expect(outro.text).toBe(outro.turnTakingLine);
    for (const claim of [/was a hit/i, /dazzled/i, /came together/i, /whole (look|routine|glam)/i]) {
      expect(outro.text, `outro must not claim completion: ${claim}`).not.toMatch(claim);
    }
    await expect(page.getByText(/The look was not finished this time/)).toBeVisible();
  });

  test('AC-5 · a finished look ends the trial by completion and the completion beat appears', async ({ page }) => {
    await boot(page);
    await start(page, { Turns: '2' });
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');

    // Finish the staged task analysis through the same state path the taps write.
    await logic(page, `
      L.setState((s) => {
        const ed = JSON.parse(JSON.stringify(s.ed));
        ['wash','moist','contour','blush','hl','shadow','liner','mascara','lipliner','lips','hairShape','hair','outfit']
          .forEach((k) => { ed.done[k] = true; });
        ed.pimples = [2, 2, 2]; ed.outfit = 'gown';
        return { ed };
      }, () => L.afterAction());
      return null;
    `);
    await expect.poll(() => logic(page, 'return T.lookComplete')).toBe(true);

    await page.getByRole('button', { name: /Done — their turn/ }).click();
    await expect(page.getByRole('button', { name: /Print report/ })).toBeVisible();
    expect(await logic(page, 'return T.endReason')).toBe('look-complete');
    const outro = await logic(page, 'return L.state.story');
    expect(outro.complete).toBe(true);
    expect(outro.completionBeat.length).toBeGreaterThan(10);
    await expect(page.getByText(/The look was not finished/)).toHaveCount(0);
  });

  test('AC-10 · the on-screen intro is the mad-lib, and asserts no checkable visual attribute of the client', async ({ page }) => {
    await boot(page);
    // The refresh moved the pretext into the texting intro (Start → the client
    // texts in), so the mad-lib now reaches the child as message bubbles.
    await page.getByRole('button', { name: /^Start/ }).click();
    await page.getByRole('button', { name: 'Skip ahead' }).click();
    await expect(page.getByRole('button', { name: /Open the salon/ })).toBeVisible();

    // The pre-redesign copy said "total bedhead, a couple of surprise spots" —
    // both refutable by looking at the doll (§3.7.1), since every model's hair
    // differs and the spots are procedurally seeded.
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/bedhead/i);
    expect(text, 'the drawn scenario reaches the child').toMatch(/^Hi glam team!/m);
    expect(text).toMatch(/We take turns here/);
    const violations = await page.evaluate(() => window.GlamStory.congruenceViolations());
    expect(violations, 'the whole producible string set is congruent').toEqual([]);

    // The event is drawn at random from the six approved scenarios.
    const ev = await logic(page, 'return L.state.sel.eventId');
    expect(await page.evaluate((id) => window.GlamStory.EVENTS.map((e) => e.id).indexOf(id), ev)).toBeGreaterThanOrEqual(0);
  });
});

test.describe('game surface — clinician affordances and config (D-C / D-H)', () => {
  test('AC-14 · an (E) mark logs {timestamp, phase, whose-turn}, changes nothing, and undoes', async ({ page }) => {
    await boot(page);
    await start(page);
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');
    const before = await logic(page, 'return {actions:T.turn.actions, tier:T.tier(), ed:JSON.stringify(L.state.ed)}');

    await page.getByRole('button', { name: '(E)', exact: true }).click();
    await page.getByRole('button', { name: 'Took turn by force', exact: true }).click();
    await expect(page.getByText(/Noted: Took turn by force/)).toBeVisible();

    expect(await logic(page, `
      const e = T.log.filter((e) => e.type === 'e-mark').pop();
      return { code: e.code, phase: e.phase, actor: e.actor, hasT: typeof e.t === 'number' };
    `)).toEqual({ code: 'Took turn by force', phase: 'my-turn', actor: 'learner', hasT: true });

    // It must not touch play or score.
    expect(await logic(page, 'return {actions:T.turn.actions, tier:T.tier(), ed:JSON.stringify(L.state.ed)}')).toEqual(before);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => logic(page, 'return T.report().totals.eEvents')).toBe(0);
  });

  test('AC-9 (D-H) · the print view renders the ten-column per-turn table under the story, de-identified, with no PHI field anywhere', async ({ page, context }) => {
    await boot(page);
    await start(page, { Turns: '2', 'Give-back': 'forgets', Wait: '2' });
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');
    await page.getByRole('button', { name: /Done — their turn/ }).click();
    await askBack(page);
    await expect(page.getByRole('button', { name: /Print report/ })).toBeVisible();

    // The game itself must offer nowhere to type a name (§8 / no PHI).
    expect(await page.locator('input[type="text"], textarea, [contenteditable="true"]').count()).toBe(0);

    const [sheet] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: /Print report/ }).click(),
    ]);
    await sheet.waitForLoadState('domcontentloaded');

    expect(await sheet.$$eval('table th', (th) => th.map((t) => t.textContent))).toEqual([
      'Turn', 'Player', 'Step(s) taken', 'Actions', 'Within limit', 'Over-cap',
      'Relinquish (pass)', 'Wait', 'Ask-back', '(E)',
    ]);
    expect(await sheet.$$eval('tbody tr', (r) => r.length)).toBeGreaterThan(0);
    const sheetText = await sheet.evaluate(() => document.body.innerText);
    expect(sheetText).toMatch(/Session GTM-\d{8}-[0-9A-Z]{4}/);
    expect(sheetText).toMatch(/No learner name is collected/);
    expect(await sheet.locator('input, textarea').count(), 'the sheet collects nothing').toBe(0);
    // Story above, table below.
    expect(await sheet.evaluate(() => {
      const story = document.querySelector('.story'), table = document.querySelector('table');
      return story.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING ? 'below' : 'above';
    })).toBe('below');
  });

  test('AC-8/AC-12/AC-13 · no timer on the learner turn · whose-turn stated in every map style · no theme selector', async ({ page }) => {
    await boot(page);

    // AC-8 — timing is a PARTNER-turn setting only.
    expect(await page.getByLabel('My turn', { exact: true }).locator('option').allTextContents())
      .toEqual(['Count shown', 'Count hidden']);
    expect(await page.getByLabel('Their turn', { exact: true }).locator('option').allTextContents())
      .toContain('Timed 20s');

    // AC-13 — the theme dropdown is gone and pet/hero are unreachable.
    await expect(page.getByLabel('Theme', { exact: true })).toHaveCount(0);
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toMatch(/Pet Show|hero squad|🐾/);

    // AC-12 — whose turn it is, in words, in all three turn maps.
    await start(page);
    await goMyTurn(page);
    await openSettings(page);
    for (const map of ['banner', 'vanity', 'runway']) {
      await page.getByLabel('Turn map', { exact: true }).selectOption(map);
      await expect(page.getByText('MY TURN').first(), `whose-turn must be visible in the ${map} map`).toBeVisible();
    }
  });

  test('the whole played trial leaves a clean console', async ({ page }) => {
    const errors = await boot(page);
    await start(page, { Turns: '4', 'Give-back': 'forgets', Wait: '2' });
    await goMyTurn(page);
    await useTool(page, 'Eyeliner');
    await page.getByRole('button', { name: /Done — their turn/ }).click();
    await askBack(page);
    await page.getByRole('button', { name: /Go —/ }).click();
    await useTool(page, 'Mascara');
    await page.getByRole('button', { name: /Done — their turn/ }).click();
    await page.getByRole('button', { name: 'End trial', exact: true }).click();
    await expect(page.getByRole('button', { name: /Print report/ })).toBeVisible();
    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
