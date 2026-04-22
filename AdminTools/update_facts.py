#!/usr/bin/env python3
"""
update_facts.py — Expand each person in FamousPersonGame/index.html from 2 facts to 4.

Usage:
    python3 update_facts.py [--dry-run] [--start N]

Options:
    --dry-run   Parse and generate but do NOT write the HTML file.
    --start N   Skip the first N people (useful if checkpoint is corrupted).

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
MODEL      = "claude-haiku-4-5"
TARGET     = 4       # desired number of facts per person
PAUSE      = 0.35    # seconds between API calls

SYSTEM_PROMPT = (
    "You write short biographical facts for a memory-support conversation game "
    "used in speech therapy with older adults.\n"
    "Rules:\n"
    "• 1–2 sentences, about 15–25 words per fact\n"
    "• Simple, clear language (suitable for adults with mild cognitive impairment)\n"
    "• Factually accurate\n"
    "• Distinct from any existing facts listed — do not repeat them\n"
    "• Positive tone — nothing disturbing, violent, or overly sad\n"
    "• Cover variety: personal background, personality, lesser-known achievement, "
    "or cultural legacy\n\n"
    "Return ONLY a valid JSON array of strings. No markdown. No preamble.\n"
    'Example: ["He grew up in a small town in Ohio.", '
    '"His paintings hang in over 30 museums worldwide."]'
)


# ---------------------------------------------------------------------------
# HTML Parsing
# ---------------------------------------------------------------------------

def find_people_section_bounds(html: str) -> tuple[int, int]:
    """Return byte offsets (section_start, section_end) of the PEOPLE array body."""
    marker = "const PEOPLE = [\n"
    section_start = html.index(marker) + len(marker)
    section_end   = html.index("\n];", section_start)
    return section_start, section_end


def _last_match(pattern: str, text: str) -> str | None:
    m = None
    for m in re.finditer(pattern, text):
        pass
    return m.group(1) if m else None


def _extract_facts(block: str) -> list[str]:
    """Parse individual fact strings out of a `facts: [ ... ],` block."""
    facts = []
    # Find the list portion between [ and ]
    m = re.search(r"facts:\s*\[(.*?)\]", block, re.DOTALL)
    if not m:
        return facts
    inner = m.group(1)
    # Each fact is on its own line:  '...text...',
    for line in inner.splitlines():
        line = line.strip()
        if line.startswith("'") and (line.endswith("',") or line.endswith("'")):
            # Strip surrounding quotes and trailing comma
            if line.endswith("',"):
                content = line[1:-2]
            else:
                content = line[1:-1]
            content = content.replace("\\'", "'")
            if content:
                facts.append(content)
    return facts


def parse_all_people(html: str) -> list[dict]:
    """
    Return a list of person dicts, each with:
        name, years, tag, facts (list[str]),
        block_start (offset of 'facts: ['), block_end (offset just after closing '],')
    """
    section_start, section_end = find_people_section_bounds(html)
    section = html[section_start:section_end]

    people = []
    # Find every `    facts: [` opening
    for fm in re.finditer(r"    facts: \[", section):
        facts_open = fm.start()
        # Find the matching closing `    ],`
        close_m = re.search(r"    \],", section[facts_open:])
        if not close_m:
            continue
        block_end_rel = facts_open + close_m.end()
        block = section[facts_open:block_end_rel]

        # Search backwards from facts_open for name/years/tag
        preceding = section[:facts_open]
        name = _last_match(r"name:\s*'([^']+)'", preceding)
        years = _last_match(r"years:\s*'([^']+)'", preceding)
        tag  = _last_match(r"tag:\s*'([^']+)'", preceding)

        if not name:
            continue

        facts = _extract_facts(block)

        people.append({
            "name":        name,
            "years":       years or "",
            "tag":         tag or "",
            "facts":       facts,
            "block_start": section_start + facts_open,
            "block_end":   section_start + block_end_rel,
        })

    return people


# ---------------------------------------------------------------------------
# HTML Modification
# ---------------------------------------------------------------------------

def _escape_js(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def _build_facts_block(facts: list[str]) -> str:
    lines = ["    facts: ["]
    for f in facts:
        lines.append(f"      '{_escape_js(f)}',")
    lines.append("    ],")
    return "\n".join(lines)


def apply_all_updates(
    html: str,
    updates: list[tuple[list[str], int, int]],
) -> str:
    """Apply replacements in reverse byte-offset order to preserve earlier offsets."""
    for new_facts, bstart, bend in sorted(updates, key=lambda x: x[1], reverse=True):
        new_block = _build_facts_block(new_facts)
        html = html[:bstart] + new_block + html[bend:]
    return html


# ---------------------------------------------------------------------------
# API Interaction
# ---------------------------------------------------------------------------

def generate_facts(
    client: anthropic.Anthropic,
    name: str,
    years: str,
    tag: str,
    existing: list[str],
    n: int,
) -> list[str]:
    """Call claude-haiku-4-5 to generate `n` additional facts for this person."""
    existing_str = "\n".join(f"  - {f}" for f in existing)
    user_msg = (
        f"Person: {name}"
        + (f" ({years})" if years else "")
        + (f" — {tag}" if tag else "")
        + f"\n\nExisting facts (do NOT repeat these):\n{existing_str}\n\n"
        f"Generate exactly {n} new, distinct fact(s) about this person."
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )

    raw = response.content[0].text.strip()

    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise ValueError(f"Expected JSON array, got: {type(parsed)}")
    if len(parsed) < n:
        raise ValueError(f"Only got {len(parsed)} facts, needed {n}")

    return [str(f).strip() for f in parsed[:n]]


# ---------------------------------------------------------------------------
# Checkpoint helpers
# ---------------------------------------------------------------------------

def load_checkpoint() -> dict[str, list[str]]:
    if CKPT_PATH.exists():
        return json.loads(CKPT_PATH.read_text())
    return {}


def save_checkpoint(ckpt: dict[str, list[str]]) -> None:
    CKPT_PATH.write_text(json.dumps(ckpt, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    dry_run = "--dry-run" in sys.argv
    start   = 0
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--start" and i < len(sys.argv) - 1:
            start = int(sys.argv[i + 1])

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    print(f"Reading {HTML_PATH} …")
    html = HTML_PATH.read_text(encoding="utf-8")

    print("Parsing people …")
    people = parse_all_people(html)
    print(f"  Found {len(people)} people.")

    # Who still needs more facts?
    ckpt = load_checkpoint()
    todo = [p for p in people[start:] if len(ckpt.get(p["name"], p["facts"])) < TARGET]

    print(f"  {len(todo)} people need additional facts.")
    if not todo:
        print("Nothing to do.")
    else:
        for i, p in enumerate(todo):
            name     = p["name"]
            existing = ckpt.get(name, p["facts"])
            need     = TARGET - len(existing)

            print(f"  [{i+1}/{len(todo)}] {name}  ({need} fact(s) needed) …", end=" ", flush=True)

            try:
                new_facts = generate_facts(client, name, p["years"], p["tag"], existing, need)
                full_facts = existing + new_facts
                ckpt[name] = full_facts
                save_checkpoint(ckpt)
                print("OK")
            except Exception as exc:
                print(f"FAILED — {exc}")
                print("  (Progress saved; re-run to continue.)")
                # Don't exit — continue with the rest if this one fails
                ckpt[name] = existing  # preserve what we had

            if i < len(todo) - 1:
                time.sleep(PAUSE)

    # Build update list from checkpoint
    updates: list[tuple[list[str], int, int]] = []
    skipped = 0
    for p in people:
        final_facts = ckpt.get(p["name"], p["facts"])
        if final_facts != p["facts"]:
            updates.append((final_facts, p["block_start"], p["block_end"]))
        elif len(p["facts"]) >= TARGET:
            skipped += 1

    print(f"\n{len(updates)} people to update in HTML; {skipped} already had {TARGET}+ facts.")

    if not updates:
        print("No HTML changes needed.")
        return

    new_html = apply_all_updates(html, updates)

    # Sanity check
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
