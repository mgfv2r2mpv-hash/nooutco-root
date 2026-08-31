import { test, expect } from '@playwright/test';

// The note tools used to ask the model to hand-write its draft as JSON, which
// made every escape the model's responsibility - see model-json-recovery.spec.js
// for the failure that caused. output_config.format moves the note into the
// layer the API itself serialises: the model emits structured data, Anthropic
// serialises it, and res.json() hands it back. Both mis-escape modes become
// impossible by construction rather than recoverable after the fact.
//
// Structured outputs is supported on claude-haiku-4-5, which is the model these
// tools already run, and the response stays a text block - so the conversation
// remains {role, content: string} and neither the worker's contract nor the
// prompt-cache prefix changes.

test.describe('structured output request shape', () => {
  // Capture what actually goes on the wire, since the whole point is a request
  // field the model layer must receive.
  async function captureRequest(page, opts) {
    let body = null;
    await page.route('**/api/llm-call**', async (route) => {
      body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"refinedGoal":"g","exercise":{},"generalization":{},"errorCorrection":{},"hints":[]}' }],
        }),
      });
    });

    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.generateConversation));
    await page.evaluate(async (o) => {
      await window.NotesGate.generateConversation({
        system: 'sys',
        messages: [{ role: 'user', content: 'draft a SAP' }],
        tool: 'sap',
        responseSchema: o.schema,
      }).catch(() => {});
    }, opts);
    return body;
  }

  const MINIMAL_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['refinedGoal'],
    properties: { refinedGoal: { type: 'string' } },
  };

  test('sends output_config.format when the tool declares a schema', async ({ page }) => {
    const body = await captureRequest(page, { schema: MINIMAL_SCHEMA });

    expect(body.output_config).toBeTruthy();
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema).toEqual(MINIMAL_SCHEMA);
    // The conversation itself must be unchanged - string content, not blocks.
    expect(typeof body.messages[0].content).toBe('string');
  });

  test('omits output_config entirely when the tool declares no schema', async ({ page }) => {
    // A tool without a schema keeps today's plain-text behaviour and the
    // recovery ladder beneath it, so the rollout can go one tool at a time.
    const body = await captureRequest(page, { schema: undefined });

    expect('output_config' in body).toBe(false);
  });
});

test.describe('SAP response schema', () => {
  // The API constrains output to a documented SUBSET of JSON Schema. A schema
  // using anything outside it is a 400 at request time, not a soft failure, so
  // the constraint is pinned here rather than discovered in production.
  const UNSUPPORTED = [
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'minLength', 'maxLength', 'pattern',
    'minItems', 'maxItems', 'uniqueItems',
    '$recursiveRef', '$dynamicRef',
  ];

  test('is valid for the supported constraint subset and matches the rendered sections', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const report = await page.evaluate(({ unsupported, REVISION_KEYS }) => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      const schema = sap && sap.responseSchema;
      if (!schema) return { missing: true };

      const objectsMissingSeal = [];
      const bannedKeywords = [];
      const objectsWithUnrequiredProps = [];

      (function walk(node, path) {
        if (!node || typeof node !== 'object') return;
        for (const k of unsupported) {
          if (k in node) bannedKeywords.push(path + '.' + k);
        }
        if (node.type === 'object') {
          if (node.additionalProperties !== false) objectsMissingSeal.push(path);
          const props = Object.keys(node.properties || {});
          const req = node.required || [];
          // Every declared NOTE property must be required: an optional one is a
          // key the model may omit, which is exactly the blank-section hole this
          // gate exists to catch.
          //
          // The three revision keys are the deliberate exception, and they are
          // the opposite case. They carry the conversation rather than the note:
          // "answer" means the turn was a question and no section changed, and a
          // first draft has nothing to answer and nothing to route. Requiring
          // them would force every draft to invent one. bt has declared them
          // optional since the schema landed; sap gained them on 2026-08-30, and
          // expert-covers-five-tools.spec.js asserts from the other side that no
          // tool may put them in `required`.
          const optional = props.filter((p) => !req.includes(p) && !REVISION_KEYS.includes(p));
          if (optional.length) objectsWithUnrequiredProps.push(path + ' → ' + optional.join(','));
          for (const p of props) walk(node.properties[p], path + '.' + p);
        }
        if (node.type === 'array') walk(node.items, path + '[]');
      })(schema, 'root');

      return {
        missing: false,
        objectsMissingSeal,
        bannedKeywords,
        objectsWithUnrequiredProps,
        topLevelRequired: (schema.required || []).slice().sort(),
        sectionKeys: sap.formSections.map((s) => s.key || s.group).slice().sort(),
      };
    }, { unsupported: UNSUPPORTED, REVISION_KEYS: ['answer', 'bcbaQuestion', 'crossSection'] });

    expect(report.missing, 'sap tool declares no responseSchema').toBe(false);
    expect(report.objectsMissingSeal, 'every object needs additionalProperties:false').toEqual([]);
    expect(report.bannedKeywords, 'schema uses keywords outside the supported subset').toEqual([]);
    expect(report.objectsWithUnrequiredProps, 'every declared property must be required').toEqual([]);

    // The schema and the rendered form must agree, or a "successful" generation
    // can still leave a section blank.
    for (const key of report.sectionKeys) {
      expect(report.topLevelRequired, `schema is missing rendered section "${key}"`).toContain(key);
    }
  });

  test('is wired through the engine into the request', async ({ page }) => {
    let body = null;
    await page.route('**/api/llm-call**', async (route) => {
      body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    // Drive the gate with the SAP tool's own config, mirroring engine.jsx's
    // runTurn, so a schema that exists but is never passed still fails here.
    await page.evaluate(async () => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      await window.NotesGate.generateConversation({
        system: sap.buildSystem(),
        messages: [{ role: 'user', content: 'x' }],
        tool: sap.id,
        maxTokens: sap.maxTokens,
        expectKeys: sap.formSections.map((s) => s.key || s.group),
        responseSchema: sap.responseSchema || null,
      }).catch(() => {});
    });

    expect(body).toBeTruthy();
    expect(body.output_config, 'engine did not forward the SAP schema').toBeTruthy();
    expect(body.output_config.format.schema.required).toContain('refinedGoal');
  });
});
