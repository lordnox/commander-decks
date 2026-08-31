"""Load, validate, and render deck ranking scores."""

from __future__ import annotations

import json
import re
import string
from html import escape
from pathlib import Path

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
BADGE_DIR = "assets/badges"
PRIMER_BADGE_PREFIX = "../../"
BADGE_HEIGHT = 20
BADGE_BASELINE = 14
BADGE_PADDING = 7
BADGE_FONT_SIZE = 11
BADGE_FONT_STACK = "Verdana,DejaVu Sans,Geneva,sans-serif"
BADGE_SCORE_COLOR = "#555555"
BADGE_TEXT_COLOR = "#ffffff"
# Verdana 11px advance widths; close enough that segments never clip the label.
CHAR_WIDTHS = {
    **{character: 6.9 for character in string.digits},
    **dict(zip(string.ascii_uppercase, (
        7.0, 7.0, 7.1, 7.7, 6.4, 5.8, 8.0, 7.6, 4.2, 4.4, 7.0, 5.7, 8.6,
        7.6, 8.2, 6.4, 8.2, 7.1, 6.7, 6.2, 7.4, 7.0, 10.2, 7.0, 6.2, 6.4,
    ))),
    **dict(zip(string.ascii_lowercase, (
        6.2, 6.5, 5.3, 6.5, 6.2, 4.0, 6.5, 6.4, 2.9, 2.9, 5.9, 2.9, 9.7,
        6.4, 6.3, 6.5, 6.5, 4.3, 5.3, 4.0, 6.4, 5.9, 8.4, 5.9, 5.9, 5.2,
    ))),
    " ": 3.9,
    "-": 4.1,
    "'": 2.9,
    ".": 3.4,
    ",": 3.4,
    "/": 4.6,
    "+": 7.2,
}
DEFAULT_CHAR_WIDTH = 6.5
INDEX_GOAL_BADGE_HEIGHT = 16
INDEX_TEXT_GOOD_COLOR = "#2f9e8f"
INDEX_TEXT_BAD_COLOR = "#e05252"
INDEX_STRONG_FROM = 8
INDEX_WEAK_TO = 3
INDEX_BOLD_SCORES = frozenset({MIN_SCORE, MAX_SCORE})
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


def badge_color(score: int, *, high_is_bad: bool) -> str:
    palette = HIGH_IS_BAD_COLORS if high_is_bad else HIGH_IS_GOOD_COLORS
    return "#" + palette[min((score - 1) // 2, len(palette) - 1)]


def text_width(text: str) -> float:
    """Approximate Verdana 11px advance width, so segments are sized without a font engine."""
    return sum(CHAR_WIDTHS.get(character, DEFAULT_CHAR_WIDTH) for character in text)


def badge_svg(label: str, score: int, *, high_is_bad: bool) -> str:
    score_text = str(score)
    left = round(text_width(score_text) + BADGE_PADDING * 2, 1)
    right = round(text_width(label) + BADGE_PADDING * 2, 1)
    total = round(left + right, 1)
    description = escape(f"{label}: {score}")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total}" height="{BADGE_HEIGHT}"'
        f' role="img" aria-label="{description}">\n'
        f"<title>{description}</title>\n"
        '<g shape-rendering="crispEdges">\n'
        f'<rect width="{left}" height="{BADGE_HEIGHT}" fill="{BADGE_SCORE_COLOR}"/>\n'
        f'<rect x="{left}" width="{right}" height="{BADGE_HEIGHT}"'
        f' fill="{badge_color(score, high_is_bad=high_is_bad)}"/>\n'
        "</g>\n"
        f'<g fill="{BADGE_TEXT_COLOR}" text-anchor="middle"'
        f' font-family="{BADGE_FONT_STACK}" font-size="{BADGE_FONT_SIZE}">\n'
        f'<text x="{round(left / 2, 1)}" y="{BADGE_BASELINE}">{score_text}</text>\n'
        f'<text x="{round(left + right / 2, 1)}" y="{BADGE_BASELINE}">{escape(label)}</text>\n'
        "</g>\n"
        "</svg>\n"
    )


def badge_slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


def badge_path(label: str, score: int) -> str:
    return f"{BADGE_DIR}/{badge_slug(label)}-{score}.svg"


def badge_markdown(label: str, score: int, *, prefix: str = "", height: int | None = None) -> str:
    """Badges are committed SVGs, so alt and title carry the score for anyone not seeing them."""
    description = escape(f"{label} {score}", quote=True)
    size = f' height="{height}"' if height else ""
    return (
        f'<img src="{prefix}{badge_path(label, score)}"'
        f' alt="{description}" title="{description}"{size}>'
    )


def badge_row(data: dict, *, prefix: str = "", height: int | None = None) -> str:
    return " ".join(
        badge_markdown(label, score, prefix=prefix, height=height)
        for label, score, _ in score_columns(data)
    )


def primer_badges(data: dict) -> str:
    return f"{PRIMER_START}\n{badge_row(data, prefix=PRIMER_BADGE_PREFIX)}\n{PRIMER_END}"


def score_cell(key: str, score: int) -> str:
    """GitHub strips CSS, so table emphasis has to go through inline math.

    Every cell is wrapped so the column keeps one font; color marks the extremes
    only, and follows valence rather than magnitude: a high Mean is the bad end.
    """
    body = f"\\textbf{{{score}}}" if score in INDEX_BOLD_SCORES else str(score)
    body = f"\\textsf{{{body}}}"
    high_is_bad = key in HIGH_IS_BAD_KEYS
    if score >= INDEX_STRONG_FROM:
        color = INDEX_TEXT_BAD_COLOR if high_is_bad else INDEX_TEXT_GOOD_COLOR
    elif score <= INDEX_WEAK_TO:
        color = INDEX_TEXT_GOOD_COLOR if high_is_bad else INDEX_TEXT_BAD_COLOR
    else:
        return f"${body}$"
    return f"$\\color{{{color}}}{{{body}}}$"


def universal_cells(data: dict) -> list[str]:
    """One table cell per universal axis, in Jank, Fun, Mean order."""
    scores = data["scores"]
    return [score_cell(key, int(scores[key])) for key in UNIVERSAL_KEYS]


def goal_cell(data: dict) -> str:
    identity = data["scores"].get("identity") or {}
    badges = [
        badge_markdown(str(goal), int(identity[goal]), height=INDEX_GOAL_BADGE_HEIGHT)
        for goal in data["goals"]
    ]
    if not badges:
        return "—"
    return "<sub>" + " ".join(badges) + "</sub>"


def repository_root(start: Path) -> Path:
    for parent in (start, *start.parents):
        if (parent / "cards").is_dir() and (parent / "decks").is_dir():
            return parent
    raise FileNotFoundError("could not locate repository root")


def required_badges(root: Path) -> dict[str, str]:
    """Every badge file the repository should contain, keyed by repo-relative path."""
    badges: dict[str, str] = {}
    decks = root / "decks"
    if not decks.is_dir():
        return badges
    for deck_dir in sorted(decks.iterdir()):
        try:
            data = load_rankings(deck_dir)
        except (ValueError, json.JSONDecodeError, OSError):
            continue
        if data is None or validate_rankings(data):
            continue
        for label, score, high_is_bad in score_columns(data):
            badges[badge_path(label, score)] = badge_svg(label, score, high_is_bad=high_is_bad)
    return badges


def sync_badges(root: Path, *, check: bool = False) -> list[str]:
    """Write missing or changed badge SVGs and drop orphans; report paths either way."""
    badges = required_badges(root)
    stale = [
        path
        for path, svg in badges.items()
        if not (root / path).is_file() or (root / path).read_text(encoding="utf-8") != svg
    ]
    badge_dir = root / BADGE_DIR
    existing = sorted(badge_dir.glob("*.svg")) if badge_dir.is_dir() else []
    orphans = [
        str(path.relative_to(root)) for path in existing if str(path.relative_to(root)) not in badges
    ]
    if check:
        return stale + orphans
    if badges:
        badge_dir.mkdir(parents=True, exist_ok=True)
    for path in stale:
        (root / path).write_text(badges[path], encoding="utf-8")
    for path in orphans:
        (root / path).unlink()
    return stale + orphans


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
