/* Three SAP defects found while investigating why the tool's output was being
 * flagged as AI-generated. None of them is really a detection problem - they are
 * fidelity bugs that the detection work surfaced - so they are pinned here on
 * their own terms.
 *
 * Every assertion in this file fails against bfd66b84.
 *
 * The measured ground truth behind the em-dash and prompt-hierarchy assertions
 * is a batch of seven de-identified human-written SAPs on the same company
 * template: zero em dashes in prose across all seven, and prompt hierarchies
 * running 3 to 7 levels with no occurrence anywhere of the I/G/PV/FV notation
 * the prompt used to mandate. */

const { test, expect } = require('@playwright/test');

async function sapConfig(page) {
  await page.goto('/notes/bcba/index.html?tool=sap');
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
}

test.describe('SAP error-correction Note', () => {
  // Was: the closing Note was pushed onto the parts array unconditionally, so an
  // errorCorrection the model never filled still rendered ~119 characters. The
  // section looked populated to any truthiness or length check, which is exactly
  // the blank-section hole the shape gate exists to catch - except this one
  // slipped past it, because the section was not empty.
  test('an empty errorCorrection renders nothing at all', async ({ page }) => {
    await sapConfig(page);
    const out = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return {
        empty: sap.normalizeOutput({}).errorCorrection,
        emptyEc: sap.normalizeOutput({ errorCorrection: {} }).errorCorrection,
      };
    });

    expect(out.empty, 'normalizeOutput({}) must not fabricate an error-correction section').toBe('');
    expect(out.emptyEc, 'an empty errorCorrection object must not render boilerplate').toBe('');
  });

  // Was: the probe count was hardcoded to "2 consecutive maintenance probes"
  // while the model independently wrote a maintenance schedule in
  // generalization.maintenance that could say something else entirely. Nothing
  // reconciled the two, so a plan could instruct the technician to escalate on a
  // cadence its own maintenance criteria contradicted.
  test('the re-entry rule comes from the model, not a hardcoded probe count', async ({ page }) => {
    await sapConfig(page);
    const rendered = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return sap.normalizeOutput({
        errorCorrection: {
          initial: '(1) Block access.',
          maintenance: '(1) Re-present once.',
          reentryRule: 'After 3 consecutive weekly probes below 80%, contact BCBA.',
        },
      }).errorCorrection;
    });

    expect(rendered).toContain('After 3 consecutive weekly probes below 80%');
    expect(rendered, 'the hardcoded 2-probe line must not survive a model-supplied rule')
      .not.toContain('After 2 consecutive maintenance probes');
  });

  test('reentryRule is contracted in the response schema', async ({ page }) => {
    await sapConfig(page);
    const ec = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return sap.responseSchema.properties.errorCorrection;
    });

    expect(ec.required, 'an optional reentryRule is one the model may omit').toContain('reentryRule');
    expect(Object.keys(ec.properties)).toContain('reentryRule');
  });
});

test.describe('SAP prompt-hierarchy fidelity', () => {
  // Was: the prompt hardcoded a four-level I/G/PV/FV scheme and a style rule
  // reading "always I, G, PV, FV notation unless specs specify otherwise"
  // whose only escape hatch is sapSpecs, an optional field. In the seven-plan
  // human corpus the level counts are 6, 3, 5, 6, 5, 3 and 7. Not one is four,
  // and PV/FV appear nowhere. A technician runs whatever is on the page, so a
  // three-level hierarchy silently rendered as four is a fidelity defect.
  test('neither prompt mandates a fixed four-level I/G/PV/FV hierarchy', async ({ page }) => {
    await sapConfig(page);
    const prompts = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return {
        system: sap.buildSystem(),
        labeled: sap.buildLabeledPrompt({ goal: 'g', sapSpecs: '' }),
      };
    });

    for (const [name, text] of Object.entries(prompts)) {
      expect(text, `${name} prompt still prescribes Partial Verbal`).not.toMatch(/PV\b/);
      expect(text, `${name} prompt still prescribes Full Verbal`).not.toMatch(/FV\b/);
      expect(text, `${name} prompt still forces the always-I-G-PV-FV rule`)
        .not.toMatch(/always I, G, PV, FV/i);
    }

    expect(prompts.system, 'the system prompt should say level count follows the clinician')
      .toMatch(/3 to 7 levels|do NOT pad to a fixed count/);
  });
});

test.describe('SAP teaching strategy', () => {
  // Teaching Strategy was capped at "[Method name]. [One sentence on application
  // - no rationale paragraph.]" and was the one section that flagged in BOTH
  // plan #1 and plan #4 of the human corpus. The cap produced exactly the shape
  // the detector recognises: a bare, actor-less description of the method in the
  // abstract. Plan #5 scored 7% with a five-bullet Teaching Strategy naming the
  // actual schedule and contingencies for that program.
  //
  // The distinction the prompt has to hold is application vs rationale - how the
  // strategy runs here is wanted; why it was chosen is still banned everywhere.
  test('names the strategy and explains how it applies to this program', async ({ page }) => {
    await sapConfig(page);
    const prompts = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return {
        system: sap.buildSystem(),
        labeled: sap.buildLabeledPrompt({ goal: 'g', sapSpecs: '' }),
      };
    });

    for (const [name, text] of Object.entries(prompts)) {
      expect(text, `${name} prompt still caps Teaching Strategy at one sentence`)
        .not.toMatch(/One sentence on application/i);
      expect(text, `${name} prompt should ask how the strategy applies to this program`)
        .toMatch(/applies to THIS program/);
    }

    // The carve-out has to be explicit: Teaching Strategy is otherwise swept up
    // by the blanket "All other fields: no rationale, no prose, no padding".
    expect(prompts.system, 'application detail must be distinguished from rationale')
      .toMatch(/not rationale and is wanted/);
    // "no prose" was dropped from this rule deliberately. The maintainer ruled
    // that technicians read the plan before the session and need enough detail
    // to recall their training, so operational prose is now wanted; rationale
    // and padding remain banned, and that is the distinction worth pinning.
    expect(prompts.system, 'rationale and padding must still be banned')
      .toMatch(/no rationale, no padding/);
    expect(prompts.system, 'prose itself must no longer be banned')
      .not.toMatch(/no rationale, no prose/);
  });
});

test.describe('SAP error-correction register', () => {
  // Error correction flagged in plans #1 and #5 for the same reason Teaching
  // Strategy did: bare imperatives describing the generic procedure with no
  // actor and no particulars ("Immediately provide the most intrusive prompt to
  // evoke the correct response"). Steps now name who does what and the actual
  // prompt level or contingency for the program.
  //
  // An earlier version of this test pinned a "must stay executable mid-trial,
  // never become a paragraph" bound on step length. That constraint was mine,
  // not the maintainer's, and it was wrong: nothing in a SAP is read during a
  // trial. The technician reads the plan beforehand and needs enough detail to
  // call up what they were trained on, so brevity was being enforced for a
  // reason that did not exist. The bound is gone and this asserts the corrected
  // premise instead, so it cannot quietly come back.
  test('EC steps ask for actor and condition, with no false mid-trial brevity bound', async ({ page }) => {
    await sapConfig(page);
    const prompts = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return {
        system: sap.buildSystem(),
        labeled: sap.buildLabeledPrompt({ goal: 'g', sapSpecs: '' }),
      };
    });

    for (const [name, text] of Object.entries(prompts)) {
      expect(text, `${name} prompt should ask EC steps to name the actor`)
        .toMatch(/name who does what/);
      expect(text, `${name} prompt should tie EC steps to this program`)
        .toMatch(/prompt level, stimuli or contingency/);
    }

    expect(prompts.system, 'error correction must be carved out of the blanket terseness rule')
      .toMatch(/Error Correction steps name who does what/);
    expect(prompts.system, 'the refuted mid-trial brevity bound must not return')
      .not.toMatch(/never become a paragraph|execute mid-trial/);
    expect(prompts.system, 'the corrected premise must be stated, not merely implied')
      .toMatch(/reads the plan BEFORE the session, not during a trial/);
  });
});

test.describe('SAP length and actor rules', () => {
  // Both derived from measurement against the author's own 253k-word corpus and
  // then ruled on by the maintainer.
  //
  // Length: the original prompt said "keep every section as short as
  // operationally complete allows". Mean sentence length was the second
  // strongest correlate of a LOWER detector score (r = -0.78), the author's own
  // writing averages 23 words, and he ruled that technicians read the plan in
  // advance and need enough detail to recall their training. Brevity was the
  // wrong default.
  test('length follows operational completeness, not brevity', async ({ page }) => {
    await sapConfig(page);
    const prompts = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return {
        system: sap.buildSystem(),
        labeled: sap.buildLabeledPrompt({ goal: 'g', sapSpecs: '' }),
      };
    });

    for (const [name, text] of Object.entries(prompts)) {
      expect(text, `${name} prompt still tells the model to compress`)
        .not.toMatch(/as short as operationally complete allows/);
      expect(text, `${name} prompt should state who reads this and when`)
        .toMatch(/BEFORE the session/);
      expect(text, `${name} prompt should say not to compress`).toMatch(/[Dd]o not compress/);
    }
  });

  // Actor: the AI-assisted plan in the corpus had the HIGHEST actor density of
  // all five (35%) and still scored 49%, so naming actors is necessary and
  // demonstrably not sufficient. The prompt previously said "name who does what"
  // in three places with no ceiling, which points straight at saturation. The
  // maintainer ruled: warn against saturating, but do not set a number, because
  // the right rate depends on the section.
  test('actor-naming is asked for but explicitly not saturated, with no hard number', async ({ page }) => {
    await sapConfig(page);
    const prompts = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return {
        system: sap.buildSystem(),
        labeled: sap.buildLabeledPrompt({ goal: 'g', sapSpecs: '' }),
      };
    });

    for (const [name, text] of Object.entries(prompts)) {
      expect(text, `${name} prompt should warn against uniform actor-naming`)
        .toMatch(/NOT do this in every sentence|uniform actor-naming is its own tell/);
      // A rate would have been the obvious move and was explicitly rejected.
      expect(text, `${name} prompt hard-codes an actor-naming rate`)
        .not.toMatch(/one sentence in (four|4)|25% of sentences/i);
      // Multi-adult protocols: expand each role once, then abbreviate.
      expect(text, `${name} prompt should handle multi-adult protocols`)
        .toMatch(/Prompting Partner \(PP\)/);
    }
  });

  // Lesson Set Up was "actual setup steps only". Per the maintainer it covers
  // arrangement, learner readiness, and moment-picking including when to pause
  // and what has to be true to resume, with a basic need outranking the program.
  test('Lesson Set Up covers readiness and pause/resume, not just arrangement', async ({ page }) => {
    await sapConfig(page);
    const prompts = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return {
        system: sap.buildSystem(),
        labeled: sap.buildLabeledPrompt({ goal: 'g', sapSpecs: '' }),
      };
    });

    for (const [name, text] of Object.entries(prompts)) {
      expect(text, `${name} prompt still limits Lesson Set Up to setup steps`)
        .not.toMatch(/actual setup steps only/);
      expect(text, `${name} prompt should ask how to judge readiness`).toMatch(/learner is ready/);
      expect(text, `${name} prompt should ask when to pause and resume`).toMatch(/resume/);
    }

    expect(prompts.system, 'a basic need has to outrank the program').toMatch(/basic need/);
  });
});

test.describe('SAP gap questions', () => {
  // The shared engine asks the clinician up to three questions before drafting,
  // and it asks them for every tool - SAP included, from the moment BT landed
  // the feature. But the default prompt is written for a session note: it asks
  // for counts, rates, and how this session compared to recent ones. A SAP is a
  // program plan with no session behind it, so all three are unanswerable.
  //
  // The gap that matters here is the prompt hierarchy, which is also the one
  // where a plausible invention is unsafe: a technician runs whatever levels
  // the plan lists, and this tool used to manufacture four of them.
  test('SAP asks about program specification, not about a session', async ({ page }) => {
    await sapConfig(page);
    const triage = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return { system: sap.triageSystem || '', intro: sap.triageIntro || '' };
    });

    expect(triage.system, 'SAP declares no triage prompt of its own').toBeTruthy();
    expect(triage.system, 'the hierarchy is the gap the maintainer asked to become a question')
      .toMatch(/prompt hierarchy/i);
    expect(triage.system, 'and it must lead, not appear in passing').toMatch(/Ask this first/);

    // Session-note vocabulary is the tell that the default prompt leaked in.
    for (const wrong of [/how many times/i, /this session/i, /behaviors of concern/i, /rates for a behavior/i]) {
      expect(triage.system, `SAP triage still asks a session-note question: ${wrong}`).not.toMatch(wrong);
    }

    expect(triage.intro).toMatch(/GOAL AND SPECIFICATIONS/);
    expect(triage.intro, 'a plan is not a set of raw session notes').not.toMatch(/RAW NOTES/);
  });

  // An override the engine never reads is the failure this pins: the property
  // can exist on the tool and the default still go out on the wire.
  test('the engine sends SAP\'s triage prompt, not its own default', async ({ page }) => {
    const posted = [];
    await page.route('**/api/llm-call**', async (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify({ sufficient: true, questions: [] }) }],
          usage: { output_tokens: 40 },
          stop_reason: 'end_turn',
        }),
      });
    });

    const payload = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['sap'] };
    const token = Buffer.from(JSON.stringify(payload)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';

    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), token);
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    await page.getByRole('textbox', { name: /Treatment Goal/i })
      .fill('The learner will label 10 common objects in 80% of opportunities across 3 sessions.');
    await page.getByRole('button', { name: /Generate SAP/i }).click();

    // Clear the scrub gate: a once-per-load acknowledgement, then a name review
    // only when the detector finds candidates.
    const ack = page.locator('#notes-ack-go');
    if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('#notes-ack-cb').check();
      await expect(ack).toBeEnabled();
      await ack.click();
    }
    const review = page.locator('#notes-scrub-go');
    if (await review.isVisible({ timeout: 1500 }).catch(() => false)) await review.click();

    await expect.poll(() => posted.length, { timeout: 20000 }).toBeGreaterThan(0);

    const triageCall = posted[0];
    expect(triageCall.system, 'the engine sent its session-note default for a SAP')
      .toMatch(/Service Authorization Plan/);
    expect(triageCall.system).toMatch(/prompt hierarchy/i);
    expect(triageCall.system, 'the session-note default leaked onto the wire')
      .not.toMatch(/raw session notes/i);
    expect(triageCall.messages[0].content).toMatch(/GOAL AND SPECIFICATIONS/);
  });
});

test.describe('SAP em dashes', () => {
  // Zero em dashes appear in prose across all seven human plans; the tool
  // mandated four per document via the hierarchy template alone. The house
  // convention, visible in the corpus, is a plain hyphen ("* I - Independent").
  // Not a company format requirement - the maintainer had asked for it twice.
  //
  // Scoped to the model-facing prompts, triage included - its questions are
  // shown to the clinician verbatim, so an em dash there is just as visible as
  // one in the plan. Source comments and the on-screen SMART tooltip never
  // reach either surface and are left alone.
  test('no model-facing prompt contains an em dash', async ({ page }) => {
    await sapConfig(page);
    const prompts = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return {
        system: sap.buildSystem(),
        labeled: sap.buildLabeledPrompt({ goal: 'g', sapSpecs: '' }),
        triage: sap.triageSystem || '',
      };
    });

    for (const [name, text] of Object.entries(prompts)) {
      const hits = (text.match(/.{0,40}[\u2014\u2013].{0,40}/g) || []);
      expect(hits, `${name} prompt still contains em dashes:\n${hits.join('\n')}`).toEqual([]);
    }
  });

  test('the system prompt tells the model to use a hyphen', async ({ page }) => {
    await sapConfig(page);
    const system = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sap').buildSystem());

    expect(system).toMatch(/plain hyphen/i);
    expect(system).toMatch(/[Nn]ever use an em dash/);
  });
});
