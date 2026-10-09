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
import { registerFor } from "./registers.js";
import { sanitizeCorrections, sanitizeMetrics, cleanKid, cleanSlug } from "./validate.js";
import { runWeekly, isSendHour } from "./weekly.js";
import { accumulate, targetFor, renderShapeBlock } from "./shape.js";
import { acceptVoice, voiceStatements } from "./voice-write.js";
import { voiceReading } from "./voice-read.js";
import { summariseTriageUsage } from "./triage-usage.js";

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
        /* IT NAMES ITSELF, and that is not decoration. The live tests in
           test/ wait for this route on a fixed port and treat any 200 as "our
           dev server is up". On 2026-09-03 port 8799 was held by an orphaned
           workerd from an unrelated session, three days old, answering 200 to
           everything - so all six suppression tests set live = true, ran their
           assertions against a stranger's server, and failed in a way that read
           exactly like a broken suppression feature. A health check that does
           not say who it is can be answered by anyone. */
        return json(200, { ok: true, service: "bt-profile-api" });
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
      if (url.pathname === "/metrics-summary" && request.method === "GET") {
        return await handleMetricsSummary(url, env);
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
      if (url.pathname === "/triage-usage" && request.method === "GET") {
        return await handleTriageUsage(url, env);
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

  /* EACH CORRECTION'S OWN TOOL, falling back to the batch's only when the
     client did not say. The browser's correction buffer is shared across tools
     and survives a reload, so `tool` on the request is the tool whoever
     flushed the buffer happened to be in, not the tool each correction was
     made in. Labelling the whole batch from it used to write a mislabelled
     row; now that the register is half of the card's primary key, it teaches
     the rule into the wrong pool, which is the bleed this change exists to
     stop and would reintroduce it one flush at a time. */
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
    /* The three numbers a shape target is drawn from. Deliberately NOT
       burstiness, which is the whole-note figure the browser has always
       reported: it is a mixture of these two and does not identify a shape on
       its own. A note whose sections are too short to measure sends neither of
       the section numbers, and then there is nothing to fold in. Folding a zero
       would enter perfect flatness into their profile as a real observation. */
    if (m.type === "note_register"
        && Number.isFinite(m.data.meanLen) && m.data.meanLen > 0
        && Number.isFinite(m.data.sectionCv) && m.data.sectionCv > 0
        && Number.isFinite(m.data.sectionStep) && m.data.sectionStep > 0) {
      shapeUpdate = {
        meanLen: m.data.meanLen,
        withinCv: m.data.sectionCv,
        stepRel: m.data.sectionStep,
      };
    }
  }

  /* Read, fold, write. Not an UPSERT with SQL arithmetic, because the running
     variance needs the previous sums and D1 has no RETURNING on conflict. Two
     round trips on a path that already does several is the cheaper trade
     against getting the accumulator wrong. */
  if (shapeUpdate) {
    const prev = await env.DB.prepare(
      `SELECT n_notes, sum_len, sum_cv, sum_cv_sq, sum_step, sum_step_sq
         FROM shape_profile WHERE kid = ? AND tool = ?`,
    ).bind(kid, tool).first();
    const next = accumulate(prev, shapeUpdate.meanLen, shapeUpdate.withinCv, shapeUpdate.stepRel);
    statements.push(
      env.DB.prepare(
        `INSERT INTO shape_profile
           (kid, tool, n_notes, sum_len, sum_cv, sum_cv_sq, sum_step, sum_step_sq, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kid, tool) DO UPDATE SET
           n_notes = excluded.n_notes, sum_len = excluded.sum_len,
           sum_cv = excluded.sum_cv, sum_cv_sq = excluded.sum_cv_sq,
           sum_step = excluded.sum_step, sum_step_sq = excluded.sum_step_sq,
           updated = excluded.updated`,
      ).bind(kid, tool, next.n_notes, next.sum_len, next.sum_cv, next.sum_cv_sq,
             next.sum_step, next.sum_step_sq, now),
    );
  }

  /* Voice levels and diction, one entry per note. Every string these statements
     bind was already held by voice-write.js before the request arrived: see the
     comment at the top of that file. */
  const voice = acceptVoice(body.voice).notes;
  statements.push(...await voiceStatements(env.DB, kid, voice, now));

  await env.DB.batch(statements);

  // Only rebuild when something could actually have changed the card.
  const ruleSets = corrections.length ? await rebuildCard(env, kid, now) : null;

  /* Still one number, summed across registers rather than reported per one. The
     caller uses it to know whether a rebuild produced anything at all, and a
     breakdown here would name which document classes a technician writes in,
     which this response has no reason to carry. */
  const ruleCount = ruleSets
    ? [...ruleSets.values()].reduce((total, rules) => total + rules.length, 0)
    : null;

  return json(200, {
    stored: { corrections: corrections.length, metrics: metrics.length, voice: voice.length },
    rules: ruleCount === null ? undefined : ruleCount,
  });
}

/* ─────────────────────────── style card ─────────────────────────── */

async function handleGetCard(url, env) {
  const kid = cleanKid(url.searchParams.get("kid"));
  if (!kid) return json(400, { error: "Missing kid." });

  /* The tool decides which pool is read, so it is resolved before the card
     query rather than further down with the shape target. An absent or unknown
     tool resolves to a register of its own, so it reads an empty card instead
     of borrowing somebody else's rules. */
  const tool = cleanSlug(url.searchParams.get("tool")) || "unknown";
  const register = registerFor(tool);

  // A suppressed rule is gone as far as this route is concerned: not in the
  // list, not in the block, so it cannot reach a prompt. The technician is not
  // told, by design - the removal is reviewed in supervision, not announced by
  // the tool.
  //
  // The join carries the register as well as the feature. Without it a removal
  // made for one document class would hide the rule in every other, which is a
  // judgement the supervisor did not make.
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
     revision and the prompt prefix stays stable for the cache.

     shape_profile stays keyed by TOOL, not by register. It is a measurement of
     the notes a tool actually produced rather than a learned rule, and two
     tools in one register can still have different shapes. */
  const seed = (url.searchParams.get("seed") || "").slice(0, 64) || (kid + ":" + tool);
  const shapeRow = await env.DB.prepare(
    `SELECT n_notes, sum_len, sum_cv, sum_cv_sq, sum_step, sum_step_sq
       FROM shape_profile WHERE kid = ? AND tool = ?`,
  ).bind(kid, tool).first();
  const target = targetFor(shapeRow, tool, seed);

  /* SLICE 6: the author's stored voice, read back for this note. It rides on
     the card for the reason the shape target does: it is fetched at the moment
     the note is drafted and has to reach the same prompt. Ids and numbers only;
     the browser holds the words (voice-read.js says why). */
  const [{ results: levelRows }, { results: dictionRows }] = await Promise.all([
    env.DB.prepare(
      `SELECT feature, n, sum, sum_sq, w_n, w_sum, w_sum_sq
         FROM voice_level WHERE kid = ? AND tool = ?`,
    ).bind(kid, tool).all(),
    env.DB.prepare(
      `SELECT family, variant, count, notes
         FROM diction_level WHERE kid = ? AND tool = ?`,
    ).bind(kid, tool).all(),
  ]);
  const voice = voiceReading(levelRows || [], dictionRows || []);

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
    voice,
    updatedAt: (results || []).reduce((a, r) => Math.max(a, r.updated_at || 0), 0) || null,
  });
}

async function handleMute(request, env) {
  const body = await readJson(request);
  if (!body) return json(400, { error: "Invalid JSON." });

  const kid = cleanKid(body.kid);
  const feature = FEATURE_NAMES.includes(body.feature) ? body.feature : null;
  if (!kid || !feature) return json(400, { error: "Missing kid or unknown feature." });

  /* SCOPED TO THE REGISTER THE TECHNICIAN IS WRITING IN. Muting "prefer shorter
     sentences" while writing a supervision note used to mute it for SAP as
     well. The switch sits on one rule on one card, in front of somebody who is
     looking at one document, and it should do what it looks like it does. */
  const register = registerFor(cleanSlug(body.tool) || "unknown");

  // A mute is reversible and the evidence is untouched, so a rule the
  // technician switches off can come back if they keep making that correction.
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
  /* COUNT(DISTINCT kid), NOT COUNT(*). This is the direct consequence of
     putting the register in the key, and it is an anonymity guard rather than
     an arithmetic nicety. One person can now hold the same feature in two
     registers, so counting rows would report them as two technicians. That
     floats a feature over MIN_COHORT that exactly one person actually has, and
     MIN_COHORT is the entire reason this route can return anything at all: it
     is what makes the answer a fact about the house prompt instead of a fact
     about one identifiable individual.

     The rows are still grouped across registers on purpose. The question this
     answers is which way technicians are pulling overall, and splitting it by
     document class would narrow each group toward the point where one person
     is recognisable in it. */
  const { results } = await env.DB.prepare(
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

/* What the tool has actually been doing, as numbers.
 *
 * WHY IT EXISTS. The expert bench is meant to answer "how are my BTs doing"
 * with figures rather than impressions, and nothing here could produce one. The
 * store had the rows all along -- usage_metric has carried an event per draft
 * since it was built -- but no route aggregated them, so the only readings
 * anyone had were anecdotes off individual notes.
 *
 * CONTENT-FREE, like everything else in this file. Every number below is a
 * count, a mean or a rate over columns that were already numeric. There is no
 * prose in usage_metric to leak, because the Pages worker sanitises every value
 * to a number or a boolean before it is written.
 *
 * BOUNDED. The type counts are done in SQL. The two aggregations that need the
 * JSON body read a capped window of recent rows rather than the table, so this
 * costs the same whether the store holds a thousand rows or a million.
 */
const METRICS_WINDOW_DAYS = 30;
const METRICS_ROW_CAP = 5000;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (v, dp = 1) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

async function handleMetricsSummary(url, env) {
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || METRICS_WINDOW_DAYS));
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const { results: counts } = await env.DB.prepare(
    `SELECT tool, type, COUNT(*) AS n
       FROM usage_metric
      WHERE ts >= ?
      GROUP BY tool, type
      ORDER BY n DESC`,
  ).bind(since).all();

  // Only the two types whose bodies carry numbers worth averaging. Reading
  // every row's JSON to find out would be the unbounded version of this.
  const { results: rows } = await env.DB.prepare(
    `SELECT tool, type, data
       FROM usage_metric
      WHERE ts >= ? AND type IN ('note_copied', 'note_hints')
      ORDER BY ts DESC
      LIMIT ?`,
  ).bind(since, METRICS_ROW_CAP).all();

  const copied = { seconds: [], edited: [], revisions: [] };
  const hintNotes = {};   // code -> notes that raised it
  const hintTotal = {};   // code -> times raised
  let hintDrafts = 0;

  for (const r of results_or_empty(rows)) {
    let data;
    try { data = JSON.parse(r.data); } catch { continue; }
    if (!data || typeof data !== "object") continue;

    if (r.type === "note_copied") {
      if (Number.isFinite(data.seconds)) copied.seconds.push(data.seconds);
      if (Number.isFinite(data.edited)) copied.edited.push(data.edited);
      if (Number.isFinite(data.revisions)) copied.revisions.push(data.revisions);
      continue;
    }

    // note_hints: one key per advisory code, the value being how many times
    // that code fired on the draft. `tool` rides along in the same object and
    // is not a code, so it is skipped by name.
    hintDrafts += 1;
    for (const [code, n] of Object.entries(data)) {
      if (code === "tool" || !Number.isFinite(n)) continue;
      hintNotes[code] = (hintNotes[code] || 0) + 1;
      hintTotal[code] = (hintTotal[code] || 0) + n;
    }
  }

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS technicians, SUM(note_count) AS notes FROM technician`,
  ).first();

  const byType = {};
  for (const c of results_or_empty(counts)) {
    byType[c.type] = (byType[c.type] || 0) + c.n;
  }

  return json(200, {
    windowDays: days,
    rowCap: METRICS_ROW_CAP,
    // Said out loud, because a capped window that silently truncated would make
    // a busy month look like a quiet one and nobody would be able to tell.
    capped: results_or_empty(rows).length >= METRICS_ROW_CAP,
    cohort: {
      technicians: (totals && totals.technicians) || 0,
      notesAllTime: (totals && totals.notes) || 0,
    },
    events: byType,
    byTool: results_or_empty(counts).map((c) => ({ tool: c.tool, type: c.type, count: c.n })),
    drafting: {
      // How long a draft was looked at before it went to the EHR, how much of
      // it was retyped, and how many times it was sent back for a revision.
      notesCopied: copied.seconds.length,
      medianSecondsToCopy: round(median(copied.seconds), 0),
      meanSecondsToCopy: round(mean(copied.seconds), 0),
      meanCharsRetyped: round(mean(copied.edited), 0),
      meanRevisions: round(mean(copied.revisions), 2),
    },
    hints: {
      // The rate a given advisory code fires, which is the reading that did not
      // exist when a dropped hint had to be argued from a single note.
      draftsMeasured: hintDrafts,
      codes: Object.keys(hintTotal)
        .map((code) => ({
          code,
          notes: hintNotes[code],
          times: hintTotal[code],
          rate: hintDrafts ? round(hintNotes[code] / hintDrafts, 3) : null,
        }))
        .sort((a, b) => b.notes - a.notes),
    },
  });
}

// D1 returns undefined rather than [] on some paths; every caller here wants
// an array it can iterate without a guard at each site.
function results_or_empty(r) { return Array.isArray(r) ? r : []; }

/* How each BT answers NoMe's questions, per technician and per tool: accepted
 * as is, edited, own words, or left unrefined. Supervisor view, so it is
 * reached only through the Pages worker's admin check (PROFILE_ADMIN_ROUTES).
 *
 * Counts and rates only. The rows hold four integers and a round, and
 * summariseTriageUsage reads the four by name and nothing else.
 *
 * BOUNDED like /metrics-summary: a window of days and a row cap, and the reply
 * says when the cap was reached so a busy month cannot read as a quiet one. */
const TRIAGE_USAGE_ROW_CAP = 20000;

async function handleTriageUsage(url, env) {
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || METRICS_WINDOW_DAYS));
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const { results } = await env.DB.prepare(
    `SELECT kid, tool, data
       FROM usage_metric
      WHERE type = 'triage_answers' AND ts >= ?
      ORDER BY ts DESC
      LIMIT ?`,
  ).bind(since, TRIAGE_USAGE_ROW_CAP).all();
  const rows = results_or_empty(results);
  return json(200, {
    windowDays: days,
    rowCap: TRIAGE_USAGE_ROW_CAP,
    capped: rows.length >= TRIAGE_USAGE_ROW_CAP,
    ...summariseTriageUsage(rows),
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
            /* DISTINCT feature, not rows. These three are a magnitude for
               deciding whose card to open, and counting rows would multiply
               each of them by the number of document classes a technician
               writes in. The removals are the sharp case: the migration copies
               an old suppression into every register, so three judgements would
               be reported as twelve and a supervisor would read that as a
               person whose card keeps being corrected. The detail view is where
               the per-register breakdown belongs. */
            (SELECT COUNT(DISTINCT c.feature) FROM style_card c WHERE c.kid = t.kid)              AS rules,
            (SELECT COUNT(DISTINCT c.feature) FROM style_card c WHERE c.kid = t.kid AND c.muted = 1) AS muted,
            (SELECT COUNT(DISTINCT s.feature) FROM style_card_suppression s WHERE s.kid = t.kid)  AS removed,
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

  /* This view spans every register on purpose: a supervisor opening a card
     wants the whole person, not one document class at a time. The register
     therefore travels on each row, because the same feature can now appear
     more than once and without it two rules would be indistinguishable. */
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

  /* Keyed by register AND feature. Keyed by feature alone, a removal made for
     supervision notes would mark the rule removed on every other document
     class in this view, showing a supervisor a judgement they never made and
     inviting them to act on it. */
  const keyOf = (row) => `${row.register}\u0000${row.feature}`;
  const removedAt = new Map((suppressed.results || []).map((r) => [keyOf(r), r.ts]));

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
      removed: removedAt.has(keyOf(r)),
      removedAt: removedAt.get(keyOf(r)) || null,
      updatedAt: r.updated_at,
    })),
    // A rule can be removed and then fall below the evidence bar, at which
    // point no style_card row exists to hang it off. Report it anyway, or the
    // removal looks like it never happened. Matched on the register too, or a
    // removal in one class would be hidden by a surviving rule in another.
    removedWithoutRule: (suppressed.results || [])
      .filter((r) => !(card.results || []).some((c) => keyOf(c) === keyOf(r)))
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

  /* SCOPED TO ONE REGISTER. A supervisor reviewing a supervision note removes a
     rule they judged wrong for supervision notes. Unscoped, that judgement
     silently reached every other document class the technician writes in, and
     they were never shown the rules it was removing there. Removing it in
     another register is a separate call, which is a separate decision. */
  const register = registerFor(cleanSlug(body.tool) || "unknown");

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

async function rebuildCard(env, kid, now) {
  /* `tool` is read here for the first time. correction_event has carried it
     since the table was written and nothing ever selected it, which is the
     mechanical reason one person had a single pool: the rebuild could not tell
     a SAP correction from a supervision one, so it derived over all of them
     together. */
  const { results } = await env.DB.prepare(
    `SELECT tool, feature, direction, magnitude, ts FROM correction_event
      WHERE kid = ? ORDER BY ts DESC LIMIT ?`,
  )
    .bind(kid, CORRECTION_WINDOW)
    .all();

  /* One derivation per register, not one over everything. The window is still
     applied per technician above, so a busy register cannot be starved by
     splitting the limit, and a register with too little evidence simply derives
     no rules, which is the correct outcome rather than a borrowed one. */
  const byRegister = new Map();
  for (const event of results || []) {
    const register = registerFor(event.tool);
    if (!byRegister.has(register)) byRegister.set(register, []);
    byRegister.get(register).push(event);
  }

  const statements = [];
  const ruleSets = new Map();

  for (const [register, events] of byRegister) {
    const rules = deriveRules(events, now);
    const rows = cardRows(kid, register, rules, now);
    const keep = new Set(rows.map((r) => r.feature));
    ruleSets.set(register, rules);

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

    /* A feature that no longer clears the evidence bar must lose its rule, or a
       card only ever grows and stale rules quietly persist. Scoped to this
       register: an unscoped DELETE would reach into pools this derivation saw
       no evidence for and wipe rules that are still earned there. */
    const drop = FEATURE_NAMES.filter((f) => !keep.has(f));
    if (drop.length) {
      statements.push(
        env.DB.prepare(
          `DELETE FROM style_card
            WHERE kid = ? AND register = ? AND feature IN (${drop.map(() => "?").join(",")})`,
        ).bind(kid, register, ...drop),
      );
    }
  }

  if (statements.length) await env.DB.batch(statements);
  return ruleSets;
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
