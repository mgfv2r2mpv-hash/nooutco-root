/**
 * Technician style profile API.
 *
 * INGRESS. This Worker has no route and no workers.dev subdomain (see
 * wrangler.toml). The only way to reach it is a service binding from the tools
 * Pages worker, which is the whole point -- the browser never talks to it, so
 * a technician cannot read or forge another technician's profile even if they
 * hold a valid session token.
 *
 * That means `kid` arrives already authenticated: the caller verified the HMAC
 * session token before forwarding. This Worker does not re-verify it, because
 * it has no access to ADMIN_SECRET and no independent way to. Everything else
 * in the request is still validated here -- an authenticated caller is not the
 * same as a correct one, and the feature list is a closed set for a reason.
 *
 * WHAT MAY NOT BE STORED: clinical text of any kind. See schema.sql.
 */

import { deriveRules, cardRows, renderStyleBlock } from "./derive.js";
import { FEATURE_NAMES } from "./features.js";
import { sanitizeCorrections, sanitizeMetrics, cleanKid, cleanSlug } from "./validate.js";

/** Corrections considered when rebuilding a card. Bounds the query, and a
 *  technician's style two thousand edits ago is not evidence about today. */
const CORRECTION_WINDOW = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.DB) return json(503, { error: "Profile database is not bound." });

    try {
      if (url.pathname === "/health") {
        return json(200, { ok: true });
      }
      if (url.pathname === "/events" && request.method === "POST") {
        return await handleEvents(request, env);
      }
      if (url.pathname === "/style-card" && request.method === "GET") {
        return await handleGetCard(url, env);
      }
      if (url.pathname === "/style-card/mute" && request.method === "POST") {
        return await handleMute(request, env);
      }
      if (url.pathname === "/insights" && request.method === "GET") {
        return await handleInsights(env);
      }
      return json(404, { error: "No such route." });
    } catch (err) {
      // Never echo the caller's payload back -- it is the one thing that could
      // carry something it should not.
      console.error("profile-api error", url.pathname, err && err.message);
      return json(500, { error: "Profile store error." });
    }
  },
};

/* ─────────────────────────── events ─────────────────────────── */

async function handleEvents(request, env) {
  const body = await readJson(request);
  if (!body) return json(400, { error: "Invalid JSON." });

  const kid = cleanKid(body.kid);
  if (!kid) return json(400, { error: "Missing kid." });
  const tool = cleanSlug(body.tool) || "unknown";
  const now = Date.now();

  const corrections = sanitizeCorrections(body.corrections, now);
  const metrics = sanitizeMetrics(body.metrics, now);

  const statements = [
    env.DB.prepare(
      `INSERT INTO technician (kid, first_seen, last_seen, note_count)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(kid) DO UPDATE SET last_seen = excluded.last_seen`,
    ).bind(kid, now, now),
  ];

  for (const c of corrections) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO correction_event (kid, tool, ts, source, feature, direction, magnitude)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(kid, tool, c.ts, c.source, c.feature, c.direction, c.magnitude),
    );
  }

  for (const m of metrics) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO usage_metric (kid, tool, ts, type, data) VALUES (?, ?, ?, ?, ?)`,
      ).bind(kid, tool, m.ts, m.type, JSON.stringify(m.data)),
    );
    if (m.type === "note_generated") {
      statements.push(
        env.DB.prepare(`UPDATE technician SET note_count = note_count + 1 WHERE kid = ?`).bind(kid),
      );
    }
  }

  await env.DB.batch(statements);

  // Only rebuild when something could actually have changed the card.
  const rules = corrections.length ? await rebuildCard(env, kid, now) : null;

  return json(200, {
    stored: { corrections: corrections.length, metrics: metrics.length },
    rules: rules ? rules.length : undefined,
  });
}

/* ─────────────────────────── style card ─────────────────────────── */

async function handleGetCard(url, env) {
  const kid = cleanKid(url.searchParams.get("kid"));
  if (!kid) return json(400, { error: "Missing kid." });

  const { results } = await env.DB.prepare(
    `SELECT feature, direction, rule, evidence, confidence, muted, updated_at
       FROM style_card WHERE kid = ? ORDER BY confidence DESC`,
  )
    .bind(kid)
    .all();

  const rules = (results || []).map((r) => ({
    feature: r.feature,
    direction: r.direction,
    rule: r.rule,
    evidence: r.evidence,
    confidence: r.confidence,
    muted: !!r.muted,
  }));

  return json(200, {
    rules,
    block: renderStyleBlock(rules),
    updatedAt: (results || []).reduce((a, r) => Math.max(a, r.updated_at || 0), 0) || null,
  });
}

async function handleMute(request, env) {
  const body = await readJson(request);
  if (!body) return json(400, { error: "Invalid JSON." });

  const kid = cleanKid(body.kid);
  const feature = FEATURE_NAMES.includes(body.feature) ? body.feature : null;
  if (!kid || !feature) return json(400, { error: "Missing kid or unknown feature." });

  // A mute is reversible and the evidence is untouched, so a rule the
  // technician switches off can come back if they keep making that correction.
  await env.DB.prepare(`UPDATE style_card SET muted = ? WHERE kid = ? AND feature = ?`)
    .bind(body.muted === false ? 0 : 1, kid, feature)
    .run();

  return json(200, { ok: true });
}

/**
 * Aggregate view for steering the tool, deliberately naming nobody.
 *
 * The question this answers is "which way are technicians pulling, and should
 * the base prompt move?" -- if most of them keep shortening sentences, that is
 * a fact about the house prompt, not about seven individuals.
 *
 * NO `kid` IS RETURNED, from any row. That is not decoration: the moment this
 * can be joined back to a person it stops being an engineering signal and
 * becomes a performance record, which is a different thing with different
 * consequences for how technicians use the tool. A feature with only one
 * technician behind it is withheld too, since "1 technician, direction -1" plus
 * a roster of one is not anonymous.
 */
const MIN_COHORT = 2;

async function handleInsights(env) {
  const { results } = await env.DB.prepare(
    `SELECT feature,
            direction,
            COUNT(*)              AS technicians,
            SUM(evidence)         AS evidence,
            AVG(confidence)       AS confidence,
            SUM(muted)            AS muted
       FROM style_card
      GROUP BY feature, direction
      ORDER BY technicians DESC, evidence DESC`,
  ).all();

  const rows = (results || []).filter((r) => r.technicians >= MIN_COHORT);

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS technicians, SUM(note_count) AS notes FROM technician`,
  ).first();

  return json(200, {
    cohort: {
      technicians: (totals && totals.technicians) || 0,
      notes: (totals && totals.notes) || 0,
    },
    // Suppressed rows are reported as a count so the view never silently looks
    // emptier than the data is.
    withheldForSmallCohort: (results || []).length - rows.length,
    minCohort: MIN_COHORT,
    features: rows.map((r) => ({
      feature: r.feature,
      direction: r.direction,
      technicians: r.technicians,
      evidence: r.evidence,
      confidence: Math.round((r.confidence || 0) * 100) / 100,
      mutedBy: r.muted,
    })),
  });
}

async function rebuildCard(env, kid, now) {
  const { results } = await env.DB.prepare(
    `SELECT feature, direction, magnitude, ts FROM correction_event
      WHERE kid = ? ORDER BY ts DESC LIMIT ?`,
  )
    .bind(kid, CORRECTION_WINDOW)
    .all();

  const rules = deriveRules(results || [], now);
  const rows = cardRows(kid, rules, now);
  const keep = new Set(rows.map((r) => r.feature));

  const statements = rows.map((r) =>
    env.DB.prepare(
      `INSERT INTO style_card (kid, feature, direction, rule, evidence, confidence, muted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(kid, feature) DO UPDATE SET
         direction  = excluded.direction,
         rule       = excluded.rule,
         evidence   = excluded.evidence,
         confidence = excluded.confidence,
         updated_at = excluded.updated_at,
         -- A mute is an opinion about one specific instruction. When the
         -- evidence flips the direction, the rule becomes its own opposite, and
         -- carrying the mute across would silently suppress a rule the
         -- technician never saw, let alone objected to.
         muted      = CASE WHEN style_card.direction != excluded.direction
                           THEN 0 ELSE style_card.muted END`,
    ).bind(r.kid, r.feature, r.direction, r.rule, r.evidence, r.confidence, r.updated_at),
  );

  // A feature that no longer clears the evidence bar must lose its rule --
  // otherwise a card only ever grows and stale rules quietly persist.
  const drop = FEATURE_NAMES.filter((f) => !keep.has(f));
  if (drop.length) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM style_card WHERE kid = ? AND feature IN (${drop.map(() => "?").join(",")})`,
      ).bind(kid, ...drop),
    );
  }

  if (statements.length) await env.DB.batch(statements);
  return rules;
}

/* ─────────────────────────── transport ─────────────────────────── */

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
