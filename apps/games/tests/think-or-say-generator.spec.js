import { test, expect } from '@playwright/test';

/**
 * ════════════════════════════════════════════════════════════════════════
 * think-or-say: the exemplar generator, enumerated exhaustively
 *
 * Teaching cards are hand-authored and reviewable. Probe items and
 * re-presentations are GENERATED — because probe novelty cannot depend on
 * remembering what was already used. Storage gets cleared, and one technician
 * runs the same programme with two learners on the same device; any scheme that
 * tracks "probes used" is one wipe away from presenting a trained item as a
 * generalization datum with nothing on screen saying so.
 *
 * The generated space is FINITE, so it is not sampled here — it is enumerated,
 * every template × variant × slot combination, and four things are asserted of
 * every item in it:
 *
 *   (a) the item's key equals its template's key. The key is never substituted
 *       at render time, so a generated item cannot be mis-keyed by construction;
 *       this is the test that says "by construction" is true.
 *   (b) no SAMPLED slot value appears among the criterial features of its own
 *       template. This is why the allow-lists are per template and never a
 *       global pool: "somebody you have never met" is scenery on an audience
 *       template and IS the answer on a relationship one.
 *   (c) no two items render identically — otherwise the space is smaller than
 *       it claims and a "fresh" item can be one already seen.
 *   (d) every rendering is non-empty and grammatical enough to carry its
 *       utterance and both action verbs, with no placeholder left unresolved.
 *
 * Fixed can-have values are deliberately outside (b). G-relationship's
 * `vary.person = 'stranger'` and `features.relationship = 'stranger'` are the
 * same fact in two vocabularies, and the template supplies it rather than
 * drawing it — which is exactly the distinction (b) exists to police, so the
 * items carry `sampled` to say which values were drawn.
 * ════════════════════════════════════════════════════════════════════════
 */

const URL = '/think-or-say/';

async function seed(page, working) {
  await page.addInitScript((cfg) => {
    localStorage.setItem('nooutco.settings.think-or-say', JSON.stringify({ working: cfg }));
  }, working);
}

async function booted(page) {
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
}

/**
 * The whole finite space, plus the template declarations it came from, flattened
 * to plain data so the assertions run here rather than inside the page.
 */
async function space(page) {
  return page.evaluate(() => {
    const G = window.__thinkOrSay.generator;
    return {
      items: G.SPACE.map(it => ({
        id: it.id, templateId: it.templateId, variant: it.variant, dim: it.dim,
        level: it.level, answer: it.answer, situation: it.situation,
        utterance: it.utterance, question: it.question, leadIn: it.leadIn,
        sayVerb: it.sayVerb, object: it.object, reason: it.reason,
        features: { ...it.features }, vary: { ...it.vary }, sampled: it.sampled.slice(),
      })),
      templates: G.TEMPLATES.map(t => ({
        id: t.id, dim: t.dim, kind: t.kind || 'flip', levels: t.levels.slice(),
        variants: t.variants.map(v => ({
          value: v.value, answer: v.answer, features: { ...v.features },
        })),
        // How many items this template SHOULD contribute, from the declared
        // allow-lists alone — the independent count enumerate() is checked against.
        sizes: t.variants.map((v) => {
          const keys = ['setting', 'person', 'topic', 'form'];
          return keys.reduce((n, k) => {
            if (v.fixed && v.fixed[k] != null) return n;
            const list = (v.slots && v.slots[k]) || (t.slots && t.slots[k]);
            return n * (list ? list.length : 1);
          }, 1);
        }),
      })),
    };
  });
}

test.describe('the generated space, enumerated', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await booted(page);
  });

  test('the generator exists, and its space is finite and enumerated whole', async ({ page }) => {
    const { items, templates } = await space(page);
    expect(templates.length, 'templates declared').toBeGreaterThanOrEqual(8);
    expect(items.length, 'items in the space').toBeGreaterThan(0);

    // Exhaustive, not sampled: the enumeration size equals the product of the
    // declared allow-lists, template by template.
    const declared = templates.reduce((n, t) => n + t.sizes.reduce((a, b) => a + b, 0), 0);
    expect(items.length, 'enumerate() covers the whole declared space').toBe(declared);

    for (const t of templates) {
      const mine = items.filter(i => i.templateId === t.id);
      expect(mine.length, `${t.id} contributes its declared size`)
        .toBe(t.sizes.reduce((a, b) => a + b, 0));
    }
  });

  test('(a) every item\'s key equals its template\'s key', async ({ page }) => {
    const { items, templates } = await space(page);
    const keyed = new Map();
    for (const t of templates) {
      for (const v of t.variants) keyed.set(`${t.id}:${v.value}`, { t, v });
    }

    for (const it of items) {
      const entry = keyed.get(`${it.templateId}:${it.variant}`);
      expect(entry, `${it.id} names a template variant that exists`).toBeTruthy();
      expect(it.answer, `${it.id} answer`).toBe(entry.v.answer);
      expect(it.features, `${it.id} criterial features`).toEqual(entry.v.features);
      expect(it.dim, `${it.id} dimension`).toBe(entry.t.dim);
    }

    // And the key itself is a matched minimum-difference pair: the two variants
    // hold every criterial feature constant but one, and the answer flips.
    for (const t of templates) {
      const [a, b] = t.variants;
      expect(t.variants.length, `${t.id} variants`).toBe(2);
      expect(new Set([a.answer, b.answer]), `${t.id} answers`).toEqual(new Set(['think', 'say']));
      expect(Object.keys(a.features).sort(), `${t.id} turns on the same dimensions`)
        .toEqual(Object.keys(b.features).sort());
      const differing = Object.keys(a.features).filter(k => a.features[k] !== b.features[k]);
      expect(differing.length, `${t.id} differs on exactly one criterial feature`).toBe(1);
      if (t.kind === 'defeater') {
        expect(a.features[t.dim], `${t.id} holds ${t.dim} constant`).toBe(b.features[t.dim]);
        expect(differing[0]).not.toBe(t.dim);
      } else {
        expect(differing[0], `${t.id} flips its own dimension`).toBe(t.dim);
      }
    }
  });

  test('(b) no sampled slot value is a criterial value of its own template', async ({ page }) => {
    const { items, templates } = await space(page);

    // Item by item: nothing DRAWN is also part of the key.
    for (const it of items) {
      const criterial = Object.values(it.features);
      for (const k of it.sampled) {
        expect(criterial, `${it.id} samples "${it.vary[k]}" as ${k}, which its key uses`)
          .not.toContain(it.vary[k]);
      }
      // Every can-have feature is either sampled or supplied by the key.
      expect(Object.keys(it.vary).sort()).toEqual(['form', 'person', 'setting', 'topic']);
    }

    // Template by template: the allow-lists themselves, across BOTH variants —
    // a value that is safe on the say side and criterial on the think side is
    // still a value this template may not draw.
    for (const t of templates) {
      const criterial = new Set(t.variants.flatMap(v => Object.values(v.features)));
      const drawn = new Set(items.filter(i => i.templateId === t.id)
        .flatMap(i => i.sampled.map(k => i.vary[k])));
      for (const value of drawn) {
        expect(criterial.has(value), `${t.id} draws "${value}", which is criterial on it`).toBe(false);
      }
    }
  });

  test('(c) no two items render identically', async ({ page }) => {
    const { items } = await space(page);
    const seen = new Map();
    for (const it of items) {
      const rendered = `${it.situation}|${it.utterance}|${it.question}`;
      expect(seen.has(rendered), `${it.id} renders exactly as ${seen.get(rendered)}`).toBe(false);
      seen.set(rendered, it.id);
    }
    expect(seen.size).toBe(items.length);
    // Ids are unique too, so a trial record can name one item unambiguously.
    expect(new Set(items.map(i => i.id)).size).toBe(items.length);
  });

  test('(d) every rendering carries its utterance, both action verbs, and no stray placeholder', async ({ page }) => {
    const { items } = await space(page);
    for (const it of items) {
      const full = `${it.situation} ${it.leadIn} ${it.utterance} ${it.question} ${it.reason}`;
      expect(it.situation.trim().length, `${it.id} situation is non-empty`).toBeGreaterThan(0);
      expect(it.utterance.trim().length, `${it.id} utterance is non-empty`).toBeGreaterThan(0);
      expect(full, `${it.id} carries its utterance`).toContain(it.utterance);
      expect(it.question, `${it.id} names THINK`).toContain('THINK');
      expect(it.question, `${it.id} names ${it.sayVerb.toUpperCase()}`)
        .toContain(it.sayVerb.toUpperCase());
      expect(it.question).toBe(`Should you THINK ${it.object}, or ${it.sayVerb.toUpperCase()} ${it.object}?`);
      expect(it.leadIn, `${it.id} lead-in`).toBe('You have a thought:');
      expect(full, `${it.id} has an unresolved placeholder`).not.toMatch(/[{}]/);
      // The PROSE never says "you think". The balanced question unavoidably
      // does — "Should you THINK these words, or SAY these words?" — and that
      // is not the defect: it names the other action in the same breath, at the
      // same length. Same rule the authored cards are held to.
      const prose = `${it.situation} ${it.leadIn} ${it.utterance} ${it.reason}`;
      expect(prose, `${it.id} prose gives the answer away`).not.toMatch(/you think/i);
      // The sentence ends like a sentence — the cheapest grammar check that
      // catches a slot value pasted onto a truncated frame.
      expect(it.situation.trim(), `${it.id} situation is punctuated`).toMatch(/[.!?]$/);
    }
  });
});

// ── Re-presentation ────────────────────────────────────────────────────────

test.describe('re-presentation with a fresh surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await booted(page);
  });

  test('a re-presented card keeps its criterial key and changes its surface', async ({ page }) => {
    const reps = await page.evaluate(() => {
      const { cards, generator } = window.__thinkOrSay;
      return cards.map((c, i) => {
        const r = generator.represent(c, i);
        return {
          id: c.id,
          answer: c.answer, situation: c.situation,
          features: { ...c.features }, vary: { ...c.vary }, level: c.level,
          rep: r && {
            id: r.id, answer: r.answer, situation: r.situation, level: r.level,
            features: { ...r.features }, vary: { ...r.vary },
            representedFrom: r.representedFrom, generated: r.generated,
            question: r.question, leadIn: r.leadIn,
          },
        };
      });
    });

    const made = reps.filter(r => r.rep);
    expect(made.length, 'some authored cards have a template that carries their key')
      .toBeGreaterThan(0);

    for (const { id, answer, situation, features, vary, level, rep } of made) {
      // Same criterial item: same key, same answer, same level, same target id.
      expect(rep.features, `${id} re-presented key`).toEqual(features);
      expect(rep.answer, `${id} re-presented answer`).toBe(answer);
      expect(rep.level, `${id} re-presented level`).toBe(level);
      expect(rep.id, `${id} stays the same target`).toBe(id);
      expect(rep.representedFrom).toBe(id);
      expect(rep.generated).toBe(true);
      // Fresh surface: the prose is different, and at least one of the
      // can-have features the learner could have memorised has moved.
      expect(rep.situation, `${id} re-presented prose is fresh`).not.toBe(situation);
      const moved = ['person', 'setting', 'topic'].filter(k => rep.vary[k] !== vary[k]);
      expect(moved.length, `${id} surface features that moved`).toBeGreaterThan(0);
      // Still a card: framing intact.
      expect(rep.leadIn).toBe('You have a thought:');
      expect(rep.question).toContain('THINK');
    }
  });

  test('a card no template carries comes back unchanged rather than substituted', async ({ page }) => {
    const unmatched = await page.evaluate(() => {
      const { cards, generator } = window.__thinkOrSay;
      // A card whose criterial configuration no template declares must yield
      // null, so the caller re-presents the original — never a different item
      // wearing the same id.
      return cards.filter(c => generator.represent(c, 0) === null).length;
    });
    expect(unmatched, 'the generator declines rather than guessing').toBeGreaterThan(0);
  });

  test('a missed card returns in the deck with different prose and the same answer', async ({ page }) => {
    // Level 1's "looks" category is three cards, and its first card's criterial
    // configuration is one the generator carries — so this walks a whole deck
    // plus the re-presentation in four trials.
    await seed(page, {
      level: 1, category: 'looks', order: 'sequential',
      represent: true, errorless: false, noErrorAnim: true,
      autoPrompt: false, promptDelay: false, showReason: false,
    });
    await page.goto(URL);
    await booted(page);

    const deck = await page.evaluate(() => window.__thinkOrSay.level(1).cards
      .filter(c => c.cat === 'looks')
      .map(c => ({ id: c.id, answer: c.answer, situation: c.situation })));
    expect(deck.length, 'the "looks" deck').toBe(3);

    await page.locator('#btn-play').click();

    const situationOf = async () => page.locator('#scenario-situation').textContent();
    const answerTrial = async (correct, wrongFirst) => {
      await page.locator('#reveal-panel').click();
      await expect(page.locator('#choices')).toBeVisible();
      if (wrongFirst) {
        const wrong = correct === 'think' ? 'say' : 'think';
        await page.locator(`#choices .choice[data-answer="${wrong}"]`).click();
      }
      await page.locator(`#choices .choice[data-answer="${correct}"]`).click();
      await page.locator('#btn-next').click();
    };

    // Trial 1 is missed, so it is re-queued at the end of the deck.
    expect(await situationOf()).toBe(deck[0].situation);
    await answerTrial(deck[0].answer, true);
    await answerTrial(deck[1].answer, false);
    await answerTrial(deck[2].answer, false);

    // Trial 4 is the re-presentation: the same criterial item, fresh prose.
    await expect(page.locator('#scenario-situation')).toBeVisible();
    const returned = await situationOf();
    expect(returned, 'the repeat is not the memorised surface').not.toBe(deck[0].situation);
    for (const card of deck) {
      expect(returned, 'the repeat is not simply another authored card').not.toBe(card.situation);
    }
    await expect(page.locator('#scenario-thought .lead-in')).toHaveText('You have a thought:');
    await expect(page.locator('#scenario-question')).toContainText('THINK');

    // And it is still the same target: answering it the same way is correct.
    await page.locator('#reveal-panel').click();
    await page.locator(`#choices .choice[data-answer="${deck[0].answer}"]`).click();
    await expect(page.locator(`#choices .choice[data-answer="${deck[0].answer}"]`))
      .toHaveClass(/correct/);
  });
});
