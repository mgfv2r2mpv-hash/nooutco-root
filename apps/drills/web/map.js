/* The knowledge map: how much has been said under each BACB outline item.
 *
 * His ruling, 2026-09-22: "a chart with clinical topics to visually represent
 * the density of its knowledge ... start from the BACB task list ... it will
 * learn and get increasingly curious and self-refining from there."
 *
 * Density per item is a count of kept drill answers filed under it (from the
 * drill history) plus expert records mapped to it (handed in by the caller;
 * the Mac app fetches them, the browser page has none). Curiosity is a rule:
 * the next question comes from the emptiest cell that has a question in the
 * bank and was not asked in the last five drills.
 *
 * Pure. No DOM: render() returns a description the page turns into elements,
 * so the counting can be tested without a browser.
 */
import { OUTLINE, ITEMS } from "./outline.js";

/**
 * @param {Array<{itemId?: string, outline?: string}>} history  kept drills
 * @param {Record<string, number>} [expert]  outline id -> expert record count
 * @returns {{ cells: Record<string, {mine: number, expert: number, total: number}>, max: number, domains: Array<{letter, name, questions, share, mine, expert, items: string[]}> }}
 */
export function density(history, expert) {
  const cells = {};
  for (const it of ITEMS) cells[it.id] = { mine: 0, expert: 0, total: 0 };
  for (const h of history || []) {
    const id = h && h.outline;
    if (id && cells[id]) cells[id].mine += 1;
  }
  for (const [id, n] of Object.entries(expert || {})) {
    if (cells[id] && Number.isFinite(n) && n > 0) cells[id].expert += n;
  }
  let max = 0;
  for (const c of Object.values(cells)) { c.total = c.mine + c.expert; if (c.total > max) max = c.total; }
  const domains = OUTLINE.map((d) => ({
    letter: d.letter, name: d.name, questions: d.questions, share: d.share,
    mine: d.items.reduce((s, it) => s + cells[it.id].mine, 0),
    expert: d.items.reduce((s, it) => s + cells[it.id].expert, 0),
    items: d.items.map((it) => it.id),
  }));
  return { cells, max, domains };
}

/**
 * The emptiest outline item that the bank can ask about. Ties break toward
 * the domain the exam weights most, then by outline order, so the walk is the
 * same one every time and not a coin toss.
 *
 * @param {object} args
 * @param {Array} args.bank            items carrying `outline`
 * @param {Array} args.history         kept drills carrying `outline` and `itemId`
 * @param {Record<string, number>} [args.expert]
 * @param {number} [args.recent=5]     drills whose outline items are skipped
 * @returns {string|null} an outline id, or null when the bank has none
 */
export function emptiestCell({ bank, history, expert, recent = 5 } = {}) {
  const askable = new Set((bank || []).map((b) => b.outline).filter(Boolean));
  if (!askable.size) return null;
  // recent = 0 means skip nothing; slice(-0) would mean skip everything.
  const lately = recent > 0 ? (history || []).slice(-recent) : [];
  const skip = new Set(lately.map((h) => h && h.outline).filter(Boolean));
  const { cells } = density(history, expert);
  const share = Object.fromEntries(OUTLINE.map((d) => [d.letter, d.share || 0]));
  let pool = ITEMS.filter((it) => askable.has(it.id) && !skip.has(it.id));
  if (!pool.length) pool = ITEMS.filter((it) => askable.has(it.id));
  pool.sort((a, b) => cells[a.id].total - cells[b.id].total || share[b.domain] - share[a.domain] || ITEMS.indexOf(a) - ITEMS.indexOf(b));
  return pool[0].id;
}

/**
 * What the page draws: one column per domain, one cell per item, a shade in
 * 0..1 against the fullest cell, and whether the bank can ask there yet.
 */
export function render(history, expert, bank) {
  const { cells, max, domains } = density(history, expert);
  const askable = new Set((bank || []).map((b) => b.outline).filter(Boolean));
  return domains.map((d) => ({
    ...d,
    cells: d.items.map((id) => ({
      id, ...cells[id],
      shade: max > 0 ? cells[id].total / max : 0,
      askable: askable.has(id),
      text: (ITEMS.find((it) => it.id === id) || {}).text || "",
    })),
  }));
}
