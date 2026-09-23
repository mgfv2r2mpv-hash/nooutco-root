/* Where the drill keeps things.
 *
 * In the Mac app the page talks to the Swift shell through one message handler,
 * `drill`, which answers with a promise (WKScriptMessageHandlerWithReply). The
 * shell keeps history, lexicon and settings as JSON files under
 * ~/Library/Application Support/Clinical Typing Drills, and Keep writes the
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
const HISTORY_MAX = 2000;

function lsGet(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: the drill still works */ }
}

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
  lsSet(LS.history, trimmed);
  return { ok: true };
}

export async function saveLexicon(list) {
  if (inApp) return call("saveLexicon", { lexicon: list });
  lsSet(LS.lexicon, list);
  return { ok: true };
}

export async function saveSettings(obj) {
  if (inApp) return call("saveSettings", { settings: obj });
  lsSet(LS.settings, obj);
  return { ok: true };
}

/**
 * Keep the text of one drill. Only ever called from the Keep button, his
 * ruling of 2026-09-22. The record carries the answer, the question it
 * answered, the outline item, the clock, and the scores.
 * @returns {Promise<{ok: boolean, corpus?: string, expert?: string, note?: string}>}
 */
export async function keep(record) {
  if (inApp) return call("keep", { record });
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
