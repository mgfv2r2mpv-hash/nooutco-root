/* The calendar and the trophy case: drawing only. The numbers come from
 * trophies.js, which the node tests read.
 *
 * Calendar: each day with a drill shows the day's average NWAM (big) and GWAM
 * (small), a badge with how many drills, and a warm banner runs under every
 * stretch of consecutive days.
 */
import { dayStats, streakRuns, monthGrid, bannersForWeek, trophyCase } from "./trophies.js";
import { dayOf } from "./panel.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Draws into `root`; returns a redraw for a given month offset. */
export function createCalendar(root) {
  let offset = 0; // months back from this one
  let history = [];
  function draw() {
    const now = new Date();
    const today = dayOf(now.toISOString());
    const view = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const stats = dayStats(history);
    const byDay = new Map(stats.map((d) => [d.day, d]));
    const st = streakRuns(stats.map((d) => d.day), today);
    const head = h("div", "cal-head");
    const prev = h("button", "soft cal-nav", "‹"); prev.type = "button"; prev.title = "Earlier month"; prev.dataset.calPrev = "";
    const next = h("button", "soft cal-nav", "›"); next.type = "button"; next.title = "Later month"; next.dataset.calNext = "";
    next.disabled = offset === 0;
    prev.addEventListener("click", () => { offset += 1; draw(); });
    next.addEventListener("click", () => { offset = Math.max(0, offset - 1); draw(); });
    head.append(prev, h("b", "cal-month", `${MONTHS[view.getMonth()]} ${view.getFullYear()}`), next);
    const todayCount = byDay.get(today)?.count || 0;
    const sum = h("p", "cal-sum");
    sum.dataset.calSummary = "";
    sum.textContent = [
      st.current ? `${plural(st.current, "day")} in a row${st.alive ? "" : ", alive until midnight"}` : "No streak running",
      `longest ${plural(st.longest, "day")}`,
      `${plural(todayCount, "drill")} today`,
    ].join(" · ");
    const grid = h("div", "cal-grid");
    const wk = h("div", "cal-weekdays");
    for (const d of WEEKDAYS) wk.appendChild(h("span", null, d));
    grid.appendChild(wk);
    for (const week of monthGrid(view.getFullYear(), view.getMonth())) {
      const row = h("div", "cal-week");
      for (const b of bannersForWeek(week, st.runs)) {
        const band = h("i", "cal-banner" + (b.starts ? " starts" : "") + (b.ends ? " ends" : ""));
        band.style.gridColumn = `${b.from + 1} / ${b.to + 2}`;
        band.dataset.calBanner = String(b.days);
        if (b.starts) band.textContent = `${b.days}-day streak`;
        band.title = `${b.days} days in a row`;
        row.appendChild(band);
      }
      week.forEach((c, i) => {
        const d = byDay.get(c.day);
        const cell = h("div", "cal-day" + (c.inMonth ? "" : " is-out") + (c.day === today ? " is-today" : "") + (d ? " has" : ""));
        cell.style.gridColumn = String(i + 1);
        cell.dataset.calDay = c.day;
        cell.appendChild(h("span", "cal-date", String(c.date)));
        if (d) {
          const badge = h("span", "cal-badge", String(d.count));
          badge.dataset.calCount = String(d.count);
          const n = h("b", "cal-nwam", d.nwam.toFixed(0));
          const g = h("span", "cal-gwam", `${d.gwam.toFixed(0)} gross`);
          cell.append(badge, n, g);
          cell.title = `${c.day}: ${plural(d.count, "drill")}. Average ${d.nwam} NWAM, ${d.gwam} GWAM, ${Math.round(d.accuracy * 100)}% accurate. Best ${d.bestNwam} NWAM, ${d.bestGwam} GWAM.`;
        }
        row.appendChild(cell);
      });
      grid.appendChild(row);
    }
    const key = h("p", "basis", "Big number: the day's average net words a minute. Small: gross. The badge counts drills that day. The warm banner runs under days in a row.");
    root.replaceChildren(head, sum, grid, key);
  }
  return {
    render(list) { history = list || []; draw(); },
    today() { offset = 0; draw(); },
  };
}

/**
 * The trophy case, grouped, unlocked first in each group with its date. By
 * default each family shows what is won plus only the NEXT tier to earn; the
 * toggle shows every trophy.
 */
let showAll = false;
export function renderTrophies(root, history) {
  const everything = trophyCase(history);
  const won = everything.filter((t) => t.unlocked).length;
  const nextOf = new Set();
  for (const t of everything) if (!t.unlocked && ![...nextOf].some((id) => everything.find((x) => x.id === id).family === t.family)) nextOf.add(t.id);
  const all = showAll ? everything : everything.filter((t) => t.unlocked || nextOf.has(t.id));
  const top = h("div", "trophy-top");
  const sum = h("p", "trophy-sum", `${won} of ${everything.length} unlocked`);
  sum.dataset.trophySummary = "";
  const toggle = h("button", "soft trophy-toggle", showAll ? "Show won and next" : "Show every trophy");
  toggle.type = "button"; toggle.dataset.trophyToggle = "";
  toggle.addEventListener("click", () => { showAll = !showAll; renderTrophies(root, history); });
  top.append(sum, toggle);
  const groups = [...new Set(all.map((t) => t.group))];
  const out = [top];
  for (const g of groups) {
    const sec = h("section", "trophy-group");
    sec.appendChild(h("h3", null, g));
    const ul = h("ul", "trophies");
    const mine = all.filter((t) => t.group === g);
    // Unlocked first, newest last; then locked, nearest to done first.
    mine.sort((a, b) => (!!b.unlocked - !!a.unlocked)
      || (a.unlocked && b.unlocked ? a.unlocked.localeCompare(b.unlocked) : b.have / b.need - a.have / a.need));
    for (const t of mine) {
      const li = h("li", "trophy" + (t.unlocked ? " is-won" : ""));
      li.dataset.trophy = t.id;
      if (!t.unlocked && nextOf.has(t.id)) li.classList.add("is-next");
      li.appendChild(cup(!!t.unlocked));
      const body = h("div", "trophy-body");
      body.appendChild(h("b", null, t.name));
      body.appendChild(h("span", "trophy-cond", t.condition));
      if (t.unlocked) {
        const when = new Date(t.unlocked);
        body.appendChild(h("span", "trophy-date", `Unlocked ${when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`));
      } else {
        const bar = h("span", "trophy-bar");
        bar.style.setProperty("--p", String(Math.min(1, t.have / t.need)));
        body.appendChild(bar);
        body.appendChild(h("span", "trophy-date", `${fmt(t.have)} of ${fmt(t.need)}`));
      }
      li.appendChild(body);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    out.push(sec);
  }
  root.replaceChildren(...out);
  return { won, total: all.length };
}
const fmt = (n) => Math.floor(n).toLocaleString("en-US");

const NS = "http://www.w3.org/2000/svg";
function cup(won) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 40 40");
  s.setAttribute("class", "cup");
  s.innerHTML = won
    ? '<path class="cup-body" d="M11 7h18v6a9 9 0 0 1-18 0z"/><path class="cup-handle" d="M11 9H6a5 5 0 0 0 6 7M29 9h5a5 5 0 0 1-6 7"/><path class="cup-stem" d="M17 22h6l-1 6h-4z"/><rect class="cup-base" x="12" y="28" width="16" height="5" rx="2"/><path class="cup-shine" d="M15 10v4"/>'
    : '<path class="cup-ghost" d="M11 7h18v6a9 9 0 0 1-18 0zM11 9H6a5 5 0 0 0 6 7M29 9h5a5 5 0 0 1-6 7M17 22h6l-1 6h-4zM12 28h16v5H12z"/>';
  return s;
}
