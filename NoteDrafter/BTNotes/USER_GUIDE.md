# BT Direct Service Note Tool — User Guide

A browser-based AI writing assistant that turns a Behavior Technician's brief session notes into a polished, EHR-ready clinical note. No installation required.

---

## What it does

You type short fragments describing what happened in the session. The tool drafts:
- **Narrative paragraphs** for each free-text section of the clinical note
- **Checkbox suggestions** showing which boxes to tick on your EHR form

You review the draft, edit anything that needs adjusting, and copy each section directly into your EHR.

---

## Important: No PHI

**Do not enter any Protected Health Information (PHI).** This means no client names, dates of birth, addresses, insurance numbers, or any other detail that could identify a specific person.

Use general descriptions only — "the client," "the parent," "the BCBA." The tool works just as well with anonymous language.

---

## Quick start

1. Open the tool in your browser.
2. Choose an **AI Provider** and enter your API key (or skip to use Generate Prompt instead).
3. Select **Place of Service** and **Telehealth** status.
4. Fill in the five note sections (fragments are fine).
5. Press **Generate Note** (with API key) or **Generate Prompt** (without).
6. Review the draft and copy each section into your EHR.

---

## AI Provider setup

The tool connects directly to an AI provider using your personal API key. The key is stored only in your browser — it is never sent to any server other than the AI provider you choose.

| Provider | Cost | How to get a key |
|----------|------|-----------------|
| **Gemini** | Free tier available | aistudio.google.com/app/apikey |
| **OpenAI** | Paid | platform.openai.com/api-keys |
| **Anthropic** | Paid | console.anthropic.com/settings/keys |

> **Not sure how to get a key?** Press the **"Copy 'help me get a key' prompt"** button next to your chosen provider, paste it into any AI chat (ChatGPT, Gemini, Claude), and it will walk you through the steps in plain language.

### No API key?

Use **Generate Prompt** instead. This produces the same request as a block of text that you can paste into any AI chat for free. You then copy the AI's response back into your EHR manually.

---

## Session Facts (quick picks)

These two fields are recorded as-selected — the AI does not infer them from your notes.

| Field | Options |
|-------|---------|
| **Place of Service** | Home · Clinic/Center · School · Community · Other |
| **Provided via Telehealth?** | No · Yes |

---

## The five note sections

Fill in what you remember using plain language and fragments. Full sentences are not required.

### 1. Session Start & Context *(optional but helpful)*

Who was there, how the client seemed when you arrived, and what the general focus was.

> Example: *BCBA present 20 min; parent home in another room. Arrived tired, slow to engage. Ran treatment-plan goals + behavior plan.*

Informs: **Individuals Present**, **Clinical Status**, **Purpose of Session** checkboxes.

### 2. Skill Acquisition / Lesson Progress *(required)*

What you taught and how it went. Aim for two programs if possible (e.g., one communication skill and one adaptive/behavior-replacement skill). Include prompting level, accuracy, and any progress or barriers.

> Example: *Receptive ID DTT, 3-item array, full physical faded to independent, 2 indep at end. Tact training during NET play, ~70% accuracy.*

Informs: **ABA Teaching Techniques**, **Narrative of Lesson Progress**.

### 3. Antecedent Strategies *(required)*

What you did proactively to prevent or reduce behavior of concern, and whether it helped.

> Example: *First/then board for transitions. 1-min warnings before switching activities. Offered choice of work order. Reduced noise — helped engagement.*

Informs: **Antecedent Strategies Utilized**, **Antecedent Narrative**.

### 4. Behavior & Staff Response *(required)*

Behavior(s) of concern this session (including zero occurrences), how you responded, whether it worked, and how rates compared to recent sessions.

> Example: *Elopement x2; blocked + redirected, no escalation. Prompted "break please," allowed break, behavior dropped. Lower rate than last week.*

Informs: **Consequence Strategies**, **Effectiveness**, **Behavior Plan Narrative**, **Client Progress**.

### 5. Follow-Up & Concerns *(optional)*

Anything the BCBA should know or do. Items already mentioned in earlier sections are picked up automatically. Leave blank if there is nothing new — a default "no new concerns" sentence is used.

> Example: *Ask BCBA to update elopement protocol. Need new visual schedule printed.*

Informs: **Action Items for BCBA**, **Summary of Concerns**.

---

## Generating the note

### Generate Note (with API key)

The note is built on this page. Review the result:

- **Checklists** show which boxes to tick. They are suggestions — verify each one before ticking your EHR.
- **Narratives** are editable text areas. Click into any narrative to make changes before copying.
- **Copy** buttons appear next to each section for one-click copying into your EHR.
- **Copy All** copies the entire note as plain text.

### Generate Prompt (no API key needed)

A block of text is produced that you can paste into ChatGPT, Gemini, Claude, or any AI chat. The AI's response will be formatted as labeled sections matching your EHR form.

---

## Reviewing the draft

The AI writes conservative, accurate clinical language. Still, always verify:

- **Checkbox suggestions** — confirm each ticked option matches what actually happened.
- **Prompt type names** — the AI uses precise ABA terms (full physical prompt, errorless, DRO). Make sure they match what you actually implemented.
- **Quantities and rates** — the AI only uses numbers you provided. If a number looks wrong, it came from your notes.
- **Invented content** — if a section of your notes was blank, the AI writes a minimal honest statement rather than making things up. Check that sections you left empty are handled appropriately.

---

## Common issues

| Issue | Fix |
|-------|-----|
| "API key wasn't accepted" | Double-check you copied the full key. Even one missing character causes this error. |
| "The AI service is temporarily busy" | Try again in a few minutes, or use Generate Prompt as a fallback. |
| "No JSON found in response" | The AI returned an unexpected format. Press Generate Note again; it usually resolves on retry. |
| "Please add notes for…" | The three required fields (Lesson, Antecedent, Behavior) must have some content before the note can be generated. |
| API key not saving | Make sure your browser allows `localStorage`. Private/incognito mode may block it. |

---

## Privacy

- Your API key is stored in your browser's `localStorage` and is only sent to the AI provider you chose.
- Session notes you type are sent to the AI provider as part of the request. Do not type PHI.
- No data is stored on any server operated by this tool.
- The tool's disclaimer: *Use is subject to the legal and regulatory constraints of your jurisdiction. These tools do not remove your responsibility to review all output for accuracy and to maintain compliance with your credentialing board's ethical standards.*
