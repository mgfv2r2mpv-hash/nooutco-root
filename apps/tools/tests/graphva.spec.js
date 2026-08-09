import { test, expect } from '@playwright/test';

// Regression suite for the graph visual analysis tool.
//
// The defects this guards against are all of one kind: a tool that produces a
// confident number where the record cannot support one. v3 of this workbench
// reported "Effect demonstrated for this adjacent pair" on an AB graph, which
// no single-case design can establish, and reported "No effect demonstrated" on
// a two-point phase, which is a false negative manufactured by the tool rather
// than found in the data.
//
// Where a published expected value exists, the assertion uses that value rather
// than one this implementation produced. NAP is pinned against WWC v5.0's own
// worked example; the exact Mann-Whitney p is pinned against 1/C(m+n,n), which
// is the closed-form answer at complete separation.
//
// The page is loaded rather than the modules imported, because the statistics
// attach to `window` in the vanilla no-build style the rest of apps/tools uses.

const PAGE = '/graphVA/index.html';

test.describe('graph visual analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.GVA_VERDICT && !!window.GVA_STATS);
  });

  test('page renders the sample record with no script errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(PAGE);
    await page.waitForFunction(() => document.querySelector('#verdict .vfinding'));

    await expect(page.locator('#verdict .vfinding')).toBeVisible();
    await expect(page.locator('#metrics tbody tr')).toHaveCount(7);
    // The chart must actually draw, not just exist.
    expect(await page.locator('#chart polyline').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  // WWC Procedures and Standards Handbook v5.0, Appendix I. Baseline
  // 15,10,14,17,13,12 with a decrease-desirable outcome, comparing the first
  // three points to the last three, scoring 0.5 for ties. WWC reports 0.44.
  test('NAP reproduces the published WWC worked example', async ({ page }) => {
    const nap = await page.evaluate(() =>
      window.GVA_STATS.wwcBaselineTrend([15, 10, 14, 17, 13, 12], 'dec').nap,
    );
    expect(nap).toBeCloseTo(0.4444, 4);
    expect(nap.toFixed(2)).toBe('0.44');
  });

  // At complete separation the exact one-tailed p is 1/C(m+n, n). This is the
  // statistic the tool leans on once the Hanley-McNeil interval degenerates,
  // so it has to be right for the short-phase message to mean anything.
  const SEPARATION = [
    { m: 2, n: 3, p: 1 / 10 },
    { m: 3, n: 3, p: 1 / 20 },
    { m: 8, n: 3, p: 1 / 165 },
    { m: 5, n: 5, p: 1 / 252 },
  ];
  for (const { m, n, p } of SEPARATION) {
    test(`exact Mann-Whitney at complete separation, ${m} vs ${n}`, async ({ page }) => {
      const got = await page.evaluate(({ m, n }) => {
        const base = Array.from({ length: m }, (_, i) => 100 + i);
        const tx = Array.from({ length: n }, (_, i) => 1 + i);
        return window.GVA_STATS.mannWhitneyExact(base, tx, 'dec').p;
      }, { m, n });
      expect(got).toBeCloseTo(p, 10);
    });
  }

  // The refusal is arithmetic, not a threshold someone chose: below 5 treatment
  // points no k satisfies an exact one-tailed binomial at p < .05.
  test('CDC critical values, and the null below n = 5', async ({ page }) => {
    const got = await page.evaluate(() => {
      const S = window.GVA_STATS;
      return {
        exact: [4, 5, 6, 7, 8, 9, 10].map((n) => S.cdcCriticalExact(n)),
        fisher: [7, 10, 12].map((n) => S.cdcCritical(n, 'fisher')),
      };
    });
    expect(got.exact).toEqual([null, 5, 6, 7, 7, 8, 9]);
    // Fisher's published table tracks a normal approximation and is looser at
    // exactly these n. Both modes are offered; the tool prints which it used.
    expect(got.fisher).toEqual([6, 8, 9]);
  });

  test('a treatment phase under 3 points refuses a verdict', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'Baseline', cond: 'base', data: '10,12,11,9,13,10' },
          { name: 'Plan 1', cond: 'tx', data: '4,3' },
        ],
        { direction: 'dec' },
      ),
    );
    expect(res.finding).toBe('In Treatment');
    expect(res.decision.severity).toBe('hard');
  });

  // The ruling this encodes: the treatment phase governs the finding. A
  // deliberately abbreviated baseline caps the causal claim, it does not block
  // a finding, because prolonging a pretreatment condition has its own cost.
  test('an abbreviated 2-point baseline still yields a finding', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'Baseline', cond: 'base', data: '14, 16' },
          { name: 'Plan 1', cond: 'tx', data: '12,10,9,7,8,6,5,4,5,3,4,2' },
        ],
        { direction: 'dec' },
      ),
    );
    expect(res.finding).toBe('Progressing');
    // ...and it is honest that the comparison cannot count as a demonstration.
    expect(res.causal.level).toBe('ineligible');
    expect(res.rating.demonstrations).toBe(0);
  });

  // The headline defect in v3: an AB design cannot demonstrate a functional
  // relation, however clean the separation.
  test('an AB design never claims a functional relation', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'Baseline', cond: 'base', data: '20,22,19,21,20,23' },
          { name: 'Plan 1', cond: 'tx', data: '3,2,4,3,2,1,2,3' },
        ],
        { direction: 'dec' },
      ),
    );
    expect(res.finding).toBe('Progressing');
    expect(res.structure.design.letters).toBe('AB');
    expect(res.causal.level).toBe('correlation');
    expect(res.causal.headline).not.toMatch(/functional/i);
    expect(res.rating.demonstrations).toBe(1);
    expect(res.causal.body).toMatch(/cannot demonstrate a functional relation/i);
  });

  // WWC v5.0: "nonsequential phases cannot serve as demonstrations". A short
  // phase invalidates both transitions that touch it, so a record can carry
  // plenty of data overall and still fail on where the data sit.
  test('a short middle phase invalidates both adjacent transitions', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'A1', cond: 'base', data: '10,11,9,12,10,11' },
          { name: 'B1', cond: 'tx', data: '4,3,5,4,3' },
          { name: 'A2', cond: 'base', data: '9,10' },
          { name: 'B2', cond: 'tx', data: '3,4,3,2,4' },
        ],
        { direction: 'dec' },
      ),
    );
    expect(res.structure.design.letters).toBe('ABAB');
    expect(res.structure.transitions).toHaveLength(3);
    expect(res.rating.demonstrations).toBe(1);
    expect(res.causal.level).toBe('correlation');
  });

  test('a clean ABAB reaches three demonstrations', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'A1', cond: 'base', data: '10,11,9,12,10,11' },
          { name: 'B1', cond: 'tx', data: '4,3,5,4,3' },
          { name: 'A2', cond: 'base', data: '9,10,11,10,9' },
          { name: 'B2', cond: 'tx', data: '3,4,3,2,4' },
        ],
        { direction: 'dec' },
      ),
    );
    expect(res.rating.demonstrations).toBe(3);
    expect(res.causal.level).toBe('functional');
    expect(res.reversibility.available).toBe(true);
  });

  // Six drawn phase changes, one condition change. Reading the staffing changes
  // as demonstrations of effect is the exact misread this collapse prevents.
  test('consecutive baseline segments collapse to one condition', async ({ page }) => {
    const res = await page.evaluate(() => {
      const phases = [
        { name: 'Baseline A', cond: 'base', data: '7, 0' },
        { name: 'Baseline B', cond: 'base', data: '1, 5, 1' },
        { name: 'Baseline C', cond: 'base', data: '1, 1, 18, 12, 17, 6' },
        { name: 'Baseline D', cond: 'base', data: '0, 0, 0, 0, 0, 1, 0, 1' },
        { name: 'Baseline E', cond: 'base', data: '1, 0, 1, 0, 4, 3, 2, 1, 2, 3, 2' },
        { name: 'Baseline F', cond: 'base', data: '5, 2, 0, 1, 5, 5, 4, 6, 12, 1, 0, 1, 0, 1, 5, 3, 10' },
        { name: 'Plan 1', cond: 'tx', data: '2, 10, 9, 13, 6, 2, 5, 5, 7, 4' },
      ];
      return window.GVA_VERDICT.evaluate(phases, { direction: 'dec' });
    });
    expect(res.structure.design.letters).toBe('AB');
    expect(res.structure.withinChanges).toHaveLength(5);
    expect(res.rating.demonstrations).toBe(1);
    // Behavior rose on a reduction target, so this is not merely "no effect".
    expect(res.finding).toBe('Not Progressing');
    expect(res.decision.mode).toBe('countertherapeutic');
  });

  // A 25% envelope around a median of 3 is plus or minus 0.75, which on whole
  // counts nothing but an exact 3 can satisfy. Reporting that as instability
  // blames the client for an artifact of the criterion.
  test('the stability envelope reports when it is finer than the measurement grain', async ({ page }) => {
    const st = await page.evaluate(() =>
      window.GVA_STATS.stability([5, 2, 0, 1, 5, 5, 4, 6, 12, 1, 0, 1, 0, 1, 5, 3, 10], {}),
    );
    expect(st.median).toBe(3);
    expect(st.halfWidth).toBeCloseTo(0.75, 6);
    expect(st.subGrain).toBe(true);
  });

  /* Slope reversal across a phase line.
   *
   * His ruling of 2026-08-09: in funder-paid clinical work a reversal phase is
   * commonly withheld on purpose, so a directional flip at the phase line is
   * one of the few correlational signals actually available. It argues about
   * attribution, so it sits on the causal axis and never promotes correlation
   * to a functional relation. His caveat rides with it: a cyclical series can
   * manufacture a flip wherever the phase line happens to fall.
   */
  test('a climbing baseline that flips at the line is a reversal, and it is immediate', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'Baseline', cond: 'base', data: '4,5,6,7,9,10,12' },
          { name: 'Plan 1', cond: 'tx', data: '11,9,7,6,4,3,2,2' },
        ],
        { direction: 'dec' },
      ),
    );
    const rev = res.primary.trend.reversal;
    expect(rev.present).toBe(true);
    expect(rev.immediate).toBe(true);
    expect(rev.cyclicalCaution).toBe(false);
    expect(res.causalNote).toMatch(/turned at the phase line/i);
    // It must still refuse to call it causal.
    expect(res.causalNote).toMatch(/does not establish a functional relation/i);
    expect(res.causal.level).toBe('correlation');
  });

  test('a flat baseline gives a trend change, not a reversal', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'Baseline', cond: 'base', data: '10,10,11,10,10,11' },
          { name: 'Plan 1', cond: 'tx', data: '9,8,6,5,4,3' },
        ],
        { direction: 'dec' },
      ),
    );
    expect(res.primary.trend.reversal.present).toBe(false);
    expect(res.causalNote).toBeNull();
    expect(res.rationale.map((l) => l.text).join(' ')).toMatch(/bend in the line rather than a turnaround/i);
  });

  // The bend branch reads trend only. On the sample record the level rises
  // while the within-phase slope runs the right way, and saying "behavior
  // improved" there contradicted the level line two paragraphs above it.
  test('the bend branch claims nothing about level', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'Baseline F', cond: 'base', data: '5,2,0,1,5,5,4,6,12,1,0,1,0,1,5,3,10' },
          { name: 'Plan 1', cond: 'tx', data: '2,10,9,13,6,2,5,5,7,4' },
        ],
        { direction: 'dec' },
      ),
    );
    const text = res.rationale.map((l) => l.text).join(' ');
    // Level went the wrong way on this record, so no line may say it improved.
    expect(res.primary.level.therapeutic).toBe(false);
    expect(text).toMatch(/bend in the line rather than a turnaround/i);
    expect(text).not.toMatch(/behavior improved/i);
  });

  test('a cyclical baseline suspends the reversal claim rather than banking it', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'Baseline', cond: 'base', data: '2,11,3,12,4,13,5,14' },
          { name: 'Plan 1', cond: 'tx', data: '12,3,10,2,8,1,6,1' },
        ],
        { direction: 'dec' },
      ),
    );
    const rev = res.primary.trend.reversal;
    expect(rev.present).toBe(true);
    expect(rev.cyclicalCaution).toBe(true);
    expect(res.causalNote).toMatch(/unresolved/i);
    // The signature is asserted by its stable name, not by its wording, so the
    // prose stays free to change without weakening the pin.
    const kinds = await page.evaluate(
      () => window.GVA_CYCLES.describe(
        window.GVA_CYCLES.cyclicality([2, 11, 3, 12, 4, 13, 5, 14]), 'Baseline',
      ).map((e) => e.kind),
    );
    expect(kinds).toContain('alternation');
  });

  // Kendall's turning point test. A strict zig-zag maximises turning points at
  // n-2; a monotone series has none. The expectation is 2(n-2)/3.
  test('the turning point test separates oscillation from a trend', async ({ page }) => {
    const got = await page.evaluate(() => {
      const C = window.GVA_CYCLES;
      return {
        zig: C.turningPoints([1, 9, 1, 9, 1, 9, 1, 9, 1, 9]),
        mono: C.turningPoints([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        short: C.turningPoints([1, 5, 2]),
      };
    });
    expect(got.zig.count).toBe(8);
    expect(got.zig.expected).toBeCloseTo(16 / 3, 6);
    expect(got.zig.oscillating).toBe(true);
    expect(got.mono.count).toBe(0);
    expect(got.mono.oscillating).toBe(false);
    // Refuses rather than computing a z-score from three points.
    expect(got.short.available).toBe(false);
  });

  // Redaction has to be destructive before upload, not a warning the clinician
  // is trusted to heed. The bytes that leave must not contain the source pixels.
  test('redaction bakes opaque pixels into the uploaded bitmap', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.style.width = '200px';
      document.body.appendChild(host);
      const ed = window.GVA_REDACT.create(host, {});

      const c = document.createElement('canvas');
      c.width = 200; c.height = 100;
      const cx = c.getContext('2d');
      cx.fillStyle = '#ff0000';
      cx.fillRect(0, 0, 200, 100);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const file = new File([blob], 'graph.png', { type: 'image/png' });

      await ed.load(file);
      // Coordinates must be taken from the canvas's own rect: the editor
      // converts clientX/clientY through getBoundingClientRect(), and the host
      // sits far down the page.
      const rect = ed.canvas.getBoundingClientRect();
      const fire = (target, type, x, y) =>
        target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
      fire(ed.canvas, 'mousedown', rect.left, rect.top);
      fire(window, 'mousemove', rect.left + 100, rect.top + 60);
      fire(window, 'mouseup', rect.left + 100, rect.top + 60);

      const baked = ed.bake();
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = baked.dataUrl; });
      const check = document.createElement('canvas');
      check.width = img.width; check.height = img.height;
      const ccx = check.getContext('2d');
      ccx.drawImage(img, 0, 0);
      const covered = ccx.getImageData(2, 2, 1, 1).data;
      const untouched = ccx.getImageData(img.width - 3, img.height - 3, 1, 1).data;
      return {
        redactions: baked.redactions,
        hasData: !!baked.base64,
        covered: [covered[0], covered[1], covered[2]],
        untouched: [untouched[0], untouched[1], untouched[2]],
      };
    });

    expect(out.redactions).toBeGreaterThan(0);
    expect(out.hasData).toBe(true);
    // The covered corner is black, not the red of the source bitmap.
    expect(out.covered).toEqual([0, 0, 0]);
    // ...and the redaction is targeted rather than blanket, so the rest of the
    // graph survives and stays readable.
    expect(out.untouched).toEqual([255, 0, 0]);
  });

  // Default-deny: a signed-in user whose password does not carry the slug sees
  // the button relabel rather than disappear, matching every other gated tool.
  test('a user without the slug is denied, and an admin is not', async ({ page }) => {
    const seed = (payload) => {
      const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem('notes_auth_token', b64 + '.unverified-signature');
      document.dispatchEvent(new CustomEvent('notes-auth-change'));
    };

    const exp = Math.floor(Date.now() / 1000) + 3600;

    await page.evaluate(([seedSrc, exp]) => {
      // eslint-disable-next-line no-new-func
      new Function('payload', `(${seedSrc})(payload)`)({ exp, role: 'user', kid: 'x', tools: ['bt'] });
    }, [seed.toString(), exp]);
    await page.reload();
    await page.waitForFunction(() => !!document.querySelector('#extract'));
    await expect(page.locator('#extract')).toHaveText('No access for this tool');
    await expect(page.locator('#extract')).toBeDisabled();

    await page.evaluate(([seedSrc, exp]) => {
      // eslint-disable-next-line no-new-func
      new Function('payload', `(${seedSrc})(payload)`)({ exp, role: 'admin' });
    }, [seed.toString(), exp]);
    await page.reload();
    await page.waitForFunction(() => !!document.querySelector('#extract'));
    // Admin bypasses per-tool scope on both the client and the server.
    await expect(page.locator('#extract')).toHaveText('Read graph');
    await expect(page.locator('#extract')).toBeEnabled();
  });

  test('typed phase data survives a reload and logout clears it', async ({ page }) => {
    const field = page.locator('#phases textarea').first();
    await field.waitFor();
    await field.fill('9, 8, 7, 6');
    // Drafts are encrypted at rest, so the stored value is ciphertext and
    // asserting on the plaintext would only prove the encryption was broken.
    // Existence here, round-trip through a reload below.
    await page.waitForFunction(() => !!localStorage.getItem('notes_draft_graphva'));
    await page.reload();
    await expect(page.locator('#phases textarea').first()).toHaveValue('9, 8, 7, 6');

    await page.evaluate(() => window.NotesGate.logout());
    const remaining = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.indexOf('notes_draft_') === 0),
    );
    expect(remaining).toEqual([]);
  });

  /* The two registers.
   *
   * His ruling of 2026-08-09: the reading is for an analyst who works in visual
   * analysis and not in statistics, so the numbers have to be translated rather
   * than printed. The arithmetic still has to exist for anyone defending the
   * record, which is what `detail` holds. These two tests are the pin: the
   * first fails if jargon leaks back up into the reading, the second fails if
   * translating the reading quietly deletes the model underneath it.
   */
  const JARGON = [
    /\bNAP\b/, /Mann-Whitney/i, /\bp\s*[=<]/, /binomial/i, /Theil-Sen/i, /autocorrelation/i,
    /log response ratio/i, /standard error/i, /confidence interval/i, /\b95% CI\b/, /lag-\d/i,
    /null distribution/i, /Type I error/i, /\bSD\b/, /\bd = /, /criterion line/i, /nonoverlap/i,
  ];

  // Records chosen between them to fire every rationale branch, including the
  // ones that restate a method's own unavailability reason. The short-phase
  // cases matter most: their reasons are written in the method's language and
  // were the branch that leaked "the binomial cannot reach p < .05".
  const WIDE = [
    { name: 'Baseline', cond: 'base', data: '4,9,5,11,6,12,8,14,9,15' },
    { name: 'Plan 1', cond: 'tx', data: '13,9,6,4,3,2,2' },
  ];
  const REGISTER_CASES = [
    ['a full record', WIDE, 'dec'],
    ['a two-point plan phase', [
      { name: 'Baseline', cond: 'base', data: '9,10,8,11,9,10' },
      { name: 'Plan 1', cond: 'tx', data: '3,2' },
    ], 'dec'],
    ['a four-point plan phase', [
      { name: 'Baseline', cond: 'base', data: '9,10,8,11,9,10' },
      { name: 'Plan 1', cond: 'tx', data: '3,2,4,2' },
    ], 'dec'],
    ['an abbreviated baseline', [
      { name: 'Baseline', cond: 'base', data: '12,14' },
      { name: 'Plan 1', cond: 'tx', data: '2,1,3' },
    ], 'dec'],
    ['an acquisition target', [
      { name: 'A1', cond: 'base', data: '2,3,1,2,3,2' },
      { name: 'B1', cond: 'tx', data: '6,7,8,9,10' },
      { name: 'A2', cond: 'base', data: '4,3,4,3,4' },
      { name: 'B2', cond: 'tx', data: '9,10,11,12,11' },
    ], 'inc'],
  ];

  for (const [label, phases, direction] of REGISTER_CASES) {
    test(`no reading leaks a statistical term into the clinician register: ${label}`, async ({ page }) => {
      const texts = await page.evaluate(
        ([p, d]) => window.GVA_VERDICT.evaluate(p, { direction: d }).rationale.map((l) => l.text),
        [phases, direction],
      );
      expect(texts.length).toBeGreaterThan(2);
      for (const text of texts) {
        for (const pattern of JARGON) {
          expect(text, `"${text}" leaks ${pattern}`).not.toMatch(pattern);
        }
      }
    });
  }

  test('the arithmetic survives underneath the reading', async ({ page }) => {
    const lines = await page.evaluate(
      (phases) => window.GVA_VERDICT.evaluate(phases, { direction: 'dec' }).rationale,
      WIDE,
    );
    const details = lines.map((l) => l.detail).filter(Boolean).join(' ');
    // Whatever the wording above it, the index and its value stay checkable.
    expect(details).toMatch(/\bNAP\b/);
    expect(details).toMatch(/Theil-Sen/);
    expect(details).toMatch(/Median/);
  });

  // The sentence he struck on 2026-08-09: the tool does not explain to a BCBA
  // why their own field withholds a reversal.
  test('the causal body states the limit without explaining clinical practice', async ({ page }) => {
    const body = await page.evaluate(
      () => window.GVA_VERDICT.evaluate(
        [
          { name: 'Baseline', cond: 'base', data: '20,22,19,21,20,23' },
          { name: 'Plan 1', cond: 'tx', data: '3,2,4,3,2,1,2,3' },
        ],
        { direction: 'dec' },
      ).causal.body,
    );
    expect(body).toMatch(/cannot demonstrate a functional relation/i);
    expect(body).not.toMatch(/funder|withh|cascading|treatment decision/i);
  });

  /* Three defects that only surfaced once the prose was printed and read.
   * Green assertions coexisted with all of them.
   */

  // Any short series of noise around a level has a negative lag-1, so the bare
  // sign called a flat baseline cyclical and suspended a clean claim for nothing.
  test('an ordinary flat baseline is not called cyclical', async ({ page }) => {
    const flat = await page.evaluate(() => [
      window.GVA_CYCLES.cyclicality([20, 22, 19, 21, 20, 23]).cyclical,
      window.GVA_CYCLES.cyclicality([9, 10, 8, 11, 9, 10]).cyclical,
      // A genuine period-2 series must still fire, or the guard has just
      // deleted the signal rather than sharpened it.
      window.GVA_CYCLES.cyclicality([2, 11, 3, 12, 4, 13, 5, 14]).cyclical,
    ]);
    expect(flat).toEqual([false, false, true]);
  });

  // The refusal said nothing computed on the phase means anything in either
  // direction, and the paragraph below it narrated a turn drawn through 2 points.
  test('a hard refusal narrates no trend and banks no attribution', async ({ page }) => {
    const res = await page.evaluate(() =>
      window.GVA_VERDICT.evaluate(
        [
          { name: 'Baseline', cond: 'base', data: '9,10,8,11,9,10' },
          { name: 'Plan 1', cond: 'tx', data: '3,2' },
        ],
        { direction: 'dec' },
      ),
    );
    expect(res.finding).toBe('In Treatment');
    expect(res.decision.severity).toBe('hard');
    expect(res.causalNote).toBeNull();
    const text = res.rationale.map((l) => l.text).join(' ');
    expect(text).not.toMatch(/turned at the phase line|bend in the line/i);
    // The refusal itself, and the level, still print.
    expect(text).toMatch(/holds 2 sessions/);
    expect(text).toMatch(/A typical session moved/);
  });

  test('the arithmetic is off by default and appears when asked for', async ({ page }) => {
    await expect(page.locator('#verdict .vbody p').first()).toBeVisible();
    expect(await page.locator('#verdict .vbody p.stat').count()).toBe(0);

    await page.locator('#showStats').check();
    expect(await page.locator('#verdict .vbody p.stat').count()).toBeGreaterThan(0);

    // The choice rides in the draft, so it survives a reload.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#verdict .vfinding'));
    await expect(page.locator('#showStats')).toBeChecked();
  });
});
