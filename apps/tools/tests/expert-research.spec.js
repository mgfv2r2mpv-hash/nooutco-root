import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { expertResearchRequest, researchSources, researchReport, RESEARCH_DOMAINS } from '../_worker.js';

/* Research: the expert goes and reads before it says anything.
 *
 * WHY THIS ROUTE IS DIFFERENT FROM EVERY OTHER ONE HERE. It runs on a larger
 * model than the pass, on his ruling, because the pass is pinned to Haiku 4.5
 * so the knowledge-versus-catalog comparison stays honest and Haiku cannot run
 * the search tool at all. It spends real money per search. And it is the one
 * route on this Worker whose input LEAVES the account, because a search query
 * goes to a search engine, which is why the question is authored by the
 * maintainer about the field and never about a client.
 *
 * The reading itself is mocked. Whether a payer's policy says what it says is
 * not a claim a test can make. What the route accepts, what it refuses, what
 * sources it will read, and whether the report it hands back is honest about
 * what it cited, all are.
 */

const SECRET = 'playwright-local-test-secret';
const TOKEN_KEY = 'notes_auth_token';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function adminToken(role = 'admin') {
  const payload = { role, kid: 'pw:admin', exp: Math.floor(Date.now() / 1000) + 3600 };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}

test.describe('the list of sources is the whole control', () => {
  test('it is his list, and nothing has been added to it', () => {
    /* A research tool that can read anything launders a forum post into a rule
       that reaches every note, and once the rule is written the store has no
       way to tell one source from another. So the list is pinned here rather
       than left to drift with an edit nobody reviewed. */
    expect(RESEARCH_DOMAINS).toEqual([
      'aetna.com', 'uhcprovider.com', 'anthem.com', 'cigna.com', 'bcbs.com',
      'cms.gov', 'medicaid.gov', 'ecfr.gov',
      'bacb.com', 'abainternational.org', 'apbahome.net',
      'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov',
      'onlinelibrary.wiley.com', 'link.springer.com',
    ]);
  });

  test('the AMA is not on it, and the two journals he named are, through their publishers', () => {
    // He was offered the AMA and left it unticked. JABA is on Wiley and
    // Behavior Analysis in Practice is on Springer, so both are already
    // reachable without a separate entry.
    expect(RESEARCH_DOMAINS).not.toContain('ama-assn.org');
    expect(RESEARCH_DOMAINS).toContain('onlinelibrary.wiley.com');
    expect(RESEARCH_DOMAINS).toContain('link.springer.com');
  });

  test('every entry is a bare domain, which is the only form the tool takes', () => {
    for (const d of RESEARCH_DOMAINS) {
      expect(d, `${d} carries a scheme`).not.toMatch(/^https?:/);
      expect(d, `${d} has a trailing slash`).not.toMatch(/\/$/);
      expect(d).toMatch(/^[a-z0-9.-]+$/);
    }
  });
});

test.describe('what the route accepts', () => {
  test('a question is required and is bounded', () => {
    expect(expertResearchRequest({}).error).toBeTruthy();
    expect(expertResearchRequest({ question: '   ' }).error).toBeTruthy();
    expect(expertResearchRequest({ question: 'x'.repeat(4001) }).error).toMatch(/longer than this route accepts/);
    expect(expertResearchRequest({ question: 'What does Aetna require?' }).question).toBe('What does Aetna require?');
  });

  test('a conversation carries as text, never as content blocks', () => {
    // Carrying a previous turn's search results would mean round-tripping their
    // encrypted content through the browser untouched, which is both a bigger
    // payload and something a page could corrupt into a 400.
    const ok = expertResearchRequest({
      question: 'And for Cigna?',
      messages: [{ role: 'user', content: 'What does Aetna require?' }, { role: 'assistant', content: 'Aetna requires...' }],
    });
    expect(ok.messages).toHaveLength(2);
    expect(ok.messages.every((m) => typeof m.content === 'string')).toBe(true);

    expect(expertResearchRequest({ question: 'q', messages: 'no' }).error).toBeTruthy();
    expect(expertResearchRequest({ question: 'q', messages: [{ role: 'system', content: 'x' }] }).error).toMatch(/user or the assistant/);
    expect(expertResearchRequest({ question: 'q', messages: [{ role: 'user', content: [{ type: 'text' }] }] }).error).toBeTruthy();
    expect(expertResearchRequest({ question: 'q', messages: [{ role: 'user', content: '  ' }] }).error).toBeTruthy();
  });

  test('the conversation is bounded, because every turn re-reads the whole thing', () => {
    const many = Array.from({ length: 9 }, () => ({ role: 'user', content: 'x' }));
    expect(expertResearchRequest({ question: 'q', messages: many }).error).toMatch(/longer than this route carries/);
  });
});

test.describe('what it says it read', () => {
  test('a source is one it actually cited, not one the search happened to return', () => {
    /* A result the model read and did not use is not a source. Listing it would
       make the report look better evidenced than it is, to the one person whose
       whole job here is judging how well evidenced it is. */
    const api = {
      content: [
        { type: 'server_tool_use', name: 'web_search', input: { query: 'aetna aba policy' } },
        {
          type: 'web_search_tool_result',
          content: [
            { type: 'web_search_result', url: 'https://aetna.com/never-cited', title: 'Never cited' },
            { type: 'web_search_result', url: 'https://cigna.com/policy', title: 'Cigna' },
          ],
        },
        {
          type: 'text',
          text: 'Aetna requires a documented response to treatment.',
          citations: [
            { type: 'web_search_result_location', url: 'https://aetna.com/policy', title: 'Aetna medical policy', cited_text: '...' },
          ],
        },
      ],
    };
    expect(researchSources(api)).toEqual([{ url: 'https://aetna.com/policy', title: 'Aetna medical policy' }]);
  });

  test('a source leaned on twice is listed once, in the order it was first used', () => {
    const cite = (url, title) => ({ type: 'web_search_result_location', url, title, cited_text: '...' });
    const api = {
      content: [
        { type: 'text', text: 'One.', citations: [cite('https://cms.gov/a', 'CMS A')] },
        { type: 'text', text: 'Two.', citations: [cite('https://aetna.com/b', 'Aetna B'), cite('https://cms.gov/a', 'CMS A')] },
      ],
    };
    expect(researchSources(api).map((s) => s.url)).toEqual(['https://cms.gov/a', 'https://aetna.com/b']);
  });

  test('a report with no citations reports no sources rather than inventing one', () => {
    expect(researchSources({ content: [{ type: 'text', text: 'I could not establish that.' }] })).toEqual([]);
    expect(researchSources(null)).toEqual([]);
  });
});

test.describe('who can spend the account on a search', () => {
  const post = (request, token, body) =>
    request.post('/api/expert-research', {
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      data: body,
      failOnStatusCode: false,
    });

  test('a clinician cannot, and is told so before the body is read', async ({ request }) => {
    const res = await post(request, adminToken('user'), { question: 'What does Aetna require?' });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/admin only/);
  });

  test('nor can somebody with no session at all', async ({ request }) => {
    const res = await post(request, null, { question: 'What does Aetna require?' });
    expect(res.status()).toBe(401);
  });

  test('an admin with a bad question is refused before anything is spent', async ({ request }) => {
    const res = await post(request, adminToken(), { question: '' });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/Ask it something/);
  });
});

test.describe('the console around it', () => {
  async function openTab(page) {
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    await page.route('**/api/expert-knowledge**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [], proposals: [], candidates: [], knowledge: true }) })
    );
    await page.goto('/admin/');
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  }

  test('the report is shown with what it cited, as links he can open', async ({ page }) => {
    await openTab(page);
    await page.route('**/api/expert-research', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          report: 'Aetna requires a documented response to treatment.',
          sources: [{ url: 'https://aetna.com/policy', title: 'Aetna medical policy' }],
          searches: 3,
          truncated: false,
          usage: { input_tokens: 900, output_tokens: 700 },
          model: 'claude-opus-5',
          domains: 16,
        }),
      })
    );
    await page.fill('#knQuestion', 'What does Aetna require?');
    await page.locator('#knResearch').click();
    const log = page.locator('#knResearchLog');
    await expect(log).toContainText('Aetna requires a documented response');
    await expect(log.locator('a[href="https://aetna.com/policy"]')).toHaveText('Aetna medical policy');
    // The number of approved domains is on the screen, so the limit he set is
    // visible rather than something he has to remember he set.
    await expect(page.locator('#knResearchUsage')).toContainText('16 approved domains');
  });

  test('a report that cited nothing says so, rather than showing an empty list', async ({ page }) => {
    await openTab(page);
    await page.route('**/api/expert-research', (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ report: 'I could not establish that from these sources.', sources: [], searches: 2, model: 'claude-opus-5', domains: 16 }),
      })
    );
    await page.fill('#knQuestion', 'Does the BACB require it?');
    await page.locator('#knResearch').click();
    await expect(page.locator('#knResearchLog')).toContainText('It cited nothing, so nothing here is sourced');
  });

  test('a follow-up sends the transcript as text, never as content blocks', async ({ page }) => {
    await openTab(page);
    const bodies = [];
    await page.route('**/api/expert-research', (route) => {
      bodies.push(route.request().postDataJSON());
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ report: 'An answer.', sources: [], searches: 1, model: 'claude-opus-5', domains: 16 }),
      });
    });
    await page.fill('#knQuestion', 'First question?');
    await page.locator('#knResearch').click();
    await expect(page.locator('#knResearchLog')).toContainText('An answer.');
    await page.fill('#knQuestion', 'Second question?');
    await page.locator('#knResearch').click();
    await expect.poll(() => bodies.length).toBe(2);

    expect(bodies[0].messages).toEqual([]);
    expect(bodies[1].messages).toEqual([
      { role: 'user', content: 'First question?' },
      { role: 'assistant', content: 'An answer.' },
    ]);
  });

  test('a rule written after research carries what it was written from', async ({ page }) => {
    // A rule whose sources are gone is a rule nobody can re-argue when a payer
    // changes its policy, which is the case this store exists for.
    await openTab(page);
    await page.route('**/api/expert-research', (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          report: 'Aetna requires a documented response to treatment.',
          sources: [{ url: 'https://aetna.com/policy', title: 'Aetna medical policy' }],
          searches: 1, model: 'claude-opus-5', domains: 16,
        }),
      })
    );
    await page.fill('#knQuestion', 'What does Aetna require?');
    await page.locator('#knResearch').click();
    await expect(page.locator('#knResearchLog')).toContainText('Aetna requires');

    const proposals = [];
    await page.route('**/api/expert-knowledge?op=propose**', (route) => {
      proposals.push(route.request().postDataJSON());
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proposalId: 'pr_1' }) });
    });
    await page.fill('#knTitle', 'Document the response');
    await page.fill('#knRule', 'Say what changed in response to treatment.');
    await page.fill('#knTopic', 'authorisation');
    await page.fill('#knApplies', 'when the note supports continued authorisation');
    await page.fill('#knBody', 'necessity');
    await page.locator('#knPropose').click();
    await expect.poll(() => proposals.length).toBe(1);
    expect(proposals[0].provenance.sources).toEqual([{ url: 'https://aetna.com/policy', title: 'Aetna medical policy' }]);
  });
});

test.describe('a turn that paused', () => {
  /* A long search does not come back as an answer. It comes back as pause_turn
     with part of the assistant turn in it, and the way to continue is to hand
     that part straight back. The continuation carries ON from there rather than
     starting again, so the answer and the citations for ONE question are spread
     across every response in the turn. Reading only the last one loses the
     opening, which on a long search is where it says what it went looking for.
  */
  const cite = (url, title) => ({ type: 'web_search_result_location', url, title, cited_text: 'a line', encrypted_index: 'x' });

  const paused = {
    stop_reason: 'pause_turn',
    content: [
      { type: 'text', text: 'I checked the payer policies first. ', citations: [cite('https://aetna.com/a', 'Aetna')] },
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'aetna aba policy' } },
    ],
  };
  const finished = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'CMS agrees.', citations: [cite('https://cms.gov/b', 'CMS')] }],
  };

  test('the report is the whole turn, not the tail of it', () => {
    expect(researchReport([paused, finished])).toBe('I checked the payer policies first. CMS agrees.');
    // The last response alone is what a reader would have been shown, and it is
    // missing the half that says what was checked.
    expect(researchReport([finished])).toBe('CMS agrees.');
  });

  test('the citations are the whole turn too, so nothing found before the pause is dropped', () => {
    expect(researchSources([paused, finished]).map((s) => s.url)).toEqual(['https://aetna.com/a', 'https://cms.gov/b']);
  });

  test('a url cited on both sides of a pause is listed once, in first-use order', () => {
    const again = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Same source.', citations: [cite('https://aetna.com/a', 'Aetna')] }] };
    expect(researchSources([paused, again]).map((s) => s.url)).toEqual(['https://aetna.com/a']);
  });

  test('one response still works unwrapped, because most turns never pause', () => {
    expect(researchReport(finished)).toBe('CMS agrees.');
    expect(researchSources(finished).map((s) => s.url)).toEqual(['https://cms.gov/b']);
  });

  test('nothing readable comes back as an empty string rather than as a crash', () => {
    expect(researchReport([])).toBe('');
    expect(researchReport([null, { content: null }])).toBe('');
    expect(researchReport(null)).toBe('');
    expect(researchSources([null])).toEqual([]);
  });
});
