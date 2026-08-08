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
import { runWeekly, isSendHour } from "./weekly.js";
import { accumulate, targetFor, renderShapeBlock } from "./shape.js";
import { registerFor } from "./registers.js";

/** Corrections considered when rebuilding a card. Bounds the query, and a
 *  technician's style two thousand edits ago is not evidence about today. */
const CORRECTION_WINDOW = 500;

export default {
  /* Friday 20:00 in America/New_York. The cron fires at both candidate UTC
     hours because daylight saving moves that target, and isSendHour decides
     which firing is the real one. A no-op firing costs one Intl call.

     Deliberately best effort: a failed send must not retry into a loop, so it
     is logged and dropped. The data it summarises stays in D1 either way. */
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    if (!isSendHour(new Date(event.scheduledTime))) return;
    ctx.waitUntil(
      runWeekly(env, event.scheduledTime)
        .then((r) => console.log("weekly audit", JSON.stringify({ sent: r.sent, notes: r.notes, status: r.status, reason: r.reason })))
        .catch((e) => console.log("weekly audit failed", String(e && e.message || e))),
    );
  },

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
      // Supervisor views. Reachable only over the service binding, and the
      // Pages worker puts an admin-token check in front of every one of them.
      if (url.pathname === "/roster" && request.method === "GET") {
        return await handleRoster(env);
      }
      if (url.pathname === "/card-detail" && request.method === "GET") {
        return await handleCardDetail(url, env);
      }
      if (url.pathname === "/card-history" && request.method === "GET") {
        return await handleCardHistory(url, env);
      }
      if (url.pathname === "/suppress" && request.method === "POST") {
        return await handleSuppress(request, env);
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
  let shapeUpdate = null;

  const statements = [
    env.DB.prepare(
      `INSERT INTO technician (kid, first_seen, last_seen, note_count)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(kid) DO UPDATE SET last_seen = excluded.last_seen`,
    ).bind(kid, now, now),
  ];

  /* THE CORRECTION'S OWN TOOL WINS.
     `tool` here is a property of the BATCH, and a batch is whatever happened to
     be buffered when a flush succeeded. It was previously the only thing this
     INSERT had, which meant a technician who worked in two tools before a flush
     landed had every correction in that batch filed under whichever one the
     oldest buffered event came from, and a flush with no metrics alongside it
     filed them all under "unknown". A correction now carries the tool it was
     actually made in, and the batch value is only the fallback. */
  for (const c of corrections) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO correction_event (kid, tool, ts, source, feature, direction, magnitude)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(kid, c.tool || tool, c.ts, c.source, c.feature, c.direction, c.magnitude),
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
    // The two numbers the shape target is drawn from. burstiness IS the
    // coefficient of variation of sentence length; the browser reports it under
    // that name because that is what the scorer has always called it.
    if (m.type === "note_register"
        && Number.isFinite(m.data.meanLen) && Number.isFinite(m.data.burstiness)
        && m.data.meanLen > 0 && m.data.burstiness > 0) {
      shapeUpdate = { meanLen: m.data.meanLen, cv: m.data.burstiness };
    }
  }

  /* Read, fold, write. Not an UPSERT with SQL arithmetic, because the running
     variance needs the previous sums and D1 has no RETURNING on conflict. Two
     round trips on a path that already does several is the cheaper trade
     against getting the accumulator wrong. */
  if (shapeUpdate) {
    const prev = await env.DB.prepare(
      `SELECT n_notes, sum_len, sum_cv, sum_cv_sq FROM shape_profile WHERE kid = ? AND tool = ?`,
    ).bind(kid, tool).first();
    const next = accumulate(prev, shapeUpdate.meanLen, shapeUpdate.cv);
    statements.push(
      env.DB.prepare(
        `INSERT INTO shape_profile (kid, tool, n_notes, sum_len, sum_cv, sum_cv_sq, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kid, tool) DO UPDATE SET
           n_notes = excluded.n_notes, sum_len = excluded.sum_len,
           sum_cv = excluded.sum_cv, sum_cv_sq = excluded.sum_cv_sq,
           updated = excluded.updated`,
      ).bind(kid, tool, next.n_notes, next.sum_len, next.sum_cv, next.sum_cv_sq, now),
    );
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

  // A suppressed rule is gone as far as this route is concerned: not in the
  // list, not in the block, so it cannot reach a prompt. The technician is not
  // told, by design - the removal is reviewed in supervision, not announced by
  // the tool.
  /* The card served is the one for THIS tool's register. Reading the tool up
     here rather than further down is what makes that possible; it was already
     being read for the shape target below. */
  const tool = cleanSlug(url.searchParams.get("tool")) || "unknown";
  const register = registerFor(tool);

  const { results } = await env.DB.prepare(
    `SELECT c.feature, c.direction, c.rule, c.evidence, c.confidence, c.muted, c.updated_at
       FROM style_card c
       LEFT JOIN style_card_suppression s
         ON s.kid = c.kid AND s.register = c.register AND s.feature = c.feature
      WHERE c.kid = ? AND c.register = ? AND s.feature IS NULL
      ORDER BY c.confidence DESC`,
  )
    .bind(kid, register)
    .all();

  const rules = (results || []).map((r) => ({
    feature: r.feature,
    direction: r.direction,
    rule: r.rule,
    evidence: r.evidence,
    confidence: r.confidence,
    muted: !!r.muted,
  }));

  /* The shape target rides along with the card, rather than on its own route.
     It has to be drawn once per note and reach the same prompt, and the card is
     already fetched at exactly that moment. A second endpoint would be a second
     chance for the two to disagree about which note they are describing.

     The seed is the caller's, so the same note redraws the same target on a
     revision and the prompt prefix stays stable for the cache. */
  const seed = (url.searchParams.get("seed") || "").slice(0, 64) || (kid + ":" + tool);
  const shapeRow = await env.DB.prepare(
    `SELECT n_notes, sum_len, sum_cv, sum_cv_sq FROM shape_profile WHERE kid = ? AND tool = ?`,
  ).bind(kid, tool).first();
  const target = targetFor(shapeRow, tool, seed);

  /* Kept as two fields rather than one concatenated string. `block` is the
     learned card and must stay empty when there are no rules, which is what
     suppression relies on to prove a removed rule left the prompt. The shape
     target is not a learned rule and applies even to a technician with no card
     at all, so it travels beside it and the caller composes. */
  return json(200, {
    rules,
    block: renderStyleBlock(rules),
    shapeBlock: renderShapeBlock(target),
    shape: target,
    updatedAt: (results || []).reduce((a, r) => Math.max(a, r.updated_at || 0), 0) || null,
  });
}

async function handleMute(request, env) {
  const body = await readJson(request);
  if (!body) return json(400, { error: "Invalid JSON." });

  const kid = cleanKid(body.kid);
  const feature = FEATURE_NAMES.includes(body.feature) ? body.feature : null;
  if (!kid || !feature) return json(400, { error: "Missing kid or unknown feature." });

  /* A mute is reversible and the evidence is untouched, so a rule the technician
     switches off can come back if they keep making that correction.

     SCOPED TO ONE REGISTER. Without the register in the WHERE clause this would
     mute the same feature everywhere, so switching off "prefer shorter
     sentences" while writing a supervision note would silently switch it off for
     SAP too. The technician muted the rule they were shown, in the document they
     were writing, and nothing more. */
  const register = registerFor(cleanSlug(body.tool));
  await env.DB.prepare(
    `UPDATE style_card SET muted = ? WHERE kid = ? AND register = ? AND feature = ?`,
  )
    .bind(body.muted === false ? 0 : 1, kid, register, feature)
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
    /* COUNT(DISTINCT kid), not COUNT(*). One person can now hold the same
       feature in two registers, so counting rows would report them as two
       technicians and float a feature over the MIN_COHORT bar that only one
       person actually has. That would break the anonymity this route exists to
       preserve, not just the arithmetic. */
    `SELECT feature,
            direction,
            COUNT(DISTINCT kid)   AS technicians,
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

/* ───────────────────── supervisor views ─────────────────────
 *
 * The original design deliberately made individual cards invisible to a BCBA,
 * on the reasoning that a technician who knows their supervisor reads their
 * card uses the tool differently. The ruling on 2026-08-04 overrode that: the
 * heuristics about staff have to be visible to track over time, and a rule that
 * is not in line with company or best practice policy has to be removable.
 *
 * What did NOT change is what is stored. These routes read the same
 * content-free columns as everything else. There is no prose here to read.
 */

/** Everyone the store knows about, with enough to decide whose card to open. */
async function handleRoster(env) {
  const { results } = await env.DB.prepare(
    `SELECT t.kid,
            t.first_seen,
            t.last_seen,
            t.note_count,
            (SELECT COUNT(*) FROM style_card c WHERE c.kid = t.kid)              AS rules,
            (SELECT COUNT(*) FROM style_card c WHERE c.kid = t.kid AND c.muted = 1) AS muted,
            (SELECT COUNT(*) FROM style_card_suppression s WHERE s.kid = t.kid)  AS removed,
            (SELECT COUNT(*) FROM correction_event e WHERE e.kid = t.kid)        AS corrections
       FROM technician t
      ORDER BY t.last_seen DESC`,
  ).all();

  return json(200, {
    technicians: (results || []).map((r) => ({
      kid: r.kid,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      notes: r.note_count,
      corrections: r.corrections,
      rules: r.rules,
      muted: r.muted,
      removed: r.removed,
    })),
  });
}

/** One technician's card as a supervisor needs to see it: including the rules
 *  the technician muted and the ones a supervisor already removed, which the
 *  technician-facing route hides. */
async function handleCardDetail(url, env) {
  const kid = cleanKid(url.searchParams.get("kid"));
  if (!kid) return json(400, { error: "Missing kid." });

  const [card, suppressed, who] = await Promise.all([
    env.DB.prepare(
      `SELECT register, feature, direction, rule, evidence, confidence, muted, updated_at
         FROM style_card WHERE kid = ? ORDER BY register, confidence DESC`,
    ).bind(kid).all(),
    env.DB.prepare(
      `SELECT register, feature, ts FROM style_card_suppression WHERE kid = ?`,
    ).bind(kid).all(),
    env.DB.prepare(
      `SELECT first_seen, last_seen, note_count FROM technician WHERE kid = ?`,
    ).bind(kid).first(),
  ]);

  /* Keyed by register AND feature. On the feature alone, a rule the supervisor
     removed from one register would render as removed in every register that
     happens to carry the same feature, which is a removal they never made. */
  const key = (register, feature) => register + " " + feature;
  const removedAt = new Map(
    (suppressed.results || []).map((r) => [key(r.register, r.feature), r.ts]),
  );

  return json(200, {
    kid,
    firstSeen: who ? who.first_seen : null,
    lastSeen: who ? who.last_seen : null,
    notes: who ? who.note_count : 0,
    rules: (card.results || []).map((r) => ({
      register: r.register,
      feature: r.feature,
      direction: r.direction,
      rule: r.rule,
      evidence: r.evidence,
      confidence: r.confidence,
      muted: !!r.muted,
      removed: removedAt.has(key(r.register, r.feature)),
      removedAt: removedAt.get(key(r.register, r.feature)) || null,
      updatedAt: r.updated_at,
    })),
    // A rule can be removed and then fall below the evidence bar, at which
    // point no style_card row exists to hang it off. Report it anyway, or the
    // removal looks like it never happened.
    removedWithoutRule: (suppressed.results || [])
      .filter((r) => !(card.results || [])
        .some((c) => c.register === r.register && c.feature === r.feature))
      .map((r) => ({ register: r.register, feature: r.feature, removedAt: r.ts })),
  });
}

/** How the card moved, replayed rather than stored.
 *
 * deriveRules is pure and takes the events plus a clock, so the card at any
 * past moment is just deriveRules(events up to then, then). That keeps one
 * definition of what a card is: a stored history could drift from the live
 * derivation and then two answers would both look authoritative. */
const HISTORY_MAX_POINTS = 24;

async function handleCardHistory(url, env) {
  const kid = cleanKid(url.searchParams.get("kid"));
  if (!kid) return json(400, { error: "Missing kid." });

  const asked = Number(url.searchParams.get("points"));
  const points = Math.max(2, Math.min(HISTORY_MAX_POINTS, Number.isFinite(asked) ? asked : 12));

  const { results } = await env.DB.prepare(
    `SELECT feature, direction, magnitude, ts FROM correction_event
      WHERE kid = ? ORDER BY ts ASC`,
  ).bind(kid).all();

  const events = results || [];
  if (!events.length) return json(200, { kid, points: [], features: [] });

  const first = events[0].ts;
  const last = events[events.length - 1].ts;
  const span = Math.max(1, last - first);

  const series = [];
  for (let i = 0; i < points; i++) {
    const at = first + Math.round((span * (i + 1)) / points);
    const upTo = events.filter((e) => e.ts <= at);
    const rules = deriveRules(upTo, at);
    series.push({
      ts: at,
      events: upTo.length,
      rules: rules.map((r) => ({
        feature: r.feature,
        direction: r.direction,
        confidence: r.confidence,
        evidence: r.evidence,
      })),
    });
  }

  // Which features ever appeared, so a caller can lay out the lines up front.
  const seen = new Set();
  for (const p of series) for (const r of p.rules) seen.add(r.feature);

  return json(200, { kid, points: series, features: [...seen] });
}

/** Remove a rule, or put one back. Deliberately silent: the technician is not
 *  notified, and nothing in their view says a rule was ever there. */
async function handleSuppress(request, env) {
  const body = await readJson(request);
  const kid = cleanKid(body && body.kid);
  const feature = cleanSlug(body && body.feature);
  if (!kid || !feature) return json(400, { error: "Missing kid or feature." });
  if (!FEATURE_NAMES.includes(feature)) return json(400, { error: "Unknown feature." });

  const removed = body.removed !== false;
  const now = Number.isFinite(body.now) ? Math.round(body.now) : Date.now();

  /* A supervisor removes ONE rule, in one register, and is looking at that
     register's card when they do it. Taking the register from the request
     rather than removing the feature everywhere matters: "prefer contractions"
     may be wrong in a clinical instrument and perfectly right in a parent
     training note, and a removal that hit both would be a judgement the
     supervisor did not make. */
  const register = cleanSlug(body && body.register) || registerFor(cleanSlug(body && body.tool));

  if (removed) {
    await env.DB.prepare(
      `INSERT INTO style_card_suppression (kid, register, feature, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT(kid, register, feature) DO UPDATE SET ts = excluded.ts`,
    ).bind(kid, register, feature, now).run();
  } else {
    await env.DB.prepare(
      `DELETE FROM style_card_suppression WHERE kid = ? AND register = ? AND feature = ?`,
    ).bind(kid, register, feature).run();
  }

  return json(200, { ok: true, kid, register, feature, removed });
}

/* ONE CARD PER REGISTER, not one per person.
   The window is applied per register rather than across the whole history,
   because a technician who writes mostly supervision notes would otherwise have
   their SAP evidence pushed out of the window by sheer volume and never grow a
   SAP rule at all. */
async function rebuildCard(env, kid, now) {
  const { results } = await env.DB.prepare(
    `SELECT feature, direction, magnitude, ts, tool FROM correction_event
      WHERE kid = ? ORDER BY ts DESC LIMIT ?`,
  )
    .bind(kid, CORRECTION_WINDOW * 4)
    .all();

  const byRegister = new Map();
  for (const e of results || []) {
    const reg = registerFor(e.tool);
    if (!byRegister.has(reg)) byRegister.set(reg, []);
    const bucket = byRegister.get(reg);
    if (bucket.length < CORRECTION_WINDOW) bucket.push(e);
  }

  const statements = [];
  const all = [];

  for (const [register, events] of byRegister) {
    const rules = deriveRules(events, now);
    const rows = cardRows(kid, register, rules, now);
    const keep = new Set(rows.map((r) => r.feature));
    all.push(...rows);

    for (const r of rows) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO style_card (kid, register, feature, direction, rule, evidence, confidence, muted, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(kid, register, feature) DO UPDATE SET
             direction  = excluded.direction,
             rule       = excluded.rule,
             evidence   = excluded.evidence,
             confidence = excluded.confidence,
             updated_at = excluded.updated_at,
             -- A mute is an opinion about one specific instruction. When the
             -- evidence flips the direction, the rule becomes its own opposite,
             -- and carrying the mute across would silently suppress a rule the
             -- technician never saw, let alone objected to.
             muted      = CASE WHEN style_card.direction != excluded.direction
                               THEN 0 ELSE style_card.muted END`,
        ).bind(r.kid, r.register, r.feature, r.direction, r.rule, r.evidence, r.confidence, r.updated_at),
      );
    }

    // A feature that no longer clears the evidence bar must lose its rule --
    // otherwise a card only ever grows and stale rules quietly persist. Scoped
    // to this register: a rule in another one is not stale just because this
    // register's evidence moved.
    const drop = FEATURE_NAMES.filter((f) => !keep.has(f));
    if (drop.length) {
      statements.push(
        env.DB.prepare(
          `DELETE FROM style_card WHERE kid = ? AND register = ? AND feature IN (${drop.map(() => "?").join(",")})`,
        ).bind(kid, register, ...drop),
      );
    }
  }

  if (statements.length) await env.DB.batch(statements);
  return all;
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
