/* The bands as a road he climbs: the highest band his own numbers have
 * reached, the band a round opens for the first time, and the road the home
 * screen draws. Pure readings of the history; nothing here is written back.
 *
 * A band is worked out again from each record's own NWAM and accuracy, never
 * from the band name stored on it. Records made before the bands above
 * Professional existed all say "Professional", and reading the name would
 * throw a level-up for a band his numbers had already reached.
 */
import { BANDS, rate } from "./score.js";

/** A level-up needs a few rounds behind it, so the first drills never throw one. */
export const LEVEL_UP_MIN_ROUNDS = 3;

const indexOf = (name) => BANDS.findIndex((b) => b.name === name);

/** The band a record earned, as an index into BANDS (0 is the top), or -1. */
export function bandOf(h) {
  if (!h || !Number.isFinite(h.nwam) || h.nwam <= 0) return -1;
  return indexOf(rate(h.nwam, Number.isFinite(h.accuracy) ? h.accuracy : 1).name);
}

/** The highest band these records reached: an index into BANDS, or -1 for none. */
export function highestBand(history) {
  let top = -1;
  for (const h of history || []) {
    const i = bandOf(h);
    if (i >= 0 && (top < 0 || i < top)) top = i;
  }
  return top;
}

/**
 * The band this round opened, when it is higher than any band the prior
 * rounds of the same kind reached, or null.
 * `rating` is the round's rate() result; `prior` the earlier rounds of its kind.
 */
export function bandUp(rating, prior) {
  const rounds = (prior || []).filter((h) => bandOf(h) >= 0);
  if (!rating || rounds.length < LEVEL_UP_MIN_ROUNDS) return null;
  const now = indexOf(rating.name);
  const before = highestBand(rounds);
  if (now < 0 || before < 0 || now >= before) return null;
  return { band: BANDS[now].name, min: BANDS[now].min, from: BANDS[before].name };
}

/**
 * The road for the home screen, bottom band first: each band reached, next or
 * ahead, and a line that names the next one. Null with no rounds yet.
 */
export function bandRoad(history) {
  const top = highestBand(history);
  if (top < 0) return null;
  const bands = BANDS.map((b, i) => ({ name: b.name, min: b.min, state: i >= top ? "reached" : i === top - 1 ? "next" : "ahead" })).reverse();
  const next = top > 0 ? BANDS[top - 1] : null;
  const line = next
    ? `Highest band so far: ${BANDS[top].name}. Next: ${next.name}, at ${next.min} NWAM.`
    : `Highest band so far: ${BANDS[top].name}, the top of the road.`;
  return { bands, top: BANDS[top].name, next: next ? next.name : null, line };
}
