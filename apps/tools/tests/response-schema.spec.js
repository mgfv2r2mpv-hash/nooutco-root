import { test, expect } from '@playwright/test';
import { refusedKeywords } from './helpers/schema.js';

/* The static half of the guard: every tool's own response schema, read off the
 * page without driving a single form.
 *
 * Both pages, because the tools are split across them - bt ships on its own
 * page and the other four on the BCBA page - so checking either one alone
 * leaves schemas nothing looks at.
 *
 * The triage schema is the one that actually broke, and it is covered where its
 * call can be intercepted, in bt-assistant.spec.js. */

const PAGES = [
  { url: '/notes/bcba/index.html', expect: ['sup', 'sap', 'assess', 'parent'] },
  { url: '/notes/bt/index.html', expect: ['bt'] },
];

for (const p of PAGES) {
  test(`no response schema on ${p.url} carries a keyword the API refuses`, async ({ page }) => {
    await page.goto(p.url);
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const schemas = await page.evaluate(() =>
      window.NOTE_TOOLS.map((t) => ({ id: t.id, schema: t.responseSchema || null })),
    );

    // Guard the guard. A page that quietly stopped loading a tool would pass
    // this vacuously, which is the same shape of silence the defect had.
    expect(schemas.map((s) => s.id).sort()).toEqual(p.expect.slice().sort());
    for (const { id, schema } of schemas) {
      expect(schema, `${id} ships no response schema`).toBeTruthy();
      expect(refusedKeywords(schema, id), `${id} response schema`).toEqual([]);
    }
  });
}
