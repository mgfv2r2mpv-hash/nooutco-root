/* The page an Horae Zone email link opens.
 *
 * The link carries the code in its fragment (HZ_LINK_BASE#<code>, see
 * packages/account-engine/src/mailer.mjs fragmentLink). A browser never sends
 * the fragment to a server, so the code reaches this script and nothing else.
 * This script shows it for the reader to paste into Sass C. Assistant, which
 * makes the service call itself. It sends the code nowhere: no fetch, no
 * logging, no analytics, and the Worker's CSP for this path has no connect-src,
 * so the browser would refuse a request even if one were added by mistake.
 */
(function () {
  'use strict';

  // The mailer refuses any token outside this alphabet, so anything else in
  // the fragment did not come from a Horae Zone email and is not shown.
  var CODE_SHAPE = /^[A-Za-z0-9_-]{1,512}$/;

  var found = document.getElementById('found');
  var missing = document.getElementById('missing');
  var codeEl = document.getElementById('code');
  var copyBtn = document.getElementById('copy');
  var status = document.getElementById('copy-status');
  var code = '';

  // Read the fragment, then take it out of the address bar so the code is not
  // left in history or in a screenshot of the URL.
  function readFragment() {
    var raw = location.hash.slice(1);
    if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    return CODE_SHAPE.test(raw) ? raw : '';
  }

  function show(next) {
    code = next;
    codeEl.textContent = code;
    status.textContent = '';
    found.hidden = !code;
    missing.hidden = !!code;
  }

  function copyBySelection() {
    var range = document.createRange();
    range.selectNodeContents(codeEl);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    return ok;
  }

  copyBtn.addEventListener('click', function () {
    if (!code) return;
    var done = function () { status.textContent = 'Copied'; };
    var fallback = function () {
      status.textContent = copyBySelection() ? 'Copied' : 'Not copied. The code is selected, copy it by hand.';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, fallback);
    } else {
      fallback();
    }
  });

  // A second link opened into the same tab only changes the fragment.
  window.addEventListener('hashchange', function () {
    var next = readFragment();
    if (next) show(next);
  });

  show(readFragment());
})();
