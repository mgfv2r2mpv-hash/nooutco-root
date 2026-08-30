import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* The Expert Pass bench, on the admin page.
 *
 * WHY IT EXISTS AT ALL. A route nobody can call answers nothing. The whole
 * point of running the expert beside the drafting loop is to read it against
 * the hint catalog on the same intake, and that needs a surface. This one is a
 * bench rather than a feature: it writes nothing, saves nothing, and applies
 * nothing to any note.
 *
 * THE COMPARISON IS THE POINT, so the catalog it draws is the live one, read
 * out of window.NOTE_TOOLS rather than copied into the page. A copy would
 * drift, and a drifted catalog would look like the expert winning.
 *
 * The pass itself is mocked here. Whether the model finds the right things is
 * not a claim a test can make; whether the page shows what came back, and says
 * the honest thing when nothing came back, is.
 */

const SECRET = 'playwright-local-test-secret';
const TOKEN_KEY = 'notes_auth_token';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function adminToken() {
  const payload = { role: 'admin', kid: 'pw:admin', exp: Math.floor(Date.now() / 1000) + 3600 };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}

const FINDINGS = {
  terms: [
    { token: 'SBT', reading: 'Skills-Based Treatment', status: 'resolved', why: 'Named beside toleration training.' },
    { token: 'PT', reading: '', status: 'unknown', why: 'Could be physical therapy or a probe trial here.' },
  ],
  register: [
    {
      quote: 'he wanted attention',
      action: 'reframe',
      why: 'A function claim. Function belongs to the analysis.',
      move: "He pulled at staff's sleeve and staff turned toward him.",
    },
    {
      quote: 'approached staff and was happy',
      action: 'keep',
      why: 'The approach is the evidence and the note is written the way notes are written.',
      move: 'Leave it.',
    },
  ],
  hints: [
    { section: 'note', rank: 1, kind: 'blocks-claim', ask: 'You mentioned elopement, how many times?', why: 'A funder rejects a claim with no count.' },
    { section: 'note', rank: 2, kind: 'thin', ask: 'Which prompt level did you use?', why: '' },
  ],
  hintsDropped: 0,
  usage: { input_tokens: 120, output_tokens: 300, cache_read_input_tokens: 4100, cache_creation_input_tokens: 0 },
  model: 'claude-haiku-4-5-20251001',
};

async function openBench(page, findings) {
  await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
  if (findings !== undefined) {
    await page.route('**/api/expert-pass', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(findings) })
    );
  }
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Expert', exact: true }).click();
}

test.describe('the bench reads the live tool registry', () => {
  test('a tool is offered only when its section list can be read, never guessed', async ({ page }) => {
    /* A tool is offered when its section list can be READ, never when it can be
       guessed at. All five declare a responseSchema since 2026-08-30, so the
       offered list is currently the whole registry - but the test compares the
       page against the registry rather than against a count, so a tool losing
       its schema drops out of both sides together instead of being inferred.
       Offering a tool blind would mean every hint came back filed under "note",
       and the expert would look unable to tell sections apart. */
    await openBench(page);
    const ids = await page.locator('#exTool option').evaluateAll((opts) => opts.map((o) => o.value));
    const readable = await page.evaluate(() =>
      window.NOTE_TOOLS
        .filter((t) => t.hintCatalog && Array.isArray(t.responseSchema?.properties?.hints?.items?.properties?.section?.enum))
        .map((t) => t.id)
    );
    expect(ids).toEqual(readable);
    expect(ids).toContain('bt');
    expect(ids.length).toBeGreaterThan(0);
  });

  test('and the page says how many were left out, rather than showing a short list silently', async ({ page }) => {
    await openBench(page);
    const total = await page.evaluate(() => window.NOTE_TOOLS.length);
    const shown = await page.locator('#exTool option').count();
    if (shown < total) {
      await expect(page.locator('#exToolNote')).toContainText(`${shown} of ${total} tools`);
    } else {
      await expect(page.locator('#exToolNote')).toHaveText('');
    }
  });

  test('the catalog it shows is the real one, not a copy that could drift', async ({ page }) => {
    await openBench(page);
    const live = await page.evaluate(() => {
      const t = window.NOTE_TOOLS.find((x) => x.id === 'bt');
      return Object.keys(t.hintCatalog);
    });
    const shown = await page.locator('#exCatalog .cat-row code').allTextContents();
    expect(shown).toEqual(live);
    // The ceiling, stated as a number on the page so the comparison has a size.
    await expect(page.locator('#exCatalog')).toContainText(`${live.length} codes`);
  });

  test('switching tools switches the catalog', async ({ page }) => {
    await openBench(page);
    const btCodes = await page.locator('#exCatalog .cat-row code').allTextContents();
    await page.selectOption('#exTool', 'sap');
    const supCodes = await page.locator('#exCatalog .cat-row code').allTextContents();
    expect(supCodes).not.toEqual(btCodes);
  });

  test('the sections it sends are the tool\'s own section ids', async ({ page }) => {
    // The section list shapes the response enum, so sending the wrong one would
    // make every hint come back filed under "note" and look like the expert
    // could not tell sections apart.
    let sent = null;
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    await page.route('**/api/expert-pass', (route) => {
      sent = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FINDINGS) });
    });
    await page.goto('/admin/');
    await page.getByRole('button', { name: 'Expert', exact: true }).click();

    const ids = await page.locator('#exTool option').evaluateAll((o) => o.map((x) => x.value));
    for (const id of ids) {
      await page.selectOption('#exTool', id);
      await page.fill('#exIntake', 'Ran SBT. He wanted attention.');
      await page.click('#exRun');
      await expect(page.locator('#exTerms .finding').first()).toBeVisible();

      const want = await page.evaluate((toolId) => {
        const t = window.NOTE_TOOLS.find((x) => x.id === toolId);
        return t.responseSchema.properties.hints.items.properties.section.enum.filter((v) => v !== 'note');
      }, id);
      expect(sent.tool, `the bench sent the wrong tool id for ${id}`).toBe(id);
      expect(sent.sections, `${id} got the wrong section list`).toEqual(want);
      expect(want.length, `${id} would send an empty section list`).toBeGreaterThan(0);
      expect(sent.intake).toBe('Ran SBT. He wanted attention.');
    }
  });

  test('formSections is the obvious wrong source, and the page reads the schema instead', async ({ page }) => {
    /* The wrong turn, kept as a test so nobody takes it again. Every one of the
       five tools has formSections, so a bench reading it would have offered all
       five and looked complete. But formSections is a render order and
       SECTION_IDS is the contract: only bt derives one from the other, and the
       rest each keep a separate list nothing on the page could check. A tool
       offered off the wrong structure gets sent the wrong ids, every hint comes
       back filed under "note", and the expert looks unable to tell one section
       from another.

       All five carry a schema now, so no tool is currently left out - which
       makes the two assertions below the whole point rather than a formality.
       They say the offered list IS the readable list, in both directions, so a
       tool losing its schema leaves the menu rather than being guessed at. */
    await openBench(page);
    const shape = await page.evaluate(() =>
      window.NOTE_TOOLS.map((t) => ({
        id: t.id,
        hasForm: Array.isArray(t.formSections) && t.formSections.length > 0,
        hasSchema: Array.isArray(t.responseSchema?.properties?.hints?.items?.properties?.section?.enum),
      }))
    );
    const blind = shape.filter((t) => t.hasForm && !t.hasSchema).map((t) => t.id);
    const offered = await page.locator('#exTool option').evaluateAll((o) => o.map((x) => x.value));
    for (const id of blind) {
      expect(offered, `${id} has no verifiable section list and must not be offered`).not.toContain(id);
    }
    expect(
      [...offered].sort(),
      'a tool whose section list can be read is not being offered',
    ).toEqual(shape.filter((t) => t.hasSchema).map((t) => t.id).sort());

    /* And where both sources do exist they agree, which is what makes the
       schema safe to read rather than merely available. */
    const conflict = await page.evaluate(() =>
      window.NOTE_TOOLS.filter((t) => {
        const fromSchema = t.responseSchema?.properties?.hints?.items?.properties?.section?.enum;
        if (!Array.isArray(fromSchema)) return false;
        const fromForm = (t.formSections || []).map((s) => s.key || s.group).filter(Boolean);
        return JSON.stringify(fromSchema.filter((v) => v !== 'note')) !== JSON.stringify(fromForm);
      }).map((t) => t.id)
    );
    expect(conflict, 'a tool disagrees with itself about its own sections').toEqual([]);
  });
});

test.describe('what the bench draws', () => {
  test('a resolved term and an unresolved one are drawn differently', async ({ page }) => {
    // An unknown is the honest answer rather than a failure, and it has to look
    // different from a confident one or the whole distinction is decoration.
    await openBench(page, FINDINGS);
    await page.fill('#exIntake', 'x');
    await page.click('#exRun');
    await expect(page.locator('#exTerms')).toContainText('SBT = Skills-Based Treatment');
    await expect(page.locator('#exTerms .tag-resolved')).toHaveCount(1);
    await expect(page.locator('#exTerms .tag-unknown')).toHaveCount(1);
  });

  test('a reframe carries its replacement sentence, not the rule it broke', async ({ page }) => {
    await openBench(page, FINDINGS);
    await page.fill('#exIntake', 'x');
    await page.click('#exRun');
    await expect(page.locator('#exRegister')).toContainText("staff turned toward him");
    await expect(page.locator('#exRegister .tag-reframe')).toHaveCount(1);
  });

  test('a keep is shown, because the over-correction costs as much as the error', async ({ page }) => {
    // "He approached staff and was happy" is how these notes are really
    // written. A bench that only listed problems would train the reader to
    // treat every register finding as something to cut.
    await openBench(page, FINDINGS);
    await page.fill('#exIntake', 'x');
    await page.click('#exRun');
    await expect(page.locator('#exRegister .tag-keep')).toHaveCount(1);
  });

  test('hints are drawn in the model\'s own order, with severity beside them', async ({ page }) => {
    await openBench(page, FINDINGS);
    await page.fill('#exIntake', 'x');
    await page.click('#exRun');
    // allTextContents does not retry, so wait for the render the way the other
    // assertions in this file do before reading the list out.
    await expect(page.locator('#exHints .finding')).toHaveCount(2);
    const asks = await page.locator('#exHints .finding .move').allTextContents();
    expect(asks[0]).toContain('1.');
    expect(asks[0]).toContain('elopement');
    await expect(page.locator('#exHints .tag-blocks-claim')).toHaveCount(1);
  });

  test('an empty finding list says so plainly instead of looking broken', async ({ page }) => {
    // The prompt tells the expert that finding nothing is a result. The page
    // has to agree, or a clean note reads as a failed call.
    await openBench(page, { terms: [], register: [], hints: [], hintsDropped: 0, model: 'm', usage: {} });
    await page.fill('#exIntake', 'x');
    await page.click('#exRun');
    await expect(page.locator('#exRegister')).toContainText('Nothing mentalistic');
    await expect(page.locator('#exTerms')).toContainText('No abbreviations');
    await expect(page.locator('#exHints')).toContainText('Nothing it would ask about');
  });

  test('hints cut by the ceiling are reported, never dropped silently', async ({ page }) => {
    await openBench(page, { ...FINDINGS, hintsDropped: 3 });
    await page.fill('#exIntake', 'x');
    await page.click('#exRun');
    await expect(page.locator('#exHints')).toContainText('3 lower-ranked hint(s)');
  });

  test('an error from the route is shown rather than swallowed', async ({ page }) => {
    // The state production sits in until the store ships the expert key, so
    // this is the message the first person to open the tab will actually meet.
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    await page.route('**/api/expert-pass', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'The expert is unavailable, so nothing was reviewed. Nothing was sent to the model.' }),
      })
    );
    await page.goto('/admin/');
    await page.getByRole('button', { name: 'Expert', exact: true }).click();
    await page.fill('#exIntake', 'x');
    await page.click('#exRun');
    await expect(page.locator('#exErr')).toContainText('nothing was reviewed');
  });

  test('it refuses to send an empty intake at all', async ({ page }) => {
    let called = false;
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    await page.route('**/api/expert-pass', (route) => { called = true; return route.fulfill({ status: 200, body: '{}' }); });
    await page.goto('/admin/');
    await page.getByRole('button', { name: 'Expert', exact: true }).click();
    await page.click('#exRun');
    await expect(page.locator('#exErr')).toContainText('Paste an intake');
    expect(called).toBe(false);
  });

  test('the cost of the call is on the page, because that is half the comparison', async ({ page }) => {
    // "Does the expert beat the catalog" is partly a question about what it
    // costs, and the cached read is the number that decides it: the knowledge
    // is a stable prefix on every call.
    await openBench(page, FINDINGS);
    await page.fill('#exIntake', 'x');
    await page.click('#exRun');
    await expect(page.locator('#exUsage')).toContainText('4100 cached');
  });
});

/* THE SIXTH TAB, which is the part no assertion in this file could see.
 *
 * Adding it pushed the nav to 555px inside a 390px phone and gave the whole
 * admin page a horizontal scrollbar. Twelve green tests said nothing, and a
 * screenshot said it immediately. So the measurement becomes a test.
 *
 * Two numbers, and they pull against each other: the nav must wrap on a phone
 * and must NOT wrap on a desktop, where 700px of nav holds seven labels only
 * because three of them were shortened to buy the room. Knowledge was the tab
 * that forced that: at the old labels the row measured 769px in Verdana inside
 * a 700px nav, and PII, Non-PII and Profiles brought it to 629 with 71px
 * spare. Nothing about the padding or the font size changed, which is why the
 * row still looks the way it did. */
test.describe('the nav still fits after a seventh tab', () => {
  for (const width of [320, 390, 430, 768, 1280]) {
    test(`no horizontal scroll at ${width}`, async ({ page }) => {
      await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/admin/');
      await page.getByRole('button', { name: 'Expert', exact: true }).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `the admin page scrolls sideways by ${overflow}px at ${width}`).toBeLessThanOrEqual(0);
    });
  }

  /* THE FONT IS FORCED, AND THAT IS THE WHOLE POINT.
   *
   * The admin page asks for the system UI stack, so the nav is laid out in a
   * different typeface on every platform: San Francisco here, DejaVu Sans on the
   * Linux CI runners, whatever Windows offers. The first version of this test
   * asserted one row in "whatever font this machine happens to have", passed on
   * three engines locally, and then failed on firefox and webkit in CI while
   * chromium passed. Nothing was wrong with the page that day. The test was
   * measuring something it could not know the value of.
   *
   * So it pins the font to a wide one instead. Verdana is a deliberate stand-in
   * for the widest fallback the page can realistically land on, and it is
   * present on every platform this suite runs on. Fitting in Verdana means
   * fitting in San Francisco with room to spare, which makes this a STRONGER
   * guard than the original and a deterministic one. */
  const WIDE_STACK = 'Verdana, "DejaVu Sans", Tahoma, sans-serif';

  async function measureNav(page, fontStack) {
    return page.evaluate((stack) => {
      if (stack) document.body.style.fontFamily = stack;
      const nav = document.querySelector('.tab-nav');
      const btns = [...document.querySelectorAll('.tab-nav .tab-btn')];
      const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
      const navWidth = nav.getBoundingClientRect().width;
      const tabsWidth = btns.reduce((a, b) => a + b.getBoundingClientRect().width, 0) + gap * (btns.length - 1);
      return {
        rows: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top))).size,
        navWidth: Math.round(navWidth),
        tabsWidth: Math.round(tabsWidth),
        margin: Math.round(navWidth - tabsWidth),
        font: getComputedStyle(btns[0]).fontFamily.split(',')[0].replace(/["']/g, ''),
      };
    }, fontStack);
  }

  test('the tabs stay on one row at desktop width, in a font wider than this machine has', async ({ page }) => {
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin/');
    await page.evaluate(() => document.fonts.ready);

    const m = await measureNav(page, WIDE_STACK);
    expect(
      m.rows,
      `seven tabs wrapped to ${m.rows} rows in ${m.font}: they measure ${m.tabsWidth}px inside a ${m.navWidth}px nav, ${-m.margin}px too wide`
    ).toBe(1);
    // A pass with no room left is the failure this test was rewritten to stop
    // shipping, so it has to be a pass with room in it.
    expect(m.margin, `the nav fits in ${m.font} by only ${m.margin}px, which is inside the noise between engines`).toBeGreaterThan(20);
  });

  test('and the fit is comfortable in whatever font this platform actually uses', async ({ page }) => {
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin/');
    await page.evaluate(() => document.fonts.ready);

    const m = await measureNav(page, null);
    expect(m.rows, `seven tabs wrapped to ${m.rows} rows in this platform's own ${m.font}`).toBe(1);
    expect(m.margin, `only ${m.margin}px spare in ${m.font}`).toBeGreaterThan(20);
  });

  test('and wrap rather than scroll on a phone', async ({ page }) => {
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/admin/');
    const rows = await page.evaluate(() => {
      const tops = [...document.querySelectorAll('.tab-nav .tab-btn')].map((b) => Math.round(b.getBoundingClientRect().top));
      return new Set(tops).size;
    });
    expect(rows).toBeGreaterThan(1);
  });
});
