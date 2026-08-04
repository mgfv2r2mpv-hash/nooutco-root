/* voice-capture.js - keeping what the owning clinician actually changed.
 *
 * The style store already learns from every technician, but it keeps only
 * NUMBERS: a feature name, a direction, a magnitude. That is the right trade for
 * a shared store and it throws away the thing his voice profile most needs,
 * which is the pair itself. A before/after pair holds topic, length, and content
 * constant, so every difference is a decision he made. Two hundred words of
 * "before" plus two hundred of "after" constrain generation more than two
 * thousand words of unpaired prose, because unpaired prose shows what he writes
 * and a pair shows what he REJECTS.
 *
 * THREE THINGS MAKE THIS SAFE TO DO AT ALL, and none of them is optional.
 *
 * 1. NOTHING LEAVES THE BROWSER. Pairs are held in localStorage on his machine
 *    and exported by him, deliberately, to ~/Private/voice-corpus. There is no
 *    endpoint, no KV key, and no request. This is not a smaller version of a
 *    server-side store; it is a different thing, and it is why no new
 *    PHI-adjacent store exists anywhere as a result of this file.
 *
 * 2. NOTHING IS KEPT THAT HAS NOT BEEN VERIFIED. Both halves of every pair go
 *    through NotesScrub.verifyOutput first, and a single finding on either side
 *    discards the pair. The refusal is counted, never explained, because an
 *    explanation would have to quote what it found.
 *
 * 3. IT ONLY RUNS FOR HIM. A technician's revisions belong to that technician's
 *    style card, not to his voice profile. Non-admin sessions capture nothing,
 *    and the check is on the token the server already re-checks.
 *
 * Exposes window.VoiceCapture.
 */
(function () {
  "use strict";

  var KEY = "voice_pairs_v1";
  var MAX_PAIRS = 200;      // a browser store, not an archive
  var MIN_WORDS = 25;       // below this a diff is a typo, not a decision

  function words(s) { return String(s || "").split(/\s+/).filter(Boolean).length; }

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  // Counts only. A refusal is a number so that reading the log can never
  // reconstruct what was refused.
  function bump(kind) {
    try {
      var s = JSON.parse(localStorage.getItem(KEY + "_stats") || "{}");
      s[kind] = (s[kind] || 0) + 1;
      localStorage.setItem(KEY + "_stats", JSON.stringify(s));
    } catch (e) { /* a metric must never cost him a note */ }
  }

  function enabled() {
    return !!(window.NotesGate && window.NotesGate.isAdmin && window.NotesGate.isAdmin());
  }

  /**
   * Offer a pair. Returns why it was not kept, or null when it was.
   * @param before  what the tool produced
   * @param after   what he made it say
   * @param meta    {tool, register, source} - no clinical content
   */
  function capture(before, after, meta) {
    if (!enabled()) return "not-owner";
    var b = String(before || "").trim();
    var a = String(after || "").trim();
    if (!b || !a || a === b) return "no-change";
    if (Math.min(words(b), words(a)) < MIN_WORDS) return "too-short";

    // The gate. Both halves, every time, before either is written anywhere.
    var scrub = window.NotesScrub;
    if (!scrub || !scrub.verifyOutput) { bump("no-verifier"); return "no-verifier"; }
    var vb = scrub.verifyOutput(b);
    var va = scrub.verifyOutput(a);
    if (!vb.clean || !va.clean) {
      bump("refused-identifier");
      return "refused-identifier";
    }

    var list = read();
    list.push({
      at: new Date().toISOString(),
      tool: (meta && meta.tool) || null,
      register: (meta && meta.register) || null,
      source: (meta && meta.source) || null,
      before: b,
      after: a,
    });
    // Oldest out first. A cap that silently drops the NEWEST would keep the
    // least useful evidence, which is the wrong way round.
    while (list.length > MAX_PAIRS) list.shift();
    if (!write(list)) { bump("storage-full"); return "storage-full"; }
    bump("kept");
    return null;
  }

  function stats() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(KEY + "_stats") || "{}"); } catch (e) { /* empty */ }
    s.pending = read().length;
    return s;
  }

  /* Export is a deliberate act, by him, in his browser. The file lands in his
     Downloads and he moves it to ~/Private/voice-corpus, which is where every
     other piece of his corpus already lives and the only place his own scorer
     reads from. */
  function exportPairs() {
    var list = read();
    if (!list.length) return 0;
    var blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), pairs: list }, null, 2)],
      { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "voice-pairs-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return list.length;
  }

  function clearPairs() {
    var n = read().length;
    try { localStorage.removeItem(KEY); } catch (e) { /* empty */ }
    return n;
  }

  window.VoiceCapture = {
    capture: capture,
    stats: stats,
    exportPairs: exportPairs,
    clearPairs: clearPairs,
    enabled: enabled,
    _read: read,
  };
})();
