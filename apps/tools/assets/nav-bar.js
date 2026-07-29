/* No Outcome ABA — unified navigation bar (<noaba-bar>)
   CANONICAL SOURCE: packages/shared/ui/nav-bar.js — edit here, never in
   apps/<app>/assets/nav-bar.js (generated copies; CI drift check fails on hand
   edits). Run `npm run sync:shared` after editing.

   A tiny, dependency-free, light-DOM custom element. One global bar dropped onto
   every page of tools + games + apex. Renders: brand lockup (→ apex) ·
   2-segment product switch (Games | Tools, links to the sibling domain) ·
   breadcrumb (replaces bespoke back buttons) · one admin gear.

   Also exposes `window.NoabaSites` — the environment-aware link resolver every
   cross-product link should go through, plus the `data-noaba-site` attribute
   that rewrites such links in plain app HTML. See "Environment-aware site
   links" below.

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

  // --- Environment-aware site links ------------------------------------------
  // Each product is deployed once per environment, so a cross-product link has
  // to name the sibling *in the environment it was clicked in*. Get this wrong
  // and a dev validation pass slides onto the live site mid-click, silently,
  // because the page it lands on looks identical.
  //
  //   prod   nooutco.me        games.nooutco.me        tools.nooutco.me
  //   dev    d.nooutco.me      d-games.nooutco.me      d-tools.nooutco.me
  //
  // The .pages.dev rows are the Pages projects sitting behind those custom
  // domains. Per-deployment previews arrive as <hash>.<project>.pages.dev, which
  // is why hosts are matched on exact name first and subdomain suffix second.
  var ENVIRONMENTS = [
    { id: "prod",      apex: "nooutco.me",                 games: "games.nooutco.me",               tools: "tools.nooutco.me" },
    { id: "dev",       apex: "d.nooutco.me",               games: "d-games.nooutco.me",             tools: "d-tools.nooutco.me" },
    { id: "pages",     apex: "nooutco-root.pages.dev",     games: "games-nooutco-me.pages.dev",     tools: "tools-nooutco-me.pages.dev" },
    { id: "pages-dev", apex: "dev-nooutco-root.pages.dev", games: "dev-games-nooutco-me.pages.dev", tools: "dev-tools-nooutco-me.pages.dev" }
  ];
  var PRODUCTS = ["apex", "games", "tools"];
  var FALLBACK = ENVIRONMENTS[0];

  // The environment `host` belongs to. An exact hostname beats a suffix match,
  // and a longer slot beats a shorter one, so games.nooutco.me claims the games
  // slot rather than matching prod apex's own ".nooutco.me" tail.
  function environmentFor(host) {
    var best = null, bestScore = -1;
    for (var i = 0; i < ENVIRONMENTS.length; i++) {
      for (var p = 0; p < PRODUCTS.length; p++) {
        var slot = ENVIRONMENTS[i][PRODUCTS[p]];
        var score = -1;
        if (host === slot) score = 1000 + slot.length;
        else if (host.length > slot.length && host.slice(-(slot.length + 1)) === "." + slot) score = slot.length;
        if (score > bestScore) { bestScore = score; best = ENVIRONMENTS[i]; }
      }
    }
    return best || FALLBACK;
  }

  // Origin of `product` in whichever environment `host` belongs to. Unrecognised
  // hosts (localhost, a preview of an unlisted project) fall back to production:
  // a sibling's local port is unknowable, and production is where these links
  // already pointed before any of this existed.
  function resolveSite(product, host) {
    var env = environmentFor(String(host || ""));
    return "https://" + (env[product] || FALLBACK[product]);
  }

  function siteHref(product, path) {
    return resolveSite(product, location.hostname) + (path || "");
  }

  // Progressive enhancement for cross-product links authored in app HTML. The
  // authored href stays a working production URL, so a click that lands before
  // this runs — or with JS off entirely — still goes somewhere real; only the
  // origin is swapped, keeping the path, query and hash the author wrote.
  function applySiteLinks(root, host) {
    var scope = root || document;
    var h = host || location.hostname;
    var nodes = scope.querySelectorAll("a[data-noaba-site]");
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      var product = a.getAttribute("data-noaba-site");
      if (PRODUCTS.indexOf(product) === -1) continue;
      var origin = resolveSite(product, h);
      var url;
      try { url = new URL(a.getAttribute("href") || "/", origin); }
      catch (e) { continue; }
      a.href = origin + url.pathname + url.search + url.hash;
    }
  }

  window.NoabaSites = {
    resolve: resolveSite,
    href: siteHref,
    applyLinks: applySiteLinks,
    environments: ENVIRONMENTS
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { applySiteLinks(); });
  } else {
    applySiteLinks();
  }

  // Sibling product URL for the switch. Always overridable via the
  // games-href / tools-href attrs.
  function productHref(target, overrides) {
    if (overrides && overrides[target]) return overrides[target];
    return siteHref(target);
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
      brand.href = siteHref("apex");
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
