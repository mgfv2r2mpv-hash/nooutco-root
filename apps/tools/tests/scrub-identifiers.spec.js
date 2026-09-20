import { test, expect } from '@playwright/test';

// The tool's own disclaimer has always told clinicians that PHI includes "dates
// of birth, addresses, phone numbers, ID or insurance numbers". Detection only
// ever covered person names, so the page was advertising a control it did not
// have. These pin the rest of it.
//
// scrub-test.html is used deliberately: it loads notes-gate.js WITHOUT React,
// Babel or Turnstile, so these run fast and cannot fail on a CDN hiccup.

async function detect(page, text) {
  return page.evaluate((t) => window.NotesGate._scrub.detectIdentifiers(t), text);
}

async function mapFor(page, text) {
  return page.evaluate((t) => window.NotesGate._scrub.buildIdentifierMap(t), text);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/scrub-test.html');
  await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate._scrub && window.NotesGate._scrub.detectIdentifiers));
});

test.describe('non-name identifier detection', () => {
  const CAUGHT = [
    ['a date of birth', 'DOB 03/14/2016 per the intake packet', 'DATE'],
    ['a written date', 'Reassessment due September 3, 2026', 'DATE'],
    ['a phone number', 'Mom asked for a call back at (555) 213-4477', 'PHONE'],
    ['a dotted phone number', 'callback 555.213.4477 after 5', 'PHONE'],
    ['a street address', 'Session held at 1420 Maple Street', 'ADDRESS'],
    ['an email', 'Guardian emailed from parent.name@example.com', 'EMAIL'],
    ['an SSN', 'SSN 123-45-6789 on the form', 'SSN'],
    ['a record number', 'MRN: A8842213 in the chart', 'ID'],
    ['a member id', 'member ID XZ99120345 on the card', 'ID'],
  ];

  for (const [label, text, type] of CAUGHT) {
    test(`catches ${label}`, async ({ page }) => {
      const hits = await detect(page, text);
      expect(hits.length, `nothing detected in: ${text}`).toBeGreaterThan(0);
      expect(hits.map((h) => h.type)).toContain(type);
    });
  }

  test('tokenises everything it finds, and the text stops carrying it', async ({ page }) => {
    const text = 'DOB 03/14/2016, mom at (555) 213-4477, lives at 1420 Maple Street.';
    const map = await mapFor(page, text);
    const scrubbed = await page.evaluate(
      ({ t, m }) => window.NotesGate._scrub.applyScrub(t, m),
      { t: text, m: map },
    );

    expect(scrubbed).not.toContain('03/14/2016');
    expect(scrubbed).not.toContain('555');
    expect(scrubbed).not.toContain('Maple Street');
    expect(scrubbed).toMatch(/\[DATE_1\]/);
    expect(scrubbed).toMatch(/\[PHONE_1\]/);
    expect(scrubbed).toMatch(/\[ADDRESS_1\]/);
  });

  test('a longer match wins over one nested inside it', async ({ page }) => {
    // The ZIP inside an address must not be replaced first, which would leave a
    // half-token stranded in the middle of the address.
    const hits = await detect(page, 'Clinic at 88 Oak Avenue, CA 94110 today');
    const texts = hits.map((h) => h.text);
    const address = texts.find((t) => /Oak Avenue/.test(t));
    expect(address).toBeTruthy();
    // Nothing kept may be a strict substring of another kept match.
    for (const a of texts) {
      for (const b of texts) {
        if (a !== b) expect(b.includes(a)).toBe(false);
      }
    }
  });

  // Over-scrubbing costs the model context and makes the note worse, so the
  // things a real session note is full of must survive untouched.
  const LEFT_ALONE = [
    'Receptive ID in DTT, 3-item array, 8/10 correct',
    'Elopement x2; blocked and redirected, no escalation',
    'IOA was 92% on tact data',
    'Ran FCT for 20 minutes, then a 5 minute break',
    'Client tolerated 3 of 4 transitions with a 1-minute warning',
    'Token economy: earned 5 tokens toward the preferred item',
  ];

  for (const text of LEFT_ALONE) {
    test(`leaves clinical shorthand alone: "${text.slice(0, 34)}…"`, async ({ page }) => {
      const hits = await detect(page, text);
      expect(hits, `false positive in: ${text}`).toEqual([]);
    });
  }

  test('an empty or absent note detects nothing', async ({ page }) => {
    expect(await detect(page, '')).toEqual([]);
    expect(await detect(page, null)).toEqual([]);
  });
});

/* The clinician read "declined to 20% (1 of 5) from 87% on [DATE_1]" in a signed
 * supervision note on 2026-09-19. Everything upstream of the restore was already
 * right - the date was tokenised, the model only ever saw the token, and the map
 * holding the real date was in the browser the whole time. It was dropped at the
 * last step, because identifier entries were minted without a `restore` flag and
 * restoreOutput keeps only flagged entries.
 *
 * THESE DRIVE restoreOutput, NOT restoreDeep, AND THE DIFFERENCE IS THE WHOLE
 * TEST. restoreDeep substitutes whatever map it is handed, so calling it
 * directly restores the date even on the broken build - the first draft of this
 * file did exactly that and passed against the bug it was written for. The
 * defect lives in restoreOutput's `map.filter(e => e.restore)`, which is the
 * call finalize() actually makes, so that is the seam worth driving.
 */
test.describe('a detected identifier comes back', () => {
  async function roundTrip(page, text, asModelReturnedIt) {
    return page.evaluate(({ t, returned }) => {
      const s = window.NotesGate._scrub;
      const map = s.buildIdentifierMap(t);
      const scrubbed = s.applyScrub(t, map);
      // The model sees `scrubbed` and nothing else. What it hands back is the
      // second argument when a test wants to reshape it, or the scrubbed text
      // itself when the token survives the trip intact.
      const back = returned === null ? scrubbed : returned;
      return { map, scrubbed, restored: window.NotesScrub.restoreOutput(back, map) };
    }, { t: text, returned: asModelReturnedIt ?? null });
  }

  test('the date the clinician typed is in the note again', async ({ page }) => {
    const text = 'Prompt "you can do it" declined to 20% from 87% on 09/03/2026.';
    const { scrubbed, restored } = await roundTrip(page, text);

    // The wire never carried it - that half must not regress either.
    expect(scrubbed).not.toContain('09/03/2026');
    expect(scrubbed).toContain('[DATE_1]');
    // And the clinician gets their own date back.
    expect(restored).toContain('09/03/2026');
    expect(restored).not.toMatch(/\[DATE[_\s-]?\d+\]/i);
  });

  test('every identifier class comes back, not only dates', async ({ page }) => {
    const text = 'DOB 03/14/2016, mom at (555) 213-4477, lives at 1420 Maple Street.';
    const { restored } = await roundTrip(page, text);
    expect(restored).toContain('03/14/2016');
    expect(restored).toContain('555');
    expect(restored).toContain('Maple Street');
  });

  // The one thing an echo mock can never catch: a real model reshapes the token
  // it was given. [[T3]] came back as [T3] and rode into a note once already.
  const RESHAPED = ['[date_1]', '[DATE 1]', '[ DATE_1 ]', '[[DATE_1]]', '[Date-1]'];
  for (const shape of RESHAPED) {
    test(`restores when the model hands it back as ${shape}`, async ({ page }) => {
      // The note issues DATE_1 for the written date, and the model returns the
      // token in a shape it mangled on the way through.
      const { restored } = await roundTrip(
        page,
        'Reassessment due September 3, 2026 per the plan.',
        `Reassessment noted on ${shape} per the plan.`,
      );
      expect(restored, `${shape} was left in the note`).toContain('September 3, 2026');
      expect(restored).not.toContain(shape);
    });
  }

  test('a number this note never issued is the clinician\'s own writing and stays', async ({ page }) => {
    const text = 'Session on 09/03/2026 went well.';
    const { restored } = await roundTrip(page, text, 'Compare [DATE_9] against [DATE_1].');
    expect(restored).toContain('[DATE_9]');
    expect(restored).toContain('09/03/2026');
  });

  test('the map entry is flagged restorable, which is what the filter reads', async ({ page }) => {
    const map = await mapFor(page, 'DOB 03/14/2016 per the intake packet');
    expect(map.length).toBeGreaterThan(0);
    for (const e of map) expect(e.restore, `${e.token} would be dropped by restoreOutput`).toBe(true);
  });
});
