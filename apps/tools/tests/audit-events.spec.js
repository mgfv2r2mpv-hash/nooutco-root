import { test, expect } from '@playwright/test';

// The audit trail is the only durable per-technician record this system keeps,
// and the whole reason it is acceptable to keep one is that it cannot carry
// clinical text. That is a claim, so it gets tested from both ends: the client
// must not put prose in the buffer, and the worker must not store prose even if
// a modified client sends it.

function tokenFor() {
  const payload = { role: 'user', kid: 'kid-abc', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.sig`;
}

test.describe('audit events are content-free', () => {
  test('the client drops anything that is not a number, boolean or short token', async ({ page }) => {
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));

    const buffered = await page.evaluate(() => {
      localStorage.removeItem('noaba.audit.buffer.v1');
      window.NotesGate.audit.emit('note_generated', {
        tool: 'bt',
        len_fLesson: 128,
        answered: true,
        // Everything below is the shape a leak would take.
        narrative: 'The client eloped twice and Jacob was redirected.',
        nested: { note: 'Jacob eloped' },
        list: ['Jacob', 'eloped'],
      });
      return JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]');
    });

    expect(buffered).toHaveLength(1);
    const [evt] = buffered;
    expect(evt.type).toBe('note_generated');
    expect(evt.data.len_fLesson).toBe(128);
    expect(evt.data.answered).toBe(true);
    // The prose keys are gone entirely - not truncated, not stringified.
    expect(evt.data).not.toHaveProperty('narrative');
    expect(evt.data).not.toHaveProperty('nested');
    expect(evt.data).not.toHaveProperty('list');
    expect(JSON.stringify(evt)).not.toContain('Jacob');
    expect(JSON.stringify(evt)).not.toContain('eloped');
  });

  test('an unknown event type is refused outright', async ({ page }) => {
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));

    const posted = [];
    await page.route('**/api/audit**', async (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":0}' });
    });

    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.evaluate(() => {
      localStorage.removeItem('noaba.audit.buffer.v1');
      // Not in the allowlist - must never reach the buffer.
      window.NotesGate.audit.emit('note text', { any: 1 });
      window.NotesGate.audit.emit('../../etc/passwd', { any: 1 });
    });

    const buffered = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]'));
    expect(buffered).toEqual([]);
  });

  test('events are buffered and flushed with the session token', async ({ page }) => {
    let body = null;
    let authHeader = null;
    await page.route('**/api/audit**', async (route) => {
      body = JSON.parse(route.request().postData() || '{}');
      authHeader = route.request().headers()['authorization'] || null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":1}' });
    });

    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.evaluate(() => {
      localStorage.removeItem('noaba.audit.buffer.v1');
      window.NotesGate.audit.emit('note_copied', { tool: 'bt', seconds: 42, edited: 15, revisions: 2 });
    });
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]').length);

    expect(authHeader).toContain('Bearer');
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ type: 'note_copied', tool: 'bt' });
    expect(body.events[0].data).toMatchObject({ seconds: 42, edited: 15, revisions: 2 });
  });

  test('nothing is sent while logged out - there is no technician to attribute', async ({ page }) => {
    let called = false;
    await page.route('**/api/audit**', async (route) => {
      called = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));
    await page.evaluate(() => {
      localStorage.removeItem('notes_auth_token');
      localStorage.removeItem('noaba.audit.buffer.v1');
      window.NotesGate.audit.emit('note_generated', { tool: 'bt', len_fLesson: 10 });
    });
    await page.waitForTimeout(500);

    expect(called).toBe(false);
    // ...but it is kept, so it flushes once they log in.
    const buffered = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]'));
    expect(buffered).toHaveLength(1);
  });

  test('a failed flush keeps the events for the next attempt', async ({ page }) => {
    await page.route('**/api/audit**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));

    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.evaluate(() => {
      localStorage.removeItem('noaba.audit.buffer.v1');
      window.NotesGate.audit.emit('note_generated', { tool: 'bt', len_fLesson: 10 });
    });
    await page.waitForTimeout(600);

    const buffered = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]'));
    expect(buffered).toHaveLength(1);
  });
});

/* A correction has to know which tool it was made in.
   ------------------------------------------------------------------
   It did not. The browser stripped the tool off every correction, and the
   worker labelled the whole batch with `events[0].tool` - the OLDEST entry in
   an audit buffer that is shared across tools and survives reloads. So a
   technician who wrote a SAP note and then a supervision note before a flush
   landed had both sets of corrections filed under SAP, and a flush carrying
   corrections with no metrics beside them was filed under "unknown".

   This matters beyond tidiness: the store is what a learned style rule is built
   from, so a mislabelled correction is a rule attributed to the wrong kind of
   document. */
test.describe('a correction carries its own tool', () => {
  test('the tool reaches the buffer, and it is the tool that was passed', async ({ page }) => {
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));

    const buffered = await page.evaluate(() => {
      localStorage.removeItem('noaba.corrections.buffer.v1');
      localStorage.removeItem('notes_auth_token'); // no flush, so the buffer is readable
      window.NotesGate.audit.corrections([{ feature: 'sentence_length', direction: 1 }], 'sap');
      return JSON.parse(localStorage.getItem('noaba.corrections.buffer.v1') || '[]');
    });

    expect(buffered).toHaveLength(1);
    expect(buffered[0].tool).toBe('sap');
  });

  test('two tools in one batch each keep their own, rather than sharing the first', async ({ page }) => {
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));

    const posted = [];
    await page.route('**/api/audit**', async (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":0,"profile":"skipped"}' });
    });

    await page.evaluate(() => {
      localStorage.removeItem('notes_auth_token');
      localStorage.removeItem('noaba.audit.buffer.v1');
      localStorage.removeItem('noaba.corrections.buffer.v1');
      // The exact shape of the bug: an audit event from one tool sits in the
      // buffer first, then corrections are made in a different tool.
      window.NotesGate.audit.emit('note_generated', { tool: 'sap', len_goal: 40 });
      window.NotesGate.audit.corrections([{ feature: 'sentence_length', direction: -1 }], 'sup');
    });
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.evaluate(() => window.NotesGate.audit.flush());
    await page.waitForTimeout(600);

    expect(posted).toHaveLength(1);
    const [body] = posted;
    expect(body.events[0].tool).toBe('sap');
    expect(body.corrections).toHaveLength(1);
    // The whole point: the correction is a supervision-note correction, and the
    // SAP event sitting ahead of it in the buffer does not get to relabel it.
    expect(body.corrections[0].tool).toBe('sup');
  });

  test('a tool that is not a slug is dropped rather than carried', async ({ page }) => {
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));

    const buffered = await page.evaluate(() => {
      localStorage.removeItem('noaba.corrections.buffer.v1');
      localStorage.removeItem('notes_auth_token');
      window.NotesGate.audit.corrections(
        [{ feature: 'sentence_length', direction: 1 }],
        'Jacob eloped from the clinic',
      );
      return JSON.parse(localStorage.getItem('noaba.corrections.buffer.v1') || '[]');
    });

    expect(buffered).toHaveLength(1);
    expect(buffered[0].tool).toBeNull();
    expect(JSON.stringify(buffered)).not.toContain('Jacob');
  });
});
