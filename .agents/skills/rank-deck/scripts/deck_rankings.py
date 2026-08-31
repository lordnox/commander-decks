"""Load, validate, and render deck ranking scores."""

from __future__ import annotations

import json
import re
from pathlib import Path

MIN_SCORE = 1
MAX_SCORE = 10
UNIVERSAL_KEYS = ("fun", "oppressiveness", "jankiness")
UNIVERSAL_LABELS = {
    "fun": "Fun",
    "oppressiveness": "Oppressiveness",
    "jankiness": "Jankiness",
}
PRIMER_START = "<!-- deck-rankings:start -->"
PRIMER_END = "<!-- deck-rankings:end -->"
PRIMER_SECTION = re.compile(
    rf"{re.escape(PRIMER_START)}.*?{re.escape(PRIMER_END)}",
    re.DOTALL,
)
TAGS_END = "<!-- deck-tags:end -->"
ARCHIDEKT_LINK = re.compile(
    r"^\[!\[Open in Archidekt\]\([^)]*\)\]\(https://archidekt\.com/sandbox\?deck=[^)]*\)"
    r"(?: \[!\[[^\]]*\]\([^)]*\)\]\([^)]*\))*$",
    re.MULTILINE,
)


def rankings_path(deck_dir: Path) -> Path:
    return deck_dir / "rankings.json"


def load_rankings(deck_dir: Path) -> dict | None:
    path = rankings_path(deck_dir)
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"invalid rankings.json: {path}")
    return data


def validate_rankings(data: dict) -> list[str]:
    errors: list[str] = []
    goals = data.get("goals")
    if not isinstance(goals, list) or not goals:
        errors.append("rankings.json needs a non-empty goals list")
        goals = []
    else:
        for goal in goals:
            if not isinstance(goal, str) or not goal.strip():
                errors.append(f"invalid ranking goal: {goal!r}")
    scores = data.get("scores")
    if not isinstance(scores, dict):
        errors.append("rankings.json needs a scores object")
        return errors
    for key in UNIVERSAL_KEYS:
        score = scores.get(key)
        if not _valid_score(score):
            errors.append(f"rankings.json {key} must be an integer {MIN_SCORE}-{MAX_SCORE}")
    identity = scores.get("identity")
    if not isinstance(identity, dict):
        errors.append("rankings.json scores.identity must be an object")
        return errors
    for goal in goals:
        if not isinstance(goal, str) or not goal.strip():
            continue
        if not _valid_score(identity.get(goal)):
            errors.append(
                f"rankings.json identity {goal!r} must be an integer {MIN_SCORE}-{MAX_SCORE}"
            )
    extra = [name for name in identity if name not in goals]
    if extra:
        errors.append("rankings.json identity has undeclared goals: " + ", ".join(extra))
    notes = data.get("notes")
    if notes is not None and (not isinstance(notes, str) or not notes.strip()):
        errors.append("rankings.json notes must be a non-empty string when present")
    return errors


def _valid_score(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and MIN_SCORE <= value <= MAX_SCORE


def score_columns(data: dict) -> list[tuple[str, int]]:
    scores = data["scores"]
    columns = [(UNIVERSAL_LABELS[key], int(scores[key])) for key in UNIVERSAL_KEYS]
    identity = scores.get("identity") or {}
    for goal in data["goals"]:
        columns.append((str(goal), int(identity[goal])))
    return columns


def primer_table(data: dict) -> str:
    columns = score_columns(data)
    headers = " | ".join(label for label, _ in columns)
    divider = " | ".join("---:" for _ in columns)
    values = " | ".join(str(score) for _, score in columns)
    body = f"| {headers} |\n| {divider} |\n| {values} |"
    return f"{PRIMER_START}\n{body}\n{PRIMER_END}"


def index_inline(data: dict) -> str:
    return " " + " · ".join(f"{label} {score}" for label, score in score_columns(data))


def insert_primer_section(original: str, section: str | None) -> str:
    if section is None:
        updated = PRIMER_SECTION.sub("", original, count=1)
        return re.sub(r"\n{3,}", "\n\n", updated)
    if PRIMER_SECTION.search(original):
        return PRIMER_SECTION.sub(section, original, count=1)
    tags_at = original.find(TAGS_END)
    if tags_at != -1:
        insert_at = tags_at + len(TAGS_END)
        return original[:insert_at] + "\n\n" + section + original[insert_at:]
    match = ARCHIDEKT_LINK.search(original)
    if match:
        insert_at = match.end()
        return original[:insert_at] + "\n\n" + section + original[insert_at:]
    lines = original.splitlines(keepends=True)
    if not lines or not lines[0].startswith("# "):
        raise ValueError("primer must begin with a Markdown H1 title")
    newline = "\r\n" if lines[0].endswith("\r\n") else "\n"
    index = 1
    while index < len(lines) and not lines[index].strip():
        index += 1
    while index < len(lines) and lines[index].lstrip().startswith(">"):
        index += 1
    prefix = "".join(lines[:index]).rstrip()
    suffix = "".join(lines[index:]).lstrip()
    parts = [prefix, "", section, ""]
    if suffix:
        parts.append(suffix if suffix.endswith(("\n", "\r\n")) else suffix + newline)
    return newline.join(parts)
