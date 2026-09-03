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

/* Delivery, which is a different question from content. The two tests above ask
   what a flush is allowed to carry; these ask whether it carries it at all.

   WHAT WENT WRONG. auditFlush guards against two overlapping POSTs, correctly,
   because each one slices the buffer from the front and a second in flight
   would drop what the first had already sent. But it returned at that guard
   with nothing scheduled, so an event emitted while a request was in the air
   waited for some later emit to start a fresh flush. Measured 2026-09-03 on a
   full bt drafting run: of five events the run emits, only gap_questions and
   note_generated reached the server. note_postpass, note_hints and
   note_register were all stranded, because each was emitted while the previous
   flush was still in flight. They survive in localStorage and go out on the
   next page load, so this delayed rather than lost them - but a usage signal
   that arrives whenever the technician next opens the tool is not answering the
   question it was built to answer. */
test.describe('audit events reach the server in the session that made them', () => {
  test('an event emitted while a flush is in flight is still sent', async ({ page }) => {
    const sent = [];
    let first = true;
    await page.route('**/api/audit**', async (route) => {
      JSON.parse(route.request().postData() || '{}').events.forEach((e) => sent.push(e.type));
      // Hold the first response open, so the second emit lands mid-flight -
      // which is exactly the ordering engine.jsx produces and nothing in the
      // page was arranging on purpose.
      if (first) { first = false; await new Promise((r) => setTimeout(r, 400)); }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":1}' });
    });

    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.evaluate(() => {
      localStorage.removeItem('noaba.audit.buffer.v1');
      window.NotesGate.audit.emit('note_generated', { tool: 'bt', len_fLesson: 10 });
      window.NotesGate.audit.emit('note_postpass', { tool: 'bt', zeroRecast: 1 });
    });

    await expect
      .poll(() => sent, { timeout: 5000, message: 'the second event never left the page' })
      .toContain('note_postpass');
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]').length))
      .toBe(0);
  });

  test('a failing flush re-arms once and does not become a retry loop', async ({ page }) => {
    // The re-arm above must not undo the fail-open behaviour the test before it
    // pins. Re-arming only on a NEW emit is what bounds this: two emits may
    // cost a second attempt, and a persistently failing server must not be
    // polled forever by a page nobody is touching.
    let posts = 0;
    await page.route('**/api/audit**', async (route) => {
      posts += 1;
      await new Promise((r) => setTimeout(r, 200));
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    });

    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.audit));
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.evaluate(() => {
      localStorage.removeItem('noaba.audit.buffer.v1');
      window.NotesGate.audit.emit('note_generated', { tool: 'bt', len_fLesson: 10 });
      window.NotesGate.audit.emit('note_postpass', { tool: 'bt', zeroRecast: 1 });
    });

    await page.waitForTimeout(2000);
    expect(posts, `a failing server was polled ${posts} times from two emits`).toBeLessThanOrEqual(2);
    const buffered = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]'));
    expect(buffered, 'a failed flush must keep both events for the next attempt').toHaveLength(2);
  });
});
