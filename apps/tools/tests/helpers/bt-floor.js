/* Filler that lifts a short test fixture over the BT intake's word floor.
 *
 * The page refuses Generate until each box holds its minimum (8 / 26 / 13 / 18,
 * 65 in all - see notes/bcba/min-words.js). Most specs are about something else
 * and fill the boxes with a few words, so each appends the matching pad here
 * rather than the page growing a way around its own floor.
 *
 * The pads are plain session talk with no counts, no behaviour words and no
 * claims, so they cannot change what a spec asserts about the note. Each is
 * comfortably longer than its box's minimum, so a fixture of a few words still
 * clears it. The text starts with a space: it is appended to an existing fixture.
 */

export const FLOOR_PAD = {
  session: 'Client arrived calm and ready, said hello at the door, and walked in with staff to start the session.',
  lesson: ' while the BT ran the program at the table in the usual order, with the materials set out ahead of time, and kept the pace steady through the whole teaching block.',
  antecedent: ' and the BT kept the schedule visible on the table for the whole session.',
  behavior: ' while staff stayed close, kept each demand short, and checked in with him after every one.',
};

/* The Session Start box, which the older fixtures never filled because it was
 * not required before the floor. */
export async function fillSession(page) {
  await page.getByRole('textbox', { name: /Session Start/i }).fill(FLOOR_PAD.session);
}
