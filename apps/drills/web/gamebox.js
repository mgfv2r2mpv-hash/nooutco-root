/* One mini game at a time (AUDIT G3-G6). Each game box carries its own shut
 * as box.shut, which stops its timers and removes it without handing focus
 * back; closeGames runs it for every game in host. A game opening, Home and
 * a new round all go through here, so no box comes back stale and no timer
 * runs on a detached node.
 */
export function closeGames(host) {
  for (const box of [...(host ? host.querySelectorAll("[data-minigame]") : [])]) {
    if (typeof box.shut === "function") box.shut();
    else box.remove();
  }
}

/* A typed run finishes only on the right words with a clock that started
 * (AUDIT G7, G12). typed is the input split at spaces, words the line to
 * type, started whether a key started the clock. Returns null when the run
 * may finish, or the line to show him instead; nothing is saved meanwhile,
 * so twenty quick spaces never earn a trophy.
 */
export function unfinishedLine(typed, words, started) {
  const wrong = words.filter((w, i) => typed[i] !== w).length;
  if (wrong) return `${wrong} word${wrong === 1 ? " does" : "s do"} not match. Fix ${wrong === 1 ? "it" : "them"} to finish.`;
  if (!started) return "The clock did not start: no key was typed. Clear the line and type it.";
  return null;
}
