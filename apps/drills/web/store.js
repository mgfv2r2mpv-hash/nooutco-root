/* Where the drill keeps things.
 *
 * In the Mac app the page talks to the Swift shell through one message handler,
 * `drill`, which answers with a promise (WKScriptMessageHandlerWithReply). The
 * shell keeps history, lexicon and settings as JSON files under
 * ~/Library/Application Support/ClickClackOracle, and Keep writes the
 * answer's text into the voice corpus (drill register) and the expert queue.
 *
 * In a plain browser (the tests, a quick look) there is no shell: history,
 * lexicon and settings fall back to localStorage, and Keep says it cannot keep
 * text outside the app. Nothing else in the page knows which one it is in.
 */

const bridge = (typeof window !== "undefined" && window.webkit && window.webkit.messageHandlers
  && window.webkit.messageHandlers.drill) || null;

export const inApp = !!bridge;

const LS = {
  history: "noaba.drills.v1",
  lexicon: "noaba.drills.lexicon.v1",
  settings: "noaba.drills.settings.v1",
};
export const HISTORY_MAX = 2000;

function lsGet(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}
/** false when the browser refuses the write (private mode, a full quota); the drill still works. */
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}
const saved = (ok) => (ok ? { ok: true } : { ok: false, note: "the browser refused the write" });

async function call(op, payload) {
  return bridge.postMessage({ op, ...(payload || {}) });
}

/** Everything the page needs at start: { history, lexicon, settings }. */
export async function load() {
  if (inApp) {
    try {
      const r = await call("load");
      return {
        history: Array.isArray(r && r.history) ? r.history : [],
        lexicon: Array.isArray(r && r.lexicon) ? r.lexicon : [],
        settings: r && typeof r.settings === "object" && r.settings ? r.settings : {},
      };
    } catch (e) {
      return { history: [], lexicon: [], settings: {}, error: String(e) };
    }
  }
  const history = lsGet(LS.history, []);
  const lexicon = lsGet(LS.lexicon, []);
  const settings = lsGet(LS.settings, {});
  return {
    history: Array.isArray(history) ? history : [],
    lexicon: Array.isArray(lexicon) ? lexicon : [],
    settings: settings && typeof settings === "object" ? settings : {},
  };
}

export async function saveHistory(list) {
  const trimmed = list.slice(-HISTORY_MAX);
  if (inApp) return call("saveHistory", { history: trimmed });
  return saved(lsSet(LS.history, trimmed));
}

export async function saveLexicon(list) {
  if (inApp) return call("saveLexicon", { lexicon: list });
  return saved(lsSet(LS.lexicon, list));
}

export async function saveSettings(obj) {
  if (inApp) return call("saveSettings", { settings: obj });
  return saved(lsSet(LS.settings, obj));
}

/**
 * Keep the text of one drill. Only ever called from the Keep button, his
 * ruling of 2026-09-22. The record carries the answer, the question it
 * answered, the outline item, the clock, and the scores.
 * @returns {Promise<{ok: boolean, corpus?: string, expert?: string, note?: string}>}
 */
export async function keep(record) {
  if (inApp) return call("keep", { record });
  const m = typeof window !== "undefined" && window.ClickClackMock;
  if (m && m.keep) return m.keep(record);
  return { ok: false, note: "Keeping text works in the Mac app; this browser page keeps numbers only." };
}

/** A line in the app's log. Counts and names only, never the typed text. */
export function log(line) {
  if (inApp) { call("log", { line: String(line).slice(0, 500) }).catch(() => {}); }
}

/** The self-test hook: the shell's --selftest waits for this. */
export function ready(report) {
  if (inApp) { call("ready", { report }).catch(() => {}); }
}

/* ---- the oracle, the microphone and the expert (Mac app only) ----------
 * In a plain browser these say so, honestly. Tests put canned replies on
 * window.ClickClackMock; nothing in the page's own flow sets it. */
const mock = () => (typeof window !== "undefined" && window.ClickClackMock) || null;
const notInApp = (what) => ({ ok: false, note: `${what} works in the Mac app.` });

/** One call to his Claude Code: { ok, output } or { ok: false, note }. */
export async function askClaude({ system, prompt, schema, webSearch = false }) {
  if (inApp) return call("askClaude", { system, prompt, schema: JSON.stringify(schema), webSearch });
  const m = mock();
  if (m && m.askClaude) return m.askClaude({ system, prompt, schema, webSearch });
  return notInApp("The oracle");
}

export async function micStart() {
  if (inApp) return call("micStart");
  const m = mock();
  if (m && m.micStart) return m.micStart();
  return notInApp("Talking");
}
export async function micStop() {
  if (inApp) return call("micStop");
  const m = mock();
  if (m && m.micStop) return m.micStop();
  return { ok: true };
}

export async function expertStatus() {
  if (inApp) return call("expertStatus");
  const m = mock();
  if (m && m.expertStatus) return m.expertStatus();
  return { connected: false, queued: 0, note: "Sending to the expert works in the Mac app." };
}
export async function expertToken(token) {
  if (inApp) return call("expertToken", { token });
  const m = mock();
  if (m && m.expertToken) return m.expertToken(token);
  return { connected: false, queued: 0, note: "Sending to the expert works in the Mac app." };
}
export async function expertQueue() {
  if (inApp) return call("expertQueue");
  const m = mock();
  if (m && m.expertQueue) return m.expertQueue();
  return { items: [] };
}
export async function expertPropose(record) {
  if (inApp) return call("expertPropose", { record });
  const m = mock();
  if (m && m.expertPropose) return m.expertPropose(record);
  return notInApp("Proposing");
}
export async function expertSent(stamps) {
  if (inApp) return call("expertSent", { stamps });
  const m = mock();
  if (m && m.expertSent) return m.expertSent(stamps);
  return { ok: true, queued: 0 };
}
/** The expert's records in force: { ok, records } or { ok: false, note }. */
export async function expertRecords() {
  if (inApp) return call("expertRecords");
  const m = mock();
  if (m && m.expertRecords) return m.expertRecords();
  return { ok: false, note: "Reading the expert works in the Mac app." };
}
