"""Load, validate, and render Archidekt-based deck tags."""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from urllib.parse import quote

RANKING_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "rank-deck/scripts"
RANKING_SPEC = importlib.util.spec_from_file_location(
    "deck_rankings",
    RANKING_SCRIPT_DIR / "deck_rankings.py",
)
deck_rankings = importlib.util.module_from_spec(RANKING_SPEC)
RANKING_SPEC.loader.exec_module(deck_rankings)

SCHEMA_VERSION = 1
MIN_SCORE = 1
MAX_SCORE = 5
DEFAULT_CUTOFF = 3
PRIMER_START = "<!-- deck-tags:start -->"
PRIMER_END = "<!-- deck-tags:end -->"
PRIMER_SECTION = re.compile(
    rf"{re.escape(PRIMER_START)}.*?{re.escape(PRIMER_END)}",
    re.DOTALL,
)
INDEX_START = "<!-- deck-index:start -->"
INDEX_END = "<!-- deck-index:end -->"
INDEX_SECTION = re.compile(
    rf"{re.escape(INDEX_START)}.*?{re.escape(INDEX_END)}",
    re.DOTALL,
)
ARCHIDEKT_LINK = re.compile(
    r"^\[!\[Open in Archidekt\]\([^)]*\)\]\(https://archidekt\.com/sandbox\?deck=[^)]*\)"
    r"(?: \[!\[[^\]]*\]\([^)]*\)\]\([^)]*\))*$",
    re.MULTILINE,
)
MARKDOWN_LINK = re.compile(r"\[(?P<label>[^\]]+)\]\([^)]*\)")
DECK_PREFIX = re.compile(r"^(?P<bracket>\d+)(?P<modifier>[+-]?)_")
SHIELD_COLORS = {5: "0b6b58", 4: "2f7d6a", 3: "5f8b84"}
SHIELD_FALLBACK_COLOR = "6b7f7a"
OVERFLOW_COLOR = "6b7280"
INDEX_BADGE_LIMIT = 3
BRACKET_NAMES = {
    1: "Exhibition",
    2: "Core",
    3: "Upgraded",
    4: "Optimized",
    5: "cEDH",
}


def repository_root(start: Path) -> Path:
    for parent in (start, *start.parents):
        if (parent / "cards").is_dir() and (parent / "decks").is_dir():
            return parent
    raise FileNotFoundError("could not locate repository root")


def catalog_path(root: Path) -> Path:
    return root / ".agents/skills/tag-deck/archidekt-tags.json"


def load_catalog(root: Path) -> dict:
    path = catalog_path(root)
    if not path.is_file():
        raise FileNotFoundError(f"missing Archidekt tag catalog: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    tags = data.get("tags")
    if not isinstance(tags, list) or not tags:
        raise ValueError(f"invalid Archidekt tag catalog: {path}")
    by_name = {}
    for entry in tags:
        name = entry.get("name")
        slug = entry.get("slug")
        url = entry.get("url")
        if not isinstance(name, str) or not isinstance(slug, str) or not isinstance(url, str):
            raise ValueError(f"invalid catalog tag: {entry!r}")
        by_name[name] = {"name": name, "slug": slug, "url": url}
    data["by_name"] = by_name
    data["default_cutoff"] = int(data.get("default_cutoff") or DEFAULT_CUTOFF)
    return data


def load_deck_tags(deck_dir: Path) -> dict:
    path = deck_dir / "tags.json"
    if not path.is_file():
        raise FileNotFoundError(f"missing tags.json: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"invalid tags.json: {path}")
    return data


def visible_tags(deck: dict, catalog: dict) -> list[dict]:
    cutoff = int(deck.get("cutoff") or catalog.get("default_cutoff") or DEFAULT_CUTOFF)
    by_name = catalog["by_name"]
    visible = []
    for entry in deck.get("tags") or []:
        name = entry.get("name")
        score = entry.get("score")
        if name not in by_name:
            raise ValueError(f"unknown Archidekt tag: {name!r}")
        if not isinstance(score, int) or not MIN_SCORE <= score <= MAX_SCORE:
            raise ValueError(f"tag {name!r} score must be an integer {MIN_SCORE}-{MAX_SCORE}")
        if score >= cutoff:
            visible.append({**by_name[name], "score": score})
    visible.sort(key=lambda item: (-item["score"], item["name"].casefold()))
    return visible


def validate_deck_tags(deck: dict, catalog: dict) -> list[str]:
    errors = []
    if deck.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"tags.json schema_version must be {SCHEMA_VERSION}")
    summary = deck.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        errors.append("tags.json needs a non-empty summary")
    cutoff = deck.get("cutoff", catalog.get("default_cutoff") or DEFAULT_CUTOFF)
    if not isinstance(cutoff, int) or cutoff < MIN_SCORE:
        errors.append("tags.json cutoff must be a positive integer")
    tags = deck.get("tags")
    if not isinstance(tags, list) or not tags:
        errors.append("tags.json needs at least one scored tag")
        return errors
    seen = set()
    by_name = catalog["by_name"]
    for entry in tags:
        if not isinstance(entry, dict):
            errors.append(f"invalid tag entry: {entry!r}")
            continue
        name = entry.get("name")
        score = entry.get("score")
        reason = entry.get("reason")
        if name in seen:
            errors.append(f"duplicate tag: {name}")
        seen.add(name)
        if name not in by_name:
            errors.append(f"tag is not in the Archidekt catalog: {name!r}")
        if not isinstance(score, int) or not MIN_SCORE <= score <= MAX_SCORE:
            errors.append(f"tag {name!r} score must be an integer {MIN_SCORE}-{MAX_SCORE}")
        if not isinstance(reason, str) or not reason.strip():
            errors.append(f"tag {name!r} needs a reason")
    return errors


def shield_url(name: str, score: int) -> str:
    label = quote(str(score), safe="")
    message = quote(name, safe="")
    color = SHIELD_COLORS.get(score, SHIELD_FALLBACK_COLOR)
    return (
        f"https://img.shields.io/static/v1?label={label}&message={message}"
        f"&color={color}&style=flat-square"
    )


def badge_markdown(tag: dict) -> str:
    alt = f"{tag['name']} {tag['score']}"
    return f"[![{alt}]({shield_url(tag['name'], tag['score'])})]({tag['url']})"


def index_tag_link(tag: dict) -> str:
    """Root-index tags are plain names; their scores stay on the primer badges."""
    return f"[{tag['name']}]({tag['url']})"


def primer_section(tags: list[dict]) -> str:
    if not tags:
        body = "_No Archidekt tags reach this deck's display cutoff._"
    else:
        body = " ".join(badge_markdown(tag) for tag in tags)
    return f"{PRIMER_START}\n{body}\n{PRIMER_END}"


def overflow_badge(count: int, primer_path: str) -> str:
    message = quote(f"+{count} more", safe="")
    url = (
        f"https://img.shields.io/static/v1?label=&message={message}"
        f"&color={OVERFLOW_COLOR}&style=flat-square"
    )
    return f"[![+{count} more tags]({url})]({primer_path})"


def insert_primer_section(original: str, section: str) -> str:
    if PRIMER_SECTION.search(original):
        return PRIMER_SECTION.sub(section, original, count=1)
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


def deck_title(deck_dir: Path, deck: dict) -> str:
    title = deck.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    primer = deck_dir / "README.md"
    first_line = primer.read_text(encoding="utf-8").splitlines()[0] if primer.is_file() else ""
    if not first_line.startswith("# "):
        return deck_dir.name
    return MARKDOWN_LINK.sub(lambda match: match.group("label"), first_line[2:]).strip()


def bracket_position(deck_dir_name: str) -> tuple[int, int]:
    """Sort position of a deck directory: bracket number, then −, plain, +."""
    match = DECK_PREFIX.match(deck_dir_name)
    if not match:
        return (99, 2)
    modifier = match.group("modifier")
    rank = {"-": 0, "+": 2}.get(modifier, 1)
    return (int(match.group("bracket")), rank)


def bracket_badge(deck_dir_name: str) -> str:
    match = DECK_PREFIX.match(deck_dir_name)
    if not match:
        return "Unrated"
    return match.group("bracket") + match.group("modifier").replace("-", "−")


def bracket_heading(bracket: int) -> str:
    if bracket not in BRACKET_NAMES:
        return "Unrated"
    return f"Bracket {bracket} · {BRACKET_NAMES[bracket]}"


def index_entries(root: Path, catalog: dict) -> list[dict]:
    """Collect one root-README index entry per deck that has renderable tags."""
    entries = []
    for deck_dir in sorted((root / "decks").iterdir()):
        if not (deck_dir / "tags.json").is_file() or not (deck_dir / "README.md").is_file():
            continue
        try:
            deck = load_deck_tags(deck_dir)
            if validate_deck_tags(deck, catalog):
                continue
            visible = visible_tags(deck, catalog)
        except (ValueError, json.JSONDecodeError, OSError):
            continue
        bracket, rank = bracket_position(deck_dir.name)
        ranking_inline = ""
        try:
            rankings = deck_rankings.load_rankings(deck_dir)
            if rankings is not None and not deck_rankings.validate_rankings(rankings):
                ranking_inline = deck_rankings.index_badges(rankings)
        except (ValueError, json.JSONDecodeError, OSError):
            ranking_inline = ""
        entries.append(
            {
                "bracket": bracket,
                "rank": rank,
                "badge": bracket_badge(deck_dir.name),
                "title": deck_title(deck_dir, deck),
                "path": relative_primer_path(deck_dir, root),
                "summary": str(deck["summary"]).strip(),
                "tags": visible,
                "rankings": ranking_inline,
            }
        )
    entries.sort(key=lambda entry: (entry["bracket"], entry["rank"], entry["title"].casefold()))
    return entries


def index_entry_lines(entry: dict) -> list[str]:
    shown = entry["tags"][:INDEX_BADGE_LIMIT]
    tags = [index_tag_link(tag) for tag in shown]
    hidden = len(entry["tags"]) - len(shown)
    if hidden > 0:
        tags.append(f"[+{hidden} more]({entry['path']})")
    rankings = entry.get("rankings") or ""
    lines = [f"- **[{entry['title']}]({entry['path']})** `{entry['badge']}`{rankings}<br>"]
    lines.append(f"  {entry['summary']}" + ("<br>" if tags else ""))
    if tags:
        lines.append("  <sub>" + " · ".join(tags) + "</sub>")
    return lines


def index_section(entries: list[dict]) -> str:
    lines = [INDEX_START]
    current: int | None = None
    for entry in entries:
        if entry["bracket"] != current:
            current = entry["bracket"]
            if len(lines) > 1:
                lines.append("")
            lines.append(f"### {bracket_heading(current)}")
            lines.append("")
        lines.extend(index_entry_lines(entry))
    if len(lines) == 1:
        lines.append("_No deck primers yet._")
    lines.append(INDEX_END)
    return "\n".join(lines)


def replace_primer_index(text: str, section: str) -> str:
    if not INDEX_SECTION.search(text):
        raise ValueError(
            f"root README is missing the {INDEX_START} / {INDEX_END} deck index markers"
        )
    return INDEX_SECTION.sub(lambda _: section, text, count=1)


def relative_primer_path(deck_dir: Path, root: Path) -> str:
    return str((deck_dir / "README.md").relative_to(root))
