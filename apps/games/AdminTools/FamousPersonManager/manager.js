'use strict';
/* ══════════════════════════════════════════════════════════════════
   Famous Person Manager - edits the Red Carpet Convos roster
   (apps/games/red-carpet-convos/people.json).

   Auth matches the other AdminTools managers: the ADMIN_SECRET_HASH
   placeholder is rewritten per request by _worker.js; the typed
   password's SHA-256 must match it, and becomes the Bearer token.

   Endpoints (all POST, Bearer-gated in the Worker):
     rcc-save-facts        { people }            → commit people.json
     rcc-generate-facts    { mode, name|limit }  → AI draft (returns facts)
     person-suggestions    { action, name? }     → list / dismiss queue
   ══════════════════════════════════════════════════════════════════ */
(function () {
  // ── Auth (ported from FFCGManager) ─────────────────────────────────
  // The hash is injected into index.html by _worker.js and exposed as a global
  // (HTML-only rewrite - it cannot live in this .js file).
  const ADMIN_SECRET_HASH = window.ADMIN_SECRET_HASH || "";
  let token = localStorage.getItem('admin_token') || '';

  const adminGear = document.getElementById('admin-gear');
  const adminModal = document.getElementById('admin-modal');
  const adminPwInput = document.getElementById('admin-pw-input');
  const adminPwError = document.getElementById('admin-pw-error');

  function setGearAuthed(a) { adminGear.classList.toggle('authed', a); }
  function showAdminModal(msg) { adminPwInput.value = ''; adminPwError.textContent = msg || ''; adminModal.classList.add('open'); setTimeout(function () { adminPwInput.focus(); }, 50); }

  adminGear.addEventListener('click', function () {
    adminModal.classList.toggle('open');
    if (adminModal.classList.contains('open')) { adminPwInput.value = ''; adminPwError.textContent = ''; setTimeout(function () { adminPwInput.focus(); }, 50); }
  });
  adminModal.addEventListener('click', function (e) { if (e.target === adminModal) adminModal.classList.remove('open'); });

  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function adminUnlock() {
    const pw = adminPwInput.value;
    if (!pw) { adminPwError.textContent = 'Enter password.'; return; }
    const hash = await sha256Hex(pw);
    if (hash === ADMIN_SECRET_HASH) { token = hash; localStorage.setItem('admin_token', hash); setGearAuthed(true); adminModal.classList.remove('open'); initApp(); }
    else { adminPwError.textContent = 'Incorrect password.'; adminPwInput.value = ''; adminPwInput.focus(); }
  }
  document.getElementById('admin-unlock-btn').addEventListener('click', adminUnlock);
  adminPwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') adminUnlock(); });

  function handle401() { token = ''; localStorage.removeItem('admin_token'); setGearAuthed(false); showAdminModal('Session expired - re-enter password.'); }

  async function adminPost(endpoint, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 35000);
    let res;
    try {
      res = await fetch('../../api/admin/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) { clearTimeout(timer); throw new Error(e.name === 'AbortError' ? 'Request timed out' : e.message); }
    clearTimeout(timer);
    if (res.status === 401) { handle401(); return null; }
    return res;
  }

  if (token) { setGearAuthed(true); initApp(); } else { showAdminModal(); }

  // ── Manager state ──────────────────────────────────────────────────
  var root = document.getElementById('fpm');
  var FIELDS = [
    { key: 'text', label: 'Fact', hint: 'read together in Meet', rows: 2, full: true },
    { key: 'topic', label: 'Topic chip', hint: '2-4 words', rows: 1, full: false },
    { key: 'sayShort', label: 'Comment · short', hint: 'the “in a few words” hook', rows: 1, full: false },
    { key: 'say', label: 'Comment · full', hint: 'a plain statement', rows: 2, full: true },
    { key: 'ask', label: 'Question to partner', hint: 'the volley', rows: 2, full: false },
    { key: 'askYou', label: 'Alternate question', hint: 'turn it to them/you', rows: 2, full: false },
    { key: 'bridge', label: 'Recall bridge', hint: 'partner opener into this fact', rows: 2, full: true }
  ];
  var m = { tab: 'prompts', pIdx: 0, filter: '', people: [], original: [], suggestions: [], dirty: false, regenBusy: false, loaded: false };
  var flashT = null;

  function clone(list) { return list.map(function (p) { return Object.assign({}, p, { facts: (p.facts || []).map(function (f) { return Object.assign({}, f); }) }); }); }
  function cur() { return m.people[m.pIdx] || m.people[0] || { name: '', tag: '', years: '', img: '', facts: [] }; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escA(s) { return esc(s).replace(/"/g, '&quot;'); }
  function imgSrc(p) { var i = p && p.img; if (!i) return ''; return /^(https?:|\/)/.test(i) ? i : '../../red-carpet-convos/' + i; }
  function recomputeDirty() { m.dirty = JSON.stringify(m.people) !== JSON.stringify(m.original); }

  // ── Boot / data ────────────────────────────────────────────────────
  function initApp() {
    fetch('../../red-carpet-convos/people.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data && data.people) || [];
        m.people = clone(list); m.original = clone(list); m.loaded = true; render(); loadSuggestions();
      })
      .catch(function () { m.people = []; m.original = []; m.loaded = true; render(); loadSuggestions(); });
  }
  function loadSuggestions() {
    adminPost('person-suggestions', { action: 'list' })
      .then(function (res) { if (!res || !res.ok) return; return res.json().then(function (d) { m.suggestions = (d && (d.suggestions || d.items)) || []; refreshSuggestUI(); }); })
      .catch(function () { /* endpoint may not exist yet - degrade quietly */ });
  }
  function refreshSuggestUI() { var b = document.getElementById('fpm-suggest-badge'); if (b) { b.textContent = m.suggestions.length; b.style.background = m.suggestions.length ? 'var(--sage-500)' : 'var(--slate-300)'; } if (m.tab === 'suggestions') render(); }

  // ── Actions ────────────────────────────────────────────────────────
  function setTab(t) { m.tab = t; render(); }
  function selectPerson(i) { m.pIdx = i; render(); }
  function editField(fi, key, val) { var p = m.people[m.pIdx]; if (p && p.facts[fi]) { p.facts[fi][key] = val; recomputeDirty(); var f = document.getElementById('fpm-flash'); if (f) f.textContent = ''; } }

  function flash(msg, type) {
    var el = document.getElementById('fpm-flash');
    if (el) { el.textContent = msg; el.style.color = type === 'err' ? '#b91c1c' : 'var(--sage-700)'; }
    clearTimeout(flashT); flashT = setTimeout(function () { var e2 = document.getElementById('fpm-flash'); if (e2) e2.textContent = ''; }, 3200);
  }

  function save() {
    var host = cur();
    adminPost('rcc-save-facts', { people: m.people })
      .then(function (res) {
        if (!res) return; // 401 handled
        if (res.ok) { m.original = clone(m.people); m.dirty = false; flash('Saved to the roster ✓', 'ok'); }
        else return res.json().catch(function () { return {}; }).then(function (d) { flash('Save failed: ' + (d.error || res.status), 'err'); });
      })
      .catch(function (e) { flash('Save failed: ' + e.message, 'err'); });
    void host;
  }
  function revert() {
    var name = cur().name;
    var orig = m.original.filter(function (p) { return p.name === name; })[0];
    if (orig) { var i = m.people.map(function (p) { return p.name; }).indexOf(name); if (i >= 0) m.people[i] = clone([orig])[0]; }
    recomputeDirty(); flash('Reverted this person', 'ok'); render();
  }
  function regen() {
    if (m.regenBusy) return;
    var name = cur().name;
    m.regenBusy = true; render();
    adminPost('rcc-generate-facts', { mode: 'fill', name: name })
      .then(function (res) {
        m.regenBusy = false;
        if (!res) { render(); return; }
        return res.json().catch(function () { return {}; }).then(function (d) {
          var facts = d.facts || (d.person && d.person.facts);
          if (res.ok && facts && facts.length) {
            var i = m.people.map(function (p) { return p.name; }).indexOf(name);
            if (i >= 0) { m.people[i] = Object.assign({}, m.people[i], { facts: facts.map(function (f) { return Object.assign({}, f); }) }); }
            recomputeDirty(); flash('AI draft ready - review, then Save', 'ok');
          } else if (res.ok && (d.ok || d.message)) { flash(d.message || 'Draft requested', 'ok'); }
          else flash('Draft failed: ' + (d.error || res.status), 'err');
          render();
        });
      })
      .catch(function (e) { m.regenBusy = false; flash('Draft failed: ' + e.message, 'err'); render(); });
  }
  function approve(name) {
    var i = m.people.map(function (p) { return p.name.toLowerCase(); }).indexOf(name.toLowerCase());
    if (i < 0) { m.people.push({ name: name, years: '', tag: 'Pending', emoji: '⭐', img: '', accent: '', accentBg: '', converted: false, facts: [] }); i = m.people.length - 1; }
    m.suggestions = m.suggestions.filter(function (s) { return s.name !== name; });
    m.tab = 'prompts'; m.pIdx = i; recomputeDirty();
    adminPost('person-suggestions', { action: 'dismiss', name: name }).catch(function () {});
    flash('Added as a draft - draft facts, then Save', 'ok'); render();
  }
  function dismissSuggest(name) {
    m.suggestions = m.suggestions.filter(function (s) { return s.name !== name; });
    adminPost('person-suggestions', { action: 'dismiss', name: name }).catch(function () {});
    render();
  }

  // ── Render ─────────────────────────────────────────────────────────
  function tabStyle(active) { return 'padding:10px 16px;border:none;border-bottom:2.5px solid ' + (active ? 'var(--sage-500)' : 'transparent') + ';background:none;color:' + (active ? 'var(--sage-700)' : 'var(--slate-500)') + ';font-size:13.5px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:7px'; }

  function bar() {
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 20px;background:#fff;border-bottom:1px solid var(--sage-200);flex:0 0 auto">' +
      '<img src="/logo-mark.svg" alt="No Outcome ABA" style="width:32px;height:32px" />' +
      '<div style="line-height:1.15;flex:0 0 auto"><div style="font-size:15px;font-weight:800;color:var(--sage-700);white-space:nowrap">Famous Person Manager</div><div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500)">Red Carpet Convos content · admin</div></div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-left:auto"><span style="font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--sage-700);background:var(--sage-100);border-radius:999px;padding:4px 11px">🔒 GM mode</span>' +
      '<a href="../../GM/" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1.5px solid var(--sage-200);border-radius:var(--radius-md);color:var(--sage-700);font-size:12.5px;font-weight:700">← Back to GM</a></div></div>';
  }
  function tabs() {
    return '<div style="display:flex;gap:2px;padding:8px 20px 0;background:#fff;border-bottom:1px solid var(--sage-200);flex:0 0 auto">' +
      '<button data-act="tabPrompts" style="' + tabStyle(m.tab === 'prompts') + '">Prompts</button>' +
      '<button data-act="tabSuggest" style="' + tabStyle(m.tab === 'suggestions') + '">Suggestions <span id="fpm-suggest-badge" style="font-size:10px;font-weight:800;min-width:17px;text-align:center;padding:1px 5px;border-radius:999px;background:' + (m.suggestions.length ? 'var(--sage-500)' : 'var(--slate-300)') + ';color:#fff">' + m.suggestions.length + '</span></button></div>';
  }

  function personList() {
    var f = m.filter.trim().toLowerCase();
    var rows = m.people.map(function (p, i) {
      if (f && p.name.toLowerCase().indexOf(f) < 0) return '';
      var active = i === m.pIdx, done = p.converted === true;
      var img = imgSrc(p);
      var imgTag = img ? '<img src="' + escA(img) + '" alt="" referrerpolicy="no-referrer" data-imgerr style="width:34px;height:34px;border-radius:8px;object-fit:cover;object-position:center 30%;flex:0 0 auto;background:var(--slate-100)" />' : '<span style="width:34px;height:34px;border-radius:8px;flex:0 0 auto;background:var(--slate-100);display:flex;align-items:center;justify-content:center;font-size:16px">' + (p.emoji || '⭐') + '</span>';
      return '<button data-act="selectPerson" data-arg="' + i + '" style="display:flex;align-items:center;gap:10px;width:100%;padding:8px;border:1px solid ' + (active ? 'var(--sage-500)' : 'transparent') + ';background:' + (active ? '#fff' : 'transparent') + ';border-radius:var(--radius-md);cursor:pointer;margin-bottom:2px;box-shadow:' + (active ? 'var(--shadow-sm)' : 'none') + '">' +
        imgTag + '<span style="flex:1;min-width:0;text-align:left"><span style="display:block;font-size:13px;font-weight:800;color:var(--slate-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name) + '</span><span style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--slate-400)">' + esc(p.tag) + '</span></span>' +
        '<span title="' + (done ? 'Live in game' : 'Pending - needs facts') + '" style="width:9px;height:9px;border-radius:999px;flex:0 0 auto;background:' + (done ? 'var(--sage-400)' : 'var(--amber-300)') + '"></span></button>';
    }).join('');
    return '<div style="flex:0 0 260px;border-right:1px solid var(--sage-200);background:#fbfcf9;display:flex;flex-direction:column;min-height:0">' +
      '<div style="padding:12px 14px;border-bottom:1px solid var(--sage-200)"><input id="fpm-filter" value="' + escA(m.filter) + '" placeholder="Filter people…" style="width:100%;padding:8px 11px;border:1px solid var(--sage-300);border-radius:var(--radius-md);font-size:13px;background:#fff;color:var(--slate-900)" /></div>' +
      '<div id="fpm-person-rows" class="fpm-scroll" style="flex:1;overflow-y:auto;padding:8px">' + (rows || '<div style="padding:14px;font-size:12.5px;color:var(--slate-400)">No people yet.</div>') + '</div></div>';
  }

  function editor() {
    var p = cur();
    var img = imgSrc(p);
    var head = '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' +
      (img ? '<img src="' + escA(img) + '" alt="" referrerpolicy="no-referrer" data-imgerr style="width:52px;height:52px;border-radius:12px;object-fit:cover;object-position:center 30%;flex:0 0 auto;background:var(--pabg)" />' : '<span style="width:52px;height:52px;border-radius:12px;flex:0 0 auto;background:var(--pabg);display:flex;align-items:center;justify-content:center;font-size:22px">' + (p.emoji || '⭐') + '</span>') +
      '<div style="flex:1;min-width:0"><div style="font-size:20px;font-weight:800;color:var(--slate-900);line-height:1.1">' + esc(p.name) + '</div><div style="font-size:12px;font-weight:700;color:var(--slate-400)">' + esc(p.tag) + ' · ' + esc(p.years || ' - ') + '</div></div>' +
      '<button data-act="regen" style="padding:9px 15px;border:1.5px solid var(--violet-200);border-radius:var(--radius-md);background:var(--violet-50);color:var(--violet-600);font-size:12.5px;font-weight:800;cursor:' + (m.regenBusy ? 'default' : 'pointer') + ';opacity:' + (m.regenBusy ? '.6' : '1') + ';flex:0 0 auto">' + (m.regenBusy ? '✨ Drafting…' : ((p.facts || []).length ? '✨ Regenerate with AI' : '✨ Draft with AI')) + '</button></div>';

    var bodyHTML;
    if (!(p.facts || []).length) {
      bodyHTML = '<div style="background:#fff;border:1px dashed var(--sage-300);border-radius:var(--radius-lg);padding:34px 22px;text-align:center"><div style="font-size:30px">🧠</div><div style="font-size:15px;font-weight:800;color:var(--slate-900);margin-top:6px">No facts yet</div>' +
        '<div style="font-size:13px;color:var(--slate-600);margin-top:4px;line-height:1.5;max-width:400px;margin-left:auto;margin-right:auto">This person was added from a suggestion. Draft a connected 4-fact set with AI, then fine-tune each prompt below.</div>' +
        '<button data-act="regen" style="margin-top:16px;padding:11px 20px;border:none;border-radius:var(--radius-md);background:var(--violet-600);color:#fff;font-size:14px;font-weight:800;cursor:pointer">✨ Draft with AI</button></div>';
    } else {
      bodyHTML = '<div style="display:flex;flex-direction:column;gap:16px">' + p.facts.map(function (fact, fi) {
        var fields = FIELDS.map(function (fd) {
          return '<div style="' + (fd.full ? 'grid-column:1 / -1' : '') + '"><div style="display:flex;align-items:baseline;gap:7px;margin-bottom:4px"><span style="font-size:11px;font-weight:800;color:var(--slate-700)">' + fd.label + '</span><span style="font-size:10.5px;color:var(--slate-400)">' + fd.hint + '</span></div>' +
            '<textarea data-fi="' + fi + '" data-key="' + fd.key + '" rows="' + fd.rows + '" style="width:100%;resize:vertical;padding:8px 10px;border:1px solid var(--sage-300);border-radius:var(--radius-md);font-size:13px;line-height:1.4;color:var(--slate-900);background:#fff">' + esc(fact[fd.key] || '') + '</textarea></div>';
        }).join('');
        return '<div style="background:#fff;border:1px solid var(--sage-200);border-left:4px solid var(--pa);border-radius:var(--radius-lg);padding:15px 17px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="width:22px;height:22px;border-radius:999px;background:var(--pabg);color:var(--pa);font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center">' + (fi + 1) + '</span><span style="font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-400)">Turn ' + (fi + 1) + '</span></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' + fields + '</div></div>';
      }).join('') + '</div>';
    }

    var accent = p.accent || '#6b7c47', accentBg = p.accentBg || '#eef0da';
    return '<div class="fpm-scroll" style="flex:1;min-width:0;overflow-y:auto;padding:22px 26px 40px"><div style="max-width:720px;margin:0 auto;animation:fpm-in .25s ease-out;--pa:' + accent + ';--pabg:' + accentBg + '">' + head + bodyHTML + '</div></div>';
  }

  function suggestions() {
    var rows;
    if (m.suggestions.length) {
      rows = '<div style="display:flex;flex-direction:column;gap:10px;margin-top:20px">' + m.suggestions.map(function (s) {
        var count = s.count === 1 ? 'once' : ((s.count || 1) + ' times');
        return '<div style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);padding:14px 16px"><span style="font-size:22px">🙋</span>' +
          '<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:800;color:var(--slate-900)">' + esc(s.name) + '</div><div style="font-size:12px;color:var(--slate-500)">Asked for ' + count + (s.last ? ' · last ' + esc(s.last) : '') + '</div></div>' +
          '<button data-act="dismiss" data-arg="' + escA(s.name) + '" style="padding:8px 13px;border:1.5px solid var(--sage-200);border-radius:var(--radius-md);background:#fff;color:var(--slate-500);font-size:12.5px;font-weight:700;cursor:pointer">Dismiss</button>' +
          '<button data-act="approve" data-arg="' + escA(s.name) + '" style="padding:8px 15px;border:none;border-radius:var(--radius-md);background:var(--sage-500);color:#fff;font-size:12.5px;font-weight:800;cursor:pointer">Add to roster →</button></div>';
      }).join('') + '</div>';
    } else {
      rows = '<div style="background:#fff;border:1px dashed var(--sage-300);border-radius:var(--radius-lg);padding:34px;text-align:center;margin-top:20px"><div style="font-size:28px">📭</div><div style="font-size:14px;font-weight:800;color:var(--slate-900);margin-top:6px">No open suggestions</div><div style="font-size:13px;color:var(--slate-500);margin-top:3px">You’re all caught up.</div></div>';
    }
    return '<div class="fpm-scroll" style="flex:1;min-height:0;overflow-y:auto;padding:24px 26px 40px"><div style="max-width:620px;margin:0 auto;animation:fpm-in .25s ease-out">' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500)">From the game search box</div>' +
      '<h1 style="font-size:24px;font-weight:800;color:var(--slate-900);letter-spacing:-.3px;margin-top:3px">People staff wanted</h1>' +
      '<p style="font-size:13.5px;color:var(--slate-600);line-height:1.5;margin-top:6px">When a search finds no match, staff can suggest a name. Requests land here (deduped, with a count). Add one to the roster as a draft, then draft facts on the Prompts tab.</p>' +
      rows + '</div></div>';
  }

  function saveBar() {
    var show = m.tab === 'prompts' && (cur().facts || []).length > 0;
    return '<div style="flex:0 0 auto;display:' + (show ? 'flex' : 'none') + ';align-items:center;gap:12px;padding:11px 22px;background:#fff;border-top:1px solid var(--sage-200);box-shadow:0 -4px 16px rgba(17,24,39,.05)">' +
      '<span id="fpm-flash" style="font-size:12.5px;font-weight:700;color:var(--sage-700)"></span>' +
      '<div style="display:flex;gap:10px;margin-left:auto"><button data-act="revert" style="padding:9px 15px;border:1.5px solid var(--sage-200);border-radius:var(--radius-md);background:#fff;color:var(--slate-500);font-size:13px;font-weight:700;cursor:pointer">Revert</button>' +
      '<button data-act="save" style="padding:9px 18px;border:none;border-radius:var(--radius-md);background:var(--sage-500);color:#fff;font-size:13px;font-weight:800;cursor:pointer">Save changes</button></div></div>';
  }

  function render() {
    if (!m.loaded) { root.innerHTML = ''; return; }
    var mid = m.tab === 'prompts'
      ? '<div style="flex:1;min-height:0;display:flex">' + personList() + editor() + '</div>'
      : suggestions();
    root.innerHTML = bar() + tabs() + mid + saveBar();
    // imperative inputs
    var filt = document.getElementById('fpm-filter');
    if (filt) { filt.addEventListener('input', function () { m.filter = filt.value; var host = document.getElementById('fpm-person-rows'); if (host) host.innerHTML = personListRowsOnly(); }); if (document.activeElement !== filt && m.filter) { filt.focus(); var v = filt.value; filt.value = ''; filt.value = v; } }
    root.querySelectorAll('textarea[data-fi]').forEach(function (ta) {
      ta.addEventListener('input', function () { editField(+ta.getAttribute('data-fi'), ta.getAttribute('data-key'), ta.value); });
    });
  }
  // filter results only (keeps focus while typing in the filter box)
  function personListRowsOnly() {
    var f = m.filter.trim().toLowerCase();
    var rows = m.people.map(function (p, i) {
      if (f && p.name.toLowerCase().indexOf(f) < 0) return '';
      var active = i === m.pIdx, done = p.converted === true, img = imgSrc(p);
      var imgTag = img ? '<img src="' + escA(img) + '" alt="" referrerpolicy="no-referrer" data-imgerr style="width:34px;height:34px;border-radius:8px;object-fit:cover;object-position:center 30%;flex:0 0 auto;background:var(--slate-100)" />' : '<span style="width:34px;height:34px;border-radius:8px;flex:0 0 auto;background:var(--slate-100);display:flex;align-items:center;justify-content:center;font-size:16px">' + (p.emoji || '⭐') + '</span>';
      return '<button data-act="selectPerson" data-arg="' + i + '" style="display:flex;align-items:center;gap:10px;width:100%;padding:8px;border:1px solid ' + (active ? 'var(--sage-500)' : 'transparent') + ';background:' + (active ? '#fff' : 'transparent') + ';border-radius:var(--radius-md);cursor:pointer;margin-bottom:2px;box-shadow:' + (active ? 'var(--shadow-sm)' : 'none') + '">' + imgTag +
        '<span style="flex:1;min-width:0;text-align:left"><span style="display:block;font-size:13px;font-weight:800;color:var(--slate-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name) + '</span><span style="display:block;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--slate-400)">' + esc(p.tag) + '</span></span>' +
        '<span title="' + (done ? 'Live in game' : 'Pending - needs facts') + '" style="width:9px;height:9px;border-radius:999px;flex:0 0 auto;background:' + (done ? 'var(--sage-400)' : 'var(--amber-300)') + '"></span></button>';
    }).join('');
    return rows || '<div style="padding:14px;font-size:12.5px;color:var(--slate-400)">No match.</div>';
  }

  var ACTIONS = {
    tabPrompts: function () { setTab('prompts'); }, tabSuggest: function () { setTab('suggestions'); },
    selectPerson: function (a) { selectPerson(+a); },
    regen: regen, save: save, revert: revert,
    approve: function (a) { approve(a); }, dismiss: function (a) { dismissSuggest(a); }
  };
  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t || !root.contains(t)) return;
    var fn = ACTIONS[t.getAttribute('data-act')]; if (fn) { e.preventDefault(); fn(t.getAttribute('data-arg')); }
  });
  root.addEventListener('error', function (e) { var el = e.target; if (el && el.hasAttribute && el.hasAttribute('data-imgerr')) el.style.visibility = 'hidden'; }, true);
})();
