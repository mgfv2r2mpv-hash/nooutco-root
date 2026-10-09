/* Find and replace across the note form.

   Kaleb asked for it on 2026-10-09 while filling the note tool forms: "Need a
   find/replace on form text fields". He dictates, so the bar is built to save
   words and clicks: a shortcut opens it with the cursor in Find, a word he has
   selected in a field is already in Find, Enter in Find steps to the next match,
   Enter in Replace replaces it and steps on, and Esc puts him in the field of
   the match he was on with that match selected, ready to dictate over.

   Focus stays in the bar while he steps, so a second Enter can never land in a
   field as a line break over the selected word. find-highlight.js marks the
   match, because a field does not paint its selection without focus.

   SCOPE. The text fields inside [data-find-scope], which the engine puts on the
   form card: textareas and text inputs. Never a password or hidden input, never
   a read-only or disabled one, and never the bar's own two boxes.

   HOW A REPLACEMENT GOES IN. The way typing does. The field is focused, the
   range selected, and document.execCommand("insertText") writes it, which fires
   beforeinput and input like a keystroke and leaves a native undo step in the
   field. The engine's fields are React-controlled, so their onChange runs and
   the autosave, counts and scrub state move exactly as if he had typed. Where
   execCommand is unavailable or refuses, the value goes in through the native
   setter and one bubbling input event, which React also reads.

   PRIVACY. This file sends nothing anywhere and stores nothing. What he searches
   for may be a client's name, so the last Find and Replace are kept in memory for
   this page load only. A masking token such as [CLIENT] is plain text here: Find
   never reads its box as a pattern, and none of this touches the scrub code. */
(function () {
  "use strict";

  var SCOPE_SELECTOR = "[data-find-scope]";
  var TEXT_INPUT_TYPES = { "": true, text: true, search: true };
  /* A selection longer than this, or one spanning lines, is a passage he is
     about to edit, not a word he wants to find. */
  var SEED_MAX_CHARS = 80;
  var WORD_CHAR = "[\\p{L}\\p{N}_]";
  // Space kept between the bar's bottom edge and a field that Next scrolls to.
  var CLEARANCE_GAP_PX = 12;

  var state = {
    find: "",
    replace: "",
    matchCase: false,
    wholeWord: false,
    current: null,
    returnTo: null,
    undo: null,
  };
  var ui = null;

  /* ── Matching ─────────────────────────────────────────────────────────── */

  function escapeForRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* Whole word uses letter and digit classes rather than \b, so a token that
     starts with a bracket, like [CLIENT], still counts as a whole word. */
  function buildPattern() {
    if (!state.find) return null;
    var body = escapeForRegExp(state.find);
    var flags = "gu" + (state.matchCase ? "" : "i");
    if (!state.wholeWord) return new RegExp(body, flags);
    try {
      return new RegExp("(?<!" + WORD_CHAR + ")" + body + "(?!" + WORD_CHAR + ")", flags);
    } catch (e) {
      // A browser without lookbehind (Safari before 16.4) gets plain \b edges.
      return new RegExp("\\b" + body + "\\b", flags);
    }
  }

  function isTextField(el) {
    if (ui && ui.root.contains(el)) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === "INPUT") {
      var type = (el.getAttribute("type") || "").toLowerCase();
      if (!TEXT_INPUT_TYPES[type]) return false;
    }
    return el.getClientRects().length > 0;
  }

  function fields() {
    var scope = document.querySelector(SCOPE_SELECTOR);
    if (!scope) return [];
    return Array.prototype.filter.call(scope.querySelectorAll("textarea, input"), isTextField);
  }

  function matchesIn(el, pattern) {
    var found = [];
    var text = el.value || "";
    pattern.lastIndex = 0;
    var m;
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex += 1; continue; }
      found.push({ el: el, start: m.index, end: m.index + m[0].length });
    }
    return found;
  }

  function allMatches() {
    var pattern = buildPattern();
    if (!pattern) return [];
    return fields().reduce(function (acc, el) { return acc.concat(matchesIn(el, pattern)); }, []);
  }

  function sameMatch(a, b) {
    return !!a && !!b && a.el === b.el && a.start === b.start && a.end === b.end;
  }

  /* The current match only counts while its text is still a match where it was.
     Typing in the field, or a change to Find, retires it. */
  function liveCurrent(list) {
    var cur = state.current;
    if (!cur) return null;
    for (var i = 0; i < list.length; i++) if (sameMatch(list[i], cur)) return list[i];
    return null;
  }

  /* The first match at or after a point in page order, wrapping to the top. */
  function firstFrom(list, el, pos) {
    if (!list.length) return null;
    var order = fields();
    var at = order.indexOf(el);
    for (var i = 0; i < list.length; i++) {
      var idx = order.indexOf(list[i].el);
      if (idx > at || (idx === at && list[i].start >= pos)) return list[i];
    }
    return list[0];
  }

  /* ── Writing ──────────────────────────────────────────────────────────── */

  function setNativeValue(el, value, data) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: data }));
  }

  // Replace [start, end) in a field with text, as typing would.
  function writeRange(el, start, end, text) {
    var before = el.value;
    var expected = before.slice(0, start) + text + before.slice(end);
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, end);
    var wrote = false;
    try {
      wrote = document.execCommand(text ? "insertText" : "delete", false, text);
    } catch (e) {
      wrote = false;
    }
    if (!wrote || el.value !== expected) {
      // Nothing was written, or something else was: put in exactly what was asked.
      if (el.value !== before && el.value !== expected) setNativeValue(el, before, null);
      if (el.value !== expected) setNativeValue(el, expected, text);
    }
    return { el: el, at: start + text.length };
  }

  /* ── Moving through matches ───────────────────────────────────────────── */

  var NO_MARK = { show: function () {}, clear: function () {}, centerIn: function () {}, redraw: function () {} };
  function mark() {
    return window.NoteFindHighlight || NO_MARK;
  }

  /* Run fn, then hand focus back to the bar control that had it. Writing into a
     field has to focus it, and the bar keeps focus so a second Enter steps on
     rather than typing a line break over the selected word. */
  function keepingFocus(fn) {
    var back = document.activeElement;
    fn();
    var inBar = back && ui && ui.root.contains(back);
    if (inBar && document.activeElement !== back) back.focus({ preventScroll: true });
  }

  /* Select the match in its field and bring it into view, in the field's own
     box and on the page. The selection is real, so Esc lands him in the field
     with the word selected; the mark shows it until then. */
  function selectMatch(match) {
    state.current = { el: match.el, start: match.start, end: match.end };
    state.returnTo = match.el;
    keepingFocus(function () { match.el.setSelectionRange(match.start, match.end); });
    mark().centerIn(match.el, match.start, match.end);
    match.el.scrollIntoView({ block: "center", inline: "nearest" });
    mark().show(match.el, match.start, match.end);
  }

  function next() {
    var list = allMatches();
    if (!list.length) { state.current = null; render(); return; }
    var cur = liveCurrent(list);
    selectMatch(cur ? firstFrom(list, cur.el, cur.start + 1) : list[0]);
    render();
  }

  function replaceOne() {
    var list = allMatches();
    if (!list.length) { render(); return; }
    var target = liveCurrent(list) || list[0];
    var after = null;
    keepingFocus(function () { after = writeRange(target.el, target.start, target.end, state.replace); });
    state.undo = null;
    var rest = allMatches();
    var following = firstFrom(rest, after.el, after.at);
    if (following) selectMatch(following);
    else state.current = null;
    setStatus("");
    render();
  }

  function replaceAll() {
    var list = allMatches();
    if (!list.length) { render(); return; }
    var groups = [];
    list.forEach(function (m) {
      var last = groups[groups.length - 1];
      if (last && last.el === m.el) last.matches.push(m);
      else groups.push({ el: m.el, matches: [m] });
    });
    /* One write per field, spanning its first match to its last, so each field
       takes one native undo step and the whole set takes one Undo in the bar. */
    var entries = groups.map(function (g) {
      var value = g.el.value;
      var first = g.matches[0].start;
      var lastEnd = g.matches[g.matches.length - 1].end;
      var middle = g.matches.map(function (m, i) {
        return value.slice(i ? g.matches[i - 1].end : first, m.start) + state.replace;
      }).join("");
      keepingFocus(function () { writeRange(g.el, first, lastEnd, middle); });
      return { el: g.el, before: value, after: g.el.value };
    });
    state.undo = entries;
    state.current = null;
    setStatus("Replaced " + plural(list.length, "", "") + " in " + plural(groups.length, "field", "fields"));
    render();
  }

  function undoReplaceAll() {
    var entries = state.undo || [];
    state.undo = null;
    var intact = entries.every(function (e) { return e.el.isConnected && e.el.value === e.after; });
    if (!intact) {
      setStatus("The fields changed after Replace all. Cmd+Z in each field still steps back.");
      render();
      return;
    }
    entries.forEach(function (e) { writeRange(e.el, 0, e.el.value.length, e.before); });
    state.current = null;
    ui.find.focus({ preventScroll: true });
    setStatus("Replace all undone");
    render();
  }

  /* ── The bar ──────────────────────────────────────────────────────────── */

  function plural(n, one, many) {
    var word = n === 1 ? one : many;
    return word ? n + " " + word : String(n);
  }

  function setStatus(text) {
    if (ui) ui.status.textContent = text;
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text) node.textContent = text;
    return node;
  }

  function button(label, attrs, onClick) {
    var b = el("button", Object.assign({ type: "button" }, attrs), label);
    b.addEventListener("click", onClick);
    return b;
  }

  function build() {
    var root = el("div", { class: "find-bar", role: "search", "aria-label": "Find and replace" });
    root.hidden = true;

    var find = el("input", { type: "text", class: "find-bar-input", "aria-label": "Find", placeholder: "Find", autocomplete: "off", spellcheck: "false" });
    var replace = el("input", { type: "text", class: "find-bar-input", "aria-label": "Replace with", placeholder: "Replace with", autocomplete: "off", spellcheck: "false" });
    var matchCase = button("Match case", { class: "find-bar-toggle", "aria-pressed": "false" }, function () {
      state.matchCase = !state.matchCase;
      render();
    });
    var wholeWord = button("Whole word", { class: "find-bar-toggle", "aria-pressed": "false" }, function () {
      state.wholeWord = !state.wholeWord;
      render();
    });
    var nextBtn = button("Next", { class: "find-bar-btn", "aria-label": "Next match" }, next);
    var replaceBtn = button("Replace", { class: "find-bar-btn" }, replaceOne);
    var replaceAllBtn = button("Replace all", { class: "find-bar-btn find-bar-primary" }, replaceAll);
    var undoBtn = button("Undo", { class: "find-bar-btn", "aria-label": "Undo replace all" }, undoReplaceAll);
    var closeBtn = button("×", { class: "find-bar-close", "aria-label": "Close find", title: "Close (Esc)" }, close);

    var count = el("span", { class: "find-bar-count", "data-find-count": "" });
    var position = el("span", { class: "find-bar-position", "data-find-position": "" });
    var status = el("span", { class: "find-bar-status", "data-find-status": "" });
    var readout = el("div", { class: "find-bar-readout", "aria-live": "polite" });
    [count, position, status].forEach(function (n) { readout.appendChild(n); });

    var inputs = el("div", { class: "find-bar-inputs" });
    [find, replace].forEach(function (n) { inputs.appendChild(n); });
    var toggles = el("div", { class: "find-bar-actions" });
    [matchCase, wholeWord, nextBtn, replaceBtn, replaceAllBtn, undoBtn].forEach(function (n) { toggles.appendChild(n); });

    var head = el("div", { class: "find-bar-head" });
    head.appendChild(readout);
    head.appendChild(closeBtn);
    [head, inputs, toggles].forEach(function (n) { root.appendChild(n); });

    find.addEventListener("input", function () {
      state.find = find.value;
      state.current = null;
      setStatus("");
      render();
    });
    replace.addEventListener("input", function () { state.replace = replace.value; });
    find.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); next(); }
    });
    replace.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); replaceOne(); }
    });

    document.body.appendChild(root);
    return {
      root: root, find: find, replace: replace, matchCase: matchCase, wholeWord: wholeWord,
      nextBtn: nextBtn, replaceBtn: replaceBtn, replaceAllBtn: replaceAllBtn, undoBtn: undoBtn,
      count: count, position: position, status: status,
    };
  }

  function render() {
    if (!ui || ui.root.hidden) return;
    var list = allMatches();
    var fieldCount = list.reduce(function (acc, m) { return acc.indexOf(m.el) === -1 ? acc.concat([m.el]) : acc; }, []).length;
    ui.count.textContent = !state.find ? "" : list.length
      ? plural(list.length, "match", "matches") + " in " + plural(fieldCount, "field", "fields")
      : "No matches";
    var cur = liveCurrent(list);
    var at = cur ? list.indexOf(cur) + 1 : 0;
    ui.position.textContent = at ? at + " of " + list.length : "";
    if (cur) mark().redraw();
    else mark().clear();
    ui.matchCase.setAttribute("aria-pressed", String(state.matchCase));
    ui.wholeWord.setAttribute("aria-pressed", String(state.wholeWord));
    [ui.nextBtn, ui.replaceBtn, ui.replaceAllBtn].forEach(function (b) { b.disabled = !list.length; });
    ui.undoBtn.hidden = !state.undo;
    var clearance = Math.ceil(ui.root.getBoundingClientRect().bottom + CLEARANCE_GAP_PX);
    document.documentElement.style.setProperty("--find-bar-clearance", clearance + "px");
  }

  function seedFromSelection(field) {
    if (!field || !isTextField(field)) return;
    var picked = (field.value || "").slice(field.selectionStart, field.selectionEnd);
    if (!picked || picked.length > SEED_MAX_CHARS || picked.indexOf("\n") !== -1) return;
    state.find = picked;
    state.current = null;
  }

  function open() {
    if (!ui) ui = build();
    var active = document.activeElement;
    if (active && !ui.root.contains(active)) {
      state.returnTo = active;
      seedFromSelection(active);
    }
    ui.find.value = state.find;
    ui.replace.value = state.replace;
    ui.root.hidden = false;
    setStatus("");
    render();
    ui.find.focus({ preventScroll: true });
    ui.find.select();
  }

  function close() {
    if (!ui || ui.root.hidden) return;
    ui.root.hidden = true;
    document.documentElement.style.removeProperty("--find-bar-clearance");
    mark().clear();
    state.current = null;
    state.undo = null;
    var back = state.returnTo;
    state.returnTo = null;
    if (back && back.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
  }

  function isOpen() {
    return !!ui && !ui.root.hidden;
  }

  /* ── Keys ─────────────────────────────────────────────────────────────── */

  /* Cmd+Option+F on a Mac, Ctrl+Alt+F elsewhere. Both are accepted everywhere,
     because the page cannot reliably tell which keyboard it is on. e.code, not
     e.key: Option+F on a Mac types "ƒ". Plain Cmd+F and Ctrl+F stay the
     browser's own find. */
  function isShortcut(e) {
    return (e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === "KeyF";
  }

  document.addEventListener("keydown", function (e) {
    if (isShortcut(e)) {
      e.preventDefault();
      open();
      return;
    }
    if (e.key !== "Escape" || !isOpen()) return;
    var active = document.activeElement;
    var scope = document.querySelector(SCOPE_SELECTOR);
    if (ui.root.contains(active) || (scope && scope.contains(active))) close();
  }, true);

  // Typing in a field while the bar is open keeps the count true.
  document.addEventListener("input", function (e) {
    if (isOpen() && !ui.root.contains(e.target)) render();
  }, true);

  window.NoteFindReplace = { open: open, close: close, isOpen: isOpen };
})();
