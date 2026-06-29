/* No Outcome ABA — Game Master admin shell (<noaba-admin-shell>)
   CANONICAL SOURCE: packages/shared/ui/admin-shell.js — edit here, never in
   apps/games/assets/admin-shell.js (generated copy; CI drift check fails on hand
   edits). Run `npm run sync:shared` after editing. Games-only.

   A dependency-free, light-DOM custom element that renders the persistent admin
   chrome (nav rail + content toolbar) around a manager's content, plus a global
   `window.NoabaShell` with a dirty-state registry and the Frame-05 unsaved-
   changes guard. Pairs with admin-shell.css + tokens.css.

   Usage — wrap the manager's content:

     <body class="ash-page">
       <noaba-bar product="games" crumbs="Game Master/FFC Manager"
                  crumb-hrefs="/,/GM/" no-admin></noaba-bar>
       <noaba-admin-shell active="ffc" current="FFC Manager" count="42 items">
         <div data-ash-slot="actions"> …search + primary button… </div>
         <main> …manager content… </main>
       </noaba-admin-shell>
     </body>

   Attributes: active="images|ffc|intraverbal|sequences|famous" · current="…" ·
   count="…" (optional pill) · exit-href (default "/") · hub-href (default "/GM/")
   · data-collapsed (force icon rail). Children with data-ash-slot="actions" are
   relocated into the toolbar's right side; everything else fills the body.

   Dirty state / guard (managers call these):
     NoabaShell.markDirty(id, { emoji, name })   // flag one unsaved item
     NoabaShell.markClean(id) · NoabaShell.clearDirty() · NoabaShell.isDirty()
     NoabaShell.onSaveAll(fn)   // fn(): Promise — invoked by "Save all & leave"
   The guard fires on rail/exit clicks and beforeunload while anything is dirty. */
(function () {
  "use strict";

  // Root-absolute so the rail resolves identically from /GM/ and /AdminTools/*/.
  var NAV = [
    { key: "images",      glyph: "🖼️", label: "Images",        href: "/AdminTools/ImageManager/" },
    { key: "ffc",         glyph: "🏷️", label: "FFC Game",      href: "/AdminTools/FFCGManager/" },
    { key: "intraverbal", glyph: "💬",  label: "Intraverbal",   href: "/AdminTools/IntraverbalManager/" },
    { key: "sequences",   glyph: "🔁",  label: "Sequences",     href: "/AdminTools/SequencesManager/" },
    { key: "famous",      glyph: "🧠",  label: "Famous Person", href: "/famous-person/" }
  ];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ── Dirty-state registry + guard (module singleton) ─────────────────── */
  var dirty = new Map();              // id -> { emoji, name }
  var saveAllFn = null;               // page-registered Promise-returning saver
  var guardEl = null;                 // lazily-built dialog
  var pendingNav = null;              // { run: fn } captured navigation

  function isDirty() { return dirty.size > 0; }

  function ensureGuard() {
    if (guardEl) return guardEl;
    var overlay = el("div", "ash-guard");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "ash-guard-title");
    var box = el("div", "ash-guard-box");

    var head = el("div", "ash-guard-head");
    var icon = el("div", "ash-guard-icon", "⚠️");
    icon.setAttribute("aria-hidden", "true");
    var title = el("div", "ash-guard-title", "Leave without saving?");
    title.id = "ash-guard-title";
    head.appendChild(icon); head.appendChild(title);

    var body = el("div", "ash-guard-body");
    var list = el("div", "ash-guard-list");

    var save = el("button", "ash-guard-save", "Save all & leave");
    save.type = "button";
    var alt = el("div", "ash-guard-alt");
    var discard = el("button", "ash-guard-discard", "Discard changes");
    discard.type = "button";
    var keep = el("button", "ash-guard-keep", "Keep editing");
    keep.type = "button";
    alt.appendChild(discard); alt.appendChild(keep);

    box.appendChild(head); box.appendChild(body); box.appendChild(list);
    box.appendChild(save); box.appendChild(alt);
    overlay.appendChild(box);

    keep.addEventListener("click", closeGuard);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeGuard(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("is-open")) closeGuard();
    });
    discard.addEventListener("click", function () {
      dirty.clear();
      var nav = pendingNav; closeGuard();
      if (nav) nav.run();
    });
    save.addEventListener("click", function () {
      if (!saveAllFn) { // no saver wired — fall back to discard semantics safely
        dirty.clear(); var nav0 = pendingNav; closeGuard(); if (nav0) nav0.run(); return;
      }
      save.disabled = true; save.textContent = "Saving…";
      Promise.resolve()
        .then(function () { return saveAllFn(); })
        .then(function () {
          dirty.clear();
          var nav = pendingNav; closeGuard();
          if (nav) nav.run();
        })
        .catch(function () {
          // Leave drafts intact; let the manager surface its own error.
          save.disabled = false; save.textContent = "Save all & leave";
        });
    });

    guardEl = overlay;
    guardEl._body = body; guardEl._list = list; guardEl._save = save;
    document.body.appendChild(overlay);
    return guardEl;
  }

  function openGuard(nav) {
    var g = ensureGuard();
    pendingNav = nav;
    var n = dirty.size;
    g._body.innerHTML = "You've edited <strong>" + n + (n === 1 ? " item" : " items") +
      "</strong> that haven't been saved yet. They'll be lost if you leave now.";
    g._list.replaceChildren();
    dirty.forEach(function (meta, id) {
      if (g._list.childNodes.length) g._list.appendChild(el("div", "ash-guard-divider"));
      var row = el("div", "ash-guard-row");
      row.appendChild(el("span", null, (meta && meta.emoji) || "📄"));
      row.appendChild(el("span", "ash-guard-row-name", (meta && meta.name) || id));
      row.appendChild(el("span", "ash-guard-row-dot"));
      g._list.appendChild(row);
    });
    g._save.disabled = false; g._save.textContent = "Save all & leave";
    g.classList.add("is-open");
    g._save.focus();
  }

  function closeGuard() {
    if (guardEl) guardEl.classList.remove("is-open");
    pendingNav = null;
  }

  // Intercept a navigation: if dirty, stage it behind the guard; else run now.
  function guardedGo(href) {
    if (!isDirty()) { location.assign(href); return; }
    openGuard({ run: function () { location.assign(href); } });
  }

  window.addEventListener("beforeunload", function (e) {
    if (isDirty()) { e.preventDefault(); e.returnValue = ""; return ""; }
  });

  window.NoabaShell = {
    markDirty: function (id, meta) { dirty.set(String(id), meta || {}); },
    markClean: function (id) { dirty.delete(String(id)); },
    clearDirty: function () { dirty.clear(); },
    isDirty: isDirty,
    onSaveAll: function (fn) { saveAllFn = fn; },
    /** Programmatic guarded navigation, for custom buttons. */
    navigate: guardedGo
  };

  /* ── Custom element ──────────────────────────────────────────────────── */
  class NoabaAdminShell extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      // Capture authored children before we rebuild (script is deferred → parsed).
      var slotted = [], bodyKids = [];
      Array.prototype.slice.call(this.childNodes).forEach(function (node) {
        if (node.nodeType === 1 && node.getAttribute("data-ash-slot") === "actions") slotted.push(node);
        else bodyKids.push(node);
      });

      var active = (this.getAttribute("active") || "").toLowerCase();
      var current = this.getAttribute("current") || "";
      var count = this.getAttribute("count");
      var exitHref = this.getAttribute("exit-href") || "/";
      var hubHref = this.getAttribute("hub-href") || "/GM/";
      var logo = this.getAttribute("logo") || "/logo-mark.svg";

      // Rail
      var rail = el("div", "ash-rail");
      var brand = el("a", "ash-brand");
      brand.href = hubHref;
      brand.setAttribute("aria-label", "Game Master hub");
      var img = el("img"); img.src = logo; img.alt = ""; img.setAttribute("aria-hidden", "true");
      var btext = el("div", "ash-brand-text");
      btext.appendChild(el("div", "ash-brand-name", "Game Master"));
      btext.appendChild(el("div", "ash-brand-eyebrow", "Content tools"));
      brand.appendChild(img); brand.appendChild(btext);
      rail.appendChild(brand);

      rail.appendChild(el("div", "ash-manage", "Manage"));

      NAV.forEach(function (item) {
        var a = el("a", "ash-nav-item" + (item.key === active ? " is-active" : ""));
        a.href = item.href;
        if (item.key === active) a.setAttribute("aria-current", "page");
        var accent = el("span", "ash-nav-accent"); accent.setAttribute("aria-hidden", "true");
        var glyph = el("span", "ash-nav-glyph", item.glyph); glyph.setAttribute("aria-hidden", "true");
        a.appendChild(accent); a.appendChild(glyph);
        a.appendChild(el("span", "ash-nav-label", item.label));
        // Guard rail navigation when drafts are pending.
        a.addEventListener("click", function (e) {
          if (isDirty()) { e.preventDefault(); guardedGo(item.href); }
        });
        rail.appendChild(a);
      });

      rail.appendChild(el("div", "ash-rail-spacer"));

      var foot = el("div", "ash-foot");
      var gm = el("div", "ash-gm");
      var dot = el("span", "ash-gm-dot"); dot.setAttribute("aria-hidden", "true");
      gm.appendChild(dot); gm.appendChild(el("span", null, "GM mode active"));
      var exit = el("a", "ash-exit");
      exit.href = exitHref;
      var exg = el("span", "ash-exit-glyph", "↩︎"); exg.setAttribute("aria-hidden", "true");
      exit.appendChild(exg); exit.appendChild(el("span", "ash-exit-label", "Exit to games"));
      exit.addEventListener("click", function (e) {
        if (isDirty()) { e.preventDefault(); guardedGo(exitHref); }
      });
      foot.appendChild(gm); foot.appendChild(exit);
      rail.appendChild(foot);

      // Content column
      var content = el("div", "ash-content");
      var bar = el("div", "ash-bar");
      var crumbs = el("nav", "ash-crumbs");
      crumbs.setAttribute("aria-label", "Breadcrumb");
      crumbs.appendChild(el("span", "ash-crumb-root", "Game Master"));
      var sep = el("span", "ash-crumb-sep", "/"); sep.setAttribute("aria-hidden", "true");
      crumbs.appendChild(sep);
      var cur = el("span", "ash-crumb-current", current);
      cur.setAttribute("aria-current", "page");
      crumbs.appendChild(cur);
      if (count != null && count !== "") {
        var pill = el("span", "ash-count", count);
        pill.setAttribute("data-ash-count", "");
        crumbs.appendChild(pill);
      }
      bar.appendChild(crumbs);
      bar.appendChild(el("div", "ash-bar-spacer"));
      var actions = el("div", "ash-actions");
      slotted.forEach(function (node) { actions.appendChild(node); });
      bar.appendChild(actions);

      var bodyWrap = el("div", "ash-body");
      bodyKids.forEach(function (node) { bodyWrap.appendChild(node); });

      content.appendChild(bar);
      content.appendChild(bodyWrap);

      this.replaceChildren(rail, content);
      this._countEl = (count != null && count !== "") ? crumbs.querySelector("[data-ash-count]") : null;
      this._curEl = cur;
    }

    /** Update the toolbar count pill text (e.g. after add/delete). */
    setCount(text) {
      if (this._countEl) { this._countEl.textContent = text; return; }
      // create one if it wasn't present
      var crumbs = this.querySelector(".ash-crumbs");
      if (!crumbs) return;
      var pill = el("span", "ash-count", text);
      pill.setAttribute("data-ash-count", "");
      crumbs.appendChild(pill);
      this._countEl = pill;
    }
    setCurrent(text) { if (this._curEl) this._curEl.textContent = text; }
  }

  if (!customElements.get("noaba-admin-shell")) {
    customElements.define("noaba-admin-shell", NoabaAdminShell);
  }
})();
