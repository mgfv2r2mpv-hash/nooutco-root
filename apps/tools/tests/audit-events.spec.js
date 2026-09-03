import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { AUDIT_TYPES, sanitizeAuditEvent } from '../_worker.js';

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


/* THE ALLOWLIST IS THE THIRD PLACE THIS HAS GONE WRONG, so it gets a scan
   rather than another hand-checked list.

   sanitizeAuditEvent returns null for any type AUDIT_TYPES does not name, and
   handleAudit then answers 200 with stored:0 because zero accepted and nothing
   to do share a response shape. The browser reads that 200, drains the batch it
   just sent, and the event is gone - not delayed the way the in-flight bug
   above delayed things, but destroyed, in silence, on every note.

   note_register, recommendation and capture were each emitted for months into
   an allowlist that did not name them. The file's own comment calls that an
   oversight rather than a ruling, and the fix each time was to add the name.
   Measured 2026-09-03, five more were doing it: corrections_pass, expert_pass,
   corrections_mark, corrections_done and function_claim_answered.

   Adding names one at a time is what let this happen twice, so the test below
   reads the emit calls out of the source instead. A sixth is caught the day it
   is written rather than the day someone goes looking for a rate. */

// Every file the browser runs, which is anywhere an emit can be written. tests/
// is excluded because these specs emit deliberately invalid types to prove the
// client refuses them, and _worker.js is the allowlist itself, not a caller.
function clientSources(dir, out) {
  out = out || [];
  for (const name of readdirSync(dir || (dir = process.cwd()))) {
    if (['node_modules', 'tests', '.wrangler', 'test-results', 'playwright-report'].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) clientSources(full, out);
    else if (/\.(js|jsx|html)$/.test(name) && name !== '_worker.js') out.push(full);
  }
  return out;
}

// Matches the local `audit("type", …)` helper in engine.jsx and a direct
// `NotesGate.audit.emit("type", …)`. A type passed as a variable cannot be read
// statically and is not claimed to be.
function emittedTypes() {
  const found = new Map();
  for (const file of clientSources()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\baudit(?:\.emit)?\(\s*["']([a-z_]{1,32})["']/g)) {
        if (!found.has(m[1])) found.set(m[1], path.relative(process.cwd(), file) + ':' + (i + 1));
      }
    });
  }
  return found;
}

test.describe('every event the client emits is one the server names', () => {
  test('no audit type is emitted into an allowlist that does not name it', () => {
    const emitted = emittedTypes();

    // A scan that found nothing would pass this test for the wrong reason, so
    // it has to prove it is still reading real call sites first.
    expect([...emitted.keys()]).toContain('note_hints');
    expect(emitted.size).toBeGreaterThan(5);

    const orphans = [...emitted]
      .filter(([type]) => !AUDIT_TYPES.has(type))
      .map(([type, where]) => type + ' (' + where + ')');
    expect(orphans).toEqual([]);
  });

  test('the five that were being dropped whole now survive the sanitiser', () => {
    // The payloads these five actually send, read off their call sites.
    const cases = {
      corrections_pass: { sections: 2, marks: 2, dropped: 0, inTokens: 900, cachedTokens: 0, outTokens: 120 },
      expert_pass: { hints: 4, register: 2, terms: 1, dropped: 0, inTokens: 1200, cachedTokens: 800, outTokens: 300 },
      corrections_mark: { undone: 1, restored: 0 },
      corrections_done: { kept: 3, undone: 1 },
      function_claim_answered: { kind: 'attention', option: 'before' },
    };
    for (const [type, data] of Object.entries(cases)) {
      const out = sanitizeAuditEvent({ type, tool: 'bt', ts: 1, data });
      expect(out, type + ' was dropped whole').not.toBeNull();
      expect(out.type).toBe(type);
      expect(out.data).toEqual(data);
    }
  });

  test('admitting them opens no text channel', () => {
    // The safety property is about values, and it does not move because a type
    // was named. claim.kind and optionId are closed vocabularies of short
    // slugs; everything else in this payload is the shape a leak would take.
    const out = sanitizeAuditEvent({
      type: 'function_claim_answered',
      tool: 'bt',
      ts: 1,
      data: {
        kind: 'attention',
        option: 'before',
        narrative: 'The client eloped twice and Jacob was redirected.',
        nested: { note: 'Jacob eloped' },
        list: ['Jacob', 'eloped'],
      },
    });
    expect(out.data).toEqual({ kind: 'attention', option: 'before' });
    expect(JSON.stringify(out)).not.toContain('Jacob');
    expect(JSON.stringify(out)).not.toContain('eloped');
  });
});
