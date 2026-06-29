/* No Outcome ABA — unified navigation bar (<noaba-bar>)
   CANONICAL SOURCE: packages/shared/ui/nav-bar.js — edit here, never in
   apps/<app>/assets/nav-bar.js (generated copies; CI drift check fails on hand
   edits). Run `npm run sync:shared` after editing.

   A tiny, dependency-free, light-DOM custom element. One global bar dropped onto
   every page of tools + games + apex. Renders: brand lockup (→ nooutco.me) ·
   2-segment product switch (Games | Tools, hard-links to sibling domain) ·
   breadcrumb (replaces bespoke back buttons) · one admin gear.

   Auth is decoupled: the gear dispatches `noaba:admin-invoke` (the page wires it
   to its own auth flow); the bar reflects authed state from `noaba:auth-state`
   events or an optional `window.__noabaAuthProbe()` — it never imports either
   auth system. See packages/shared/README.md.

     <noaba-bar product="tools|games|apex"
                crumbs="Notes/BT session note"
                crumb-hrefs="/notes/"          (optional, comma-separated, parents only)
                logo="/logo-mark.svg"          (optional override)
                games-href="..." tools-href="..."  (optional env overrides)>
*/
(function () {
  "use strict";

  var HOME = "https://nooutco.me";
  var PROD = { games: "https://games.nooutco.me", tools: "https://tools.nooutco.me" };

  // Resolve the sibling product URL, dev-aware. If the current host carries a
  // "tools"/"games" token (tools.nooutco.me, dev-tools-nooutco-me.pages.dev, …),
  // swap it so dev validation stays on dev. Apex (no token) falls back to prod
  // product roots. Always overridable via the games-href / tools-href attrs.
  function productHref(target, overrides) {
    if (overrides && overrides[target]) return overrides[target];
    var host = location.hostname;
    var other = target === "games" ? "tools" : "games";
    if (host.indexOf(target) !== -1 || host.indexOf(other) !== -1) {
      return location.protocol + "//" + host.split(other).join(target);
    }
    return PROD[target];
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var SEGMENTS = [
    { key: "games", glyph: "👾", label: "Games" },
    { key: "tools", glyph: "🗃️", label: "Tools" }
  ];

  class NoabaBar extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      this.render();
      this._onAuth = this._onAuth.bind(this);
      document.addEventListener("noaba:auth-state", this._onAuth);
      // Initial authed state, if the page exposes a probe.
      try {
        if (typeof window.__noabaAuthProbe === "function") {
          this._setAuthed(!!window.__noabaAuthProbe());
        }
      } catch (e) { /* probe is best-effort */ }
    }

    disconnectedCallback() {
      document.removeEventListener("noaba:auth-state", this._onAuth);
      this._mounted = false;
    }

    _onAuth(e) {
      this._setAuthed(!!(e && e.detail && e.detail.authed));
    }

    _setAuthed(on) {
      if (this._gear) this._gear.setAttribute("data-authed", on ? "true" : "false");
    }

    render() {
      var product = (this.getAttribute("product") || "").toLowerCase();
      var overrides = {
        games: this.getAttribute("games-href"),
        tools: this.getAttribute("tools-href")
      };
      var logo = this.getAttribute("logo") || "/logo-mark.svg";

      var row = el("div", "noaba-row");

      // Brand → home
      var brand = el("a", "noaba-brand");
      brand.href = HOME;
      brand.setAttribute("aria-label", "No Outcome ABA — home");
      var img = el("img");
      img.src = logo;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      var wordmark = el("span", "noaba-wordmark");
      wordmark.innerHTML = "No Outcome <span>ABA</span>";
      brand.appendChild(img);
      brand.appendChild(wordmark);
      row.appendChild(brand);

      // Product switch
      var sw = el("div", "noaba-switch");
      sw.setAttribute("role", "group");
      sw.setAttribute("aria-label", "Switch product");
      SEGMENTS.forEach(function (seg) {
        var active = seg.key === product;
        var node;
        if (active) {
          node = el("span", "noaba-seg");
          node.setAttribute("aria-current", "page");
        } else {
          node = el("a", "noaba-seg");
          node.href = productHref(seg.key, overrides);
        }
        node.setAttribute("aria-label", seg.label);
        var glyph = el("span", null, seg.glyph);
        glyph.setAttribute("aria-hidden", "true");
        var label = el("span", "noaba-seg-label", seg.label);
        node.appendChild(glyph);
        node.appendChild(label);
        sw.appendChild(node);
      });
      row.appendChild(sw);

      // Breadcrumb
      var crumbsAttr = (this.getAttribute("crumbs") || "").trim();
      if (crumbsAttr) {
        var labels = crumbsAttr.split("/").map(function (s) { return s.trim(); }).filter(Boolean);
        var hrefs = (this.getAttribute("crumb-hrefs") || "")
          .split(",").map(function (s) { return s.trim(); });
        var nav = el("nav", "noaba-crumbs");
        nav.setAttribute("aria-label", "Breadcrumb");
        // back chevron — only shows on collapsed layout (CSS)
        var chev = el("span", "noaba-back-chevron", "‹");
        chev.setAttribute("aria-hidden", "true");
        nav.appendChild(chev);
        labels.forEach(function (label, i) {
          var isCurrent = i === labels.length - 1;
          if (i > 0) {
            var sep = el("span", "noaba-sep", "›");
            sep.setAttribute("aria-hidden", "true");
            nav.appendChild(sep);
          }
          var href = hrefs[i];
          var crumb;
          if (!isCurrent && href) {
            crumb = el("a", "noaba-crumb", label);
            crumb.href = href;
          } else {
            crumb = el("span", "noaba-crumb", label);
            if (isCurrent) crumb.setAttribute("aria-current", "page");
          }
          nav.appendChild(crumb);
        });
        row.appendChild(nav);
      }

      row.appendChild(el("div", "noaba-spacer"));

      // Admin gear — suppressed on pages with no admin concept (`no-admin`).
      if (this.hasAttribute("no-admin")) {
        this.replaceChildren(row);
        return;
      }
      var gear = el("button", "noaba-gear");
      gear.type = "button";
      gear.setAttribute("aria-label", "Admin");
      gear.setAttribute("data-authed", "false");
      var ring = el("span", "noaba-gear-ring", "⚙");
      ring.setAttribute("aria-hidden", "true");
      gear.appendChild(ring);
      var self = this;
      gear.addEventListener("click", function () {
        self.dispatchEvent(new CustomEvent("noaba:admin-invoke", { bubbles: true }));
      });
      this._gear = gear;
      row.appendChild(gear);

      this.replaceChildren(row);
    }
  }

  if (!customElements.get("noaba-bar")) {
    customElements.define("noaba-bar", NoabaBar);
  }
})();
