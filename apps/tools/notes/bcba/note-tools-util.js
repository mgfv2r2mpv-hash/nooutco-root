/* Helpers every note tool shares, loaded before the tool configs on both
 * note pages.
 *
 * WHY THIS IS A FILE NOW. It used to be an inline <script> block copied into
 * notes/bcba/index.html and notes/bt/index.html, and the copies were identical
 * by convention only - nothing checked. When the hint channel grew rank, kind,
 * a whole-note section and a shared schema builder, that duplication went from
 * twelve lines to a hundred, and every future edit would have had to be made
 * twice with no test to catch a miss. One file, loaded by both pages.
 */
window.NOTE_TOOLS = [];
window.NoteToolsUtil = {
  // "a" | "b" | "c" menu string for ALLOWED-value lists in prompts.
  menu: function (arr) { return arr.map(function (x) { return '"' + x + '"'; }).join(" | "); },
  // Severity, in the order the renderer draws them. Not part of the sort:
  // the model orders its own findings and kind only decides how loudly one
  // is drawn, plus how ties break.
  HINT_KINDS: { "blocks-claim": 0, thin: 1, register: 2 },
  // A hint about the note as a whole rather than any one section. Before it
  // existed, a whole-note finding had to be filed against whichever section
  // was nearest, which put it under a heading it was not about.
  HINT_WHOLE_NOTE: "note",
  // Ceiling on the whole list. It is a backstop against a runaway response,
  // not the display cap - the renderer shows three per section and puts the
  // rest behind a disclosure, so this number only has to sit above what a
  // real note produces.
  HINT_CEILING: 24,

  // Validate the model's hint codes against the tool's catalog and the note's
  // known section keys; anything unrecognized is dropped (fabrication-proof).
  //
  // WHY THE SORT EXISTS. This used to be a flat filter with a bare
  // .slice(0, 8) on the end, so when the model found more than eight gaps,
  // the eight that survived were whichever it happened to emit first. That
  // is a truncation with no judgment behind it, and it is what made "the
  // expert prioritizes the hints" meaningless - there was nowhere for a
  // priority to go. rank carries the model's own ordering and the sort runs
  // BEFORE the cut, so whatever falls off the end is what the model itself
  // ranked last.
  //
  // An unranked hint sinks below every ranked one rather than being dropped,
  // because a missing rank is the model declining to order, not the finding
  // being worthless. Emission order breaks the final tie so the result is
  // stable regardless of the engine's sort.
  normalizeHints: function (raw, catalog, validSections) {
    if (!Array.isArray(raw)) return [];
    var kinds = window.NoteToolsUtil.HINT_KINDS;
    var whole = window.NoteToolsUtil.HINT_WHOLE_NOTE;
    var UNRANKED = Number.MAX_SAFE_INTEGER;
    return raw.filter(function (h) {
      return h && typeof h.section === "string" && typeof h.code === "string" &&
        (h.section === whole || validSections.indexOf(h.section) !== -1) &&
        Object.prototype.hasOwnProperty.call(catalog, h.code);
    }).map(function (h, i) {
      var ranked = typeof h.rank === "number" && isFinite(h.rank);
      return {
        section: h.section,
        code: h.code,
        detail: typeof h.detail === "string" ? h.detail.slice(0, 120) : "",
        kind: Object.prototype.hasOwnProperty.call(kinds, h.kind) ? h.kind : "thin",
        rank: ranked ? Math.floor(h.rank) : null,
        _emitted: i,
      };
    }).sort(function (a, b) {
      return ((a.rank === null ? UNRANKED : a.rank) - (b.rank === null ? UNRANKED : b.rank)) ||
        (kinds[a.kind] - kinds[b.kind]) ||
        (a._emitted - b._emitted);
    }).map(function (h) {
      return { section: h.section, code: h.code, detail: h.detail, kind: h.kind, rank: h.rank };
    }).slice(0, window.NoteToolsUtil.HINT_CEILING);
  },

  // The hints half of a tool's responseSchema, so five tools stop writing
  // the same object five times and cannot drift apart.
  //
  // The descriptions are load-bearing rather than documentation. BT's system
  // prompt is composed server-side from the prompt store, so prompt wording
  // added here would never reach that tool - but the schema IS sent from the
  // browser for every tool, so what rank and kind mean travels with it.
  hintSchema: function (catalog, validSections) {
    return {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "code", "detail", "rank", "kind"],
        properties: {
          section: {
            type: "string",
            enum: validSections.concat([window.NoteToolsUtil.HINT_WHOLE_NOTE]),
            description: 'The section this is about. Use "' + window.NoteToolsUtil.HINT_WHOLE_NOTE +
              '" when the finding is about the note as a whole rather than one section.',
          },
          code: { type: "string", enum: Object.keys(catalog) },
          detail: { type: "string", description: "Optional specifier, 10 words or fewer." },
          rank: {
            type: "integer",
            description: "Your priority order across ALL hints in this response, 1 being the one " +
              "you would want answered first. Rank on what the note most needs, not on section " +
              "order. Only the top three per section are shown without a click, so the ordering " +
              "decides what the technician actually reads.",
          },
          kind: {
            type: "string",
            enum: Object.keys(window.NoteToolsUtil.HINT_KINDS),
            description: '"blocks-claim" when a funder could reject the claim over this, ' +
              '"thin" when the note is missing clinical detail, "register" when it is about how ' +
              "the note reads. Severity, not order.",
          },
        },
      },
    };
  },
};
