/* WHAT THE TECHNICIAN DID ABOUT A CHANGE, AND WHAT IT IS WORTH.
 *
 * THE AFFORDANCE IS RULED AND THIS FILE DOES NOT BUILD IT. The ghost checkmark
 * with the revert arrow is retracted: "I hate it and it looks stupid and makes
 * it hard to read and use." Every change the tool makes is ACCEPTED BY DEFAULT.
 * Nothing blocks the technician, and no per-item control sits in the reading
 * path. What is left to build is the recording underneath, which is this.
 *
 * FOUR DISPOSITIONS, FOUR WEIGHTS, and the ordering is the maintainer's:
 *
 *   none     they let it stand              LOW       the default, and it is
 *                                                     evidence, just weak
 *   approve  they said so                   STRONGER  they went out of their
 *                                                     way to agree
 *   reject   they said no, or reverted it   NEGATIVE  evidence of a different
 *                                                     kind, not a low score
 *   edit     they rewrote it themselves     STRONGEST plus a specimen nothing
 *                                                     else in the app produces
 *
 * WHY NONE IS NOT ZERO. A technician who reads a change and leaves it has told
 * us something, and scoring that at nothing would mean the only notes that ever
 * taught the system anything were the ones somebody fought with. It is low
 * because the reading is uncertain - they may have agreed, or may not have
 * looked - and it is not zero because across a hundred notes that uncertainty
 * averages out and the count does not.
 *
 * WHY REJECT IS SIGNED RATHER THAN SMALL. A rejection is not a weak approval.
 * It says this author does not write like that, which moves their estimate in
 * the opposite direction, and a magnitude with no sign on it would move the
 * estimate TOWARDS the thing they refused. Same magnitude as an approval and
 * the other way round: an explicit no is exactly as good evidence as an
 * explicit yes, about the opposite thing.
 *
 * THE NUMBERS ARE ORDINAL. They encode the order the maintainer stated and
 * nothing else. No fitting has been done and none should be read into them; a
 * learned bar replaces them without any other file changing, which is why every
 * caller reads weightOf() rather than a literal.
 *
 * NO NOTE TEXT IS EVER STORED HERE, AND THE STRUCTURE IS WHAT MAKES THAT TRUE
 * rather than a promise in a comment. An edit arrives carrying the offered and
 * kept sentences, which is the pair slice 5 distils into a diction family and a
 * shape feature. record() hands that pair to a SINK the caller passes and keeps
 * no reference to it. An entry in the ledger is a producer id, a code, a
 * section id, a disposition and a count - all of them enums or numbers, none of
 * them a word anybody wrote.
 */
(function () {
  "use strict";

  /* Ordinal weights. See the header: the order is ruled, the numbers are an
     encoding of that order and are not a measurement of anything. */
  var DISPOSITIONS = {
    none: { weight: 1, evidence: "kept", explicit: false },
    approve: { weight: 3, evidence: "endorsed", explicit: true },
    reject: { weight: -3, evidence: "refused", explicit: true },
    edit: { weight: 5, evidence: "rewritten", explicit: true },
  };

  /* "Revert" is the word the retracted affordance used and it will keep turning
     up in callers and in old audit rows. It is the same act as a reject: the
     technician put the note back the way they had it. One disposition, two
     names, so the ledger cannot end up with the same answer under two keys. */
  var ALIASES = { revert: "reject", accept: "approve", untouched: "none", "": "none" };

  var NAMES = Object.keys(DISPOSITIONS);

  function normalize(name) {
    var n = typeof name === "string" ? name.trim().toLowerCase() : "";
    if (Object.prototype.hasOwnProperty.call(DISPOSITIONS, n)) return n;
    if (Object.prototype.hasOwnProperty.call(ALIASES, n)) return ALIASES[n];
    return null;
  }

  function weightOf(name) {
    var n = normalize(name);
    return n ? DISPOSITIONS[n].weight : 0;
  }

  function evidenceOf(name) {
    var n = normalize(name);
    return n ? DISPOSITIONS[n].evidence : "";
  }

  /* The class an entry is filed against, and it is built out of enums alone.
     Producer id, finding code, section id. A sentence never reaches this, so
     two notes raising the same finding land on the same row and the row cannot
     be read back into either note. */
  function classOf(ev) {
    var e = ev || {};
    var producer = typeof e.producer === "string" && e.producer ? e.producer : "unknown";
    var code = typeof e.code === "string" && e.code ? e.code : "unspecified";
    var section = typeof e.section === "string" && e.section ? e.section : "note";
    return producer + ":" + code + ":" + section;
  }

  function emptyLedger() {
    return { entries: [], dropped: [] };
  }

  /* Record one disposition. Returns a NEW ledger; the one passed in is not
     touched, so a caller holding the previous state keeps the previous state.
     A name that is not a disposition is dropped with a reason rather than
     defaulted to "none", because a defaulted unknown would be counted as weak
     agreement with a change nobody agreed with.

     `sink` receives the offered/kept pair on an edit and only on an edit. It is
     the one route the text takes and it goes nowhere else: the entry appended
     below has no field that could hold it. */
  function record(ledger, ev, sink) {
    var base = ledger && Array.isArray(ledger.entries) ? ledger : emptyLedger();
    var e = ev || {};
    var name = normalize(e.disposition);
    if (!name) {
      return {
        entries: base.entries.slice(),
        dropped: base.dropped.concat([{ reason: "unknown-disposition", cls: classOf(e) }]),
      };
    }
    var spec = DISPOSITIONS[name];
    var entry = {
      cls: classOf(e),
      producer: typeof e.producer === "string" ? e.producer : "unknown",
      code: typeof e.code === "string" ? e.code : "unspecified",
      section: typeof e.section === "string" ? e.section : "note",
      tool: typeof e.tool === "string" ? e.tool : "",
      disposition: name,
      weight: spec.weight,
      evidence: spec.evidence,
      /* Present on every entry rather than only on an edit, so a reader counting
         specimens does not have to know which dispositions can carry one. */
      paired: name === "edit" && !!(e.offered || e.kept),
    };
    if (entry.paired && typeof sink === "function") {
      try {
        sink({ cls: entry.cls, tool: entry.tool, offered: String(e.offered || ""), kept: String(e.kept || "") });
      } catch (err) {
        /* A distiller that throws must not cost the technician their note, and
           it must not cost the ledger its row either. The disposition happened
           whatever the sink made of it. */
      }
    }
    return { entries: base.entries.concat([entry]), dropped: base.dropped.slice() };
  }

  /* Every item the budget offered and the technician did not touch, recorded as
     the default acceptance it is. The budget knows what was offered and the
     ledger knows what was answered; neither can work this out alone, which is
     why it takes both. Called once when a note is filed. */
  function closeNote(ledger, offered, sink) {
    var base = ledger && Array.isArray(ledger.entries) ? ledger : emptyLedger();
    var answered = {};
    base.entries.forEach(function (x) { answered[x.cls] = true; });
    var out = base;
    (Array.isArray(offered) ? offered : []).forEach(function (it) {
      if (!it) return;
      var cls = classOf(it);
      if (answered[cls]) return;
      answered[cls] = true;
      out = record(out, {
        producer: it.producer, code: it.code, section: it.section,
        tool: it.tool, disposition: "none",
      }, sink);
    });
    return out;
  }

  /* Counts per class, and the summed weight beside them. The sum is signed on
     purpose: five approvals and five rejections of the same change is not the
     same evidence as nobody ever seeing it, and a count alone cannot tell those
     apart. */
  function score(ledger) {
    var base = ledger && Array.isArray(ledger.entries) ? ledger.entries : [];
    var by = {};
    base.forEach(function (x) {
      var row = by[x.cls] || (by[x.cls] = {
        cls: x.cls, producer: x.producer, code: x.code, section: x.section,
        none: 0, approve: 0, reject: 0, edit: 0, paired: 0, weight: 0,
      });
      row[x.disposition] += 1;
      row.weight += x.weight;
      if (x.paired) row.paired += 1;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  window.NoteDisposition = {
    DISPOSITIONS: DISPOSITIONS,
    NAMES: NAMES,
    ALIASES: ALIASES,
    normalize: normalize,
    weightOf: weightOf,
    evidenceOf: evidenceOf,
    classOf: classOf,
    emptyLedger: emptyLedger,
    record: record,
    closeNote: closeNote,
    score: score,
  };
})();
