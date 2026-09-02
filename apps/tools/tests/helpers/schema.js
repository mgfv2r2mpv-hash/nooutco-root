/* Keywords the Anthropic structured-output API refuses, and where they are.
 *
 * It refuses the WHOLE call over one of these, not the property carrying it, so
 * a single bad keyword in a shared schema switches a feature off across every
 * tool that sends it. That is not a theoretical failure: TRIAGE_SCHEMA declared
 * `readiness: { type: "integer", minimum: 0, maximum: 100 }` and every note tool
 * silently stopped asking its gap questions between 2026-08-19 and 2026-09-01.
 *
 * Add to REFUSED when the API names another one. The path is returned rather
 * than a boolean because "properties > readiness > minimum" is actionable and
 * "a schema has minimum" is a hunt.
 */
export const REFUSED = ['minimum', 'maximum'];

export function refusedKeywords(node, path = '$') {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((v, i) => refusedKeywords(v, `${path}[${i}]`));
  return Object.keys(node).flatMap((k) =>
    REFUSED.includes(k) ? [`${path} > ${k}`] : refusedKeywords(node[k], `${path} > ${k}`),
  );
}
