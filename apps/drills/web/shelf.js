/* The shelf: passages he was not ready to answer.
 *
 * His ask of 2026-09-23: after the copy round he reads the passage and either
 * responds or shelves it, and a shelved one "brings the skipped one back to
 * me later on with the text changed for the transcription part, so I get the
 * same idea but practice typing something new".
 *
 * An entry comes back after SHELF_ROUNDS more copy rounds, or on a later day,
 * whichever is first. It comes back as the next text he has not just typed:
 * the original and its authored variants (variants.js) take turns. A baton
 * passage is the expert's own reply and has no variant, so it comes back as
 * it was. The shelf lives in settings.shelf and holds ids, counts and dates;
 * a baton entry also holds the expert's passage, never anything he typed.
 */
import { passageById } from "./passages.js";
import { textsFor } from "./variants.js";
import { dayOf } from "./panel.js";

export const SHELF_ROUNDS = 3;

/** Copy rounds in the history: the shelf's clock. */
export const copyRounds = (history) => (history || []).filter((h) => h && h.mode === "copy").length;

/** A new shelf with `passage` on it (replacing any older entry for the same id). */
export function shelve(shelf, passage, { at, round }) {
  const rest = (shelf || []).filter((e) => e && e.id !== passage.id);
  const entry = { id: passage.id, at, round, shown: passage.variant || 0 };
  if (passage.kind === "baton") {
    const { title, text, respond, sources, source, outline } = passage;
    entry.baton = { title, text, respond, sources: sources || [], source, outline };
  }
  return [...rest, entry];
}

/** A new shelf without `id`. */
export const unshelve = (shelf, id) => (shelf || []).filter((e) => e && e.id !== id);

/** Is this entry ready to come back? Three more copy rounds, or a new day. */
export function isDue(entry, { round, today }) {
  if (!entry) return false;
  if (round - (Number(entry.round) || 0) >= SHELF_ROUNDS) return true;
  const day = dayOf(entry.at);
  return !!day && !!today && day < today;
}

/** The oldest due entry, or null. */
export function dueEntry(shelf, now) {
  return (shelf || []).find((e) => isDue(e, now)) || null;
}

/**
 * The passage an entry comes back as: the same idea, the next text in turn.
 * Returns null when the passage no longer exists (a retired id).
 */
export function returned(entry) {
  if (!entry) return null;
  if (entry.baton) return { id: entry.id, kind: "baton", ...entry.baton, variant: 0, fromShelf: true };
  const p = passageById(entry.id);
  if (!p) return null;
  const texts = textsFor(p);
  const variant = texts.length > 1 ? ((Number(entry.shown) || 0) + 1) % texts.length : 0;
  return { ...p, text: texts[variant], variant, fromShelf: true };
}

/** Plain words for the board: title, and when it comes back. */
export function describeShelf(shelf, now) {
  return (shelf || []).map((e) => {
    const p = e.baton || passageById(e.id);
    const title = p ? p.title : e.id;
    const left = Math.max(0, SHELF_ROUNDS - (now.round - (Number(e.round) || 0)));
    const when = isDue(e, now) ? "ready now" : `back in ${left} copy round${left === 1 ? "" : "s"}, or tomorrow`;
    return { id: e.id, title, when, due: isDue(e, now) };
  });
}
