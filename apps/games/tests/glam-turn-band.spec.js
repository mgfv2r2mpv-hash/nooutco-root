import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover - THIRD PASS, Finding B: the turn indicator lives in the
 * stage's sandy counter rail, and the card it used to live in is gone.
 *
 * The maintainer's words: "Can we move the turn indicator and # actions left to
 * be in the sandy brown horizontal bar on bottom to use that helpfully and bring
 * it into the design, remove that card's vertical footprint".
 *
 * Two things have to hold at once and they pull against each other:
 *   · the card's VERTICAL FOOTPRINT is gone - nothing sits between the top of
 *     the game area and the top of the stage panel; and
 *   · whose turn it is is STILL ALWAYS VISIBLE (AC-12 / docs/…hardened-claims.md
 * - an acceptance criterion, not a preference), together with the
 *     actions-left meter the over-cap behaviour depends on the child reading.
 * A stage-anchored indicator is exactly the kind that scrolls away on a phone,
 * so the second half is asserted at all three device sizes AND after the page
 * has been scrolled to the bottom of the styling trolley, which is the furthest
 * the child can get from the stage.
 *
 * Everything here is located the way the U3 spec locates things - the panel by
 * the backdrop art it carries, the text by its own words - so the same file runs
 * against the pre-change renderer. Point it at one with:
 *
 *   git show 2f45dfda:apps/games/glam-team-makeover/index.html \
 *     > apps/games/glam-team-makeover/_before-tune3.html
 *   GLAM_PAGE=/glam-team-makeover/_before-tune3.html npx playwright test \
 *     tests/glam-turn-band.spec.js --project=chromium
 */

const PAGE = process.env.GLAM_PAGE || '/glam-team-makeover/';

/** Desktop first, then tablet, then iPhone - the redesign spec's §3.9 order.
 *  `railWas` is the height the TWO-LINE rail shipped at (index.html `--gtm-band`
 *  before the maintainer's ruling 3). The single-line rail has to come in under
 *  it, so the number is carried here rather than restated in each assertion. */
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860, railWas: 46 },
  { tag: 'tablet', width: 834, height: 1112, railWas: 46 },
  { tag: 'phone', width: 390, height: 844, railWas: 40 },
];

/** Boot into a live my-turn game screen with the stage painted. */
async function stage(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption('m4');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).click();
  await page.waitForFunction(() => {
    const c = document.getElementById('gtm-canvas');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
    return false;
  }, undefined, { timeout: 20000 });
  return errors;
}

/** Read the layout after two frames, so a viewport change has settled. */
function layout(page) {
  return page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const R = (e) => { const r = e.getBoundingClientRect();
      return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1),
               top:+r.top.toFixed(1), bottom:+r.bottom.toFixed(1), right:+r.right.toFixed(1) }; };
    const deepest = (txt) => {
      const hit = [...document.querySelectorAll('*')].filter((e) =>
        (e.textContent || '').trim() === txt &&
        ![...e.children].some((c) => (c.textContent || '').trim() === txt));
      return hit[0] || null;
    };
    const panelOf = () => {
      const cv = document.getElementById('gtm-canvas');
      if (!cv) return null;
      for (let e = cv.parentElement.parentElement; e; e = e.parentElement) {
        if (/url\(/.test(getComputedStyle(e).backgroundImage || '')) return e;
      }
      return null;
    };
    /* How much wider the text is than the box that clips it. Asked of the
       nearest CLIPPING ancestor within three steps, not of the text node
       itself: the runtime wraps every interpolation in an inline <span>, and
       scrollWidth on an inline box is 0 in Blink but the content width in
       Gecko - comparing that against clientWidth (0 in both) reports the whole
       sentence as overflow on Firefox and nothing on Chrome. */
    const clipOverflow = (el) => {
      for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) {
        if (getComputedStyle(e).overflowX !== 'visible') return e.scrollWidth - e.clientWidth;
      }
      return 0;
    };
    const panel = panelOf();
    if (!panel) return { error: 'no element under the client carries the backdrop' };
    // The same two parts under either phase's wording.
    const turn = deepest('MY TURN') || deepest('THEIR TURN');
    if (!turn) return { error: 'no element states whose turn it is' };
    const meterLabel = deepest('Actions left') || deepest('Their actions left');
    if (!meterLabel) return { error: 'no element states the actions left' };
    /* The whose-turn SENTENCE - the line the child reads, whatever it says now.
       Matched as a SENTENCE (>12 chars) rather than a prefix, because the BT's
       own setup strip carries <label>My turn</label> and <label>Their turn</label>
       and those sit at the top of the page whether or not it is scrolled - and
       a <label> wrapping its own <select> reads as "My turnCount shownCount
       hidden", which is long enough to look like a sentence. Anything holding a
       form control is setup, not the child's line. */
    const sentence = (e) => { const t = (e.textContent || '').trim();
      return t.length > 12 && /^(My turn|All set|Their turn)\b/.test(t)
        && !e.querySelector('select,input,textarea,button,option'); };
    const line = [...document.querySelectorAll('*')]
      .filter((e) => sentence(e) && ![...e.children].some(sentence))[0];
    const main = document.querySelector('main.gtm-room');
    const mcs = main ? getComputedStyle(main) : null;
    const trolley = document.getElementById('gtm-trolley');
    return {
      panel: R(panel), turn: R(turn), meter: R(meterLabel.parentElement), meterLabel: R(meterLabel),
      line: line ? R(line) : null,
      lineText: line ? (line.textContent || '').trim() : '',
      lineClipped: line ? clipOverflow(line) : 0,
      pips: [...(meterLabel.parentElement.querySelectorAll('span'))].length,
      // how much vertical room is spent between the top of the game area and
      // the top of the stage panel - the card's footprint, in one number
      aboveStage: main ? +(R(panel).top - (R(main).top + parseFloat(mcs.paddingTop || 0))).toFixed(1) : null,
      trolley: trolley ? R(trolley) : null,
      viewH: window.innerHeight, viewW: window.innerWidth,
      scrollY: Math.round(window.scrollY),
      docH: Math.round(document.documentElement.scrollHeight),
    };
  });
}

/** A rect is "on screen" when it is wholly inside the viewport with a real size. */
function onScreen(r, viewH, viewW) {
  return r && r.w > 4 && r.h > 4 && r.top >= 0 && r.bottom <= viewH && r.x >= 0 && r.right <= viewW;
}

/**
 * The rail's own shape, for the maintainer's ruling 3 (the two-line stack
 * becomes one row). Located exactly the way the rest of this file locates
 * things - by the words on screen, never by a class name - so it also runs
 * against the pre-change renderer and reports what IT does.
 *
 * The rail itself is found as the lowest common ancestor of the whose-turn
 * label and the actions-left label. That is the rail in both builds, and it
 * survives any amount of re-nesting inside it.
 */
function railShape(page) {
  return page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const R = (e) => { const r = e.getBoundingClientRect();
      return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1),
               top:+r.top.toFixed(1), bottom:+r.bottom.toFixed(1), right:+r.right.toFixed(1) }; };
    const deepest = (txt) => {
      const hit = [...document.querySelectorAll('*')].filter((e) =>
        (e.textContent || '').trim() === txt &&
        ![...e.children].some((c) => (c.textContent || '').trim() === txt));
      return hit[0] || null;
    };
    /* Overflow is asked of the nearest CLIPPING ancestor within three steps - see the note on `clipOverflow` above; scrollWidth on an inline box
       disagrees between Blink and Gecko and would report a phantom overrun. */
    const clipOverflow = (el) => {
      for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) {
        if (getComputedStyle(e).overflowX !== 'visible') return +(e.scrollWidth - e.clientWidth).toFixed(1);
      }
      return 0;
    };
    const sentence = (e) => { const t = (e.textContent || '').trim();
      return t.length > 12 && /^(My turn|All set|Their turn)\b/.test(t)
        && !e.querySelector('select,input,textarea,button,option'); };

    const turn = deepest('MY TURN') || deepest('THEIR TURN');
    const meterLabel = deepest('Actions left') || deepest('Their actions left');
    const line = [...document.querySelectorAll('*')]
      .filter((e) => sentence(e) && ![...e.children].some(sentence))[0];
    if (!turn) return { error: 'no element states whose turn it is' };
    if (!meterLabel) return { error: 'no element states the actions left' };
    if (!line) return { error: 'no element carries the whose-turn line' };

    const chain = (e) => { const c = []; for (; e; e = e.parentElement) c.push(e); return c; };
    const up = chain(turn), down = new Set(chain(meterLabel));
    const rail = up.find((e) => down.has(e));
    if (!rail) return { error: 'the whose-turn label and the actions-left label share no ancestor' };

    return {
      rail: R(rail), turn: R(turn), line: R(line), meterLabel: R(meterLabel),
      lineText: (line.textContent || '').trim(),
      lineClipped: clipOverflow(line),
      meterClipped: clipOverflow(meterLabel),
      /* Does the rail as a whole overrun the box it is painted in? A single-line
         stack that "fits" by pushing its own contents out the side has not. */
      railClipped: +(rail.scrollWidth - rail.clientWidth).toFixed(1),
    };
  });
}

/** How much of `a`'s height falls inside `b`'s, as a fraction of `a`'s. */
function sharedRow(a, b) {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return a.h > 0 ? +(overlap / a.h).toFixed(3) : 0;
}

test.describe('third pass · Finding B - the turn rail', () => {
  test('B · whose-turn and actions-left sit in the stage\'s bottom band, and the card above the stage is gone', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await stage(page);

    for (const d of DEVICES) {
      await page.setViewportSize({ width: d.width, height: d.height });
      await page.evaluate(() => window.scrollTo(0, 0));
      const g = await layout(page);
      const at = `${d.tag} (${d.width}×${d.height})`;
      expect(g.error, `${at}: ${g.error}`).toBeUndefined();

      /* THE MOVE. Both parts of the indicator are geometrically inside the stage
         panel - not merely near it - and both are in its BOTTOM band rather than
         floating over the client's face. 0.72 of the panel's height is well
         below the client's chin at every width (the client is 0.70 of a
         bottom-anchored composition). */
      for (const [what, r] of [['the whose-turn label', g.turn], ['the actions-left meter', g.meter], ['the whose-turn line', g.line]]) {
        expect(r, `${at}: ${what} was not found`).not.toBeNull();
        expect(r.top, `${at}: ${what} starts ${(g.panel.top - r.top).toFixed(1)}px ABOVE the stage panel`)
          .toBeGreaterThanOrEqual(g.panel.top - 0.6);
        expect(r.bottom, `${at}: ${what} runs ${(r.bottom - g.panel.bottom).toFixed(1)}px BELOW the stage panel`)
          .toBeLessThanOrEqual(g.panel.bottom + 0.6);
        const band = (r.top - g.panel.top) / g.panel.h;
        expect(band, `${at}: ${what} sits at ${(band * 100).toFixed(1)}% down the stage - not in the bottom band`)
          .toBeGreaterThan(0.72);
      }

      // …and the meter still has one pip per action in the budget, so "actions
      // left" is legible as a COUNT and not just as a caption.
      expect(g.pips, `${at}: the actions-left meter should still show its pips`).toBeGreaterThanOrEqual(4);

      /* THE FOOTPRINT. Nothing occupies vertical room between the top of the
         game area and the top of the stage. Before this pass the card + its row
         gap spent ~84px here at every width. */
      expect(g.aboveStage, `${at}: ${g.aboveStage}px of vertical footprint still sits above the stage`)
        .toBeLessThanOrEqual(6);

      /* …and the line the child reads is never truncated by the rail it now
         lives in - a rail whose height is a layout constant cannot wrap. */
      expect(g.lineClipped, `${at}: "${g.lineText}" is clipped by ${g.lineClipped}px in the rail`)
        .toBeLessThanOrEqual(1);
    }
    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('B (AC-12) · whose-turn and actions-left stay on screen at every width, including scrolled to the trolley', async ({ page }) => {
    test.setTimeout(180000);
    const errors = await stage(page);

    /* Three scroll positions, because "always visible" is a claim about the
       whole page and not about its top: the top; the trolley scrolled into view
       at its END (which is what a child reaching the last shelf does); and the
       very bottom of the document. */
    const places = [
      ['at the top of the page', () => window.scrollTo(0, 0)],
      ['scrolled to the trolley', () => {
        const t = document.getElementById('gtm-trolley');
        if (t) { t.scrollTop = t.scrollHeight; t.scrollIntoView({ block: 'end' }); }
      }],
      ['scrolled to the bottom of the page', () => window.scrollTo(0, document.documentElement.scrollHeight)],
    ];

    const sweep = async (phase) => {
      for (const d of DEVICES) {
        await page.setViewportSize({ width: d.width, height: d.height });
        const at = `${d.tag} (${d.width}×${d.height}), ${phase}`;
        for (const [where, fn] of places) {
          await page.evaluate(fn);
          const g = await layout(page);
          expect(g.error, `${at} ${where}: ${g.error}`).toBeUndefined();
          for (const [what, r] of [['the whose-turn label', g.turn], ['the whose-turn line', g.line], ['the actions-left meter', g.meter]]) {
            expect(onScreen(r, g.viewH, g.viewW),
              `${at} ${where} (scrollY ${g.scrollY} of ${g.docH - g.viewH}): ${what} is off screen - ${JSON.stringify(r)} in a ${g.viewW}×${g.viewH} viewport`)
              .toBe(true);
          }
        }
      }
    };

    await sweep('my turn');

    /* …and again on the PARTNER's turn, which is the taller page: the controls
       row grows the mand cue and the "✓ I asked!" button, so the document gets
       longer and the child can scroll further than the my-turn case allows.
       Playing a trial out at 390×844 is how that gap was found - the rail was at
       y −109 at scrollY 576 with only the my-turn scroll range checked. */
    await page.setViewportSize({ width: DEVICES[0].width, height: DEVICES[0].height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /Done - their turn/ }).click();
    // `exact` matters: a loose getByText also matches the BT strip's hidden
    // <label>Their turn</label>, which is never visible.
    await expect(page.getByText('THEIR TURN', { exact: true }).first()).toBeVisible();
    await sweep('their turn');

    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  /**
   * THIRD PASS · rail correction. The maintainer overruled W6's 46/40: the rail
   * is to be a SINGLE-LINE stack - the whose-turn eyebrow and the whose-turn
   * line on one row - and shorter for it.
   *
   * W6 also named the cost, and it is the half of this test that matters: a
   * single row is wider than a stack, and 390 is where it either works or does
   * not. A rail that "got shorter" by truncating the child's line, or by
   * pushing the actions-left meter out of the box, has got worse instead. So
   * height and no-truncation are asserted together, at all three widths, and
   * the 390 case is the one with only 7.7px of measured margin behind it.
   *
   * Two-sided by construction - against the pre-change build (fed4e2be) the
   * eyebrow sits ABOVE the line and the rail is exactly 46/40, so both halves
   * fail. Point it at one with:
   *
   *   git show fed4e2be:apps/games/glam-team-makeover/index.html \
   *     > apps/games/glam-team-makeover/_before-rail.html
   *   GLAM_PAGE=/glam-team-makeover/_before-rail.html npx playwright test \
   *     tests/glam-turn-band.spec.js --project=chromium
   */
  test('B (rail correction) · the rail is one row, shorter than the two-line stack, and truncates neither the line nor the meter', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await stage(page);

    for (const d of DEVICES) {
      await page.setViewportSize({ width: d.width, height: d.height });
      await page.evaluate(() => window.scrollTo(0, 0));
      const g = await railShape(page);
      const at = `${d.tag} (${d.width}×${d.height})`;
      expect(g.error, `${at}: ${g.error}`).toBeUndefined();

      /* ONE ROW. The eyebrow's height falls inside the line's - they are
         baseline-aligned siblings on a single row - and they are side by side
         rather than one under the other. Stacked, the overlap is 0. */
      expect(sharedRow(g.turn, g.line),
        `${at}: the whose-turn label (y ${g.turn.top} - ${g.turn.bottom}) and the line (y ${g.line.top} - ${g.line.bottom}) are not on one row`)
        .toBeGreaterThanOrEqual(0.8);
      expect(g.turn.right,
        `${at}: the whose-turn label ends at x ${g.turn.right} but the line starts at x ${g.line.x} - they are stacked, not side by side`)
        .toBeLessThanOrEqual(g.line.x + 1);

      /* SHORTER. Strictly under what the two-line rail shipped at - the whole
         point of the ruling, and the number the art is sized against. */
      expect(g.rail.h, `${at}: the rail is ${g.rail.h}px - the two-line rail it replaces was ${d.railWas}px`)
        .toBeLessThan(d.railWas);

      /* AND NOT AT THE LINE'S EXPENSE. Neither the child's line nor the
         actions-left label may be clipped, and the rail may not overrun its
         own box to make room. */
      expect(g.lineClipped, `${at}: "${g.lineText}" is clipped by ${g.lineClipped}px in the one-row rail`)
        .toBeLessThanOrEqual(1);
      expect(g.meterClipped, `${at}: the actions-left label is clipped by ${g.meterClipped}px in the one-row rail`)
        .toBeLessThanOrEqual(1);
      expect(g.railClipped, `${at}: the rail overruns its own box by ${g.railClipped}px`)
        .toBeLessThanOrEqual(1);
      /* …and the line stops before the meter starts, so "not clipped" cannot be
         satisfied by the two simply overlapping. */
      expect(g.line.right, `${at}: the whose-turn line runs to x ${g.line.right}, under the actions-left label at x ${g.meterLabel.x}`)
        .toBeLessThanOrEqual(g.meterLabel.x + 1);
    }
    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
