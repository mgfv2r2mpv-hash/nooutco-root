// Redact and crop, applied before anything leaves the browser.
//
// The contract this file exists to keep: the bitmap that gets uploaded is a new
// bitmap, composed from the cropped region with opaque rectangles painted over
// it. The original ImageBitmap is never encoded and never sent. Redaction is
// destructive by construction rather than by a flag someone could forget to
// check, so there is no path where the source image reaches the network.
(function () {
  "use strict";

  var HANDLE = 8;
  var MIN_DRAG = 4;
  var OUTPUT_TYPE = "image/png";
  // Long edge cap. A graph screenshot past this carries no extra readable
  // detail and costs upload size and tokens.
  var MAX_EDGE = 1600;

  function create(container, options) {
    var opts = options || {};
    var canvas = document.createElement("canvas");
    canvas.className = "gva-redact-canvas";
    canvas.setAttribute("role", "application");
    canvas.setAttribute("aria-label", "Redaction and crop editor. Drag to draw a box.");
    container.appendChild(canvas);
    var ctx = canvas.getContext("2d");

    var state = {
      image: null,
      naturalW: 0,
      naturalH: 0,
      scale: 1,
      mode: "redact",
      rects: [],
      crop: null,
      drag: null,
      onChange: opts.onChange || function () {},
    };

    function fit() {
      if (!state.image) return;
      var maxW = Math.max(240, container.clientWidth || 640);
      state.scale = Math.min(1, maxW / state.naturalW);
      canvas.width = Math.round(state.naturalW * state.scale);
      canvas.height = Math.round(state.naturalH * state.scale);
      canvas.style.width = canvas.width + "px";
      canvas.style.height = canvas.height + "px";
    }

    // Canvas pixels to image pixels.
    function toImage(pt) {
      return { x: pt.x / state.scale, y: pt.y / state.scale };
    }

    function pointerPos(ev) {
      var r = canvas.getBoundingClientRect();
      var src = ev.touches && ev.touches.length ? ev.touches[0] : ev;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }

    function normalize(a, b) {
      return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(a.x - b.x),
        h: Math.abs(a.y - b.y),
      };
    }

    function draw() {
      if (!state.image) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);

      // Committed redactions, drawn opaque so what the user sees is what bakes.
      ctx.fillStyle = "#000";
      state.rects.forEach(function (r) {
        ctx.fillRect(r.x * state.scale, r.y * state.scale, r.w * state.scale, r.h * state.scale);
      });

      if (state.crop) {
        var c = state.crop;
        ctx.save();
        ctx.fillStyle = "rgba(21,24,28,0.55)";
        ctx.beginPath();
        ctx.rect(0, 0, canvas.width, canvas.height);
        ctx.rect(c.x * state.scale, c.y * state.scale, c.w * state.scale, c.h * state.scale);
        ctx.fill("evenodd");
        ctx.restore();
        ctx.strokeStyle = "#1F6FB2";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(c.x * state.scale, c.y * state.scale, c.w * state.scale, c.h * state.scale);
        ctx.setLineDash([]);
      }

      if (state.drag) {
        var d = normalize(state.drag.from, state.drag.to);
        ctx.strokeStyle = state.mode === "crop" ? "#1F6FB2" : "#A32D2D";
        ctx.fillStyle = state.mode === "crop" ? "rgba(31,111,178,0.12)" : "rgba(0,0,0,0.55)";
        ctx.lineWidth = 1.5;
        ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.strokeRect(d.x, d.y, d.w, d.h);
      }
    }

    function onDown(ev) {
      if (!state.image) return;
      ev.preventDefault();
      var p = pointerPos(ev);
      state.drag = { from: p, to: p };
      draw();
    }

    function onMove(ev) {
      if (!state.drag) return;
      ev.preventDefault();
      state.drag.to = pointerPos(ev);
      draw();
    }

    function onUp() {
      if (!state.drag) return;
      var d = normalize(state.drag.from, state.drag.to);
      state.drag = null;
      if (d.w < MIN_DRAG || d.h < MIN_DRAG) { draw(); return; }
      var img = {
        x: d.x / state.scale, y: d.y / state.scale,
        w: d.w / state.scale, h: d.h / state.scale,
      };
      if (state.mode === "crop") state.crop = img;
      else state.rects.push(img);
      draw();
      state.onChange(summary());
    }

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("touchstart", onDown, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onUp);

    function summary() {
      return {
        loaded: !!state.image,
        redactions: state.rects.length,
        cropped: !!state.crop,
        mode: state.mode,
      };
    }

    function load(file) {
      return new Promise(function (resolve, reject) {
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
          reject(new Error("Use a PNG, JPEG, or WebP image."));
          return;
        }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          state.image = img;
          state.naturalW = img.naturalWidth;
          state.naturalH = img.naturalHeight;
          state.rects = [];
          state.crop = null;
          fit();
          draw();
          URL.revokeObjectURL(url);
          state.onChange(summary());
          resolve(summary());
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error("Could not decode that image."));
        };
        img.src = url;
      });
    }

    // Composes the upload bitmap. Everything outside the crop is discarded by
    // never being drawn, and every redaction is painted opaque on top. The
    // result is a fresh canvas, so no pixel of the original survives except the
    // ones deliberately kept.
    function bake() {
      if (!state.image) return null;
      var c = state.crop || { x: 0, y: 0, w: state.naturalW, h: state.naturalH };
      var srcW = Math.max(1, Math.round(c.w));
      var srcH = Math.max(1, Math.round(c.h));
      var ratio = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
      var outW = Math.max(1, Math.round(srcW * ratio));
      var outH = Math.max(1, Math.round(srcH * ratio));

      var out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      var octx = out.getContext("2d");
      octx.fillStyle = "#FFF";
      octx.fillRect(0, 0, outW, outH);
      octx.drawImage(state.image, c.x, c.y, srcW, srcH, 0, 0, outW, outH);

      octx.fillStyle = "#000";
      state.rects.forEach(function (r) {
        octx.fillRect(
          (r.x - c.x) * ratio,
          (r.y - c.y) * ratio,
          r.w * ratio,
          r.h * ratio
        );
      });

      var dataUrl = out.toDataURL(OUTPUT_TYPE);
      return {
        dataUrl: dataUrl,
        base64: dataUrl.split(",")[1],
        mediaType: OUTPUT_TYPE,
        width: outW,
        height: outH,
        redactions: state.rects.length,
        cropped: !!state.crop,
      };
    }

    return {
      load: load,
      bake: bake,
      setMode: function (m) { state.mode = m === "crop" ? "crop" : "redact"; state.onChange(summary()); },
      undo: function () {
        if (state.mode === "crop" && state.crop) state.crop = null;
        else state.rects.pop();
        draw();
        state.onChange(summary());
      },
      clear: function () {
        state.rects = [];
        state.crop = null;
        draw();
        state.onChange(summary());
      },
      reset: function () {
        state.image = null;
        state.rects = [];
        state.crop = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
        state.onChange(summary());
      },
      resize: function () { fit(); draw(); },
      summary: summary,
      canvas: canvas,
    };
  }

  window.GVA_REDACT = { create: create, MAX_EDGE: MAX_EDGE, OUTPUT_TYPE: OUTPUT_TYPE };
})();
