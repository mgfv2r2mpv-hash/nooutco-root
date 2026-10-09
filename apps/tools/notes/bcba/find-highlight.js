/* The mark that shows which match find-replace.js is on.

   A text field paints its selection only while it has focus, and the bar keeps
   focus so that a second Enter steps on instead of typing a line break over the
   selected word. So the field gets the real selection (Esc hands it over, ready
   to dictate over) and this file draws a mark over the same characters until
   then.

   HOW IT FINDS THE SPOT. A hidden copy of the field, with the field's font,
   padding and width, holds the text up to the match and the match in a span.
   The span's boxes are where the match sits inside the field before scrolling.
   The mark is clipped to the field's own box, so a match scrolled out of the
   field never paints over the page around it.

   It draws nothing but a box. It reads the field's text only to measure it, and
   the copy is removed in the same call. */
(function () {
  "use strict";

  var COPIED_STYLES = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "letterSpacing",
    "lineHeight", "textTransform", "wordSpacing", "textIndent", "tabSize",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  ];

  var layer = null;
  var watched = null;
  var shown = null;

  // The match's boxes, relative to the top left of the field's padding box,
  // before the field is scrolled.
  function measure(field, start, end) {
    var cs = getComputedStyle(field);
    var isArea = field.tagName === "TEXTAREA";
    var mirror = document.createElement("div");
    COPIED_STYLES.forEach(function (p) { mirror.style[p] = cs[p]; });
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.top = "0";
    mirror.style.left = "-10000px";
    mirror.style.boxSizing = "border-box";
    mirror.style.border = "0";
    mirror.style.width = (isArea ? field.clientWidth : 100000) + "px";
    mirror.style.whiteSpace = isArea ? "pre-wrap" : "pre";
    mirror.style.overflowWrap = isArea ? "break-word" : "normal";
    var value = field.value || "";
    var mark = document.createElement("span");
    mark.textContent = value.slice(start, end);
    mirror.appendChild(document.createTextNode(value.slice(0, start)));
    mirror.appendChild(mark);
    mirror.appendChild(document.createTextNode(value.slice(end) || " "));
    document.body.appendChild(mirror);
    var origin = mirror.getBoundingClientRect();
    var boxes = Array.prototype.map.call(mark.getClientRects(), function (r) {
      return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
    });
    mirror.remove();
    return boxes;
  }

  // Scroll the field itself so the match sits in the middle of its box.
  function centerIn(field, start, end) {
    var boxes = measure(field, start, end);
    if (!boxes.length) return;
    var first = boxes[0];
    if (field.scrollHeight > field.clientHeight) {
      field.scrollTop = Math.max(0, first.y - (field.clientHeight - first.h) / 2);
    }
    if (field.scrollWidth > field.clientWidth) {
      field.scrollLeft = Math.max(0, first.x - (field.clientWidth - first.w) / 2);
    }
  }

  function draw() {
    if (!shown || !shown.field.isConnected) { clear(); return; }
    var field = shown.field;
    var rect = field.getBoundingClientRect();
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "find-mark-layer";
      layer.setAttribute("aria-hidden", "true");
      layer.setAttribute("data-find-highlight", "");
      document.body.appendChild(layer);
    }
    layer.style.left = (rect.left + field.clientLeft + window.scrollX) + "px";
    layer.style.top = (rect.top + field.clientTop + window.scrollY) + "px";
    layer.style.width = field.clientWidth + "px";
    layer.style.height = field.clientHeight + "px";
    layer.textContent = "";
    measure(field, shown.start, shown.end).forEach(function (b) {
      var m = document.createElement("div");
      m.className = "find-mark";
      m.style.left = (b.x - field.scrollLeft) + "px";
      m.style.top = (b.y - field.scrollTop) + "px";
      m.style.width = b.w + "px";
      m.style.height = b.h + "px";
      layer.appendChild(m);
    });
  }

  function watch(field) {
    if (watched === field) return;
    if (watched) watched.removeEventListener("scroll", draw);
    watched = field;
    if (field) field.addEventListener("scroll", draw);
  }

  function show(field, start, end) {
    shown = { field: field, start: start, end: end };
    watch(field);
    draw();
  }

  function clear() {
    shown = null;
    watch(null);
    if (layer) { layer.remove(); layer = null; }
  }

  window.addEventListener("resize", function () { if (shown) draw(); });

  window.NoteFindHighlight = { show: show, clear: clear, centerIn: centerIn, redraw: draw };
})();
