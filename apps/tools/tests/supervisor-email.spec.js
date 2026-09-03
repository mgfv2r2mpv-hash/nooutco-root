import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/* Who coaches the person behind a login code.
 *
 * His ask on 2026-09-03: "The passwords/profiles will need a supervisor email
 * so that if in the future a BT for another client uses this I can have their
 * reviews wired to the correct supervisor."
 *
 * WHERE IT LIVES IS THE DESIGN DECISION, and the last test in this file is the
 * one that defends it. The status line said "bt-profiles D1", and that store
 * opens by forbidding identifiers - it says of its own primary key that a kid
 * "is not a name and does not resolve to one without the separate API_PASSWORDS
 * KV record". An email is precisely the identifier that separation keeps out.
 * The address belongs on the record that already resolves a kid to a person.
 *
 * These run against the real _worker.js through `wrangler pages dev` with a
 * genuinely signed token and a real local KV, so a round trip here is the round
 * trip production makes.
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function tokenFor(role) {
  const p = { role, kid: `pw:${role}`, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const s = b64url(new TextEncoder().encode(JSON.stringify(p)));
  return `${s}.${b64url(createHmac('sha256', SECRET).update(s).digest())}`;
}
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const ADMIN = () => auth(tokenFor('admin'));

// Every password this file creates is uniquely named, so a run never collides
// with the local KV's leftovers from the last one.
const uniq = () => `sup-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function addPassword(request, body) {
  const res = await request.post('/api/admin/passwords', { headers: ADMIN(), data: { tools: ['bt'], ...body } });
  return { res, body: await res.json().catch(() => ({})) };
}
async function listPasswords(request) {
  const res = await request.get('/api/admin/passwords', { headers: ADMIN() });
  return (await res.json()).passwords || [];
}
const findById = (list, id) => list.find((p) => p.id === id);

test.describe('a login code carries the supervisor who reviews it', () => {
  test('an address set at creation comes back on the list', async ({ request }) => {
    const label = uniq();
    const { res, body } = await addPassword(request, { label, password: uniq(), supervisorEmail: 'lead.bcba@example.com' });
    expect(res.status()).toBe(200);
    expect(body.supervisorEmail).toBe('lead.bcba@example.com');

    const row = findById(await listPasswords(request), body.id);
    expect(row, 'the password was created but does not appear in the list').toBeTruthy();
    expect(row.supervisorEmail).toBe('lead.bcba@example.com');
  });

  test('it is optional, because most codes will not have one yet', async ({ request }) => {
    const { res, body } = await addPassword(request, { label: uniq(), password: uniq() });
    expect(res.status()).toBe(200);
    expect(body.supervisorEmail).toBe('');
    expect(findById(await listPasswords(request), body.id).supervisorEmail).toBe('');
  });

  test('it can be added later, and corrected', async ({ request }) => {
    const { body } = await addPassword(request, { label: uniq(), password: uniq() });

    let res = await request.patch('/api/admin/passwords', { headers: ADMIN(), data: { id: body.id, supervisorEmail: 'first@example.com' } });
    expect(res.status()).toBe(200);
    expect(findById(await listPasswords(request), body.id).supervisorEmail).toBe('first@example.com');

    res = await request.patch('/api/admin/passwords', { headers: ADMIN(), data: { id: body.id, supervisorEmail: 'second@example.com' } });
    expect(res.status()).toBe(200);
    expect(findById(await listPasswords(request), body.id).supervisorEmail).toBe('second@example.com');
  });

  test('an empty box clears it, because a supervisor who leaves must be removable', async ({ request }) => {
    const { body } = await addPassword(request, { label: uniq(), password: uniq(), supervisorEmail: 'gone@example.com' });
    const res = await request.patch('/api/admin/passwords', { headers: ADMIN(), data: { id: body.id, supervisorEmail: '   ' } });
    expect(res.status()).toBe(200);
    expect(findById(await listPasswords(request), body.id).supervisorEmail).toBe('');
  });

  test('a patch that does not mention it leaves it alone', async ({ request }) => {
    // The failure this guards: deactivating a code, or granting it another
    // tool, silently erasing who reviews that person's notes.
    const { body } = await addPassword(request, { label: uniq(), password: uniq(), supervisorEmail: 'keep@example.com' });

    await request.patch('/api/admin/passwords', { headers: ADMIN(), data: { id: body.id, active: false } });
    expect(findById(await listPasswords(request), body.id).supervisorEmail).toBe('keep@example.com');

    await request.patch('/api/admin/passwords', { headers: ADMIN(), data: { id: body.id, tools: ['bt', 'sup'] } });
    const row = findById(await listPasswords(request), body.id);
    expect(row.supervisorEmail, 'granting a tool erased the supervisor').toBe('keep@example.com');
    expect(row.tools).toContain('sup');
  });

  test('it is normalised, so the same person is not two supervisors', async ({ request }) => {
    const { body } = await addPassword(request, { label: uniq(), password: uniq(), supervisorEmail: '  Lead.BCBA@Example.COM  ' });
    expect(body.supervisorEmail).toBe('lead.bcba@example.com');
  });

  test('something that is not an address is refused rather than stored', async ({ request }) => {
    // Stored junk becomes a digest that silently never arrives, and the person
    // who set it has no way to tell. Refusing at the door is the only point
    // where anyone is looking.
    for (const bad of ['not-an-email', 'missing@tld', '@example.com', 'two@@example.com', 'spaces in@example.com', `${'a'.repeat(200)}@example.com`]) {
      const { res } = await addPassword(request, { label: uniq(), password: uniq(), supervisorEmail: bad });
      expect(res.status(), `"${bad}" was accepted as an email address`).toBe(400);
    }
  });

  test('a bad address on a patch is refused without touching the rest', async ({ request }) => {
    const { body } = await addPassword(request, { label: uniq(), password: uniq(), supervisorEmail: 'good@example.com' });
    const res = await request.patch('/api/admin/passwords', { headers: ADMIN(), data: { id: body.id, active: false, supervisorEmail: 'nope' } });
    expect(res.status()).toBe(400);

    const row = findById(await listPasswords(request), body.id);
    expect(row.supervisorEmail, 'a rejected patch changed the address anyway').toBe('good@example.com');
    expect(row.active, 'a rejected patch applied its other half').toBe(true);
  });

  test('a technician cannot read the list, so cannot read the addresses', async ({ request }) => {
    const res = await request.get('/api/admin/passwords', { headers: auth(tokenFor('user')) });
    expect(res.status()).toBe(401);
  });
});

test.describe('the address stays out of the content-free store', () => {
  test('bt-profiles D1 declares no column that could hold one', async () => {
    /* THE POINT OF THE WHOLE PLACEMENT, pinned so a later round cannot quietly
       move it. That schema's header calls itself content-free and treats "is
       this column content-free?" as a review gate on any future migration. A
       text column for an address would pass a test suite and break the promise
       the store is built on, so the promise gets a test. */
    const schema = readFileSync(path.join(process.cwd(), '../profile-api/schema.sql'), 'utf8');
    expect(schema.toLowerCase()).not.toMatch(/\bemail\b/);

    const migrations = path.join(process.cwd(), '../profile-api/migrations');
    const { readdirSync } = await import('node:fs');
    readdirSync(migrations).filter((f) => f.endsWith('.sql')).forEach((f) => {
      expect(readFileSync(path.join(migrations, f), 'utf8').toLowerCase(), `${f} adds an email column to the content-free store`)
        .not.toMatch(/\bemail\b/);
    });
  });
});

test.describe('the admin page can actually set one', () => {
  /* The API tests above prove the worker keeps an address. They say nothing
     about whether anyone can put one there, and a field that only curl can
     reach is not a field he has. */
  const signInAsAdmin = async (page) => {
    await page.goto('/admin/index.html');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor('admin'));
    await page.reload();
  };

  test('the add form offers a supervisor box, and what it sends comes back in the row', async ({ page }) => {
    const label = uniq();
    await signInAsAdmin(page);

    await page.locator('#newLabel').fill(label);
    await page.locator('#newPw').fill(uniq());
    await page.locator('#newSup').fill('Rowena.Lead@Example.com');
    await page.locator('#toolChecks input[value="bt"]').check();
    await page.locator('#addBtn').click();

    const row = page.locator('#rows tr', { hasText: label });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('[data-cell=sup]'), 'the row does not show the supervisor it was given')
      .toHaveText('rowena.lead@example.com');
  });

  test('a code with no supervisor says so rather than showing an empty cell', async ({ page }) => {
    const label = uniq();
    await signInAsAdmin(page);
    await page.locator('#newLabel').fill(label);
    await page.locator('#newPw').fill(uniq());
    await page.locator('#toolChecks input[value="bt"]').check();
    await page.locator('#addBtn').click();

    const row = page.locator('#rows tr', { hasText: label });
    await expect(row.locator('[data-cell=sup]')).toHaveText('not set');
  });

  test('Edit access sets the supervisor in the same pass as the tools', async ({ page }) => {
    const label = uniq();
    await signInAsAdmin(page);
    await page.locator('#newLabel').fill(label);
    await page.locator('#newPw').fill(uniq());
    await page.locator('#toolChecks input[value="bt"]').check();
    await page.locator('#addBtn').click();

    const row = page.locator('#rows tr', { hasText: label });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: 'Edit access' }).click();
    await row.locator('[data-cell=supinput]').fill('later@example.com');
    await row.getByRole('button', { name: 'Save' }).click();

    const after = page.locator('#rows tr', { hasText: label });
    await expect(after.locator('[data-cell=sup]')).toHaveText('later@example.com', { timeout: 10000 });
  });
});
