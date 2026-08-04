# `shared/stimuli/uploads/`

Stimulus art added through AdminTools, laid out as `<category>/<filename>` - for example `T_household_items/table.jpg`.

This is a **source** directory, not a generated one. `shared/stimuli/build.mjs`
ranks it above all three `_Resources` trees and re-emits its files into
`shared/stimuli/img/`, which is what the games actually serve. `img/` is wiped
and rewritten on every rebuild, so an uploaded image that lived only there
would disappear the next time anyone ran `npm run stimuli:build`. Keeping the
original here is what makes the rebuild reproducible.

An upload is authoritative for its stimulus: it supersedes every other art
candidate for that name rather than joining them as an unpublished variant. A
technician who uploads a photo of a bear has chosen the bear picture, and only
one URL per stimulus is ever published anyway.

The file name sets the stimulus: `T_foods/orange.jpg` is `foods-orange`.
Separator and case differences fold together, so `mail_carrier.jpg` and
`mail-carrier.jpg` name the same stimulus rather than forking a near-duplicate.

Related technician state, also read by the rebuild:

| File | Holds |
|---|---|
| `uploads/` | which art exists |
| `labels.json` | what a stimulus is called |
| `publishing.json` | which game runs it |
