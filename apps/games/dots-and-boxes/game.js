/* ── Dots & Boxes ──────────────────────────────────────────────────────
   Pass-and-play turn-taking game. Two players share one device. On a turn a
   player draws one line between two adjacent dots; closing the 4th side of a
   box claims it (their number, in their color) and grants another turn — a
   line that closes no box passes the turn. When every box is claimed the game
   is over. A two-stage input (preview, then confirm) makes each move
   deliberate; a repeatable "Backup" button undoes the last line.

   Vanilla static HTML/CSS/JS — no build step. Board is a single inline SVG
   built once per game; moves/undo mutate only the touched nodes.
   --------------------------------------------------------------------- */
'use strict';

// ── Geometry (viewBox units) ───────────────────────────────────────────
const GAP = 100;   // spacing between dots
const PAD = 40;    // margin around the dot grid
const SVGNS = 'http://www.w3.org/2000/svg';

// ── Players (2, fixed). Colors resolve from design tokens; hex fallbacks
//    keep SVG strokes correct if the CSS var is unavailable. ────────────
const PALETTE = [
  { num: 1, name: 'Player 1', colorVar: '--blue-500',   fallback: '#3b82f6' },
  { num: 2, name: 'Player 2', colorVar: '--orange-600', fallback: '#ea580c' },
];

const MIN_SIZE = 2;
const MAX_SIZE = 8;
const DEFAULT_SIZE = 3;

// ── DOM ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  selRows:    $('sel-rows'),
  selCols:    $('sel-cols'),
  btnPlay:    $('btn-play'),
  intro:      $('game-intro'),
  gameArea:   $('game-area'),
  turn:       $('turn-indicator'),
  scoreboard: $('scoreboard'),
  progress:   $('progress-label'),
  boardWrap:  document.querySelector('.db-board-wrap'),
  board:      $('db-board'),
  btnUndo:    $('btn-undo'),
  btnNewgame: $('btn-newgame'),
  btnCancel:  $('btn-cancel-preview'),
};

// Per-game SVG node lookups (rebuilt each game) + the reusable ghost line.
let nodes = { vis: {}, hit: {}, boxFill: {}, boxNum: {}, ghost: null };

// ── Model ──────────────────────────────────────────────────────────────
let M = freshModel(DEFAULT_SIZE, DEFAULT_SIZE);

function freshModel(rows, cols) {
  return {
    rows, cols,
    totalBoxes: rows * cols,
    players: PALETTE.map((p) => ({ ...p, score: 0, color: resolveColor(p.colorVar, p.fallback) })),
    current: 0,
    hEdges: grid(rows + 1, cols, -1),      // hEdges[r][c] : r∈0..rows,   c∈0..cols-1
    vEdges: grid(rows, cols + 1, -1),      // vEdges[r][c] : r∈0..rows-1, c∈0..cols
    boxes:  grid(rows, cols, -1),          // boxes[r][c]  : owner playerIdx | -1
    filledBoxes: 0,
    history: [],                           // { orient, r, c, player, claimed:[{r,c}] }
    preview: null,                         // { orient, r, c } | null
    finished: false,
  };
}

function grid(rows, cols, fill) {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function resolveColor(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}

// ── Edge helpers ───────────────────────────────────────────────────────
const key = (orient, r, c) => orient + ':' + r + ':' + c;

function getEdge(orient, r, c) {
  return orient === 'h' ? M.hEdges[r][c] : M.vEdges[r][c];
}
function setEdge(orient, r, c, val) {
  if (orient === 'h') M.hEdges[r][c] = val; else M.vEdges[r][c] = val;
}

// The 1 or 2 in-range boxes a new edge can complete.
function adjacentBoxes(orient, r, c) {
  const out = [];
  if (orient === 'h') {
    if (r - 1 >= 0)     out.push({ r: r - 1, c });
    if (r < M.rows)     out.push({ r, c });
  } else {
    if (c - 1 >= 0)     out.push({ r, c: c - 1 });
    if (c < M.cols)     out.push({ r, c });
  }
  return out;
}

function isBoxComplete(r, c) {
  return M.hEdges[r][c] !== -1 && M.hEdges[r + 1][c] !== -1 &&
         M.vEdges[r][c] !== -1 && M.vEdges[r][c + 1] !== -1;
}

function edgeCoords(orient, r, c) {
  const x = PAD + c * GAP, y = PAD + r * GAP;
  return orient === 'h'
    ? { x1: x, y1: y, x2: x + GAP, y2: y }
    : { x1: x, y1: y, x2: x, y2: y + GAP };
}

// Tap-zone rectangle straddling an edge (viewBox units). A rect — not a line —
// guarantees a real bounding box, so taps land reliably on touch and
// programmatic clicks work in tests. HIT_BAND (40) < GAP (100), so parallel
// edges never overlap; it scales with the board, so no per-size tuning.
const HIT_BAND = 40;
function edgeHitRect(orient, r, c) {
  const x = PAD + c * GAP, y = PAD + r * GAP;
  return orient === 'h'
    ? { x, y: y - HIT_BAND / 2, width: GAP, height: HIT_BAND }
    : { x: x - HIT_BAND / 2, y, width: HIT_BAND, height: GAP };
}

function eachEdge(cb) {
  for (let r = 0; r <= M.rows; r++)
    for (let c = 0; c < M.cols; c++) { const p = edgeCoords('h', r, c); cb('h', r, c, p); }
  for (let r = 0; r < M.rows; r++)
    for (let c = 0; c <= M.cols; c++) { const p = edgeCoords('v', r, c); cb('v', r, c, p); }
}

// ── SVG build ──────────────────────────────────────────────────────────
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVGNS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function buildBoard() {
  const svg = el.board;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const W = PAD * 2 + M.cols * GAP;
  const H = PAD * 2 + M.rows * GAP;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (el.boardWrap) el.boardWrap.style.setProperty('--board-aspect', `${W} / ${H}`);

  nodes = { vis: {}, hit: {}, boxFill: {}, boxNum: {}, ghost: null };

  // 1. Backdrop — tapping it clears a pending preview.
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H, class: 'db-backdrop', fill: 'transparent' }));

  // 2 + 3. Box fills and centered number labels.
  for (let r = 0; r < M.rows; r++) {
    for (let c = 0; c < M.cols; c++) {
      const x = PAD + c * GAP, y = PAD + r * GAP;
      const rect = svgEl('rect', { x, y, width: GAP, height: GAP, rx: 6, class: 'db-box', 'data-r': r, 'data-c': c });
      svg.appendChild(rect);
      nodes.boxFill[r + ':' + c] = rect;
      const t = svgEl('text', {
        x: x + GAP / 2, y: y + GAP / 2, class: 'db-num',
        'text-anchor': 'middle', 'dominant-baseline': 'central', 'data-r': r, 'data-c': c,
      });
      svg.appendChild(t);
      nodes.boxNum[r + ':' + c] = t;
    }
  }

  // 4. Visible edge guides (faint until owned).
  eachEdge((orient, r, c, p) => {
    const ln = svgEl('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, class: 'db-edge', 'data-orient': orient, 'data-r': r, 'data-c': c });
    svg.appendChild(ln);
    nodes.vis[key(orient, r, c)] = ln;
  });

  // 5. Single reusable preview line.
  const ghost = svgEl('line', { id: 'db-ghost', class: 'db-ghost', x1: 0, y1: 0, x2: 0, y2: 0 });
  ghost.style.display = 'none';
  svg.appendChild(ghost);
  nodes.ghost = ghost;

  // 6. Dots.
  for (let r = 0; r <= M.rows; r++)
    for (let c = 0; c <= M.cols; c++)
      svg.appendChild(svgEl('circle', { cx: PAD + c * GAP, cy: PAD + r * GAP, r: 7, class: 'db-dot' }));

  // 7. Transparent hit rectangles on top — the only interactive elements.
  eachEdge((orient, r, c) => {
    const b = edgeHitRect(orient, r, c);
    const hit = svgEl('rect', { x: b.x, y: b.y, width: b.width, height: b.height, class: 'db-hit', fill: 'transparent', 'data-orient': orient, 'data-r': r, 'data-c': c });
    svg.appendChild(hit);
    nodes.hit[key(orient, r, c)] = hit;
  });
}

// ── Input state machine ────────────────────────────────────────────────
const currentColor = () => M.players[M.current].color;
const sameEdge = (a, b) => a && b && a.orient === b.orient && a.r === b.r && a.c === b.c;
const edgeOf = (node) => ({ orient: node.dataset.orient, r: +node.dataset.r, c: +node.dataset.c });

function setPreview(E) {
  M.preview = E;
  const g = nodes.ghost;
  const p = edgeCoords(E.orient, E.r, E.c);
  g.setAttribute('x1', p.x1); g.setAttribute('y1', p.y1);
  g.setAttribute('x2', p.x2); g.setAttribute('y2', p.y2);
  g.style.stroke = currentColor();
  g.style.display = '';
  if (el.btnCancel) el.btnCancel.hidden = false;
}

function cancelPreview() {
  M.preview = null;
  if (nodes.ghost) nodes.ghost.style.display = 'none';
  if (el.btnCancel) el.btnCancel.hidden = true;
}

function commitEdge(E) {
  cancelPreview();
  placeLine(E.orient, E.r, E.c, M.current);
}

function onBoardPointerDown(e) {
  if (M.finished) return;
  const t = e.target;
  const isHit = t.classList && t.classList.contains('db-hit') && !t.classList.contains('filled');
  if (!isHit) {                       // empty space / dot / box / filled edge → clear preview
    if (M.preview) cancelPreview();
    return;
  }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  const E = edgeOf(t);
  if (e.pointerType === 'mouse') {
    commitEdge(E);                    // desktop: hover already previewed → click commits
  } else {                            // touch / pen: first tap previews, second (same edge) commits
    if (sameEdge(M.preview, E)) commitEdge(E);
    else setPreview(E);
  }
}

function onBoardPointerOver(e) {
  if (M.finished || e.pointerType !== 'mouse') return;
  const t = e.target;
  if (t.classList && t.classList.contains('db-hit') && !t.classList.contains('filled')) {
    setPreview(edgeOf(t));
  }
}

function onBoardPointerOut(e) {
  if (e.pointerType !== 'mouse' || !M.preview) return;
  const t = e.target;
  if (!(t.classList && t.classList.contains('db-hit'))) return;
  // Only clear when leaving to somewhere that isn't another hit line (avoids
  // cancel/re-arm churn as the pointer crosses between adjacent edges).
  const rel = e.relatedTarget;
  if (rel && rel.classList && rel.classList.contains('db-hit')) return;
  cancelPreview();
}

// ── Place a line, claim boxes, advance turn ────────────────────────────
function placeLine(orient, r, c, playerIdx) {
  if (getEdge(orient, r, c) !== -1) return;        // already filled — no-op
  setEdge(orient, r, c, playerIdx);

  const color = M.players[playerIdx].color;
  const vis = nodes.vis[key(orient, r, c)];
  vis.style.stroke = color;
  vis.classList.add('owned');
  nodes.hit[key(orient, r, c)].classList.add('filled');

  const claimed = [];
  for (const b of adjacentBoxes(orient, r, c)) {
    if (M.boxes[b.r][b.c] === -1 && isBoxComplete(b.r, b.c)) {
      M.boxes[b.r][b.c] = playerIdx;
      M.filledBoxes++;
      paintBox(b.r, b.c, playerIdx);
      claimed.push(b);
    }
  }
  if (claimed.length) M.players[playerIdx].score += claimed.length;

  M.history.push({ orient, r, c, player: playerIdx, claimed });
  el.btnUndo.disabled = M.history.length === 0;

  if (claimed.length === 0) M.current = (M.current + 1) % M.players.length; // no box → pass
  // else: same player goes again (covers the interior line that closes TWO boxes)

  renderStatus();
  if (M.filledBoxes === M.totalBoxes) finishGame();
}

function paintBox(r, c, playerIdx) {
  const color = M.players[playerIdx].color;
  const rect = nodes.boxFill[r + ':' + c];
  rect.style.fill = color;
  rect.style.fillOpacity = '0.16';
  const t = nodes.boxNum[r + ':' + c];
  t.textContent = String(M.players[playerIdx].num);
  t.style.fill = color;
}

function clearBox(r, c) {
  const rect = nodes.boxFill[r + ':' + c];
  rect.style.fill = '';
  rect.style.fillOpacity = '';
  const t = nodes.boxNum[r + ':' + c];
  t.textContent = '';
  t.style.fill = '';
}

// ── Undo — repeatable, one line per press ──────────────────────────────
function undoOneMove() {
  const mv = M.history.pop();
  if (!mv) return false;

  for (const b of mv.claimed) {          // un-claim (handles the two-box move)
    M.boxes[b.r][b.c] = -1;
    M.filledBoxes--;
    clearBox(b.r, b.c);
  }
  M.players[mv.player].score -= mv.claimed.length;

  setEdge(mv.orient, mv.r, mv.c, -1);
  const vis = nodes.vis[key(mv.orient, mv.r, mv.c)];
  vis.style.stroke = '';                 // back to the faint CSS guide
  vis.classList.remove('owned');
  nodes.hit[key(mv.orient, mv.r, mv.c)].classList.remove('filled');

  M.current = mv.player;                 // whoever placed it is on turn again
  if (M.finished) { M.finished = false; removeDoneCard(); }   // revive without re-celebrating
  cancelPreview();
  el.btnUndo.disabled = M.history.length === 0;
  renderStatus();
  return true;
}

// ── Render: scoreboard, turn, progress ─────────────────────────────────
function renderStatus() {
  renderScoreboard();
  renderTurn();
  renderProgress();
}

function renderScoreboard() {
  el.scoreboard.innerHTML = '';
  M.players.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = 'player-chip' + (i === M.current && !M.finished ? ' is-turn' : '');
    chip.setAttribute('role', 'listitem');
    chip.style.setProperty('--pc', p.color);
    chip.innerHTML =
      '<span class="pc-badge">' + p.num + '</span>' +
      '<span class="pc-name">' + p.name + '</span>' +
      '<span class="pc-score">' + p.score + '</span>';
    el.scoreboard.appendChild(chip);
  });
}

function renderTurn() {
  if (M.finished) {
    el.turn.textContent = '🏁 Game over';
    el.turn.style.setProperty('--turn-color', 'var(--text-muted)');
    return;
  }
  const p = M.players[M.current];
  el.turn.textContent = p.name + "'s turn";
  el.turn.style.setProperty('--turn-color', p.color);
}

function renderProgress() {
  el.progress.textContent = M.filledBoxes + ' / ' + M.totalBoxes + ' boxes';
}

// ── Finish ─────────────────────────────────────────────────────────────
function finishGame() {
  M.finished = true;
  cancelPreview();
  const max = Math.max.apply(null, M.players.map((p) => p.score));
  const winners = M.players.filter((p) => p.score === max);
  const headline = winners.length === 1
    ? winners[0].name + ' wins!'
    : "It's a tie!";
  renderScoreboard();
  renderTurn();
  showDoneCard(headline);
}

function showDoneCard(headline) {
  removeDoneCard();
  const scores = M.players.map((p) => p.name + ': ' + p.score).join('  ·  ');
  const card = document.createElement('div');
  card.id = 'done-card';
  card.innerHTML =
    '<div class="done-emoji">🎉</div>' +
    '<h2>' + headline + '</h2>' +
    '<p class="done-scores">' + scores + '</p>' +
    '<button type="button" id="btn-again" class="btn-primary">Play again</button>';
  el.gameArea.appendChild(card);
  const again = $('btn-again');
  if (again) again.addEventListener('click', newGame);
  if (window.NooutcoReward && typeof window.NooutcoReward.celebrate === 'function') {
    window.NooutcoReward.celebrate(card);
  }
}

function removeDoneCard() {
  const d = $('done-card');
  if (d) d.remove();
}

// ── New game ───────────────────────────────────────────────────────────
function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function newGame() {
  const rows = clampInt(el.selRows.value, MIN_SIZE, MAX_SIZE, DEFAULT_SIZE);
  const cols = clampInt(el.selCols.value, MIN_SIZE, MAX_SIZE, DEFAULT_SIZE);
  M = freshModel(rows, cols);
  buildBoard();
  removeDoneCard();
  el.intro.hidden = true;
  el.gameArea.hidden = false;
  el.btnUndo.disabled = true;
  renderStatus();
}

// ── Wiring ─────────────────────────────────────────────────────────────
function populateSizeSelect(sel) {
  const opts = [];
  for (let n = MIN_SIZE; n <= MAX_SIZE; n++) {
    opts.push('<option value="' + n + '"' + (n === DEFAULT_SIZE ? ' selected' : '') + '>' + n + '</option>');
  }
  sel.innerHTML = opts.join('');
}

function init() {
  populateSizeSelect(el.selRows);
  populateSizeSelect(el.selCols);

  el.btnPlay.addEventListener('click', newGame);
  el.btnNewgame.addEventListener('click', newGame);
  el.btnUndo.addEventListener('click', undoOneMove);
  if (el.btnCancel) el.btnCancel.addEventListener('click', cancelPreview);

  // Delegated pointer handling on the board.
  el.board.addEventListener('pointerdown', onBoardPointerDown);
  el.board.addEventListener('pointerover', onBoardPointerOver);
  el.board.addEventListener('pointerout', onBoardPointerOut);

  window.addEventListener('blur', cancelPreview);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
