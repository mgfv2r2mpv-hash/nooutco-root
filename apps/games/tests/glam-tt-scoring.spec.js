import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — hardened turn-taking scoring criteria.
 *
 * Drives `window.GlamTT` (the measurement engine defined in
 * glam-team-makeover/index.html) in the real browser, with an injected clock so
 * every wait-window boundary is exact instead of raced.
 *
 * Authority: docs/glam-team-makeover-redesign-hardened-claims.md — AC-1…AC-27.
 * Each test names its criterion and, where the criterion exists to close a
 * specific attack from the adversarial review, that attack's id (A2/B2/B3/C1/
 * C2/D1/E1/F1/G1). A green run here is the claim that the seven-round debate's
 * conclusions are actually implemented, so please do not relax an assertion
 * without re-reading the attack it descends from.
 *
 * Criteria that are UI-level rather than scoring-level (AC-10 mad-lib
 * congruence, AC-12 whose-turn visibility, AC-13 theme removal) are covered by
 * the game-surface specs, not here.
 */

/** Load the page and hand back a scenario runner bound to the engine. */
async function bootEngine(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT);
  return errors;
}

/**
 * Build a trial whose learner budget is exactly `budget`.
 * The budget is auto-scaled from (turns, requiredActions) and is deliberately
 * not settable directly — AC-17 forbids any second lever on the cap — so tests
 * pick the required-action count that lands on the budget they want to probe.
 */
function trialArgs({ budget = 3, learnerTurns = 3, ...rest } = {}) {
  return { turns: learnerTurns * 2, requiredActions: budget * learnerTurns, ...rest };
}

test.describe('turn-taking engine — pass scoring (D-A)', () => {
  test('AC-1 · a pass after the window elapsed scores prompted at EVERY cue level, silent-probe included', async ({ page }) => {
    await bootEngine(page);

    for (const level of ['full', 'gesture', 'silent']) {
      const out = await page.evaluate(({ level, args }) => {
        const clock = { t: 0 };
        const tr = new window.GlamTT.Trial({ ...args, cueLevel: level, waitMs: 3000, now: () => clock.t });
        tr.go();
        tr.requestAction('wash');          // possession taken at t=0
        clock.t = 5000; tr.tick();         // window opened at 3000; we are 2s past it
        return { score: tr.pass(), visible: level !== 'silent' };
      }, { level, args: trialArgs({ budget: 3 }) });

      // At silent-probe NOTHING was shown, yet the prompt was delivered by
      // window-elapse — the whole point of AC-1. `!cueVisible` scoring (the old
      // build, F-22) would have returned `independent` here.
      expect(out.score, `cue=${level}`).toBe(`prompted@${level}`);
    }
  });

  test('AC-2 · a pass inside the window with possession and no prompt scores independent', async ({ page }) => {
    await bootEngine(page);
    const score = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('wash');
      clock.t = 2000; tr.tick();           // still inside the 3s window — no prompt
      return tr.pass();
    }, trialArgs({ budget: 3 }));
    expect(score).toBe('independent');
  });

  test('AC-19 (B3) · an early voluntary pass with the budget unspent scores independent and records actions-used', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('wash');            // 1 of 3 — the budget is a cap, not a quota
      clock.t = 500;
      const score = tr.pass();
      const ev = tr.log.filter((e) => e.type === 'pass').pop();
      return { score, budget: tr.learnerBudget, used: ev.actionsUsed, unspent: ev.actionsUnspent };
    }, trialArgs({ budget: 3 }));

    expect(out.budget).toBe(3);
    expect(out.score).toBe('independent');
    // F-1's data gap: an early pass must be distinguishable from a played-out turn.
    expect(out.used).toBe(1);
    expect(out.unspent).toBe(2);
  });

  test('AC-20 (C2) · a 0-action pass is `no-engagement`, never independent — an all-0-action run is Tier 3', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      const scores = [];
      while (!tr.ended) {
        if (tr.turn.actor === 'learner') { tr.go(); clock.t += 300; scores.push(tr.pass()); }
        else { clock.t += 300; tr.staffHandBack(); }
      }
      const rep = tr.report();
      return { scores, tier: rep.tier, independent: rep.totals.independentPasses, complete: rep.complete };
    }, trialArgs({ budget: 3, learnerTurns: 3, giveBack: 'prompted' }));

    expect(out.scores).toEqual(['no-engagement', 'no-engagement', 'no-engagement']);
    expect(out.independent).toBe(0);
    expect(out.tier).toBe(3);              // the disengaged run gets the floor, not the celebration
    expect(out.complete).toBe(false);
  });

  test('AC-21 (D1) · a sub-budget stall scores prompted@level for the app cue, staff-prompted for a BT prompt', async ({ page }) => {
    await bootEngine(page);

    // (a) the app's faded prompt fires on window-elapse — even though the
    //     learner never reached the budget. Anchoring the ladder on
    //     budget-exhaustion (the pre-D1 design) made this vacuously independent.
    const viaApp = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('wash');            // 1 of 3 — sub-budget
      clock.t = 4000; tr.tick();
      return { score: tr.pass(), atCap: false };
    }, trialArgs({ budget: 3 }));
    expect(viaApp.score).toBe('prompted@full');

    // (b) the BT gets there first with a real verbal/gestural prompt.
    const viaBT = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('wash');
      clock.t = 1500; tr.btPrompt();       // before the app window even elapsed
      clock.t = 2000;
      return tr.pass();
    }, trialArgs({ budget: 3 }));
    expect(viaBT).toBe('staff-prompted');
  });

  test('AC-22 (D1 corollary) · a sub-budget learner who never passes resolves to staff-prompted, no deadlock', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('wash');            // took possession, then simply will not hand over
      clock.t = 30000; tr.tick();
      tr.endTrial('bt-end');               // the BT's always-available end control
      const rep = tr.report();
      return { pass: rep.rows[0].pass, ended: tr.ended, reason: rep.endReason };
    }, trialArgs({ budget: 3 }));

    expect(out.pass).toBe('staff-prompted');
    expect(out.ended).toBe(true);
    expect(out.reason).toBe('bt-end');
  });

  test('AC-23 (E1) · a BT prompt is TURN-DURABLE — a resume cannot launder it back to independent', async ({ page }) => {
    await bootEngine(page);

    // The E1 attack, verbatim: app cue → BT real prompt → one legal resume
    // action → quick pass in the "fresh" opportunity.
    const laundered = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('wash');            // action 1 (sub-budget)
      clock.t = 4000; tr.tick();           // app faded prompt fires
      clock.t = 5000; tr.btPrompt();       // BT judges a genuine stall and prompts
      clock.t = 6000; tr.requestAction('moist');  // "one more thing before I hand it over"
      clock.t = 6500;
      return tr.pass();                    // quick pass, no NEW prompt this opportunity
    }, trialArgs({ budget: 3 }));
    expect(laundered).toBe('staff-prompted');

    // Contrast (the accepted L8 case): a BARE sub-budget app cue drawn during a
    // genuine mid-task pause IS discardable by a real resume, so a thoughtful
    // learner who resumes and relinquishes cleanly is not taxed.
    const discardable = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('wash');
      clock.t = 4000; tr.tick();           // premature idle cue — the learner was thinking
      clock.t = 5000; tr.requestAction('moist');   // genuine resume clears it
      clock.t = 5500;
      return tr.pass();
    }, trialArgs({ budget: 3 }));
    expect(discardable).toBe('independent');

    // And a prompt delivered AT/AFTER budget-exhaustion is turn-durable too:
    // no real resume is possible there, so any further tap would be over-cap.
    const atExhaustion = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('a'); tr.requestAction('b'); tr.requestAction('c');   // budget spent
      clock.t = 4000; tr.tick();           // prompt delivered at exhaustion → durable
      clock.t = 5000; tr.requestAction('d');       // refused (over-cap), cannot launder
      clock.t = 5500;
      return tr.pass();
    }, trialArgs({ budget: 3 }));
    expect(atExhaustion).toBe('prompted@full');
  });
});

test.describe('turn-taking engine — over-cap (D-B)', () => {
  test('AC-3 · an over-cap tap is refused with kid-facing feedback, logged, and triggers the prompt — in every count mode', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('a'); tr.requestAction('b'); tr.requestAction('c');
      const r = tr.requestAction('d');
      return {
        allowed: r.allowed, overCap: r.overCap, feedback: r.feedback,
        actions: tr.turn.actions,
        logged: tr.log.filter((e) => e.type === 'over-cap-attempt').length,
        promptDelivered: tr.promptDelivered(),
      };
    }, trialArgs({ budget: 3 }));

    expect(out.allowed).toBe(false);
    expect(out.overCap).toBe(true);
    // The refusal must SAY something — eval defect 2 was 0/43 tools giving any
    // feedback at the cap in hidden-count mode. The engine returns the message
    // unconditionally so no count mode can be silent.
    expect(out.feedback).toBeTruthy();
    expect(out.feedback).not.toMatch(/error|invalid|illegal|violation/i);   // never a red error, no clinical labels
    expect(out.actions).toBe(3);           // the action did not apply
    expect(out.logged).toBe(1);
    expect(out.promptDelivered).toBe(true);
  });

  test('AC-4a (A3) · over-cap forfeits only THAT turn — the per-turn fade curve survives', async ({ page }) => {
    await bootEngine(page);
    // AC-4's pin is written as a 6-learner-turn trial; turn order here is
    // L,S,L,S… so 12 configured turns give the 6 learner turns it describes.
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      const scores = [];
      let first = true;
      while (!tr.ended) {
        if (tr.turn.actor === 'learner') {
          tr.go();
          clock.t += 200; tr.requestAction('wash');
          if (first) { clock.t += 200; tr.requestAction('x1'); tr.requestAction('x2');
                       tr.requestAction('x3'); tr.requestAction('over'); first = false; }
          clock.t += 200;
          scores.push(tr.pass());
        } else { clock.t += 200; tr.staffHandBack(); }
      }
      const rep = tr.report();
      return { scores, independent: rep.totals.independentPasses, over: rep.totals.overCap };
    }, trialArgs({ budget: 4, learnerTurns: 6, giveBack: 'prompted' }));

    expect(out.scores[0]).toBe('prompted@full');       // turn 1 forfeited
    expect(out.scores.slice(1)).toEqual(Array(5).fill('independent'));
    expect(out.independent).toBe(5);                   // five independent passes survive
    expect(out.over).toBe(1);
  });

  test('AC-4b (B2) · at silent-probe an over-cap grabber still scores prompted@silent, even passing inside the window', async ({ page }) => {
    await bootEngine(page);
    const score = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'silent', waitMs: 3000, now: () => clock.t });
      tr.go();
      tr.requestAction('a'); tr.requestAction('b'); tr.requestAction('c');
      clock.t = 1000; tr.requestAction('over');   // over-cap at t=1s — nothing is shown
      clock.t = 2000; tr.tick();                  // window has NOT elapsed (2s < 3s)
      return tr.pass();
    }, trialArgs({ budget: 3 }));

    // Two of the three signals are absent (no visible prompt, window not
    // elapsed). Only a flag set by the over-cap EVENT itself can catch this —
    // that is exactly why AC-4 was rewritten off cue-visibility.
    expect(score).toBe('prompted@silent');
  });

  test('AC-17 (A5) · the enforced cap equals the auto-scaled budget and never rises within a trial', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      const caps = [];
      while (!tr.ended) {
        if (tr.turn.actor === 'learner') {
          caps.push(tr.turn.budget);
          tr.go();
          for (let i = 0; i < 9; i++) { clock.t += 50; tr.requestAction('t' + i); }   // hammer past the cap
          clock.t += 50; tr.pass();
        } else { clock.t += 50; tr.staffHandBack(); }
      }
      return { caps, budget: tr.learnerBudget, over: tr.overCapTotal() };
    }, trialArgs({ budget: 3, learnerTurns: 4, giveBack: 'prompted' }));

    expect(out.caps).toEqual([3, 3, 3, 3]);            // identical every turn — no bonus band
    expect(Math.max(...out.caps)).toBe(out.budget);
    expect(out.over).toBe(4 * 6);                      // 6 refused attempts per turn
  });
});

test.describe('turn-taking engine — ask-back (D-K)', () => {
  test('AC-24 (F1) · a 37s silent ask after the forget onset scores prompted@silent, never independent', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'silent', waitMs: 3000, giveBack: 'forgets', now: () => clock.t });
      tr.go(); tr.requestAction('wash'); clock.t = 500; tr.pass();   // learner turn 1 → staff turn
      // staff holds possession and does nothing
      clock.t = 4000; tr.tick();                    // staff-idle → forget onset
      const onset = !!tr.turn.onsetAt;
      clock.t = 41000; tr.tick();                   // 37s after the onset, silent throughout
      const score = tr.ask();
      return { onset, score };
    }, trialArgs({ budget: 3, learnerTurns: 3 }));

    expect(out.onset).toBe(true);
    // This is eval finding 2 / F-22 on its original site (`confirmAsk`
    // `independent = !cueVisible`, cue timer un-armed at cue=None). There must be
    // no ask-cue level at which a post-window ask reads independent.
    expect(out.score).toBe('prompted@silent');
  });

  test('AC-25 (F-33) · an ask while the staff is still actively taking their turn is a recordable early-ask', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'forgets', now: () => clock.t });
      tr.go(); tr.requestAction('wash'); clock.t = 500; tr.pass();
      clock.t = 1000; tr.staffAction('recolor');    // the staff IS taking their turn
      clock.t = 1500; tr.tick();                    // idle interval not elapsed → no onset
      const onset = !!tr.turn.onsetAt;
      const score = tr.ask();                       // learner interrupts
      const rep = tr.report();
      return { onset, score, row: rep.rows[1].ask };
    }, trialArgs({ budget: 3, learnerTurns: 3 }));

    expect(out.onset).toBe(false);
    expect(out.score).toBe('early-ask');
    expect(out.row).toBe('early-ask');              // recorded, not silently dropped
  });

  test('AC-26 · a BT real prompt on the ask-back is turn-durable, and the ask-back never feeds the tier', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'forgets', now: () => clock.t });
      // Learner turn 1: a clean, engaged, independent pass.
      tr.go(); tr.requestAction('wash'); clock.t = 500; const pass1 = tr.pass();
      // Staff turn: forget onset, then the BT has to prompt the mand.
      clock.t = 4000; tr.tick();
      clock.t = 4500; tr.btPrompt();
      clock.t = 5000; const ask = tr.ask();
      // Learner turn 2: clean again. Then end the trial.
      tr.go(); tr.requestAction('moist'); clock.t = 5500; const pass2 = tr.pass();
      clock.t = 6000; tr.staffHandBack();
      const rep = tr.report();
      return { pass1, ask, pass2, tier: rep.tier, asks: rep.totals.asks };
    }, trialArgs({ budget: 3, learnerTurns: 2 }));

    expect(out.pass1).toBe('independent');
    expect(out.ask).toBe('staff-prompted');
    expect(out.pass2).toBe('independent');
    // §3.7 lock: the tier is keyed to PASS independence + over-cap only. A
    // staff-prompted ask-back is reported but must not demote the child's story.
    expect(out.tier).toBe(1);
    expect(out.asks['staff-prompted']).toBe(1);
  });

  test('AC-27 (G1 MUST-TEST) · counted staff turn + give-back=forgets + 0 staff actions → the ask window OPENS and a correct ask scores the mand', async ({ page }) => {
    await bootEngine(page);

    // The one hardened fix the adversarial review never re-tested (it landed on
    // the round cap). D-K originally anchored the forget onset to "allotted
    // staff actions spent" — the pre-D1 exhaustion anchor — which never fires
    // when the staff GENUINELY forgets and does 0 of N. That reproduced eval
    // finding 3 (deadlock) and mis-filed the clinically correct mand as
    // `early-ask`. The onset must fire on STAFF-IDLE.
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({
        ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'forgets',
        partnerTimed: false,                        // Their turn = 3 actions, COUNTED
        now: () => clock.t,
      });
      tr.go(); tr.requestAction('wash'); clock.t = 500; tr.pass();

      const staffBudget = tr.turn.budget;
      const staffActions = tr.turn.actions;         // 0 — the staff forgets entirely

      clock.t = 2000; tr.tick();
      const onsetBefore = !!tr.turn.onsetAt;        // idle interval not yet elapsed
      const earlyIfAskedNow = tr._scoreAsk(tr.turn);

      clock.t = 3500; tr.tick();                    // staff-idle threshold crossed
      const onsetAfter = !!tr.turn.onsetAt;
      const onsetEvent = tr.log.filter((e) => e.type === 'forget-onset').pop();

      clock.t = 4500;                               // ask promptly, before any prompt
      const score = tr.ask();
      return {
        staffBudget, staffActions, onsetBefore, onsetAfter,
        onsetSource: onsetEvent && onsetEvent.source,
        onsetStaffActions: onsetEvent && onsetEvent.staffActions,
        earlyIfAskedNow, score, deadlocked: false,
      };
    }, trialArgs({ budget: 3, learnerTurns: 3 }));

    expect(out.staffActions).toBe(0);
    expect(out.staffBudget).toBeGreaterThan(0);      // allotted actions exist and are unspent
    expect(out.onsetBefore).toBe(false);
    expect(out.onsetAfter).toBe(true);               // the window OPENS — no F-23/F-6 deadlock
    expect(out.onsetSource).toBe('staff-idle');      // NOT "allotted staff actions spent"
    expect(out.onsetStaffActions).toBe(0);           // fired on a genuine 0-of-N forget
    expect(out.earlyIfAskedNow).toBe('early-ask');   // before the onset it would have been early…
    expect(out.score).toBe('independent');           // …and after it, the correct mand is scored
  });

  test('AC-15 · the ask-back is reachable on a counted partner turn at every cue level', async ({ page }) => {
    await bootEngine(page);
    for (const level of ['full', 'gesture', 'silent']) {
      const reachable = await page.evaluate(({ level, args }) => {
        const clock = { t: 0 };
        const tr = new window.GlamTT.Trial({ ...args, cueLevel: level, waitMs: 3000, giveBack: 'forgets', now: () => clock.t });
        tr.go(); tr.requestAction('wash'); clock.t = 500; tr.pass();
        for (let t = 1000; t <= 20000; t += 500) { clock.t = t; tr.tick(); }
        return !!tr.turn && !!tr.turn.onsetAt;
      }, { level, args: trialArgs({ budget: 3, learnerTurns: 3 }) });
      expect(reachable, `cue=${level}`).toBe(true);
    }
  });

  test('a timed partner turn keeps its prescribed length before the ask opens (AC-8 partner side)', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({
        ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'forgets',
        partnerTimed: true, partnerSecs: 20, now: () => clock.t,
      });
      tr.go(); tr.requestAction('wash'); clock.t = 500; tr.pass();
      const start = tr.turn.startedAt;
      clock.t = start + 5000; tr.tick();
      const at5s = !!tr.turn.onsetAt;                // must still be waiting — 20s prescribed
      clock.t = start + 21000; tr.tick();
      const at21s = !!tr.turn.onsetAt;
      return { at5s, at21s, prescribed: tr.turn.waitPrescribedMs };
    }, trialArgs({ budget: 3, learnerTurns: 3 }));

    expect(out.prescribed).toBe(20000);
    expect(out.at5s).toBe(false);                    // the 3s idle heuristic must not short-circuit it
    expect(out.at21s).toBe(true);
  });

  test('AC-8 · no timer bounds the learner’s own turn', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({
        ...args, cueLevel: 'full', waitMs: 3000,
        partnerTimed: true, partnerSecs: 20, now: () => clock.t,
      });
      tr.go(); tr.requestAction('wash');
      const prescribed = tr.turn.waitPrescribedMs;
      clock.t = 600000; tr.tick();                   // ten minutes on the learner's turn
      return { prescribed, stillMine: tr.turn.actor, closed: tr.turn.closed };
    }, trialArgs({ budget: 3, learnerTurns: 3 }));

    expect(out.prescribed).toBeNull();               // timed is partner-only (D-E)
    expect(out.stillMine).toBe('learner');
    expect(out.closed).toBe(false);                  // only the learner's pass ends their turn
  });
});

test.describe('turn-taking engine — completion, tier and report (D-D / D-G / D-H)', () => {
  test('AC-7 · turns=N auto-scales the budget to finish the look with the learner taking ~2/3 of the actions', async ({ page }) => {
    await bootEngine(page);
    const scales = await page.evaluate(() => {
      return [2, 4, 6, 8, 10].map((n) => Object.assign({ n }, window.GlamTT.autoScale(n, 19)));
    });

    for (const s of scales) {
      // A cooperative learner can finish the look inside their own turns.
      expect(s.learnerTurns * s.learnerBudget, `turns=${s.n}`).toBeGreaterThanOrEqual(19);
      // …and 2:1 favouring the learner (§4 approved split).
      expect(s.learnerShare, `turns=${s.n}`).toBeGreaterThan(0.6);
      expect(s.learnerShare, `turns=${s.n}`).toBeLessThan(0.72);
    }
  });

  test('AC-7 · a cooperative run completes the look inside N turns', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'prompted', now: () => clock.t });
      let remaining = 19;
      while (!tr.ended) {
        if (tr.turn.actor === 'learner') {
          tr.go();
          while (remaining > 0 && tr.actionsLeft() > 0) { clock.t += 100; tr.requestAction('step' + remaining); remaining--; }
          if (remaining === 0) tr.setLookComplete(true);
          clock.t += 100; tr.pass();
        } else { clock.t += 100; tr.staffHandBack(); }
      }
      const rep = tr.report();
      return { complete: rep.complete, reason: rep.endReason, turnsUsed: rep.rows.length, configured: rep.turnsConfigured, tier: rep.tier };
    }, { turns: 6, requiredActions: 19 });

    expect(out.complete).toBe(true);
    expect(out.reason).toBe('look-complete');
    expect(out.turnsUsed).toBeLessThanOrEqual(out.configured);
    expect(out.tier).toBe(1);
  });

  test('AC-16 (A4) · an all-repetition trial still terminates at N turns, marked incomplete, never deadlocked', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'prompted', now: () => clock.t });
      let guard = 0;
      while (!tr.ended && guard++ < 200) {
        if (tr.turn.actor === 'learner') {
          tr.go();
          // every action is a recolour of an already-done step: legal, charged,
          // and it never advances a required step (AC-6).
          while (tr.actionsLeft() > 0) { clock.t += 100; tr.requestAction('recolor-hair'); }
          clock.t += 100; tr.pass();
        } else { clock.t += 100; tr.staffHandBack(); }
      }
      const rep = tr.report();
      return { ended: tr.ended, guard, complete: rep.complete, reason: rep.endReason,
               rows: rep.rows.length, configured: rep.turnsConfigured, tier: rep.tier };
    }, trialArgs({ budget: 3, learnerTurns: 3, giveBack: 'prompted' }));

    expect(out.ended).toBe(true);
    expect(out.guard).toBeLessThan(200);             // no unexitable state
    expect(out.complete).toBe(false);                // and no completion over-claim (F-30)
    expect(out.reason).toBe('turns-exhausted');
    expect(out.rows).toBe(out.configured);
  });

  test('AC-6 · re-applying a done step does not advance completion and does not end the trial', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'prompted', now: () => clock.t });
      tr.go();
      tr.requestAction('recolor'); tr.requestAction('recolor-again');
      const completedByActions = tr.lookComplete;
      const endedByActions = tr.ended;
      const first = tr.setLookComplete(true);
      const second = tr.setLookComplete(true);       // latched — cannot double-fire
      const events = tr.log.filter((e) => e.type === 'look-complete').length;
      return { completedByActions, endedByActions, first, second, events, stillRunning: !tr.ended };
    }, trialArgs({ budget: 3, learnerTurns: 3, giveBack: 'prompted' }));

    expect(out.completedByActions).toBe(false);
    expect(out.endedByActions).toBe(false);
    expect(out.first).toBe(true);
    expect(out.second).toBe(false);
    expect(out.events).toBe(1);
    expect(out.stillRunning).toBe(true);             // completion ends the trial at the turn boundary
  });

  test('AC-18 (C1) · perfect turn-taking on an INCOMPLETE look is Tier 1 with no completion claim', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'prompted', now: () => clock.t });
      while (!tr.ended) {
        if (tr.turn.actor === 'learner') {
          tr.go();
          clock.t += 200; tr.requestAction('recolor-hair');   // engaged, but never a required step
          clock.t += 200; tr.pass();                          // early, voluntary, before any prompt
        } else { clock.t += 200; tr.staffHandBack(); }
      }
      const rep = tr.report();
      return { tier: rep.tier, complete: rep.complete, over: rep.totals.overCap,
               passes: rep.rows.filter((r) => r.player === 'Learner').map((r) => r.pass) };
    }, trialArgs({ budget: 3, learnerTurns: 4, giveBack: 'prompted' }));

    // The two axes must be independently satisfiable on ONE trial: the child
    // earns the Tier-1 turn-taking celebration AND the story asserts no
    // completion. A build that forced Tier 3 on incomplete (or claimed
    // completion at Tier 1) fails one of AC-11/AC-5.
    expect(out.passes).toEqual(Array(4).fill('independent'));
    expect(out.over).toBe(0);
    expect(out.tier).toBe(1);
    expect(out.complete).toBe(false);
  });

  test('AC-11 (A2) · an all-staff-prompted trial is Tier 3, never Tier 1', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'prompted', now: () => clock.t });
      while (!tr.ended) {
        if (tr.turn.actor === 'learner') {
          tr.go();
          clock.t += 200; tr.requestAction('wash');
          clock.t += 5000; tr.tick();                 // app prompt fires…
          tr.btPrompt();                              // …and the BT still has to prompt every turn
          clock.t += 200; tr.pass();
        } else { clock.t += 200; tr.staffHandBack(); }
      }
      const rep = tr.report();
      return { tier: rep.tier, over: rep.totals.overCap,
               passes: rep.rows.filter((r) => r.player === 'Learner').map((r) => r.pass) };
    }, trialArgs({ budget: 3, learnerTurns: 3, giveBack: 'prompted' }));

    expect(out.passes).toEqual(Array(3).fill('staff-prompted'));
    expect(out.over).toBe(0);                        // 0 over-cap and 0 `prompted@level`…
    expect(out.tier).toBe(3);                        // …must still not read as mastery
  });

  test('AC-11 · the tier is a pure function of over-cap + pass independence; (E) marks never move it', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const run = (marks) => {
        const clock = { t: 0 };
        const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'prompted', now: () => clock.t });
        while (!tr.ended) {
          if (tr.turn.actor === 'learner') {
            tr.go();
            clock.t += 200; tr.requestAction('wash');
            if (marks) { tr.mark('force'); tr.mark('interfering'); }
            clock.t += 200; tr.pass();
          } else { clock.t += 200; tr.staffHandBack(); }
        }
        return tr.report();
      };
      const clean = run(false), marked = run(true);
      return { cleanTier: clean.tier, markedTier: marked.tier,
               cleanInd: clean.totals.independentPasses, markedInd: marked.totals.independentPasses,
               markedE: marked.totals.eEvents };
    }, trialArgs({ budget: 3, learnerTurns: 3, giveBack: 'prompted' }));

    expect(out.markedE).toBe(6);
    expect(out.markedTier).toBe(out.cleanTier);
    expect(out.markedInd).toBe(out.cleanInd);
  });

  test('AC-11 · tier boundaries: 2 over-cap attempts → Tier 3; one prompted pass in four → Tier 2', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const run = (overCapTurns, promptedTurns) => {
        const clock = { t: 0 };
        const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'prompted', now: () => clock.t });
        let li = 0;
        while (!tr.ended) {
          if (tr.turn.actor === 'learner') {
            li++;
            tr.go();
            clock.t += 200; tr.requestAction('wash');
            if (overCapTurns.indexOf(li) >= 0) {
              tr.requestAction('b'); tr.requestAction('c'); tr.requestAction('over');
            }
            if (promptedTurns.indexOf(li) >= 0) { clock.t += 5000; tr.tick(); }
            clock.t += 200; tr.pass();
          } else { clock.t += 200; tr.staffHandBack(); }
        }
        return tr.report();
      };
      return {
        twoOverCap: run([1, 2], []).tier,
        onePromptedOfFour: run([], [1]).tier,
        threePromptedOfFour: run([], [1, 2, 3]).tier,
      };
    }, trialArgs({ budget: 3, learnerTurns: 4, giveBack: 'prompted' }));

    expect(out.twoOverCap).toBe(3);                  // ≥2 over-cap attempts
    expect(out.onePromptedOfFour).toBe(2);           // not perfect, not a majority
    expect(out.threePromptedOfFour).toBe(3);         // majority non-independent
  });

  test('AC-9 · the report is a per-turn table with all ten columns and a de-identified footer', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'forgets', partnerTimed: true, partnerSecs: 20, now: () => clock.t });
      tr.go(); clock.t += 200; tr.requestAction('Wash'); clock.t += 200; tr.pass();
      const start = tr.turn.startedAt;
      clock.t = start + 21000; tr.tick(); clock.t += 500; tr.mark('other'); tr.ask();
      tr.endTrial('bt-end');
      const rep = tr.report();
      return { keys: Object.keys(rep.rows[0]), rows: rep.rows, sessionId: rep.sessionId,
               footer: { turnsConfigured: rep.turnsConfigured, cueLevel: rep.cueLevel,
                         complete: rep.complete, tier: rep.tier, totals: rep.totals } };
    }, trialArgs({ budget: 3, learnerTurns: 3 }));

    // §4: Turn # · Player · Step worked · Actions (used/allotted) · Within limit
    //     · Over-cap count · Pass score · Wait held · Ask-back score · (E) events
    expect(out.keys).toEqual(['turn', 'player', 'step', 'actions', 'withinLimit',
                              'overCap', 'pass', 'wait', 'ask', 'e']);
    expect(out.rows[0].player).toBe('Learner');
    expect(out.rows[0].actions).toBe('1/3');
    expect(out.rows[0].step).toBe('Wash');
    expect(out.rows[0].withinLimit).toBe('yes');
    expect(out.rows[1].player).toBe('Staff');
    expect(out.rows[1].wait).toMatch(/^\d+s \/ 20s$/);
    expect(out.rows[1].e).toBe(1);

    // De-identified: an auto session id and nothing that could carry PHI.
    expect(out.sessionId).toMatch(/^GTM-\d{8}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const flat = JSON.stringify(out).toLowerCase();
    for (const forbidden of ['"name"', 'learnername', 'clientname', 'initials', 'freeform', 'notes']) {
      expect(flat, `report must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  test('AC-14 · an (E) mark logs {timestamp, phase, whose-turn}, changes nothing, and is undoable', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, now: () => clock.t });
      tr.go(); clock.t = 100; tr.requestAction('wash');
      const before = { actions: tr.turn.actions, over: tr.turn.overCap, forfeit: tr.turn.forfeit, cue: tr.turn.cueAt };
      clock.t = 1200;
      const ev = tr.mark('took-turn-by-force');
      const after = { actions: tr.turn.actions, over: tr.turn.overCap, forfeit: tr.turn.forfeit, cue: tr.turn.cueAt };
      const countAfterMark = tr.turn.eEvents;
      const undo = tr.undoMark();
      const countAfterUndo = tr.turn.eEvents;
      const score = tr.pass();
      return { ev, before, after, countAfterMark, countAfterUndo,
               undoType: undo && undo.type, live: tr.report().totals.eEvents, score };
    }, trialArgs({ budget: 3 }));

    expect(out.ev.type).toBe('e-mark');
    expect(out.ev.code).toBe('took-turn-by-force');
    expect(out.ev.t).toBe(1200);                     // timestamp
    expect(out.ev.phase).toBe('my-turn');            // whose turn
    expect(out.ev.turn).toBe(1);
    expect(out.after).toEqual(out.before);           // never alters gameplay or score
    expect(out.countAfterMark).toBe(1);
    expect(out.countAfterUndo).toBe(0);
    expect(out.undoType).toBe('e-undo');             // append-only: a voiding event, not a deletion
    expect(out.live).toBe(0);
    expect(out.score).toBe('independent');
  });

  test('the event log is append-only and monotonically sequenced', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const clock = { t: 0 };
      const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'forgets', now: () => clock.t });
      const sizes = [];
      tr.go(); sizes.push(tr.log.length);
      clock.t = 100; tr.requestAction('wash'); sizes.push(tr.log.length);
      clock.t = 4000; tr.tick(); sizes.push(tr.log.length);
      clock.t = 4200; tr.pass(); sizes.push(tr.log.length);
      clock.t = 8000; tr.tick(); sizes.push(tr.log.length);
      clock.t = 12000; tr.tick(); tr.ask(); sizes.push(tr.log.length);
      tr.endTrial('bt-end'); sizes.push(tr.log.length);
      const seqs = tr.log.map((e) => e.seq);
      const ts = tr.log.map((e) => e.t);
      return { sizes, seqs, monotonicSeq: seqs.every((v, i) => i === 0 || v > seqs[i - 1]),
               monotonicTime: ts.every((v, i) => i === 0 || v >= ts[i - 1]),
               types: tr.log.map((e) => e.type) };
    }, trialArgs({ budget: 3, learnerTurns: 3 }));

    for (let i = 1; i < out.sizes.length; i++) expect(out.sizes[i]).toBeGreaterThanOrEqual(out.sizes[i - 1]);
    expect(out.monotonicSeq).toBe(true);
    expect(out.monotonicTime).toBe(true);
    expect(out.types[0]).toBe('trial-start');
    expect(out.types[out.types.length - 1]).toBe('trial-end');
    expect(out.types).toContain('forget-onset');
  });

  test('a trial is always terminable — the BT end control works from any phase', async ({ page }) => {
    await bootEngine(page);
    const out = await page.evaluate((args) => {
      const phases = ['fresh', 'mid-learner', 'staff-idle', 'post-onset'];
      return phases.map((phase) => {
        const clock = { t: 0 };
        const tr = new window.GlamTT.Trial({ ...args, cueLevel: 'full', waitMs: 3000, giveBack: 'forgets', now: () => clock.t });
        if (phase !== 'fresh') { tr.go(); clock.t = 200; tr.requestAction('wash'); }
        if (phase === 'staff-idle' || phase === 'post-onset') { clock.t = 400; tr.pass(); }
        if (phase === 'post-onset') { clock.t = 4000; tr.tick(); }
        const ok = tr.endTrial('bt-end');
        const rep = tr.report();
        return { phase, ok, ended: tr.ended, rows: rep.rows.length,
                 everyLearnerRowScored: rep.rows.filter((r) => r.player === 'Learner')
                   .every((r) => window.GlamTT.isScoredPass(r.pass)) };
      });
    }, trialArgs({ budget: 3, learnerTurns: 3 }));

    for (const r of out) {
      expect(r.ok, r.phase).toBe(true);
      expect(r.ended, r.phase).toBe(true);
      expect(r.everyLearnerRowScored, r.phase).toBe(true);   // no learner turn is silently dropped
    }
  });

  test('the page loads the engine with a clean console', async ({ page }) => {
    const errors = await bootEngine(page);
    await expect(page.getByRole('button', { name: /Play/ })).toBeVisible();
    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
