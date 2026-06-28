---
name: no-outcome-aba-design
description: Use this skill to generate well-branded interfaces and assets for No Outcome ABA (the SAssi ABA scheduling product), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Where things live
- `styles.css` — the single global stylesheet to link. It `@import`s everything below.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `fonts.css` (CSS custom properties + `@font-face`/webfont imports).
- `guidelines/` — foundation specimen cards (colour, type, spacing, brand).
- `components/core/` — React primitives: `Button`, `IconButton`, `SegmentedControl`, `StatusPill`, `Badge`, `Card`, `MetaChip`, `Input`, `ProgressMeter`, `Avatar`, `Toggle`. Each has a `.prompt.md` with usage.
- `ui_kits/scheduler/` — interactive recreation of the SAssi app (calendar, compliance, Wish It).
- `assets/` — wordmark placeholder.
- `readme.md` — the full design guide: content voice, visual foundations, iconography, brand, caveats.

## Non-negotiables for this brand
- **Terminology is regulated.** Always say "Supervising Behavior Analyst" (never "BCBA") and "Credentialed BT" (never "RBT") in user-facing copy. Keep summaries objective/measurable — never diagnostic or prescriptive.
- **Traffic-light status** (green met → amber on-pace → red behind) is the core status model.
- **Appointment-type colours** are load-bearing (`--type-direct` violet, `--type-supervision` green, etc.).
- **Calm, low-arousal motion** — short fades/slides, no bounce, no looping animation; respect `prefers-reduced-motion`.
- **Iconography is functional emoji** in the source (📅🔧✨🔒…). A Lucide swap is *proposed*, not applied — confirm before using it.
- **Tone:** plain, calm, sentence case; addresses a capable professional; no hype.

## Caveats
No real logo or brand font was supplied — the wordmark is typeset in **Atkinson Hyperlegible** (a deliberate accessibility-first choice; the shipped app uses the OS system sans). Flag these substitutions if the user wants something different.
