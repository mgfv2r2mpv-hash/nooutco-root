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
