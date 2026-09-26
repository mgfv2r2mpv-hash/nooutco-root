/* The copy round: typing a passage word for word.
 *
 * Scoring lines the typed words up with the passage by longest common
 * subsequence, so a skipped or doubled word costs one error, not every word
 * after it. Words must match exactly, case and punctuation included, as in a
 * standard typing test. The live marks are simpler (word i against word i),
 * because they only have to tell him where he is.
 */

const words = (s) => String(s || "").split(/\s+/).filter(Boolean);

/**
 * Errors in a copy: typed words that are not part of the best alignment with
 * the reference, plus reference words skipped between aligned ones.
 * Reference words after the last typed word are not errors: the clock ran out.
 * @returns {{ typed: number, matched: number, errors: number, done: boolean }}
 */
export function copyErrors(text, reference) {
  const a = words(text), b = words(reference);
  const n = a.length;
  if (!n) return { typed: 0, matched: 0, errors: 0, done: false };
  // Only the part of the reference he could have reached: a little past his word count.
  const m = Math.min(b.length, n + 10);
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  // Walk the alignment; count skipped reference words only BETWEEN matches.
  let i = 0, j = 0, matched = 0, skipped = 0, pendingSkip = 0, extra = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { matched += 1; skipped += pendingSkip; pendingSkip = 0; i += 1; j += 1; }
    else if (L[i + 1][j] >= L[i][j + 1]) { extra += 1; i += 1; }
    else { pendingSkip += 1; j += 1; }
  }
  extra += n - i;
  // A wrong word typed in place of a right one is one error, not an extra plus a skip.
  const errors = Math.max(extra, skipped);
  return { typed: n, matched, errors, done: matched > 0 && b.length > 0 && a[n - 1] === b[b.length - 1] && n >= b.length };
}

/** Live marks: for each passage word, "ok", "bad", "cur" (the word being typed, "cur bad" if off) or "". */
export function liveMarks(text, reference) {
  const ref = words(reference);
  const raw = String(text || "");
  const typed = words(raw);
  const midWord = raw.length > 0 && !/\s$/.test(raw);
  const doneCount = midWord ? typed.length - 1 : typed.length;
  return ref.map((w, i) => {
    if (i < doneCount) return typed[i] === w ? "ok" : "bad";
    if (i === doneCount) return midWord && !w.startsWith(typed[typed.length - 1]) ? "cur bad" : "cur";
    return "";
  });
}

/** Draw the passage as one span per word, his weak-key letters faintly marked. */
export function renderPassage(root, reference, weak = []) {
  const set = new Set(weak);
  root.replaceChildren(...words(reference).flatMap((w, i) => {
    const s = document.createElement("span");
    s.className = "pw";
    s.dataset.i = String(i);
    if (!set.size) s.textContent = w;
    else {
      let run = "";
      for (const ch of w) {
        if (set.has(ch.toLowerCase())) {
          if (run) { s.appendChild(document.createTextNode(run)); run = ""; }
          const u = document.createElement("u"); u.className = "wk"; u.textContent = ch;
          s.appendChild(u);
        } else run += ch;
      }
      if (run) s.appendChild(document.createTextNode(run));
    }
    return [s, document.createTextNode(" ")];
  }));
}

/** Apply live marks, and keep the current word in view inside the passage box. */
export function markPassage(root, text, reference) {
  const marks = liveMarks(text, reference);
  const spans = root.querySelectorAll(".pw");
  let cur = null;
  marks.forEach((m, i) => {
    const s = spans[i];
    if (!s) return;
    const cls = "pw" + (m ? " " + m.split(" ").map((x) => "is-" + x).join(" ") : "");
    if (s.className !== cls) s.className = cls;
    if (m.startsWith("cur")) cur = s;
  });
  if (cur) {
    // Measured against the box itself: offsetTop counts from the nearest
    // positioned ancestor, which is not the passage box, so the old sum ran
    // a line or more behind and the current word slid out of sight.
    const top = cur.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    const line = cur.offsetHeight || 30;
    if (top + line > root.scrollTop + root.clientHeight - line || top < root.scrollTop) root.scrollTop = Math.max(0, top - line);
  }
  return marks;
}
