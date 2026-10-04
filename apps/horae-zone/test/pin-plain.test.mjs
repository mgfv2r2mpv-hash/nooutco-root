// A5b, what a user can see (plan §3.4 "Reuse lock": "No date, duration,
// count or hint of which PIN appears anywhere a user can see", "Offline wrong
// PINs": "No count is shown to the user", "Annual review": "no screen states
// any timing"). One run drives every A5b route through its answers and every
// mail it sends: the first PIN, opens right and wrong, the code at 12 hours,
// a too easy and a locked PIN, the online lockout with its link and reopen,
// the day cap, the reset mail, the reset and its day cap, the review and its
// snoozes, the check and the offline block.
//
// Each answer is swept whole: its headers, every key and every value. Each
// mail is swept but for its link, whose fragment is a random token the app
// reads and never shows. The one value left out of an answer is the grant: a
// signed blob for the device to check offline, never shown (test 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW_MS } from '../../../packages/account-engine/src/limits.mjs';
import { REVIEW_LIMITS } from '../src/pin-review.js';
import {
  harness, post, signed, pinnedDevice, ticketFor, reopenTokenFrom, PASSWORD, RESET_BASE,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses and PINs with no run of
// three that are not on the public fixture list.
const ADDRESS = 'pin-plain@example.test';
const CAPPED = 'pin-plain-cap@example.test';
const PIN = '274951';
const WRONG_PIN = '385062';
const NEW_PIN = '613805';
const RESET_PIN = '496173';
const EASY_PIN = '123456';
const HOUR_MS = 60 * 60 * 1000;

const UNITS = /\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?|annual(ly)?|yearly|daily|hourly|today|tomorrow|yesterday)\b/i;
// "one" is left out ("one of its devices"), and so are "once" and "single":
// a link or code that works once is the plan's single-use rule, not a count.
const COUNTS = /\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|hundred|twice|first|third|fourth|fifth)\b/i;
// "May" is left out: it is also the modal.
const MONTHS = /\b(january|february|march|april|june|july|august|september|october|november|december)\b/i;
// A hex digest of 8 or more, or a base64url run of 16 or more.
const HASHES = /[0-9a-f]{8,}|[A-Za-z0-9_-]{16,}/i;

// Why a text fails, or null when it carries no date, duration, count or hash.
// A reason word (`error`) is a closed word the app maps to its own text, so
// only a digit or a hash fails it: two-needed names the plan's rule.
function leak(text, { reason = false } = {}) {
  if (/[0-9]/.test(text)) return 'a digit';
  const rules = [['a time unit', UNITS], ['a count', COUNTS], ['a month', MONTHS], ['a hash', HASHES]];
  for (const [name, re] of reason ? rules.slice(3) : rules) {
    const m = text.match(re);
    if (m) return `${name} (${m[0]})`;
  }
  return null;
}

// Every key and value of an answer, the grant's value aside. A number is a
// count or a duration whatever it says.
function answerLeaks(json, where) {
  const found = [];
  const walk = (v, key) => {
    if (key === 'grant') return;
    if (typeof v === 'number') found.push(`${where}: ${key} is a number`);
    else if (typeof v === 'string') {
      const why = leak(v, { reason: key === 'error' });
      if (why) found.push(`${where}: ${key} carries ${why}`);
    } else if (Array.isArray(v)) {
      for (const inner of v) walk(inner, `${key}[]`);
    } else if (v && typeof v === 'object') {
      for (const [k, inner] of Object.entries(v)) {
        const why = leak(k);
        if (why) found.push(`${where}: key ${k} carries ${why}`);
        walk(inner, k);
      }
    }
  };
  walk(json, 'answer');
  return found;
}

function mailLeaks(message, where) {
  const why = leak(`${message.subject}\n${message.text.replace(/https:\/\/\S+/g, '')}`);
  return why ? [`${where} mail "${message.subject}" carries ${why}`] : [];
}

// Calls a route, keeping its answer and the mail it sent for the sweep.
function recorder(h) {
  const answers = [];
  const mails = [];
  const call = async (req, where) => {
    const sent = h.mail.length;
    const res = await h.call(req);
    const json = await res.json();
    answers.push({ where, status: res.status, headers: [...res.headers.keys()].sort(), json });
    mails.push(...h.mail.slice(sent).map((m) => ({ where, message: m })));
    return { status: res.status, json };
  };
  const pin = async (dev, pathname, body) => call(await signed(h.call, dev, pathname, body), pathname);
  return { answers, mails, call, pin };
}

async function lockWindow(r, dev) {
  for (let i = 0; i < 3; i += 1) await r.pin(dev, '/pin/verify', { pin: WRONG_PIN });
}

// Every A5b route through its answers and mails, on two accounts.
async function everyAnswer() {
  const h = harness();
  const r = recorder(h);
  const dev = await pinnedDevice(h, ADDRESS, PIN);

  // Opens, a change and the PIN's own refusals.
  await r.pin(dev, '/pin/verify', { pin: PIN });
  await r.pin(dev, '/pin/verify', { pin: WRONG_PIN });
  await r.pin(dev, '/pin/set', { pin: EASY_PIN, current: PIN });
  await r.pin(dev, '/pin/set', { pin: NEW_PIN, current: PIN });
  await r.pin(dev, '/pin/set', { pin: PIN, current: NEW_PIN });
  await r.pin(dev, '/pin/set', { pin: PIN });
  await r.pin(dev, '/pin/set', { pin: 'x' });
  h.clock.ms += 12 * HOUR_MS;
  await r.pin(dev, '/pin/verify', { pin: NEW_PIN });
  await r.pin(dev, '/pin/verify', { pin: NEW_PIN, ticket: 'x.y' });
  await r.pin(dev, '/pin/verify', { pin: NEW_PIN, ticket: await ticketFor(h, dev) });

  // The online lockout: a locked window, closed entry, its link and reopen.
  await lockWindow(r, dev);
  h.clock.ms += WINDOW_MS;
  await lockWindow(r, dev);
  await r.pin(dev, '/pin/verify', { pin: NEW_PIN });
  const token = reopenTokenFrom(h, ADDRESS);
  assert.ok(token, 'PIN entry closed and mailed its link');
  await r.call(post('/unlock/reopen', { token }), '/unlock/reopen');
  h.clock.ms += WINDOW_MS;

  // The forgotten PIN: the mail, every refusal and a reset.
  await r.pin(dev, '/pin/reset', { pin: PIN });
  await r.pin(dev, '/pin/reset', { pin: PIN, password: PASSWORD, emailCode: 'AAAAAAAAAAAAAAAAAAAAAA' });
  await r.pin(dev, '/pin/reset', {});
  const message = h.mail.filter((m) => m.text.includes(RESET_BASE)).at(-1);
  const emailCode = new URL(message.text.match(/https:\/\/\S+/)[0]).hash.slice(1);
  await r.pin(dev, '/pin/reset', { pin: NEW_PIN, password: PASSWORD, emailCode });
  await r.pin(dev, '/pin/reset', { pin: RESET_PIN, password: PASSWORD, emailCode });
  for (let i = 0; i < 4; i += 1) await r.pin(dev, '/pin/reset', { pin: PIN, password: PASSWORD, emailCode });

  // The annual review, before it is due, when due and after a snooze.
  await r.pin(dev, '/pin/review', {});
  await r.pin(dev, '/pin/review', { action: 'Snooze' });
  h.clock.ms += REVIEW_LIMITS.everyMs;
  await r.pin(dev, '/pin/review', {});
  await r.pin(dev, '/pin/review', { action: 'Change PIN' });
  await r.pin(dev, '/pin/review', { action: 'Snooze' });

  // The check, too soon, and the offline block with the check after it.
  await r.pin(dev, '/reverify', {});
  await r.pin(dev, '/reverify', {});
  await r.pin(dev, '/pin/blocked', {});
  await r.pin(dev, '/reverify', {});

  // The day cap, on its own account: two wrong PINs a window, twelve in all.
  const g = harness();
  const q = recorder(g);
  const capped = await pinnedDevice(g, CAPPED, PIN);
  for (let i = 0; i < 12; i += 1) {
    await q.pin(capped, '/pin/verify', { pin: WRONG_PIN });
    if (i % 2 === 1) g.clock.ms += WINDOW_MS;
  }
  await q.pin(capped, '/pin/verify', { pin: PIN });

  // The reset day cap, on the same account: twelve wrong factors over three
  // hours fill the day and mail its note, and a try past it waits.
  const wrongReset = { pin: RESET_PIN, password: 'not the password FAKE', emailCode: 'AAAAAAAAAAAAAAAAAAAAAA' };
  for (let i = 0; i < 12; i += 1) {
    await q.pin(capped, '/pin/reset', wrongReset);
    if (i % 5 === 4) g.clock.ms += HOUR_MS;
  }
  await q.pin(capped, '/pin/reset', { ...wrongReset, password: PASSWORD });
  return { answers: [...r.answers, ...q.answers], mails: [...r.mails, ...q.mails] };
}

// ---- the plan test ----

test('no user-facing response carries a date, duration, count or hash', async () => {
  const { answers, mails } = await everyAnswer();
  const found = [];
  for (const a of answers) {
    found.push(...answerLeaks(a.json, `${a.where} ${a.status}`));
    if (a.headers.join() !== 'cache-control,content-type') found.push(`${a.where} ${a.status}: headers ${a.headers.join()}`);
  }
  for (const m of mails) found.push(...mailLeaks(m.message, m.where));
  assert.deepEqual([...new Set(found)], []);
});

// ---- the sweep reaches every answer and mail, and catches a leak ----

test('the run reaches every A5b answer and every A5b mail', async () => {
  const { answers, mails } = await everyAnswer();
  const seen = new Set(answers.map((a) => `${a.where} ${a.status} ${a.json.error ?? Object.keys(a.json).sort().join('+')}`));
  for (const want of [
    '/pin/verify 200 grant+ok', '/pin/verify 401 bad-pin', '/pin/verify 401 code-needed', '/pin/verify 401 bad-ticket',
    '/pin/verify 423 locked', '/pin/set 400 too-easy', '/pin/set 200 grant+ok', '/pin/set 409 pin-reused', '/pin/set 400 shape',
    '/unlock/reopen 200 ok', '/pin/reset 400 two-needed', '/pin/reset 401 bad-reset', '/pin/reset 200 ok', '/pin/reset 409 pin-reused', '/pin/reset 429 slow-down',
    '/pin/review 200 review', '/pin/review 409 not-due', '/pin/review 200 actions+review', '/pin/review 400 shape',
    '/pin/review 200 ok+review', '/reverify 200 ok', '/reverify 429 slow-down', '/pin/blocked 423 account-locked',
    '/reverify 423 account-locked',
  ]) assert.ok(seen.has(want), `the run answers ${want} (seen: ${[...seen].join('; ')})`);
  const subjects = new Set(mails.map((m) => m.message.subject));
  for (const want of [
    'Horae Zone: PIN entry paused', 'Horae Zone: PIN entry closed', 'Horae Zone: PIN entry reopened',
    'Horae Zone: app PIN reset link', 'Horae Zone: app PIN reset', 'Horae Zone: app PIN reset paused', 'Horae Zone: account locked',
  ]) assert.ok(subjects.has(want), `the run mails ${want}`);
  assert.ok(mails.filter((m) => m.message.subject === 'Horae Zone: PIN entry closed').length >= 2, 'both closing rules mail');
});

test('NEGATIVE CONTROL: the sweep catches a planted date, duration, count or hash', () => {
  for (const planted of [
    { message: 'That PIN is locked until 2027-10-04.' }, { message: 'Locked for a year.' }, { message: 'Three tries left.' },
    { remaining: 2 }, { message: 'Locked until October.' }, { error: 'locked-3' }, { actions: ['Snooze', 'Wait two days'] }, { pin: 'a3f9c2e17b4d' }, { message: 'Try again in 5 minutes.' },
  ]) assert.notDeepEqual(answerLeaks(planted, 'planted'), [], JSON.stringify(planted));
  assert.deepEqual(answerLeaks({ ok: true, grant: 'eyJhbGciOiJFUzI1NiJ9.MEUCIQ' }, 'grant'), [], 'the grant alone is left out');
  assert.notDeepEqual(mailLeaks({ subject: 'S', text: 'Expires 72 hours after it was sent.' }, 'planted'), []);
  assert.deepEqual(mailLeaks({ subject: 'S', text: `Open:\n${RESET_BASE}#AAAAAAAAAAAAAAAAAAAAAA` }, 'link'), [], 'the link is left out');
});
