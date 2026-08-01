/* ── Think or Say? — the probe subsystem ───────────────────────────────
   A PROBE is an untrained item presented WITHOUT the instructional supports, so
   that a correct response is evidence about the repertoire rather than about
   the prompt (RESEARCH.md §4.2). Probes are OFF by default and configured per
   level; nothing here runs unless a Skill Acquisition Plan asks for it.

   WHAT THIS MODULE OWNS
     * TAGGING — near / far / deictic, as a SET, computed from the data rather
       than asserted by a label. Marzullo-Kerth et al. found within-category
       generalization for all three children and across-category for only one
       (RESEARCH.md §4.1), so "did it generalize?" is not one question. An item
       can be far AND deictic, and the report groups by the EXACT set.
     * SELECTION — which items are in play for a level and a tag selection, and
       which ones a session's probe block draws.
     * PLACEMENT — before / interleaved / after the teaching deck.
     * The list of supports a probe trial SUPPRESSES.

   WHAT IT DELIBERATELY DOES NOT OWN
     No "unused probes remaining" counter and no probe-reset button. The
     generated space is enumerable and re-derivable, so a stored count of what
     has been used is one localStorage wipe away from silently re-presenting a
     trained item as a generalization datum. Trial CLASSIFICATION lives in
     game.js against the running session, where it is observable.

   No build step — plain static JS, loaded after cards.js and
   exemplar-generator.js.
   ----------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var model = global.ThinkOrSayModel;
  var cards = global.ThinkOrSayCards;
  var gen = global.ThinkOrSayGenerator;
  if (!model || !cards || !gen) {
    throw new Error('think-or-say: probes.js loads after card-model.js, cards.js and exemplar-generator.js');
  }

  /* ── Tags ────────────────────────────────────────────────────────────
     Canonical order, so a tag SET has exactly one spelling and the report
     cannot end up with a "far+deictic" bucket and a "deictic+far" one. */
  var TAGS = ['near', 'far', 'deictic'];

  var PLACEMENTS = ['before', 'interleaved', 'after'];

  /**
   * The instructional supports a probe trial withholds.
   *
   * Named by their settings field so suppression is a lookup rather than five
   * scattered conditionals. The Prompt BUTTON is deliberately absent: clinical
   * judgement is never blocked. Using it does not invalidate the trial — it
   * re-classifies it as a trained one, with the reason recorded.
   *
   * `showRule` is here for the same reason `showReason` is. Level 1 states its
   * rule on screen for the whole trial, which is a teaching support and the
   * strongest one in the game — a probe run with the rule still up would
   * measure whether the learner can read it, not whether they hold it.
   */
  var SUPPRESSED = ['autoPrompt', 'errorless', 'showReason', 'represent', 'showRule'];

  function tagIndex(t) { return TAGS.indexOf(t); }

  /** One canonical spelling per tag SET: 'near', 'far+deictic', ''. */
  function tagKey(tags) {
    return (tags || []).slice().sort(function (a, b) { return tagIndex(a) - tagIndex(b); }).join('+');
  }

  /* ── near vs far, measured against what the level actually teaches ───
     For the criterial configuration an item turns on, collect every can-have
     value the level's teaching pool ever pairs with it. An item whose SAMPLED
     surface stays inside that set is a NEAR probe — same territory, new
     instance. An item that brings in a person, setting, topic or form the pool
     never pairs with that configuration is a FAR probe.

     Only SAMPLED can-have values count. A value the template's KEY supplies is
     the criterial fact in the can-have vocabulary (G-relationship's "somebody
     you have never met" is both), and grading the probe on the answer it was
     keyed with would make every item on that template far by construction. */

  function trainedSurface(level, dim, value) {
    var out = {};
    model.CAN_HAVE_KEYS.forEach(function (k) { out[k] = {}; });
    var taught = 0;
    cards.level(level).cards.forEach(function (c) {
      if (c.features[dim] !== value) return;
      taught++;
      model.CAN_HAVE_KEYS.forEach(function (k) { out[k][c.vary[k]] = true; });
    });
    return { surface: out, taught: taught };
  }

  /**
   * The tag SET for one generated item presented at one level.
   *
   * `deictic` is present exactly at Level 3, where the response required is a
   * spoken I–YOU rationale and not only the tile choice (RESEARCH.md §4.3). It
   * is a different response class, so it is a different question, so it is its
   * own tag rather than a level column.
   */
  function tagsFor(item, level) {
    var value = item.features[item.dim];
    var t = trainedSurface(level, item.dim, value);
    var novel = (item.sampled || []).some(function (k) {
      return !t.surface[k][item.vary[k]];
    });
    // A configuration the pool never teaches at all is as untrained as it gets.
    var out = [(novel || !t.taught) ? 'far' : 'near'];
    if (Number(level) === 3) out.push('deictic');
    return out;
  }

  /**
   * Every generated item for a level, tagged.
   *
   * Built fresh from the generator each call rather than cached per level: the
   * items are frozen cards, so this returns decorated COPIES and a caller that
   * mutates one cannot poison the next session.
   */
  function poolFor(level) {
    return gen.enumerateFor(level).map(function (item) {
      var tags = tagsFor(item, level);
      var probe = {};
      Object.keys(item).forEach(function (k) { probe[k] = item[k]; });
      probe.isProbe = true;
      probe.probeTags = tags;
      probe.tagKey = tagKey(tags);
      return probe;
    });
  }

  /**
   * The items a tag selection puts in play.
   *
   * Subset, not intersection: an item is in play only when EVERY tag it carries
   * was selected. A far+deictic item asks a far question and a deictic one at
   * the same time, and a technician who selected only "far" did not ask for the
   * deictic one. This is why Level 3's default selection includes deictic —
   * at Level 3 there is no item without it.
   */
  function inPlay(level, tagsSelected) {
    var sel = tagsSelected || [];
    return poolFor(level).filter(function (it) {
      return it.probeTags.every(function (t) { return sel.indexOf(t) >= 0; });
    });
  }

  /**
   * The in-play items, narrowed to the category being taught where the universe
   * has any there.
   *
   * Generalization has to be measured PER CATEGORY — Marzullo-Kerth et al. found
   * within-category generalization for all three children and across-category
   * for only one (RESEARCH.md §4.1) — so a session narrowed to one content area
   * is probed inside that content area. Where the generated universe holds no
   * item in that category at all, probing outside it beats not probing: the
   * fallback is the whole selection, and the item's own category is printed on
   * its report row, so a reader can see which happened.
   */
  function forCategory(level, tagsSelected, cat) {
    var all = inPlay(level, tagsSelected);
    if (!cat || cat === 'all') return all;
    var narrowed = all.filter(function (it) { return it.cat === cat; });
    return narrowed.length ? narrowed : all;
  }

  function groupByDim(items) {
    var out = {};
    items.forEach(function (it) { (out[it.dim] = out[it.dim] || []).push(it); });
    return out;
  }

  /**
   * The probe block for one session.
   *
   * Drawn ROUND-ROBIN across criterial dimensions rather than off the top of the
   * pool: general case programming asks the probe set to sample the range of the
   * instructional universe, and three draws that all happen to turn on `audience`
   * measure one dimension three times (RESEARCH.md §3.1). `seed` rotates which
   * surface each dimension contributes, so two sessions of the same programme do
   * not run the identical items — without anything being stored.
   */
  function select(level, tagsSelected, count, seed, pool) {
    var items = pool || inPlay(level, tagsSelected);
    var want = Math.max(0, Math.floor(Number(count) || 0));
    if (!want || !items.length) return [];
    var order = spread(items, seed);
    var out = [];
    // Asking for more probe trials than the selection holds distinct items runs
    // some of them a second time. That is not padding and it is not hidden: the
    // first clean run is the generalization datum and every later one is
    // recorded as a trained RE-EXPOSURE with that reason on the row. Silently
    // handing back fewer trials than the plan asked for would be the worse
    // answer, because nothing on the sheet would say the block was short.
    for (var i = 0; i < want; i++) out.push(order[i % order.length]);
    return out;
  }

  /** Every item once, taken round-robin across dimensions. */
  function spread(items, seed) {
    var byDim = groupByDim(items);
    var dims = Object.keys(byDim).sort();
    var offset = Math.abs(Number(seed) || 0);
    var out = [];
    for (var round = 0; out.length < items.length; round++) {
      var progressed = false;
      for (var i = 0; i < dims.length; i++) {
        var list = byDim[dims[i]];
        if (round >= list.length) continue;
        out.push(list[(round + offset) % list.length]);
        progressed = true;
      }
      if (!progressed) break;
    }
    return out;
  }

  /**
   * Where the probe block sits relative to the teaching deck.
   *
   * `interleaved` spreads the probes evenly through the teaching cards rather
   * than bunching them, so a run of probes cannot itself become the cue that
   * supports have gone away.
   */
  function place(deck, probes, placement) {
    var base = (deck || []).slice();
    var block = (probes || []).slice();
    if (!block.length) return base;
    if (placement === 'before') return block.concat(base);
    if (placement === 'after') return base.concat(block);
    var out = [];
    var step = (base.length + 1) / (block.length + 1);
    var next = 0;
    for (var i = 0; i <= base.length; i++) {
      while (next < block.length && i >= Math.round(step * (next + 1))) out.push(block[next++]);
      if (i < base.length) out.push(base[i]);
    }
    while (next < block.length) out.push(block[next++]);
    return out;
  }

  global.ThinkOrSayProbes = Object.freeze({
    TAGS: Object.freeze(TAGS.slice()),
    PLACEMENTS: Object.freeze(PLACEMENTS.slice()),
    SUPPRESSED: Object.freeze(SUPPRESSED.slice()),
    tagKey: tagKey,
    tagsFor: tagsFor,
    poolFor: poolFor,
    inPlay: inPlay,
    forCategory: forCategory,
    select: select,
    place: place,
  });
})(typeof window !== 'undefined' ? window : globalThis);
