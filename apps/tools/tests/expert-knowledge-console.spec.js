import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* The knowledge console, on the admin page.
 *
 * WHAT IT IS FOR. A settled rule used to die in the conversation that produced
 * it, because the only way into the expert's knowledge was a hand edit to a
 * private repo. This tab is the way in. On his ruling of 2026-08-30 a commit
 * goes straight to production and retiring is the rollback, which puts the
 * whole of the review here: nothing on this screen should be a press he can
 * make without having read what he is approving.
 *
 * THE STORE IS MOCKED. Whether a rule is a good rule is not a claim a test can
 * make. Whether the page states what is in force, distinguishes a store that is
 * missing from one that is empty, and names an operation rather than a path,
 * all are.
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

const CORE = {
  id: 'kn_core1', version: 2, tier: 'core', scope: 'shared', body: 'necessity', topic: null,
  title: 'Name what the session produced',
  rule: 'A note that reports only what was attempted gives a funder nothing to authorise against.',
  rationale: 'Funders reject on necessity before they reject on anything else.',
  applies: null, status: 'committed', author: 'pw:admin', createdAt: 1756500000000,
};
const TOPIC = {
  id: 'kn_sup1', version: 1, tier: 'topic', scope: 'sup', body: 'necessity', topic: 'supervision',
  title: 'Supervision ratio',
  rule: 'Name the ratio for any session a supervisor attended.',
  rationale: null,
  applies: 'when a supervisor attended the session', status: 'committed', author: 'pw:admin', createdAt: 1756500000000,
};
const STAGED = {
  proposalId: 'pr_1', targetId: null, tier: 'topic', scope: 'shared', body: 'necessity', topic: 'elopement',
  title: 'Count the instances',
  rule: 'Ask for a count whenever elopement is reported without one.',
  rationale: 'A claim with no count is the commonest rejection in this body.',
  applies: 'when the intake reports elopement', state: 'staged', author: 'pw:admin', createdAt: 1756500000000,
};
const CANDIDATE = { ...TOPIC, fetches: 12, moved: 7 };

/* Every GET the tab makes, answered from one place, so a test says only what it
   is changing. `seen` records what the browser actually asked for, which is the
   thing the allowlist exists to constrain. */
function mockStore(page, over = {}) {
  const seen = [];
  const answers = {
    list: { records: [CORE, TOPIC], knowledge: true },
    proposals: { proposals: [STAGED], knowledge: true },
    candidates: { candidates: [CANDIDATE], knowledge: true },
    history: { id: 'kn_core1', versions: [CORE, { ...CORE, version: 1, rule: 'An older wording.' }], knowledge: true },
    ...over,
  };
  page.route('**/api/expert-knowledge**', (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    seen.push({ op, method: route.request().method(), url: url.pathname + url.search });
    const body = answers[op];
    if (body && body.__status) return route.fulfill({ status: body.__status, contentType: 'application/json', body: JSON.stringify(body) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body || { ok: true }) });
  });
  return seen;
}

async function openConsole(page, over) {
  await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
  const seen = mockStore(page, over);
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  return seen;
}

test.describe('what is in force, and what is only proposed', () => {
  test('a missing store and an empty store are different answers, and the page says which', async ({ page }) => {
    // These look identical in a list and they are entirely different problems:
    // one is a deploy that never got its database, the other is a store nobody
    // has written to yet. Reading the second as the first wastes an afternoon.
    await openConsole(page, { list: { records: [], knowledge: false } });
    await expect(page.locator('#knUnbound')).toBeVisible();
    await expect(page.locator('#knRecords')).toContainText('No store on this deploy');
  });

  test('an empty store says the expert is running on its authored prompt alone', async ({ page }) => {
    await openConsole(page, { list: { records: [], knowledge: true } });
    await expect(page.locator('#knUnbound')).toBeHidden();
    await expect(page.locator('#knRecords')).toContainText('authored prompt alone');
  });

  test('core and topic are separated, because the difference is what each one costs', async ({ page }) => {
    await openConsole(page);
    const records = page.locator('#knRecords');
    await expect(records.locator('h3').first()).toContainText('Core');
    await expect(records).toContainText('in the prompt on every call');
    await expect(records).toContainText('body fetched on demand');
    // The index line is the only thing the expert sees until it fetches, so the
    // console has to show it beside the rule rather than behind a click.
    await expect(records).toContainText('Fetched when a supervisor attended the session');
    // The scope reads as the tool he knows it by. A raw id on this screen is a
    // record he cannot tell is scoped to the wrong thing.
    const pills = await records.locator('.kn-record').nth(1).locator('.pill').allTextContents();
    expect(pills).toEqual(['topic', 'Supervision', 'supervision']);
  });

  test('a staged proposal is shown as waiting, and never among what is in force', async ({ page }) => {
    await openConsole(page);
    await expect(page.locator('#knProposals')).toContainText('Count the instances');
    await expect(page.locator('#knRecords')).not.toContainText('Count the instances');
  });
});

test.describe('the browser names an operation, never a path', () => {
  test('every call the tab makes goes through the allowlist', async ({ page }) => {
    const seen = await openConsole(page);
    await expect(page.locator('#knProposals')).toContainText('Count the instances');
    expect(seen.map((s) => s.op).sort()).toEqual(['candidates', 'list', 'proposals']);
    // No upstream path appears anywhere in what the browser asked for.
    expect(seen.every((s) => !s.url.includes('/knowledge/'))).toBe(true);
  });

  test('approving posts the commit operation and then re-reads what is in force', async ({ page }) => {
    const seen = await openConsole(page);
    await page.locator('#knProposals button.kn-commit').click();
    await expect.poll(() => seen.filter((s) => s.op === 'commit').length).toBe(1);
    const commit = seen.find((s) => s.op === 'commit');
    expect(commit.method).toBe('POST');
    // The lists are re-read rather than patched in place, so the screen after
    // the press is the store's answer and not the console's guess at it.
    await expect.poll(() => seen.filter((s) => s.op === 'list').length).toBeGreaterThan(1);
  });
});

test.describe('the presses that change what every note reads', () => {
  test('retiring asks first, and a refusal writes nothing', async ({ page }) => {
    const seen = await openConsole(page);
    page.once('dialog', (d) => {
      expect(d.message()).toContain('Name what the session produced');
      expect(d.message()).toContain('Nothing is deleted');
      d.dismiss();
    });
    await page.locator('#knRecords button.kn-retire').first().click();
    await page.waitForTimeout(200);
    expect(seen.filter((s) => s.op === 'retire')).toHaveLength(0);
  });

  test('and it retires when he accepts', async ({ page }) => {
    const seen = await openConsole(page);
    page.once('dialog', (d) => d.accept());
    await page.locator('#knRecords button.kn-retire').first().click();
    await expect.poll(() => seen.filter((s) => s.op === 'retire').length).toBe(1);
  });

  test('the store names the boundary that fired, and the page shows it rather than a house message', async ({ page }) => {
    await openConsole(page, { proposals: { __status: 400, error: 'a topic record needs applies: when to fetch it, at most 200 characters.' } });
    await expect(page.locator('#knProposals')).toContainText('a topic record needs applies');
  });
});

test.describe('elevation is a decision, not a threshold', () => {
  test('a nomination shows both halves of the rule that produced it', async ({ page }) => {
    // Frequency alone nominates popular records that change nothing, so the
    // page has to show the effect beside the count or the nomination is one
    // nobody can weigh.
    await openConsole(page);
    await expect(page.locator('#knCandidates')).toContainText('Fetched 12 times, changed the answer 7 of them');
  });

  test('promoting drafts a new rule for review rather than moving one behind his back', async ({ page }) => {
    await openConsole(page);
    await page.locator('#knCandidates button.kn-elevate').click();
    await expect(page.locator('#knTier')).toHaveValue('core');
    await expect(page.locator('#knTitle')).toHaveValue('Supervision ratio');
    await expect(page.locator('#knRule')).toHaveValue(/Name the ratio/);
    await expect(page.locator('#knRationale')).toHaveValue(/fetched 12 times/);
    // A core record must not carry a topic, so the fields it must not carry are
    // not on the screen to be filled in.
    await expect(page.locator('#knTopicRow')).toBeHidden();
  });
});

test.describe('writing a rule', () => {
  test('the topic fields appear only for a topic record', async ({ page }) => {
    await openConsole(page);
    await expect(page.locator('#knTopicRow')).toBeVisible();
    await page.selectOption('#knTier', 'core');
    await expect(page.locator('#knTopicRow')).toBeHidden();
    await page.selectOption('#knTier', 'topic');
    await expect(page.locator('#knTopicRow')).toBeVisible();
  });

  test('it stages rather than commits, so nothing reaches the expert unread', async ({ page }) => {
    const seen = await openConsole(page);
    await page.fill('#knTitle', 'Count the instances');
    await page.fill('#knRule', 'Ask for a count whenever elopement is reported without one.');
    await page.fill('#knTopic', 'elopement');
    await page.fill('#knApplies', 'when the intake reports elopement');
    await page.fill('#knBody', 'necessity');
    await page.locator('#knPropose').click();
    await expect.poll(() => seen.filter((s) => s.op === 'propose').length).toBe(1);
    expect(seen.some((s) => s.op === 'commit')).toBe(false);
    await expect(page.locator('#knProposeOk')).toBeVisible();
  });

  test('the scope list is the live tool list, so a rule cannot be scoped to a tool that does not exist', async ({ page }) => {
    // A record scoped to a tool that is not published composes into nothing and
    // reads, on this screen, exactly like a record that is working.
    await openConsole(page);
    const values = await page.locator('#knScope option').evaluateAll((o) => o.map((x) => x.value));
    expect(values[0]).toBe('shared');
    expect(values).toContain('bt');
    expect(values).toContain('graphva');
  });
});

test.describe('what a rule was written off', () => {
  /* Provenance is the only thing on a committed record that says where its
     claim came from, and it is what makes the rule re-arguable the day a payer
     changes its policy. */

  // A predicate rather than a glob: Playwright reads `?` in a glob as a
  // single-character wildcard, so '**/api/expert-knowledge?op=propose' matches
  // by accident rather than because it says what it means.
  const onPropose = (page, posted) =>
    page.route(
      (url) => url.pathname === '/api/expert-knowledge' && url.searchParams.get('op') === 'propose',
      (route) => {
        posted.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
    );

  const reply = (report, urls) => ({
    report,
    sources: urls.map((u) => ({ url: u, title: u })),
    searches: urls.length,
    truncated: false,
    usage: { input_tokens: 10, output_tokens: 10 },
    model: 'claude-opus-5',
    domains: 16,
  });

  async function openWith(page, posted) {
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    mockStore(page);
    await onPropose(page, posted);
    await page.goto('/admin/');
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  }

  async function writeRule(page, title) {
    await page.locator('#knTier').selectOption('core');
    await page.locator('#knTitle').fill(title);
    await page.locator('#knRule').fill('State what the session was authorised against.');
    await page.locator('#knPropose').click();
  }

  test('a rule carries the citations from every research turn, not just the last', async ({ page }) => {
    const posted = [];
    const replies = [reply('Aetna states it plainly.', ['https://aetna.com/a']), reply('CMS says the same.', ['https://cms.gov/b'])];
    let n = 0;
    await page.route('**/api/expert-research', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replies[Math.min(n++, 1)]) })
    );
    await openWith(page, posted);

    await page.locator('#knQuestion').fill('What does Aetna require?');
    await page.locator('#knResearch').click();
    await expect(page.locator('#knResearchLog')).toContainText('Aetna states it plainly');

    await page.locator('#knQuestion').fill('And CMS?');
    await page.locator('#knResearch').click();
    await expect(page.locator('#knResearchLog')).toContainText('CMS says the same');

    await writeRule(page, 'Name the authorisation basis');
    await expect.poll(() => posted.length).toBe(1);
    const urls = posted[0].provenance.sources.map((x) => x.url).sort();
    expect(urls).toEqual(['https://aetna.com/a', 'https://cms.gov/b']);
  });

  test('a rule written with no research carries no provenance at all', async ({ page }) => {
    // An empty provenance object reads on the record as "researched, found
    // nothing", which is a different and much worse claim than "he wrote it".
    const posted = [];
    await openWith(page, posted);
    await writeRule(page, 'A rule he simply knows');
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].provenance).toBeUndefined();
  });

  test('clearing the exchange clears what a rule would be credited to', async ({ page }) => {
    const posted = [];
    let n = 0;
    await page.route('**/api/expert-research', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply('Aetna states it plainly.', ['https://aetna.com/a'])) })
    );
    await openWith(page, posted);
    await page.locator('#knQuestion').fill('What does Aetna require?');
    await page.locator('#knResearch').click();
    await expect(page.locator('#knResearchLog')).toContainText('Aetna states it plainly');

    await page.locator('#knResearchReset').click();
    await expect(page.locator('#knResearchLog')).toBeEmpty();

    await writeRule(page, 'Written after the slate was wiped');
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].provenance).toBeUndefined();
  });
});
