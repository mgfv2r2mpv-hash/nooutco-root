import { test, expect } from '@playwright/test';
import { sanitizeOutputConfig, stripUnsupportedSchemaKeys } from '../_worker.js';

/* The Messages API refuses minimum, maximum and the other numeric bounds in a
 * structured-output schema. A page running an old cached copy of the BT tool
 * sent readiness as { type: "integer", minimum: 0, maximum: 100 } and every
 * call failed with a 400. The Worker now drops those keywords on the way
 * through, so no page, however stale, can trip it. */

test('numeric bounds are dropped at every depth, and nothing else changes', () => {
  const sent = {
    type: 'object',
    properties: {
      readiness: { type: 'integer', minimum: 0, maximum: 100, description: '0 to 100.' },
      hints: {
        type: 'array',
        items: { type: 'object', properties: { rank: { type: 'integer', exclusiveMinimum: 0, multipleOf: 1 } } },
      },
      // A property that happens to be CALLED minimum is data, not a bound.
      minimum: { type: 'string' },
    },
    required: ['readiness'],
  };
  const out = sanitizeOutputConfig({ format: { type: 'json_schema', schema: sent } });
  expect(out.format.schema).toEqual({
    type: 'object',
    properties: {
      readiness: { type: 'integer', description: '0 to 100.' },
      hints: { type: 'array', items: { type: 'object', properties: { rank: { type: 'integer' } } } },
      minimum: { type: 'string' },
    },
    required: ['readiness'],
  });
  // The page's own object is left as it was.
  expect(sent.properties.readiness.minimum).toBe(0);
});

test('a schema with no bounds passes through unchanged, and the old refusals still hold', () => {
  const plain = { type: 'object', properties: { a: { type: 'string', enum: ['x'] } } };
  expect(stripUnsupportedSchemaKeys(plain)).toEqual(plain);
  expect(sanitizeOutputConfig(null)).toBeNull();
  expect(sanitizeOutputConfig({ format: { type: 'text' } })).toBeNull();
  expect(sanitizeOutputConfig({ format: { type: 'json_schema', schema: [] } })).toBeNull();
});
