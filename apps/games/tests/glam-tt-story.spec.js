import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover - story pool: congruence rule and the two-axis outro.
 *
 * Authority: spec §5 (the six approved events), §3.7 / §3.7.1 (congruence),
 * and hardened claims D-F / D-G / AC-5 / AC-10 / AC-18 / L7.
 *
 * These assertions sweep the whole producible cross-product (6 events × 3 tiers
 * × complete/incomplete × 12 name slots) rather than spot-checking strings,
 * because AC-10 is a property of the pool, not of any one line: a single
 * refutable claim about the client's hair or spots hands the learner a reason to
 * disbelieve the activity, and every model's default hair differs while the
 * spots are procedurally seeded.
 *
 * NOTE (iteration scope): this covers the story DATA and its composer. Wiring
 * the composed intro/outro into the game's screens is tracked in
 * docs/eval/glam-team-makeover-build-report.md as still outstanding, so AC-10 is
 * not yet claimed for the live intro screen - which still ships the pre-redesign
 * copy.
 */

async function bootStory(page) {
  await page.goto('/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamStory);
}

test.describe('story pool (D-F / D-G)', () => {
  test('§5 · the six approved events are present and unchanged', async ({ page }) => {
    await bootStory(page);
    const labels = await page.evaluate(() => window.GlamStory.EVENTS.map((e) => e.label));
    expect(labels).toEqual([
      'School picture day', 'Birthday party', 'Talent show',
      'Family photo', 'First day, new school', 'Dance recital',
    ]);
  });

  test('AC-10 · no producible string asserts a checkable visual attribute of the client', async ({ page }) => {
    await bootStory(page);
    const out = await page.evaluate(() => ({
      violations: window.GlamStory.congruenceViolations(),
      scanned: window.GlamStory.allStrings().length,
    }));

    // Guard the guard: a sweep that scans nothing would pass vacuously.
    expect(out.scanned).toBeGreaterThan(500);
    expect(out.violations, JSON.stringify(out.violations, null, 2)).toEqual([]);
  });

  test('AC-10 · the congruence guard actually catches a refutable claim', async ({ page }) => {
    await bootStory(page);
    // Negative control - the offending copy the redesign removes is exactly the
    // pre-redesign intro ("total bedhead, a couple of surprise spots").
    const caught = await page.evaluate(() => {
      const bad = 'It is total bedhead and there are 3 surprise spots, and no outfit yet!';
      return window.GlamStory.BANNED.filter((re) => re.test(bad)).length;
    });
    expect(caught).toBeGreaterThanOrEqual(3);   // bedhead + spots + a digit
  });

  test('AC-18 (C1) · no tier turn-taking line carries an event-success or completion claim', async ({ page }) => {
    await bootStory(page);
    const bad = await page.evaluate(() => window.GlamStory.tierLinesClaimingCompletion());
    // This is the C1 attack made mechanical: §5's fused Tier-1 cells WERE the
    // completion claim ("picture-perfect, day was a hit"), so a build that
    // reuses them would tell a child with an unfinished look that the day was a
    // hit. The tier line must be teamwork-only at every tier.
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
  });

  test('AC-5 / AC-18 · the completion beat appears only when the look is complete', async ({ page }) => {
    await bootStory(page);
    const out = await page.evaluate(() => {
      const S = window.GlamStory;
      return S.EVENTS.map((ev) => {
        const sel = { eventId: ev.id, name: 'Ada', cheer: 'Wow' };
        const rows = [];
        for (const tier of [1, 2, 3]) {
          for (const complete of [true, false]) {
            const o = S.outro(sel, tier, complete);
            rows.push({
              id: ev.id, tier, complete,
              beat: o.completionBeat, text: o.text, line: o.turnTakingLine,
            });
          }
        }
        return rows;
      }).flat();
    });

    for (const r of out) {
      if (r.complete) {
        expect(r.beat, `${r.id} t${r.tier} complete`).toBeTruthy();
        expect(r.text).toContain(r.beat);
      } else {
        // AC-18's pin: incomplete OMITS the beat and asserts no completion, but
        // the tier line still fires at full intensity - including Tier 1.
        expect(r.beat, `${r.id} t${r.tier} incomplete`).toBe('');
        expect(r.text).toBe(r.line);
        expect(r.text).not.toMatch(/came together|was a hit|dazzled|framed favorite|walked in beaming|shone on stage|what a party/i);
      }
    }
  });

  test('AC-18 · School picture day, perfect turn-taking but INCOMPLETE, does not say "day was a hit"', async ({ page }) => {
    await bootStory(page);
    const out = await page.evaluate(() => {
      const sel = { eventId: 'picture-day', name: 'Ada', cheer: 'Wow' };
      return {
        incompleteTier1: window.GlamStory.outro(sel, 1, false),
        completeTier1: window.GlamStory.outro(sel, 1, true),
      };
    });

    // The concrete AC-18 scenario, verbatim from the hardened claims.
    expect(out.incompleteTier1.text).not.toMatch(/day was a hit/i);
    expect(out.incompleteTier1.turnTakingLine).toMatch(/team/i);          // Tier-1 celebration still fires
    expect(out.incompleteTier1.complete).toBe(false);
    expect(out.completeTier1.text).toMatch(/picture day was a hit/i);     // …and is reachable when earned
  });

  test('the tier line varies by tier and the completion beat does not', async ({ page }) => {
    await bootStory(page);
    const out = await page.evaluate(() => {
      const S = window.GlamStory;
      return S.EVENTS.map((ev) => {
        const sel = { eventId: ev.id, name: 'Ada', cheer: 'Wow' };
        return {
          id: ev.id,
          lines: [1, 2, 3].map((t) => S.outro(sel, t, true).turnTakingLine),
          beats: [1, 2, 3].map((t) => S.outro(sel, t, true).completionBeat),
        };
      });
    });

    for (const ev of out) {
      expect(new Set(ev.lines).size, `${ev.id} needs 3 distinct tier lines`).toBe(3);
      expect(new Set(ev.beats).size, `${ev.id} beat must not depend on tier`).toBe(1);
    }
  });

  test('D-F · the character draw is a random client (model + name + scenario) and is lockable', async ({ page }) => {
    await bootStory(page);
    const out = await page.evaluate(() => {
      const S = window.GlamStory;
      // deterministic sequence so the spread assertion cannot flake
      let i = 0;
      const seq = [0.02, 0.31, 0.58, 0.77, 0.94, 0.12, 0.44, 0.66, 0.88, 0.05];
      const rnd = () => seq[i++ % seq.length];
      const draws = [];
      for (let n = 0; n < 24; n++) draws.push(S.draw({ rnd }));
      return {
        events: [...new Set(draws.map((d) => d.eventId))].length,
        names: [...new Set(draws.map((d) => d.name))].length,
        models: [...new Set(draws.map((d) => d.model))].length,
        locked: S.draw({ rnd, eventId: 'dance-recital', name: 'Kit', model: 'm3' }),
        validEvents: draws.every((d) => !!S.byId(d.eventId)),
        // the roster is the single source of truth for which faces exist; M1 was
        // retired from it in the refresh, so the pool must follow it, not a
        // hardcoded list that would keep the retired face alive here
        validModels: draws.every((d) => S.MODELS.includes(d.model)),
        roster: S.MODELS,
      };
    });

    expect(out.events).toBeGreaterThan(1);
    expect(out.names).toBeGreaterThan(1);
    expect(out.models).toBeGreaterThan(1);
    expect(out.validEvents).toBe(true);
    expect(out.validModels).toBe(true);
    expect(out.roster, 'M1 is retired and must not be drawable').not.toContain('m1');
    // optional BT lock (§3.7 "Model dropdown becomes the character lock")
    expect(out.locked).toMatchObject({ eventId: 'dance-recital', name: 'Kit', model: 'm3' });
  });

  test('§8 · no story string carries a number, and the name slot is fictional-client only', async ({ page }) => {
    await bootStory(page);
    const out = await page.evaluate(() => {
      const S = window.GlamStory;
      return {
        withDigits: S.allStrings().filter((x) => /\d/.test(x.s)).map((x) => x.where),
        names: S.NAMES,
      };
    });
    expect(out.withDigits).toEqual([]);          // no numbers to the child (§3.7)
    expect(out.names.length).toBeGreaterThanOrEqual(12);
    expect(out.names.every((n) => /^[A-Z][a-z]+$/.test(n))).toBe(true);
  });
});
