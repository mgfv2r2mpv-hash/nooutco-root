/* The Friday self-audit.
 *
 * WHY IT EXISTS. The SAP tool shipped output that read as machine written, and
 * nobody noticed until it was pasted into a detector by hand, weeks later. The
 * signals that gave it away were all computable at generation time: a client
 * named in 64% of sentences against 10 to 23% across seven human-written plans,
 * opener variety of 0.76 against a human floor of 0.92. This turns "somebody
 * remembers to check" into a thing that happens on its own.
 *
 * WHAT IT READS. usage_metric and correction_event only, both of which are
 * numbers, timestamps and closed-list enums by construction. No note text
 * exists anywhere in this database to leak into an email, which is what makes
 * emailing a summary acceptable at all.
 *
 * WHAT IT SAYS. This week against the four weeks before it, because a single
 * week's number is unreadable without a trend. Where a measure has a human
 * reference band it is printed next to the band rather than alone, since "score
 * 28" means nothing and "28, human band 12 to 24" means something.
 */

/* Measured on seven de-identified human-written plans, 2026-08-02 to 08-04. The
   point of reference for every register number below. */
export const HUMAN = {
  score: [12, 24],
  burstiness: [0.55, 0.82],
  openerVariety: [0.92, 1.0],
  clientRate: [0.10, 0.23],
  /* These two come from a WIDER corpus than the rest: 10th to 90th percentile
     across 108 documents, 101 coursework and the same 7 plans, 2026-08-06. Seven
     documents is thin for a band, and unlike the measures above these two have
     the wider corpus available.

     WHY THEY ARE HERE AT ALL. burstiness is the whole-note figure and it is a
     mixture of these two: across those 108 documents it correlates 0.448 with
     variability inside a section and 0.384 with the movement between sections,
     while those two correlate only 0.096 with EACH OTHER. So burstiness can sit
     inside its band while every section reads flat. Trending it alone would
     report that everything is fine in exactly the case worth catching. */
  sectionCv: [0.383, 0.538],
  sectionStep: [0.189, 0.434],

  /* THE REGISTER BAND. Measured on the same seven plans, 2026-08-06, with
     note-metrics.js itself so the runtime and the reference agree.
     These four exist so the register remediation can be TRENDED rather than
     assumed. It is the part of this work with the strongest evidence behind it,
     a real note going 53% to 0% on nothing but word choice, and until now the
     browser counted it and the counts never left the page.

     actorRate is the one to watch, and it is an open question rather than a
     settled failure. The seven human plans name a role in a median of 3% of
     sentences and 12% at the 90th percentile. Both archived generated SAPs sit
     at 0.32 and 0.34. That could be the register work overshooting, or it could
     be which sections dominate a plan, since a goal section is mostly about
     what the client will do. The band is here so a week of real notes answers
     it instead of an argument. */
  flaggedPer100: [0, 0.40],
  actorRate: [0, 0.12],
  imperativeRate: [0, 0.22],
  topOpener: [1, 3],
};

const DAY = 86400000;
const WEEK = 7 * DAY;

/** Rows in a window, as {type, data, tool, ts}. */
async function readWindow(env, fromTs, toTs) {
  const { results } = await env.DB.prepare(
    `SELECT tool, type, ts, data FROM usage_metric WHERE ts >= ? AND ts < ? ORDER BY ts`,
  ).bind(fromTs, toTs).all();
  return (results || []).map((r) => {
    let data = {};
    try { data = JSON.parse(r.data) || {}; } catch (e) { data = {}; }
    return { tool: r.tool, type: r.type, ts: r.ts, data };
  });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Everything the email needs from one window of rows. */
export function summarise(rows) {
  const reg = rows.filter((r) => r.type === "note_register");
  const pick = (k) => reg.map((r) => r.data[k]).filter((v) => typeof v === "number");

  const generated = rows.filter((r) => r.type === "note_generated");
  const gaps = rows.filter((r) => r.type === "gap_questions");
  const revisions = rows.filter((r) => r.type === "revision");
  const errors = rows.filter((r) => r.type === "note_error" || r.type === "error");

  const byTool = {};
  for (const r of generated) byTool[r.tool] = (byTool[r.tool] || 0) + 1;

  const sum = (list, key) => list.reduce((a, r) => a + (Number(r.data[key]) || 0), 0);
  // Same shape as sum, kept separate so a future change to one does not silently
  // change what a construction total means.
  const sumOf = (list, key) =>
    list.reduce((a, r) => a + (typeof r.data[key] === "number" ? r.data[key] : 0), 0);

  return {
    notes: generated.length,
    byTool,
    measured: reg.length,
    register: {
      score: median(pick("score")),
      burstiness: mean(pick("burstiness")),
      // Absent, not zero, on a note whose sections were too short to measure.
      // pick already drops anything that is not a number, so a week of short
      // notes reports n/a rather than a fabricated flatness.
      sectionCv: mean(pick("sectionCv")),
      sectionStep: mean(pick("sectionStep")),
      openerVariety: mean(pick("openerVariety")),
      clientRate: mean(pick("clientRate")),
      actorRate: mean(pick("actorRate")),
      imperativeRate: mean(pick("imperativeRate")),
      topOpener: mean(pick("topOpener")),
      flaggedPer100: mean(pick("flaggedPer100")),
      worstScore: pick("score").length ? Math.max(...pick("score")) : null,
      outsideHumanBand: pick("score").filter((s) => s > HUMAN.score[1]).length,
    },
    /* Totals rather than averages, and that is the point: the question a
       construction count answers is "did any note emit one, and which", not
       "what was the typical density". One note with four vague verbs is a lead;
       an average of 0.06 across the week hides it. */
    constructions: {
      emptyAdverbs: sumOf(reg, "emptyAdverbs"),
      participialCausals: sumOf(reg, "participialCausals"),
      abstractStates: sumOf(reg, "abstractStates"),
      vagueVerbs: sumOf(reg, "vagueVerbs"),
    },
    gapsAsked: sum(gaps, "asked"),
    gapsAnswered: sum(gaps, "answered"),
    gapsSkipped: sum(gaps, "skipped"),
    revisionsRequested: sum(revisions, "requested"),
    revisionsAccepted: sum(revisions, "accepted"),
    errors: errors.length,
  };
}

const f = (v, places = 2) => (v === null || v === undefined ? "n/a" : Number(v).toFixed(places));

/* How far outside the band a value sits. Zero anywhere inside it.
 *
 * WHY THE DIRECTION IS NOT ENOUGH. Every measure here is a BAND with two bad
 * ends, not a quantity to push one way. "Between sections" caught this: a week
 * that moved from 0.30, comfortably inside, to 0.62, well above the ceiling,
 * was reported as an improvement because the number had gone up and up was the
 * declared good direction. That is the exact failure the measure was added to
 * catch, announced as progress.
 *
 * Distance from the band answers it for every measure at once, and it is what
 * the flag on the same line already means. */
const distanceOutside = (v, range) => Math.max(0, range[0] - v, v - range[1]);

function arrow(now, then, range) {
  /* A prior of exactly zero used to suppress the arrow entirely. That is wrong
     for any measure whose GOOD value is zero: the banned constructions sat at 0
     all last week and came back this week, which is the single most reportable
     thing the register block can say, and it was the one case the trend went
     silent on. A null prior still suppresses it, because that means no data. */
  if (now === null || then === null) return "";
  const d = now - then;
  if (Math.abs(d) < 0.005) return "  (flat)";

  const dn = distanceOutside(now, range);
  const dt = distanceOutside(then, range);
  // Both inside the band: the number moved and the quality did not, so say so
  // rather than crowning a winner between two acceptable weeks.
  const verdict = dn === dt ? "both in band" : dn > dt ? "worse" : "better";
  return `  (${d > 0 ? "+" : ""}${d.toFixed(2)} vs prior 4wk, ${verdict})`;
}

function band(label, value, range, prior) {
  const inBand = value !== null && value >= range[0] && value <= range[1];
  const flag = value === null ? "" : inBand ? "  ok" : "  OUTSIDE HUMAN BAND";
  return `  ${label.padEnd(18)} ${f(value)}   human ${range[0]} to ${range[1]}${flag}${arrow(value, prior, range)}`;
}

/** The plain-text body. Deliberately not HTML: it is read on a phone. */
export function render(now, prior, weekStartIso) {
  const L = [];
  L.push(`No Outcome ABA, note tooling self-audit`);
  L.push(`Week beginning ${weekStartIso}`);
  L.push("");

  if (!now.notes) {
    L.push("No notes were generated this week, so there is nothing to measure.");
    L.push("That is worth knowing on its own: either nobody used the tools, or");
    L.push("something is failing before the audit event is sent.");
    return L.join("\n");
  }

  L.push(`NOTES`);
  L.push(`  ${now.notes} generated, ${now.measured} measured`);
  for (const [tool, n] of Object.entries(now.byTool).sort((a, b) => b[1] - a[1])) {
    L.push(`    ${tool.padEnd(10)} ${n}`);
  }
  L.push("");

  L.push(`SHAPE  (how the sentences move, and the headline score)`);
  L.push(band("median score", now.register.score, HUMAN.score, prior.register.score));
  L.push(band("burstiness", now.register.burstiness, HUMAN.burstiness, prior.register.burstiness));
  /* Read these two together, and read them BEFORE burstiness above. burstiness
     is their mixture, so a note can hold it inside the band by swinging the
     average between sections while every section reads flat. When "inside a
     section" is low and "between sections" is high, that is what happened. */
  L.push(band("inside a section", now.register.sectionCv, HUMAN.sectionCv, prior.register.sectionCv));
  L.push(band("between sections", now.register.sectionStep, HUMAN.sectionStep, prior.register.sectionStep));
  L.push(band("opener variety", now.register.openerVariety, HUMAN.openerVariety, prior.register.openerVariety));
  L.push(band("client rate", now.register.clientRate, HUMAN.clientRate, prior.register.clientRate));
  if (now.register.sectionCv !== null && now.register.sectionCv < HUMAN.sectionCv[0]) {
    L.push("");
    L.push(`  Sections are reading flat inside themselves. The whole-note number`);
    L.push(`  above cannot see this: it is a mixture, and it stays healthy when the`);
    L.push(`  variety moves out of the sections and in between them instead.`);
  }
  if (now.register.outsideHumanBand) {
    L.push("");
    L.push(`  ${now.register.outsideHumanBand} of ${now.measured} notes scored above the human ceiling of ${HUMAN.score[1]}.`);
    L.push(`  Worst single note: ${now.register.worstScore}.`);
    L.push(`  A run of these is the signal that a prompt has drifted. It is what`);
    L.push(`  went unnoticed on the SAP tool until it was scored by hand.`);
  }
  L.push("");

  /* WHO DOES WHAT, which is the part with the strongest evidence behind it: a
     real note went 53% to 0% on word choice alone, with its length, spread and
     opener variety unchanged. None of it reached this email until now. */
  L.push(`REGISTER  (who does what, and the constructions that read as machine written)`);
  L.push(band("actor named", now.register.actorRate, HUMAN.actorRate, prior.register.actorRate));
  L.push(band("imperative rate", now.register.imperativeRate, HUMAN.imperativeRate, prior.register.imperativeRate));
  L.push(band("top opener repeat", now.register.topOpener, HUMAN.topOpener, prior.register.topOpener));
  L.push(band("flagged per 100 wd", now.register.flaggedPer100, HUMAN.flaggedPer100, prior.register.flaggedPer100));

  const c = now.constructions;
  const fired = Object.entries(c).filter(([, n]) => n > 0);
  if (fired.length) {
    L.push("");
    L.push(`  Which construction fired, across all ${now.measured} measured notes:`);
    for (const [k, n] of fired.sort((a, b) => b[1] - a[1])) L.push(`    ${k.padEnd(20)} ${n}`);
    L.push(`  These four are banned in the prompt. Any of them appearing means the`);
    L.push(`  ban is not reaching the model, so the fix is a prompt change, not a`);
    L.push(`  tuning change.`);
  } else if (now.measured) {
    L.push("");
    L.push(`  None of the four banned constructions appeared in any note. That is`);
    L.push(`  the register work holding, and it is the thing to watch for a return.`);
  }

  if (now.register.actorRate !== null && now.register.actorRate > HUMAN.actorRate[1]) {
    L.push("");
    L.push(`  Actor naming is above the human band, and this is an OPEN QUESTION`);
    L.push(`  rather than a known fault. The register work deliberately pushed it up,`);
    L.push(`  because the flagged sections were the actorless ones. The seven human`);
    L.push(`  plans sit at a median of 0.03. Both may be right and the fix may have`);
    L.push(`  overshot. A few weeks of this number is what decides it.`);
  }
  L.push("");

  L.push(`GAP QUESTIONS  (asked before drafting)`);
  L.push(`  asked ${now.gapsAsked}, answered ${now.gapsAnswered}, skipped ${now.gapsSkipped}`);
  if (now.gapsAsked && now.gapsSkipped / now.gapsAsked > 0.6) {
    L.push(`  Most are being skipped. That usually means they are not answerable,`);
    L.push(`  which is worse than not asking, because it trains people to skip.`);
  }
  L.push("");

  L.push(`REVISIONS  (which sections the tool writes badly)`);
  L.push(`  requested ${now.revisionsRequested}, accepted ${now.revisionsAccepted}`);
  L.push("");

  L.push(`FAILURES`);
  L.push(`  ${now.errors} reported`);
  L.push("");

  L.push(`Reference band is seven de-identified human-written plans, measured`);
  L.push(`2026-08-02 to 08-04. Zero is not the target: those plans scored 12 to 24.`);
  L.push(`The two section measures use a wider corpus, 108 documents measured`);
  L.push(`2026-08-06, because seven is thin for a band and the wider set existed.`);
  return L.join("\n");
}

/** Build and send. Returns what happened, so the caller can log it. */
export async function runWeekly(env, nowMs) {
  const weekStart = nowMs - WEEK;
  const priorStart = nowMs - 5 * WEEK;

  const [thisWeek, prior] = await Promise.all([
    readWindow(env, weekStart, nowMs),
    readWindow(env, priorStart, weekStart),
  ]);

  const summary = summarise(thisWeek);
  const priorSummary = summarise(prior);
  const body = render(summary, priorSummary, new Date(weekStart).toISOString().slice(0, 10));

  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: "RESEND_API_KEY not set", notes: summary.notes, body };
  }
  const to = env.AUDIT_TO_EMAIL || "kaleb.fowles@gmail.com";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "No Outcome ABA <noreply@nooutco.me>",
      to: [to],
      subject: `Note tooling audit, week of ${new Date(weekStart).toISOString().slice(0, 10)}`,
      text: body,
    }),
  });

  return { sent: res.ok, status: res.status, notes: summary.notes, body };
}

/* Friday 20:00 in the maintainer's timezone, which is not a fixed UTC hour
   because of daylight saving. The cron fires at both candidate hours and this
   decides which one is actually 20:00 in New York, so the email does not drift
   by an hour twice a year. */
export function isSendHour(date, tz = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "numeric", hour12: false,
  }).formatToParts(date);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return get("weekday") === "Fri" && Number(get("hour")) === 20;
}
