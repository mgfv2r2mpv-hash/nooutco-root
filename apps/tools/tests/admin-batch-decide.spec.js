import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* PENDING SUGGESTIONS ARE DECIDED IN BATCHES.
 *
 * Kaleb, 2026-10-04: each suggestion had its own Approve and Reject, and
 * Approve asked in a dialog every time. Now each row has a checkbox, one bar
 * that stays in view decides every ticked row ("Approve" / "Reject" for one,
 * "Approve All" / "Reject All" for more), "Clear all" unticks, and there is
 * deliberately no select-all: "I want selecting all to be effortful so that
 * doing so is deliberate." The terms below are invented. */

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

const SUGGESTIONS = [
  { id: 's1', term: 'manding', confidence: 'high', reason: 'Seen in 9 notes, never beside a name.' },
  { id: 's2', term: 'gestural', confidence: 'high', reason: 'Prompt level term.' },
  { id: 's3', term: 'kowalski', confidence: 'low', reason: 'Seen twice.' },
];

/* The store: GET lists what is still pending, POST decides one id. `failIds`
   answers those ids with a 500, once. */
async function openLab(page, { failIds = [] } = {}) {
  const pending = new Map(SUGGESTIONS.map((s) => [s.id, s]));
  const posted = [];
  const failing = new Set(failIds);
  await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
  await page.route('**/api/admin/scrub-suggestions**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      posted.push(body);
      if (failing.has(body.id)) {
        failing.delete(body.id);
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'store down' }) });
      }
      pending.delete(body.id);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [...pending.values()] }) });
  });
  await page.route('**/api/admin/scrub-overrides**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stopwords: [], pending: pending.size }) }));
  page.on('dialog', (d) => { throw new Error(`a dialog opened: ${d.message()}`); });
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Algorithm Lab', exact: true }).click();
  await expect(page.locator('#sugRows .sug-row')).toHaveCount(3);
  return { posted, pending };
}

const tick = (page, term) => page.locator('#sugRows .sug-row', { hasText: term }).locator('.sug-pick').check();

test.describe('pending suggestions', () => {
  test('one checkbox per row and no select-all', async ({ page }) => {
    await openLab(page);
    await expect(page.locator('#suggestionsCard input[type=checkbox]')).toHaveCount(3);
    await expect(page.locator('#suggestionsCard').getByText(/select all/i)).toHaveCount(0);
    // No per-row Approve or Reject: the bar is the only place a decision is made.
    await expect(page.locator('#sugRows button')).toHaveCount(0);
    await expect(page.locator('#sugBar')).toBeHidden();
  });

  test('the bar names one decision, then "All" once more than one is ticked', async ({ page }) => {
    await openLab(page);
    await tick(page, 'manding');
    await expect(page.locator('#sugBar')).toBeVisible();
    await expect(page.locator('#sugBarCount')).toHaveText('1 selected');
    await expect(page.locator('#sugApprove')).toHaveText('Approve');
    await expect(page.locator('#sugReject')).toHaveText('Reject');
    await tick(page, 'gestural');
    await expect(page.locator('#sugBarCount')).toHaveText('2 selected');
    await expect(page.locator('#sugApprove')).toHaveText('Approve All');
    await expect(page.locator('#sugReject')).toHaveText('Reject All');
  });

  test('Approve All decides every ticked row, asks nothing, and leaves the rest', async ({ page }) => {
    const { posted } = await openLab(page);
    await tick(page, 'manding');
    await tick(page, 'gestural');
    await page.locator('#sugApprove').click();
    await expect(page.locator('#sugRows .sug-row')).toHaveCount(1);
    expect(posted).toEqual([{ id: 's1', decision: 'approve' }, { id: 's2', decision: 'approve' }]);
    await expect(page.locator('#sugRows .sug-row')).toContainText('kowalski');
    await expect(page.locator('#sugBar')).toBeHidden();
  });

  test('Reject decides the one ticked row', async ({ page }) => {
    const { posted } = await openLab(page);
    await tick(page, 'kowalski');
    await page.locator('#sugReject').click();
    await expect(page.locator('#sugRows .sug-row')).toHaveCount(2);
    expect(posted).toEqual([{ id: 's3', decision: 'reject' }]);
  });

  test('Clear all unticks every row and hides the bar', async ({ page }) => {
    const { posted } = await openLab(page);
    await tick(page, 'manding');
    await tick(page, 'kowalski');
    await page.locator('#sugClear').click();
    await expect(page.locator('#sugRows .sug-pick:checked')).toHaveCount(0);
    await expect(page.locator('#sugBar')).toBeHidden();
    expect(posted).toEqual([]);
  });

  test('a decision that fails stays ticked and says so', async ({ page }) => {
    await openLab(page, { failIds: ['s2'] });
    await tick(page, 'manding');
    await tick(page, 'gestural');
    await page.locator('#sugApprove').click();
    await expect(page.locator('#sugRows .sug-row')).toHaveCount(2);
    await expect(page.locator('#sugBarNote')).toContainText('1 of 2 did not go through');
    await expect(page.locator('#sugRows .sug-row', { hasText: 'gestural' }).locator('.sug-pick')).toBeChecked();
    await expect(page.locator('#sugBarCount')).toHaveText('1 selected');
  });
});
