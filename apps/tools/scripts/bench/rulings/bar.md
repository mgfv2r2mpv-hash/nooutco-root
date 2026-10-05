# The bar every bench note is held to

Kaleb's goal, 2026-10-04: every tool (BT, Supervision, Parent, Assessment,
SAP) turns a user's 5 to 7 minutes at it, about 100 to 125 typed words plus
the answers to its questions, into a note he would submit. He let these stand
as the bar on 2026-10-04, along with the order below. Each point says which
part of the bench measures it; the last point is his call alone.

1. **Faithful.** Every fact from the intake and the answers is in the note,
   and nothing is added. A fabricated particular is worse than generic prose.
   Measured by `expect.mentions` and `expect.forbid` in each case.
2. **Exact data.** The note keeps counts as written, reads the author's a/b
   notation right, puts the prompt level beside the count, and names every
   goal as written. Measured by the parent checks (`parentExpect`) and
   `expect.noData` for BT, whose data ReThink already pulls in.
3. **Right picks.** Checkboxes and single-selects follow his rulings
   (Technician present by default, a missed caregiver step means the middle
   Caregiver Response, and so on), and the note leaves no single-select blank.
   Measured by `picks`, `notPicks`, `single` and `singlesNeverBlank`.
4. **Payer-ready.** The note carries what was observed, attempted and
   resulted, progress against recent sessions, and the detail a data table
   cannot carry. The note rubric (`notes/bcba/note-rubric.js`) reads these.
5. **His register.** A billable note, a little telegraphic, the actor named,
   no em dash, no hollow sentence. The uniformity scorer and the hollow check
   measure this; the bench fails any em dash.
6. **Clean.** The note keeps no opaque token, no name the scrub missed, and
   no question to the author. The bench fails a leftover token and a question
   in a task-only field (`tasksOnly`).
7. **He would sign it with no edits.** The final word. A sample of drafts
   goes to his board each round, and every edit he makes becomes a ruling
   here (as `bt.md` did) or a check in `lib/checks.mjs`.

## Order

Parent first (its rulings were already in hand), then BT, Supervision,
Assessment, SAP. A tool moves on when its cases pass the checks and his sample
needs no edits.
