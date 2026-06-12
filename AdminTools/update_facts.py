#!/usr/bin/env python3
"""
update_facts.py — Populate / regenerate Famous Person conversation facts.

Each person in FamousPersonGame/index.html carries up to 4 "facts". A fact is no
longer a plain string — it is a rich object with nine fields that drive the
game's scaffolded prompts:

    text, topic, fragment,
    commentMin, commentPartial, commentFull,
    volleyMin,  volleyPartial,  volleyFull

This script asks Claude to write a *connected* 4-fact conversation arc per person
(each volley bridges into the next fact's topic), then rewrites the HTML.

Usage:
    python3 update_facts.py [--dry-run] [--regenerate] [--limit N] [--start N]

Options:
    --dry-run      Parse and generate but do NOT write the HTML file.
    --regenerate   Rewrite EVERY person (refresh existing facts into the
                   connected style). Default only fills people with < 4 facts
                   (i.e. the freshly-added, not-yet-populated roster entries).
    --limit N      Process at most N people this run (good for reviewable batches).
    --start N      Skip the first N matching people.

Requires:
    ANTHROPIC_API_KEY environment variable.
    pip install anthropic
"""

import json
import os
import re
import sys
import time
from pathlib import Path

import anthropic

ROOT       = Path(__file__).resolve().parent.parent
HTML_PATH  = ROOT / "FamousPersonGame" / "index.html"
CKPT_PATH  = Path(__file__).resolve().parent / "facts_checkpoint.json"
MODEL      = "claude-opus-4-8"
TARGET     = 4       # facts per person
MAX_TOKENS = 2000    # one person's 4 rich facts
PAUSE      = 0.35    # seconds between API calls

FACT_SLOTS = [
    "text", "topic", "fragment",
    "commentMin", "commentPartial", "commentFull",
    "volleyMin",  "volleyPartial",  "volleyFull",
]

SYSTEM_PROMPT = (
    'You write material for a "Famous Person" conversation game used by '
    "speech-language pathologists in one-on-one therapy with older adults and "
    "with adults rebuilding conversation skills (aphasia, cognitive-communication, "
    "autism, brain injury). The clinician and client take turns talking ABOUT a "
    "famous person. The real goal is conversation practice: making comments, "
    "asking follow-up questions, and linking one idea to the next and to the "
    "client's own life.\n\n"
    "For the person you are given, write EXACTLY 4 facts that together form ONE "
    "flowing conversation — NOT four disconnected trivia items. Order and word "
    "them so each fact leads naturally into the next:\n"
    "  Fact 1 — what the person is best known for (the hook).\n"
    "  Fact 2 — a related achievement or turning point that follows from Fact 1.\n"
    "  Fact 3 — a human, warm, or surprising personal detail.\n"
    "  Fact 4 — their legacy / why they still matter, ending by turning the talk "
    "toward the client.\n\n"
    "Each fact is a JSON object with these 9 fields. EVERY field is required and "
    "must be plain, warm, spoken-style language — short words, one idea at a time, "
    "dignified and upbeat, nothing grim or violent. Use the person's FIRST name:\n"
    "  text           — the fact, told to the client. ONE simple sentence, ~10-18 words.\n"
    '  topic          — a 2-4 word label for the fact (e.g. "the moon landing").\n'
    "  fragment       — the heart of the fact as a lowercase fragment with no "
    'subject (e.g. "walked on the moon in 1969").\n'
    '  commentMin     — a SHORT spoken starter the CLIENT could say; a few words '
    'trailing off with "…" (least help).\n'
    '  commentPartial — a fuller spoken comment with a stem for the client to '
    'finish, ending with "…".\n'
    "  commentFull    — a complete, natural spoken comment the client can copy "
    "word-for-word.\n"
    "  volleyMin      — an INDIRECT cue telling the CLINICIAN what to elicit; NOT "
    'a line to read aloud. Begin with "Ask about" or "Get them to…", trailing off '
    'with "…".\n'
    "  volleyPartial  — a partial spoken volley: a brief reaction plus a question "
    'stem the client finishes (ends with "…"); lean it toward the NEXT fact\'s topic.\n'
    "  volleyFull     — a complete spoken volley the client can copy: react, then "
    "ask a question that BRIDGES into the next fact's topic. For Fact 4, instead "
    'turn the question to the client\'s own experience ("What about you…").\n\n'
    "Hard rules:\n"
    "  • CONNECT the facts: each volleyFull for facts 1-3 must tee up the topic of "
    "the very next fact; Fact 4 closes by asking the client about themselves.\n"
    "  • commentMin/Partial/Full and volleyPartial/Full are spoken BY the client "
    "(everyday first-person voice). volleyMin is an instruction to the clinician "
    "and is never read aloud.\n"
    "  • Be accurate. Keep it positive — no death details, violence, or anything "
    "distressing.\n"
    "  • Vary how sentences open; don't start every line the same way.\n\n"
    "Return ONLY a JSON array of exactly 4 fact objects, each with all 9 fields. "
    "No markdown fences, no preamble."
)


# ---------------------------------------------------------------------------
# HTML Parsing
# ---------------------------------------------------------------------------

def find_people_section_bounds(html: str) -> tuple[int, int]:
    marker = "const PEOPLE = [\n"
    section_start = html.index(marker) + len(marker)
    section_end   = html.index("\n];", section_start)
    return section_start, section_end


def _last_match(pattern: str, text: str) -> str | None:
    m = None
    for m in re.finditer(pattern, text):
        pass
    return m.group(1) if m else None


def _match_bracket(s: str, open_idx: int) -> int:
    """Index of the ']' matching the '[' at open_idx, skipping string literals."""
    depth = 0
    in_str = False
    str_ch = ""
    i = open_idx
    while i < len(s):
        c = s[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == str_ch:
                in_str = False
        elif c in ("'", '"'):
            in_str = True
            str_ch = c
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def parse_all_people(html: str) -> list[dict]:
    """
    Return person dicts: name, years, tag, fact_count,
    block_start (offset of '    facts:'), block_end (just past closing '],').
    Handles both inline empty arrays (`facts: [],`) and multi-line object arrays.
    """
    section_start, section_end = find_people_section_bounds(html)
    section = html[section_start:section_end]

    people = []
    for fm in re.finditer(r"\n    facts: \[", section):
        open_idx = fm.end() - 1                      # the '['
        close_idx = _match_bracket(section, open_idx)
        if close_idx == -1:
            continue

        block_start_rel = fm.start() + 1             # start of '    facts:'
        block_end_rel = close_idx + 1
        if block_end_rel < len(section) and section[block_end_rel] == ",":
            block_end_rel += 1

        inner = section[open_idx + 1:close_idx]
        fact_count = len(re.findall(r"\n {8}text:", inner))

        preceding = section[:fm.start()]
        name  = _last_match(r"name:\s*'([^']+)'", preceding)
        years = _last_match(r"years:\s*'([^']+)'", preceding)
        tag   = _last_match(r"tag:\s*'([^']+)'", preceding)
        if not name:
            continue

        people.append({
            "name":        name,
            "years":       years or "",
            "tag":         tag or "",
            "fact_count":  fact_count,
            "block_start": section_start + block_start_rel,
            "block_end":   section_start + block_end_rel,
        })
    return people


# ---------------------------------------------------------------------------
# HTML Modification
# ---------------------------------------------------------------------------

def _escape_js(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


def _build_facts_block(facts: list[dict]) -> str:
    lines = ["    facts: ["]
    for f in facts:
        lines.append("      {")
        for slot in FACT_SLOTS:
            lines.append(f"        {slot}: '{_escape_js(f[slot])}',")
        lines.append("      },")
    lines.append("    ],")
    return "\n".join(lines)


def apply_all_updates(html: str, updates: list[tuple[list[dict], int, int]]) -> str:
    """Apply replacements in reverse byte-offset order to preserve earlier offsets."""
    for new_facts, bstart, bend in sorted(updates, key=lambda x: x[1], reverse=True):
        html = html[:bstart] + _build_facts_block(new_facts) + html[bend:]
    return html


# ---------------------------------------------------------------------------
# API Interaction
# ---------------------------------------------------------------------------

def _validate_facts(parsed) -> list[dict]:
    if not isinstance(parsed, list) or len(parsed) < TARGET:
        raise ValueError(f"expected a JSON array of {TARGET} facts")
    facts = parsed[:TARGET]
    for f in facts:
        if not isinstance(f, dict):
            raise ValueError("fact is not an object")
        for slot in FACT_SLOTS:
            if not isinstance(f.get(slot), str) or not f[slot].strip():
                raise ValueError(f"missing/empty field: {slot}")
    return facts


def generate_facts(client: anthropic.Anthropic, name: str, years: str, tag: str) -> list[dict]:
    """Generate a connected 4-fact conversation arc for one person."""
    descriptor = name + (f" ({years})" if years else "") + (f" — {tag}" if tag else "")
    user_msg = f"Person: {descriptor}\n\nWrite the 4-fact conversation set for this person."

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )

    text_block = next((b.text for b in response.content if b.type == "text"), None)
    if text_block is None:
        raise ValueError("no text block in model response")
    raw = re.sub(r"^```(?:json)?\s*", "", text_block.strip())
    raw = re.sub(r"\s*```$", "", raw)
    return _validate_facts(json.loads(raw))


# ---------------------------------------------------------------------------
# Checkpoint helpers
# ---------------------------------------------------------------------------

def load_checkpoint() -> dict[str, list[dict]]:
    if CKPT_PATH.exists():
        return json.loads(CKPT_PATH.read_text())
    return {}


def save_checkpoint(ckpt: dict[str, list[dict]]) -> None:
    CKPT_PATH.write_text(json.dumps(ckpt, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    argv = sys.argv[1:]
    dry_run    = "--dry-run" in argv
    regenerate = "--regenerate" in argv

    def _int_opt(flag: str, default: int) -> int:
        if flag in argv:
            i = argv.index(flag)
            if i + 1 < len(argv):
                return int(argv[i + 1])
        return default

    start = _int_opt("--start", 0)
    limit = _int_opt("--limit", 0)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    print(f"Reading {HTML_PATH} …")
    html = HTML_PATH.read_text(encoding="utf-8")

    print("Parsing people …")
    people = parse_all_people(html)
    populated = sum(1 for p in people if p["fact_count"] >= TARGET)
    print(f"  Found {len(people)} people ({populated} populated, "
          f"{len(people) - populated} empty/incomplete).")

    ckpt = load_checkpoint()

    # Choose who to (re)generate.
    if regenerate:
        todo = list(people)
    else:
        todo = [p for p in people if len(ckpt.get(p["name"], [])) < TARGET
                and p["fact_count"] < TARGET]
    todo = todo[start:]
    if limit:
        todo = todo[:limit]

    mode = "regenerate" if regenerate else "fill"
    print(f"  Mode: {mode}. {len(todo)} people to process.")

    for i, p in enumerate(todo):
        name = p["name"]
        print(f"  [{i+1}/{len(todo)}] {name} …", end=" ", flush=True)
        try:
            ckpt[name] = generate_facts(client, name, p["years"], p["tag"])
            save_checkpoint(ckpt)
            print("OK")
        except Exception as exc:                       # noqa: BLE001
            print(f"FAILED — {exc}")
            print("  (Progress saved; re-run to continue.)")
        if i < len(todo) - 1:
            time.sleep(PAUSE)

    # Build update list from the checkpoint (only people we have full sets for).
    updates: list[tuple[list[dict], int, int]] = []
    for p in people:
        facts = ckpt.get(p["name"])
        if isinstance(facts, list) and len(facts) == TARGET:
            updates.append((facts, p["block_start"], p["block_end"]))

    print(f"\n{len(updates)} people to write into HTML.")
    if not updates:
        print("No HTML changes needed.")
        return

    new_html = apply_all_updates(html, updates)

    if len(new_html) < len(html) * 0.9:
        print("ERROR: new HTML is suspiciously small — aborting.", file=sys.stderr)
        sys.exit(1)

    if dry_run:
        print("[dry-run] Would write", len(new_html), "bytes to", HTML_PATH)
    else:
        HTML_PATH.write_text(new_html, encoding="utf-8")
        print(f"Wrote {len(new_html):,} bytes to {HTML_PATH}")

    print("Done.")


if __name__ == "__main__":
    main()
