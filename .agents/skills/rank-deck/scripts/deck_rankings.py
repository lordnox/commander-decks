"""Load, validate, and render deck ranking scores."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote

MIN_SCORE = 1
MAX_SCORE = 10
UNIVERSAL_KEYS = ("jankiness", "fun", "oppressiveness")
UNIVERSAL_LABELS = {
    "jankiness": "Jank",
    "fun": "Fun",
    "oppressiveness": "Mean",
}
HIGH_IS_GOOD_COLORS = ("8aa6a0", "6f9a92", "5f8b84", "2f7d6a", "0b6b58")
HIGH_IS_BAD_COLORS = ("9a6b6b", "b05252", "b91c1c", "991b1b", "7f1d1d")
HIGH_IS_BAD_KEYS = frozenset({"oppressiveness"})
NEUTRAL_COLOR = "6b7280"
HIGH_IS_BAD_ALERT_FROM = 7
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


def score_columns(data: dict) -> list[tuple[str, int, bool]]:
    """Display order: Jank, Fun, Mean, then identity goals as declared."""
    scores = data["scores"]
    columns = [
        (UNIVERSAL_LABELS[key], int(scores[key]), key in HIGH_IS_BAD_KEYS)
        for key in UNIVERSAL_KEYS
    ]
    identity = scores.get("identity") or {}
    for goal in data["goals"]:
        columns.append((str(goal), int(identity[goal]), False))
    return columns


def shield_url(label: str, score: int, *, high_is_bad: bool) -> str:
    if high_is_bad and score < HIGH_IS_BAD_ALERT_FROM:
        color = NEUTRAL_COLOR
    else:
        palette = HIGH_IS_BAD_COLORS if high_is_bad else HIGH_IS_GOOD_COLORS
        color = palette[min((score - 1) // 2, len(palette) - 1)]
    return (
        f"https://img.shields.io/static/v1?label={quote(str(score), safe='')}"
        f"&message={quote(label, safe='')}&color={color}&style=flat-square"
    )


def badge_markdown(label: str, score: int, *, high_is_bad: bool) -> str:
    return f"![{label} {score}]({shield_url(label, score, high_is_bad=high_is_bad)})"


def badge_row(data: dict) -> str:
    return " ".join(
        badge_markdown(label, score, high_is_bad=high_is_bad)
        for label, score, high_is_bad in score_columns(data)
    )


def primer_badges(data: dict) -> str:
    return f"{PRIMER_START}\n{badge_row(data)}\n{PRIMER_END}"


def universal_signature(data: dict) -> str:
    """Compact `J6 F8 M5` figure; the axis order is explained once in the index intro."""
    scores = data["scores"]
    return " ".join(
        f"{UNIVERSAL_LABELS[key][0]}{int(scores[key])}" for key in UNIVERSAL_KEYS
    )


def identity_badges(data: dict) -> str:
    identity = data["scores"].get("identity") or {}
    return " ".join(
        badge_markdown(str(goal), int(identity[goal]), high_is_bad=False)
        for goal in data["goals"]
    )


def index_badges(data: dict) -> str:
    parts = [f"`{universal_signature(data)}`"]
    goals = identity_badges(data)
    if goals:
        parts.append(goals)
    return " " + " ".join(parts)


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
