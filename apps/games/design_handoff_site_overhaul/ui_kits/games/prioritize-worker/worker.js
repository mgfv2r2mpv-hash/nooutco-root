// Cloudflare Worker — "Prioritize" ranked voting for the No Outcome games hub.
// Each visitor submits a ranked ballot (1st / 2nd / 3rd choice among planned
// features); the Worker stores it in KV and returns aggregate weighted points.
// Weights: 1st = 3, 2nd = 2, 3rd = 1. Re-submitting overwrites that visitor's
// ballot, so accessors can change their vote/rank freely.
//
// Endpoints (path /api/votes):
//   GET  -> { points: {id:Number}, counts: {id:{first,second,third}} }
//   POST { clientId, ballot:{first,second,third} } -> same aggregate shape
//
// See README.md for deploy steps. Tighten ALLOW_ORIGIN before going live.

const WEIGHT = { first: 3, second: 2, third: 1 };
const ALLOW_ORIGIN = '*'; // e.g. 'https://nooutco.me' in production

const cors = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname !== '/api/votes') return json({ error: 'not found' }, 404);

    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const clientId = body && body.clientId;
      const ballot = (body && body.ballot) || {};
      if (!clientId || typeof clientId !== 'string') return json({ error: 'clientId required' }, 400);
      const clean = {
        first: ballot.first || null,
        second: ballot.second || null,
        third: ballot.third || null,
      };
      // Overwrite this visitor's ballot — changing a vote just replaces it.
      await env.VOTES.put('ballot:' + clientId, JSON.stringify(clean));
      return json(await tally(env));
    }

    if (request.method === 'GET') return json(await tally(env));
    return json({ error: 'method not allowed' }, 405);
  },
};

// Sum every stored ballot into weighted points + raw per-slot counts.
// Fine for modest volumes; for very high traffic, aggregate incrementally
// (read-modify-write per ballot) or use a Durable Object instead of list().
async function tally(env) {
  const points = {};
  const counts = {};
  let cursor;
  do {
    const list = await env.VOTES.list({ prefix: 'ballot:', cursor });
    for (const key of list.keys) {
      let b;
      try { b = JSON.parse(await env.VOTES.get(key.name) || '{}'); } catch (e) { continue; }
      for (const slot of Object.keys(WEIGHT)) {
        const id = b[slot];
        if (!id) continue;
        points[id] = (points[id] || 0) + WEIGHT[slot];
        counts[id] = counts[id] || { first: 0, second: 0, third: 0 };
        counts[id][slot]++;
      }
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);
  return { points, counts };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
