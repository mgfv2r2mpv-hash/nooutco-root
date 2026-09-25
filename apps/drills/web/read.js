/* Read and consider: the screen after a copy round.
 *
 * His ask of 2026-09-23: he was reading the passage before copying it, to
 * know what he would answer, and that is bad for typing. So the copy round is
 * typed cold, and afterwards the passage comes back on its own screen to READ,
 * with its question and its sources. He responds (Return) or shelves it (S).
 */

/** Split a passage into paragraphs of about `per` sentences, for reading. */
export function paragraphs(text, per = 4) {
  const sentences = String(text || "").match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [];
  const out = [];
  for (let i = 0; i < sentences.length; i += per) out.push(sentences.slice(i, i + per).join("").trim());
  return out.filter(Boolean);
}

/** One line for the top of the screen: how the copy went, briefly. */
export function scoreLine(s) {
  if (!s || s.gwam < 1) return "Nothing typed in that round.";
  return `Copied at ${s.nwam.toFixed(1)} NWAM, ${Math.round(s.accuracy * 100)}% accurate \u00b7 ${s.rating.name}`;
}

/**
 * Fill the read screen. `el` holds the screen's parts (see drill.js els.read*).
 * Returns nothing; the caller shows the section.
 */
export function renderRead(el, passage, score) {
  el.score.textContent = scoreLine(score);
  el.title.textContent = passage.title || "";
  el.source.textContent = passage.source || "";
  el.text.replaceChildren(...paragraphs(passage.text).map((t) => {
    const p = document.createElement("p");
    p.textContent = t;
    return p;
  }));
  const sources = passage.sources || [];
  el.sources.hidden = !sources.length;
  el.sources.replaceChildren(...sources.map((x) => {
    const li = document.createElement("li");
    li.textContent = x.claim;
    const src = document.createElement("span"); src.className = "src"; src.textContent = x.source;
    li.appendChild(src);
    return li;
  }));
  el.question.textContent = passage.respond || "";
}
