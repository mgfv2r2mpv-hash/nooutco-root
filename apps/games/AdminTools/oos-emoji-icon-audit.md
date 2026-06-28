# Emoji / Icon Audit — Admin Input OOS Request

Scope: Matching Game, Receptive Words Game, Hickory Dickory Dock (clock)

---

## 1. Token Board Emoji (user-selectable per session)

These appear in a `<select>` dropdown inside the Token Board settings panel. The chosen emoji is repeated on-screen to form the token strip (e.g. ⭐⭐⭐⭐ / 10). Matching and Receptive share the same pool; Hickory Dickory Dock does **not** have a token board.

| Emoji | Label in UI        | Game constant |
|-------|--------------------|---------------|
| ⭐    | Star               | `EMOJI_POOL[0]` / default `chosenEmoji` |
| 🔷    | Diamond            | `EMOJI_POOL[1]` |
| 💎    | Gem                | `EMOJI_POOL[2]` |
| ✨    | Sparkle            | `EMOJI_POOL[3]` |
| 🎁    | Gift               | `EMOJI_POOL[4]` |
| 🏆    | Trophy             | `EMOJI_POOL[5]` |
| 💫    | Dizzy              | `EMOJI_POOL[6]` |
| 🌟    | Glowing Star       | `EMOJI_POOL[7]` |

**Where it lives:** `matching/game.js:1228`, `receptive/game.js:1223`.  
**Admin ask:** Allow admins to add, remove, or reorder these choices (and set the default) per game without touching JS source.

---

## 2. UI Chrome Emoji (baked into HTML — not data-driven)

These are hardcoded in `index.html` for all three games. They are not stored in any manifest or config and cannot currently be changed without editing HTML.

| Emoji / Char | Meaning                          | Element / Location                                  | Games |
|--------------|----------------------------------|-----------------------------------------------------|-------|
| `←`          | Back to Games navigation link    | `#btn-back` text                                    | All 3 |
| `⚙`          | Opens the extra settings panel   | `#btn-extra-toggle` label                           | All 3 |
| `×`          | Close panel (Targets, Options)   | `.btn-targets-close`, `.btn-extra-close`            | All 3 |
| `?`          | Help tooltip trigger             | `.help-btn` labels throughout settings              | All 3 |
| `▾`          | Header expanded (settings shown) | `#btn-minimize` (matching only — legacy games lack this) | Matching |
| `▸`          | Header collapsed (settings hidden) | `#btn-minimize` toggled by JS                      | Matching |
| `○`          | Display mode: Simple             | `.display-ico-simple` inside display toggle         | Matching |
| `◇`          | Display mode: Visual             | `.display-ico-visual` inside display toggle         | Matching |

---

## 3. In-Game Feedback Characters

Injected by JS into the DOM during gameplay (not in HTML source).

| Char | Meaning                 | Location                          | Games          |
|------|-------------------------|-----------------------------------|----------------|
| `✓`  | Correct response badge  | `matching/game.js:873` (`okSpan.textContent`) | Matching (confirmed), likely Receptive |

Sparkle prompt (`prompt-sparkle` class) is **CSS-only** — no emoji character is injected; it uses `@keyframes sparkle-pulse` animation on the tile border. No emoji chars at risk here.

---

## 4. SVG Icon Buttons (not emoji — for completeness)

These are already inline SVG, not emoji, so no admin input needed:

| Icon         | Element             | Purpose        |
|--------------|---------------------|----------------|
| Printer SVG  | `#btn-print`        | Print session data |
| Trash SVG    | `#btn-clear-data`   | Clear session data |
| Gear SVG     | `#admin-gear-btn` (injected by `admin-gear.js`) | Admin access modal |

---

## 5. What the Admin Tool Currently Handles

`AdminTools/ImageManager/index.html` manages image manifests for:
- **Matching Game** (`IDMatchGame` — path `../../IDMatchGame/IDMatchGame/manifest.json`)
- **Receptive Words Game** (`NameIDGame` — path `../../NameIDGame/NameIDGame/manifest.json`)

It has **no concept of token emoji** or any per-game icon configuration. The manifest schema only tracks `folders`, `images`, `archived`, and `displayNames`.

---

## 6. OOS Request Summary

**Problem:** Token Board emoji pool (8 items) is hardcoded in JS per game. Admins cannot add a custom client-motivating emoji (e.g. their org's reward symbol) without a code deploy.

**Requested admin capability:**
1. View the current emoji pool for each game that has a token board
2. Add an emoji to the pool (with an optional display label)
3. Remove an emoji from the pool
4. Set the default emoji (currently always `⭐`)
5. Apply changes across Matching + Receptive in one action (they share the same pool)

**Implementation sketch (if approved):**
- Extend `manifest.json` with an optional `"tokenEmojiPool"` array
- `ImageManager` gets a new "Token Board" tab alongside the image folder tabs
- An emoji picker or free-text input + label field, with drag-to-reorder
- Games read pool from manifest at load time, fall back to hardcoded default if absent
- No change to game logic — `EMOJI_POOL` constant becomes a loaded config value

**Scope boundary:** Chrome emoji (`←`, `⚙`, `▾`, `×`, `?`, `○`, `◇`) are intentional design tokens, not admin-configurable content. Only token board emoji are in scope for this request.
