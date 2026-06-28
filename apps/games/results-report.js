/* ════════════════════════════════════════════════════════════════════
   results-report.js — durable local trial-data persistence + branded
   print/PDF report that opens quietly in a new tab.

   SECURITY / CLINICAL BOUNDARY (mandatory):
   - Device-local only. Data is read/written to localStorage and the report
     is rendered entirely client-side. NOTHING here transmits trial data to
     any worker, API, or endpoint.
   - Raw recorded data only. The report renders exactly the columns/summary
     the caller passes — no inferred mastery, no derived conclusions.
   - Persistence protects against trial-data loss if the window/tab closes.
     It is session continuity, not a record store; clearResults() fully wipes.

   API:
     NooutcoResults.save(key, rows)      persist an array of trial records
     NooutcoResults.load(key)            -> array (|| [])
     NooutcoResults.clear(key)           remove the store
     NooutcoResults.open(report, opts)   open branded report in a new tab
        report = {
          title:   string,
          meta:    string,                 // e.g. printed-at + array size
          columns: [{ label, key, cls? }], // cls(row) -> optional css class
          rows:    [ recordObject ],
          summary: [{ label, value }]
        }
        opts.onBlocked(retry)  optional; default shows an in-page banner whose
                               button retries open() inside a user gesture.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var doc = global.document;

  /* ── Persistence (device-local) ──────────────────────────────────── */
  function save(key, rows) {
    try { global.localStorage.setItem(key, JSON.stringify(rows || [])); }
    catch (e) { /* storage full / unavailable — non-fatal */ }
  }
  function load(key) {
    try { return JSON.parse(global.localStorage.getItem(key) || '[]'); }
    catch (e) { return []; }
  }
  function clear(key) {
    try { global.localStorage.removeItem(key); }
    catch (e) { /* non-fatal */ }
  }

  /* ── HTML building ───────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var REPORT_CSS = [
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:var(--font-sans);background:var(--surface-page);',
    'color:var(--text-body);padding:var(--space-10) var(--space-12);line-height:var(--leading-normal)}',
    '.rpt-header{display:flex;align-items:center;justify-content:space-between;gap:var(--space-6);',
    'margin-bottom:var(--space-6);flex-wrap:wrap}',
    '.rpt-brand{display:flex;align-items:center;gap:var(--space-5)}',
    '.rpt-kicker{font-size:var(--text-xs);font-weight:var(--weight-bold);text-transform:uppercase;',
    'letter-spacing:var(--tracking-label);color:var(--text-muted)}',
    '.rpt-header h1{font-size:var(--text-3xl);font-weight:var(--weight-bold);color:var(--text-primary);',
    'letter-spacing:var(--tracking-tight)}',
    '.rpt-print{background:var(--brand-primary);color:var(--brand-primary-text);border:none;',
    'padding:var(--space-4) var(--space-8);border-radius:var(--radius-lg);font-size:var(--text-md);',
    'font-weight:var(--weight-bold);font-family:var(--font-sans);cursor:pointer;box-shadow:var(--shadow-sm)}',
    '.rpt-print:hover{background:var(--brand-primary-hover)}',
    '.rpt-meta{color:var(--text-muted);font-size:var(--text-sm);margin-bottom:var(--space-7)}',
    '.rpt-table{width:100%;border-collapse:collapse;background:var(--surface-card);',
    'border:1px solid var(--border-default);border-radius:var(--radius-lg);overflow:hidden;',
    'box-shadow:var(--shadow-sm);margin-bottom:var(--space-7)}',
    '.rpt-table th{background:var(--surface-sunken);text-align:left;font-size:var(--text-xs);',
    'font-weight:var(--weight-bold);text-transform:uppercase;letter-spacing:var(--tracking-label);',
    'color:var(--text-muted);padding:var(--space-4) var(--space-5)}',
    '.rpt-table td{padding:var(--space-4) var(--space-5);font-size:var(--text-base);',
    'border-top:1px solid var(--border-default);color:var(--text-body)}',
    '.rpt-table tr:nth-child(even) td{background:var(--surface-page)}',
    '.outcome-error{color:var(--intent-danger);font-weight:var(--weight-semibold)}',
    '.outcome-prompted{color:var(--status-pace);font-weight:var(--weight-semibold)}',
    '.outcome-ok{color:var(--status-met);font-weight:var(--weight-semibold)}',
    '.outcome-correction{color:var(--violet-600);font-weight:var(--weight-semibold)}',
    '.rpt-summary{display:flex;flex-wrap:wrap;gap:var(--space-5) var(--space-10);',
    'padding-top:var(--space-6);border-top:1px solid var(--border-strong)}',
    '.sum-item{display:flex;flex-direction:column;gap:2px}',
    '.sum-label{font-size:var(--text-xs);text-transform:uppercase;letter-spacing:var(--tracking-label);',
    'color:var(--text-muted)}',
    '.sum-item strong{font-size:var(--text-xl);color:var(--text-primary)}',
    '.rpt-footer{margin-top:var(--space-10);font-size:var(--text-xs);color:var(--text-faint)}',
    '@media print{body{padding:0}.rpt-print{display:none}.rpt-table{box-shadow:none}}'
  ].join('');

  function buildHtml(report) {
    var ver = global.APP_VERSION || '';
    var cols = report.columns || [];

    var thead = '<thead><tr>' +
      cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') +
      '</tr></thead>';

    var tbody = '<tbody>' + (report.rows || []).map(function (row) {
      return '<tr>' + cols.map(function (c) {
        var cls = c.cls ? c.cls(row) : '';
        return '<td' + (cls ? ' class="' + esc(cls) + '"' : '') + '>' + esc(row[c.key]) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody>';

    var summary = (report.summary || []).map(function (s) {
      return '<div class="sum-item"><span class="sum-label">' + esc(s.label) +
        '</span><strong>' + esc(s.value) + '</strong></div>';
    }).join('');

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>' + esc(report.title || 'Session Results') + '</title>' +
      '<link rel="stylesheet" href="/tokens.css">' +
      '<style>' + REPORT_CSS + '</style></head><body>' +
      '<header class="rpt-header"><div class="rpt-brand">' +
      '<img src="/logo-mark.svg" alt="" width="40" height="40">' +
      '<div><div class="rpt-kicker">No Outcome ABA</div>' +
      '<h1>' + esc(report.title || 'Session Results') + '</h1></div></div>' +
      '<button class="rpt-print" onclick="window.print()">Print / Save PDF</button></header>' +
      (report.meta ? '<p class="rpt-meta">' + esc(report.meta) + '</p>' : '') +
      '<table class="rpt-table">' + thead + tbody + '</table>' +
      '<div class="rpt-summary">' + summary + '</div>' +
      '<footer class="rpt-footer">Device-local report — not transmitted.' +
      (ver ? ' v' + esc(ver) : '') + '</footer></body></html>';
  }

  /* ── Open report in a new tab (quiet) with pop-up-blocked fallback ─ */
  function writeTo(win, html) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function defaultBlockedBanner(retry) {
    // Remove any prior banner first.
    var prev = doc.getElementById('rpt-blocked-banner');
    if (prev) prev.remove();

    var bar = doc.createElement('div');
    bar.id = 'rpt-blocked-banner';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:20px', 'transform:translateX(-50%)',
      'z-index:9999', 'display:flex', 'align-items:center', 'gap:12px',
      'background:#1f2937', 'color:#fff', 'padding:12px 16px',
      'border-radius:8px', 'box-shadow:0 8px 24px rgba(0,0,0,0.25)',
      'font-family:inherit', 'font-size:14px'
    ].join(';');

    var msg = doc.createElement('span');
    msg.textContent = 'Pop-ups blocked — your results are saved.';

    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Open results';
    btn.style.cssText = [
      'background:#6a7659', 'color:#fff', 'border:none', 'cursor:pointer',
      'padding:7px 14px', 'border-radius:6px', 'font-weight:700', 'font-family:inherit'
    ].join(';');
    btn.addEventListener('click', function () {
      // Inside a user gesture — pop-up blockers allow this.
      if (retry()) bar.remove();
    });

    bar.appendChild(msg);
    bar.appendChild(btn);
    doc.body.appendChild(bar);
  }

  /**
   * Open the report in a new tab. Returns true on success.
   * On pop-up block, calls opts.onBlocked(retry) or shows a default banner
   * whose button retries inside a user gesture.
   */
  function open(report, opts) {
    opts = opts || {};
    var html = buildHtml(report);

    function attempt() {
      var w = global.open('', '_blank');
      if (!w) return false;
      writeTo(w, html);
      return true;
    }

    if (attempt()) return true;

    if (opts.onBlocked) opts.onBlocked(attempt);
    else defaultBlockedBanner(attempt);
    return false;
  }

  global.NooutcoResults = {
    save: save,
    load: load,
    clear: clear,
    open: open,
    buildHtml: buildHtml
  };
})(window);
