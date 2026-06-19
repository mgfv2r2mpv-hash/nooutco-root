const BASELINE_CARDS = [
  { id: 'vs', icon: '📅', label: 'Schedules', title: 'Visual Schedule', desc: 'Drag-to-order first/next routines with check-off.' },
  { id: 'ft', icon: '➡️', label: 'Antecedent Support', title: 'First–Then Board', desc: 'Pair a demand with a chosen reinforcer, visually.' },
  { id: 'te', icon: '🪙', label: 'Reinforcement', title: 'Token Economy', desc: 'Configurable token boards that travel with the client.' },
  { id: 'cb', icon: '🗣️', label: 'Communication · AAC', title: 'Communication Board', desc: 'Core-word & requesting visuals — point or tap to communicate; travels with the learner.' },
  { id: 'sc', icon: '🗂️', label: 'Concept Skills', title: 'Sorting & Categories', desc: 'Drag items into categories — features, function, class.' },
  { id: 'fd', icon: '✋', label: 'Listener Skills', title: 'Following Directions', desc: '1–3 step receptive directions with built-in prompts.' },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      return handleApi(request, env, path);
    }

    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

    const secret = (env.ADMIN_SECRET ?? '').trim();
    const hash = await sha256Hex(secret);
    let html = await response.text();
    html = html.replace(
      /const ADMIN_SECRET_HASH = "[a-f0-9]{64}";/g,
      `const ADMIN_SECRET_HASH = "${hash}";`
    );

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(html, { status: response.status, headers });
  },
};

async function handleApi(request, env, path) {
  try {
    if (path === '/api/cards' && request.method === 'GET')                    return handleGetCards(env);
    if (path === '/api/vote' && request.method === 'POST')                    return handleVote(request, env);
    if (path === '/api/admin/card-status' && request.method === 'POST')       return handleCardStatus(request, env);
    if (path === '/api/admin/feature-starter' && request.method === 'POST')   return handleFeatureStarter(request, env);
    if (path === '/api/admin/new-enhancement' && request.method === 'POST')   return handleNewEnhancement(request, env);
    if (path === '/api/admin/publish-card' && request.method === 'POST')      return handlePublishCard(request, env);
    if (path === '/api/admin/reset-votes' && request.method === 'POST')       return handleResetVotes(request, env);
    return jsonRes(404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    return jsonRes(500, { error: 'Server error' });
  }
}

async function handleGetCards(env) {
  const [statusList, customCardsJson] = await Promise.all([
    env.VOTE_DATA.list({ prefix: 'card_status:' }),
    env.VOTE_DATA.get('custom_cards'),
  ]);

  const statuses = {};
  await Promise.all(statusList.keys.map(async k => {
    statuses[k.name.replace('card_status:', '')] = await env.VOTE_DATA.get(k.name);
  }));

  const customCards = customCardsJson ? JSON.parse(customCardsJson) : [];
  const allCards = [...BASELINE_CARDS, ...customCards].map(c => ({
    ...c,
    status: statuses[c.id] || 'active',
    isBaseline: !!BASELINE_CARDS.find(b => b.id === c.id),
  }));

  const withVotes = await Promise.all(allCards.map(async card => {
    const votesJson = await env.VOTE_DATA.get(`votes:${card.id}`);
    const votes = votesJson ? JSON.parse(votesJson) : {};
    const score = (votes['1'] || 0) * 3 + (votes['2'] || 0) * 2 + (votes['3'] || 0);
    return { ...card, votes, score };
  }));

  withVotes.sort((a, b) => b.score - a.score);
  return jsonRes(200, { cards: withVotes });
}

async function handleVote(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: 'Invalid JSON' }); }

  const { cardId, rank, delta } = body;
  if (!cardId || ![1, 2, 3].includes(rank) || ![-1, 1].includes(delta)) {
    return jsonRes(400, { error: 'cardId, rank (1-3), delta (1|-1) required' });
  }

  const key = `votes:${cardId}`;
  const votesJson = await env.VOTE_DATA.get(key);
  const votes = votesJson ? JSON.parse(votesJson) : {};
  const r = String(rank);
  votes[r] = Math.max(0, (votes[r] || 0) + delta);
  await env.VOTE_DATA.put(key, JSON.stringify(votes));

  return jsonRes(200, { ok: true, votes });
}

async function handleCardStatus(request, env) {
  if (!await verifyAdmin(request, env)) return jsonRes(403, { error: 'Unauthorized' });

  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: 'Invalid JSON' }); }

  const { cardId, status } = body;
  if (!cardId || !['active', 'archived', 'hidden'].includes(status)) {
    return jsonRes(400, { error: 'cardId and status (active|archived|hidden) required' });
  }

  if (status === 'active') {
    await env.VOTE_DATA.delete(`card_status:${cardId}`);
  } else {
    await env.VOTE_DATA.put(`card_status:${cardId}`, status);
  }
  return jsonRes(200, { ok: true });
}

async function handleFeatureStarter(request, env) {
  if (!await verifyAdmin(request, env)) return jsonRes(403, { error: 'Unauthorized' });
  if (!env.ANTHRO_KEY) return jsonRes(503, { error: 'ANTHRO_KEY not configured' });

  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: 'Invalid JSON' }); }

  const { cardId, freeform } = body;
  let featureContext = freeform?.trim() || '';

  if (!featureContext && cardId) {
    const cardsRes = await handleGetCards(env);
    const { cards } = await cardsRes.clone().json();
    const card = cards.find(c => c.id === cardId);
    if (card) {
      featureContext = `Title: ${card.title}\nCategory: ${card.label}\nDescription: ${card.desc}\nCommunity score: ${card.score} pts`;
    }
  }

  if (!featureContext) return jsonRes(400, { error: 'cardId or freeform required' });

  const text = await callAnthropic(env.ANTHRO_KEY, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: 'You are a technical lead preparing a Claude Code session prompt to implement a new ABA therapy app feature for games.nooutco.me or tools.nooutco.me. Return ONLY the ready-to-use Claude Code prompt — no preamble, no markdown fences.',
    messages: [{
      role: 'user',
      content: `Feature:\n${featureContext}\n\nWrite a Claude Code prompt (under 300 words) that:\n1. States the goal in one sentence\n2. Lists ABA/clinical constraints (no PHI logging, session-safe)\n3. Suggests which existing game files to review for reference\n4. Outlines the approach in 3-5 bullet points\n\nStart directly with: "Implement: [feature name]"`,
    }],
  });

  return jsonRes(200, { prompt: text });
}

async function handleNewEnhancement(request, env) {
  if (!await verifyAdmin(request, env)) return jsonRes(403, { error: 'Unauthorized' });
  if (!env.ANTHRO_KEY) return jsonRes(503, { error: 'ANTHRO_KEY not configured' });

  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: 'Invalid JSON' }); }

  const { input } = body;
  if (!input || input.trim().length < 20) return jsonRes(400, { error: 'Input too short (min 20 chars)' });

  const text = await callAnthropic(env.ANTHRO_KEY, {
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: 'You evaluate ABA therapy app feature requests. Respond ONLY with valid JSON. No markdown, no explanation.',
    messages: [{
      role: 'user',
      content: `Feature request:\n${input.trim()}\n\nRespond with JSON matching this exact schema:\n{\n  "feasibility": <integer 1-5>,\n  "impact": <integer 1-5>,\n  "title": "<concise card title, max 5 words>",\n  "icon": "<single emoji>",\n  "label": "<category, e.g. Schedules, Reinforcement, Communication>",\n  "description": "<2-3 sentence voter-friendly description of what this does and who it helps>",\n  "implementation_prompt": "<200-400 word Claude Code session prompt for implementing this feature, starting with \'Implement: [title]\'>"\n}`,
    }],
  });

  let parsed;
  try {
    const cleaned = text.replace(/^```json\s*/m, '').replace(/^```\s*/m, '').replace(/```\s*$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return jsonRes(502, { error: 'AI returned invalid JSON — try again' });
  }

  return jsonRes(200, parsed);
}

async function handlePublishCard(request, env) {
  if (!await verifyAdmin(request, env)) return jsonRes(403, { error: 'Unauthorized' });

  let card;
  try { card = await request.json(); } catch { return jsonRes(400, { error: 'Invalid JSON' }); }

  const id = `c${Date.now()}`;
  const customCardsJson = await env.VOTE_DATA.get('custom_cards');
  const customCards = customCardsJson ? JSON.parse(customCardsJson) : [];
  customCards.push({ id, icon: card.icon || '✨', title: card.title, label: card.label, desc: card.description });
  await env.VOTE_DATA.put('custom_cards', JSON.stringify(customCards));

  return jsonRes(200, { ok: true, id });
}

async function handleResetVotes(request, env) {
  if (!await verifyAdmin(request, env)) return jsonRes(403, { error: 'Unauthorized' });

  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: 'Invalid JSON' }); }

  const { cardId } = body;
  if (!cardId) return jsonRes(400, { error: 'cardId required' });

  await env.VOTE_DATA.put(`votes:${cardId}`, JSON.stringify({}));
  return jsonRes(200, { ok: true });
}

async function verifyAdmin(request, env) {
  const secret = (request.headers.get('X-Admin-Secret') || '').trim();
  if (!secret || !env.ADMIN_SECRET) return false;
  const inputHash = await sha256Hex(secret);
  const expectedHash = await sha256Hex(env.ADMIN_SECRET.trim());
  return inputHash === expectedHash;
}

async function callAnthropic(apiKey, body) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.content[0]?.text || '';
}

function jsonRes(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
