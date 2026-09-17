/* Note tool addresses, crumbs and tab titles.

   Every note tool has its own address: /notes/bt/, /notes/sup/, /notes/assess/,
   /notes/parent/ and /notes/sap/. The four BCBA tools share this directory's
   page, which the Worker serves at each of their addresses, so this file is what
   tells the page which tool the address names.

   Older links carry ?tool=<id> on /notes/bcba/. They still open the right tool,
   and the address is rewritten in place rather than redirected: the old
   /notes/<id> addresses answered 301 -> ?tool=<id>, browsers keep a 301
   indefinitely, and a redirect back would loop for anyone holding one.

   Loaded as a plain script after the tools/*.js registrations and before the
   engine, so the bar and the tab title are already right when React mounts. The
   engine calls go() from the ribbon and show() after Back or Forward. */
(function () {
  "use strict";

  var PATH = /^\/notes\/([a-z]+)\/?$/;

  function tools() {
    return window.NOTE_TOOLS || [];
  }

  function byId(id) {
    var list = tools();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // The address wins over ?tool=, and an unknown id falls back to the page's
  // first tool, matching the engine's DEFAULT_TOOL.
  function idFromLocation() {
    var m = location.pathname.match(PATH);
    if (m && byId(m[1])) return m[1];
    var q = new URLSearchParams(location.search).get("tool");
    if (q && byId(q)) return q;
    return tools().length ? tools()[0].id : null;
  }

  // Keeps every other switch on the address (?schema=off, ?expert=off, ...).
  function urlFor(id) {
    var params = new URLSearchParams(location.search);
    params.delete("tool");
    var qs = params.toString();
    return "/notes/" + id + "/" + (qs ? "?" + qs : "") + location.hash;
  }

  // "Supervision Note Tool" reads "Supervision Note" in the crumb. The bar
  // splits crumbs on "/", so a title may not carry one into it.
  function crumbFor(tool) {
    return String(tool.title || tool.label || tool.id)
      .replace(/\s+Tool$/, "")
      .replace(/\s*\/\s*/g, " & ");
  }

  function show(id) {
    var tool = byId(id);
    if (!tool) return;
    var label = crumbFor(tool);
    var bar = document.querySelector("noaba-bar");
    if (bar) {
      bar.setAttribute("crumb-hrefs", "/");
      bar.setAttribute("crumbs", label);
    }
    document.title = label + " - No Outcome ABA";
  }

  // push: a ribbon click adds a history entry; the first load only corrects
  // the address it arrived on.
  function go(id, push) {
    if (!byId(id)) return;
    var next = urlFor(id);
    var here = location.pathname + location.search + location.hash;
    if (next !== here) history[push ? "pushState" : "replaceState"]({}, "", next);
    show(id);
  }

  window.NoteToolNav = {
    idFromLocation: idFromLocation,
    urlFor: urlFor,
    crumbFor: crumbFor,
    show: show,
    go: go
  };

  var initial = idFromLocation();
  if (initial) go(initial, false);
})();
