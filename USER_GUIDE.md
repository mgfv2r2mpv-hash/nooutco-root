# Games — User Guide

**games.nooutco.me** is a collection of browser-based ABA therapy games designed for use during direct-service sessions. All games run in any modern browser with no installation required.

---

## Common Controls

Every game shares the same header and settings bar layout.

### Header
| Control | What it does |
|---------|-------------|
| **← Games** | Returns to the game index |
| **Timer display** | Running session timer (MM:SS) |
| **Pause / Resume** | Pauses or resumes the timer |
| **Reset** | Resets the timer to 00:00 |

### Settings bar options (available in most games)

| Control | What it does |
|---------|-------------|
| **Topic / Category / Tag** | Selects the vocabulary or image set for the session |
| **Array Size** | How many choice items appear on screen (typically 1–10) |
| **Targets** | Opens a panel to choose which items can appear as the correct answer. Uncheck items the learner has already mastered or hasn't been introduced to yet. |
| **⚙ Settings** | Opens extra options (errorless, prompt style, re-present errors, etc.) |
| **Prompt** | Manually delivers a prompt during a live trial |
| **Start** | Begins the session |

### Common ⚙ Settings options

| Option | What it does |
|--------|-------------|
| **Errorless** | The correct answer is pre-highlighted/prompted so the learner cannot make an error. Useful when introducing a new target. |
| **Re-Present Errors** | After an error trial, immediately presents the same trial again with an automatic prompt before moving on. |
| **No Incorrect Animation** | Suppresses the error animation (useful if the animation is itself reinforcing for problem behavior). |
| **Auto-Prompt** | Automatically delivers a prompt after a configurable delay if no response is made. |
| **Prompt Delay** | How many seconds to wait before auto-prompting. |
| **Persist Prompts** | Keeps the prompt visible for the remainder of the trial rather than fading it. |

> **Tip:** Settings are saved in the browser between sessions. You do not need to reconfigure every time.

---

## Games

### 1. Famous Person Game

**Target skill:** Conversational skills — commenting on a topic and volleying a question back.

#### How to play

1. Press **Let's Play** on the start screen.
2. A famous person's photo and several facts appear.
3. The game guides the client through a four-turn conversation exchange:
   - **Turn 1:** Client makes a comment about a fact.
   - **Turn 2:** Client asks a related question.
   - Turns 3–4 repeat the pattern with new facts.
4. Tap **✓ Got it** if the client completed the move independently, or **✗ Missed** if not.
5. Press **Prompt** at any time to reveal the modeled response.
6. When all turns are complete, press **Finish & SR** to move to the Scheduled Reinforcement timer.

#### Settings

| Option | Notes |
|--------|-------|
| **Prompt method** | **MTL** (most-to-least) starts with a full model and fades; **LTM** (least-to-most) starts minimal and adds support. |
| **Show Choices** | Displays written choice options alongside the prompt. |
| **Karaoke** | Highlights words in the prompt sentence as they are read. |
| **🔄 Reset person** | Resets data for the current person without picking a new one. |

#### SR Timer screen
After pressing **Finish & SR**, a countdown ring appears. Set the reinforcement duration and press **▶ Start**. Press **■ Stop** to end the SR period early.

---

### 2. Feature · Function · Class (FFC Game)

**Target skill:** Verbal behavior — discriminating features, functions, and class membership of objects.

#### Modes

| Mode | SD presented | Client responds with |
|------|-------------|---------------------|
| **Feature** | "Which one is [feature]?" | Item that has that feature |
| **Function** | "Which one do you use to [function]?" | Item with that function |
| **Class (within group)** | "Which one is a [class]?" | Item in that class, distractors from same group |
| **Class (cross-category)** | "Which one is a [class]?" | Item in that class, distractors from different groups |

#### How to play

1. Choose **Mode**, **Array Size**, and **Tag** (vocabulary set).
2. Use **Targets** to limit which items appear as correct answers.
3. Press **Start**.
4. The SD sentence appears at the top; choice items appear in the grid.
5. Tap the correct item. The game advances automatically; errors trigger re-presentation if that option is on.

---

### 3. Hickory Dickory Dock

**Target skill:** Receptive picture identification with an engaging visual presentation.

#### How to play

1. Select a **Topic** (image category) and **Array Size**.
2. Use **Targets** to control which images can be the correct answer.
3. Press **Start**.
4. Images appear around a grandfather clock face. A sample image (the "mouse") is shown as the SD.
5. Client selects the matching image from the array. A correct response triggers the mouse running to the clock.

> **Note:** This game requires a web server to discover image folders. It works automatically at games.nooutco.me. If running locally, serve with `python3 -m http.server 8000` — do not open `index.html` directly as a file.

---

### 4. Identical Matching Game

**Target skill:** Visual matching — identifying an identical picture from an array.

#### How to play

1. Select a **Topic** and **Array Size**.
2. Use **Targets** to limit which images can appear as the correct answer.
3. Press **Start**.
4. A sample image appears at the top. Client selects the identical image from the choice array below.
5. Correct: advances to next trial. Incorrect: error feedback and re-presentation (if enabled).

> Image topics are stored in `T_*` topic folders. New topics can be added by creating a folder with the `T_` prefix and placing image files inside.

---

### 5. Intraverbal Game

**Target skill:** Intraverbal responding — completing carrier phrases.

#### Categories

| Category | Examples |
|----------|---------|
| **Animal sounds** | "A dog says…", "A cat says…" |
| **Children's songs** | "Twinkle twinkle little…", "Itsy bitsy…" |
| **Common phrases** | "Ready, set…", "Peanut butter and…" |

#### How to play

1. Select a **Category** and **Array Size**.
2. Use **Targets** to choose which items can be the correct answer.
3. Press **Start**.
4. The carrier phrase text (and audio if recorded) appears. Client selects the correct completion from the choice array.

#### Recording custom audio

Press **🎙️ Record** to open the recording panel. You can record:
- **Carrier Phrase** — your voice reading the cue sentence (e.g., "A dog says…")
- **Target** — your voice reading the correct answer (e.g., "Woof")

Recorded audio is stored in the browser and plays automatically during trials. Press **Save** to keep recordings. Recordings persist across sessions on the same device.

---

### 6. Matching Market

**Target skill:** Receptive matching in a naturalistic, shopping-themed context.

#### How to play

1. Select a **Topic** and **Array Size**.
2. Use **Targets** to control which images can appear as the customer's request.
3. Press **Start**.
4. A cartoon customer walks in holding a shopping bag with a sample image showing what they want.
5. Client selects the matching item from the market shelves.
6. Correct: the item flies into the bag and the customer walks out satisfied.

> Uses the same image library as the Identical Matching Game. Image topics must be set up in the IDMatchGame folder.

---

### 7. Receptive Words Game (Name ID)

**Target skill:** Receptive label identification — selecting a named picture from an array.

#### How to play

1. Select a **Topic** and **Array Size**.
2. Use **Targets** to limit which images can be the correct answer.
3. Press **Start**.
4. A word label appears as the SD. Client selects the matching image from the choice array.

---

### 8. Pattern Pack Co.

**Target skill:** Pattern completion — identifying and extending a repeating pattern (AB, ABC).

#### Theme
Items move along a factory conveyor belt. The client fills empty "slots" in the box by selecting from the bulk bin below.

#### Settings

| Setting | Range | Notes |
|---------|-------|-------|
| **Product Line** | — | Emoji category for the pattern items |
| **Pattern Length** | 2–3 | Number of unique items in the repeating unit (AB = 2, ABC = 3) |
| **Shown Reps** | 1–2 | How many full repeats appear before the blank slots |
| **Blanks to Fill** | 1–3 | How many slots the client must complete |
| **Bank Size** | 2–8 | Number of choices in the bulk bin |

#### How to play

1. Configure settings and press **Start**.
2. The pattern appears on the conveyor belt with the shown repetitions followed by blank slots.
3. Client taps items from the bulk bin to fill the blanks in order.
4. Correct completion triggers a celebration animation.

---

### 9. Sequences & Patterns

**Target skill:** Pattern completion — identifying and extending sequences of symbols.

Same mechanics as Pattern Pack Co. but presented as a simple horizontal sequence without the factory theme. Supports longer patterns (up to length 5) and more shown reps (up to 4).

#### Settings

| Setting | Range |
|---------|-------|
| **Symbol Set** | Emoji category |
| **Pattern Length** | 2–5 |
| **Shown Reps** | 1–4 |
| **Blanks to Fill** | 1–5 |
| **Bank Size** | 2–8 |

---

### 10. Think or Say?

**Target skill:** Perspective-taking / social cognition — discriminating between thoughts and verbal statements.

#### Modes

| Mode | What it does |
|------|-------------|
| **📖 Learn** | Presents cards with explanations. Use to introduce new situations before scored practice. |
| **▶ Play** | Scored trials. Client responds "Think" or "Say" for each situation card. |

#### Settings

| Setting | Notes |
|---------|-------|
| **Category** | Limits cards to one situation type, or use all |
| **Order** | Shuffle (random) or In order (sequential) |
| **Errorless** | Pre-highlights the correct response |
| **Re-Present Errors** | Re-presents incorrect trials with a prompt |
| **Auto-Prompt** | Delivers prompt after the set delay |

#### How to play (Play mode)

1. Choose a **Category** and **Order**, then press **▶ Play**.
2. A situation card appears with a statement.
3. Client selects **Think** (keep it in your head) or **Say** (it's okay to say aloud).
4. Correct: advances. Incorrect: error feedback, then re-presentation if enabled.

---

## Tips for BTs

- **Use Targets to match the client's program.** Only activate items listed in the client's treatment plan for that session.
- **Use Errorless for introduction.** Turn on Errorless when a target is brand new. Fade it off as the client builds fluency.
- **Re-Present Errors keeps things moving.** It prevents the session from stalling on errors by immediately re-running the trial with support.
- **The timer is not automatic.** Start the timer when the session begins; pause it during breaks. Use it to track billable session time.
- **Settings are per-device and per-browser.** If you switch devices, you may need to reconfigure.
- **No data is saved to a server.** All progress data stays in the browser. Record trial data in your EHR as usual.
