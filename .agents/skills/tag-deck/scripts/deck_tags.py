"""Load, validate, and render Archidekt-based deck tags."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote

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
OVERVIEW_START = "<!-- deck-overview:start -->"
OVERVIEW_END = "<!-- deck-overview:end -->"
OVERVIEW_SECTION = re.compile(
    rf"{re.escape(OVERVIEW_START)}.*?{re.escape(OVERVIEW_END)}",
    re.DOTALL,
)
PRIMER_LINK = re.compile(
    r"^- `(?P<badge>[^`]+)` \[(?P<label>[^\]]+)\]\((?P<path>decks/[^)]+/README\.md)\)\s*$"
)
ARCHIDEKT_LINK = re.compile(
    r"^\[\*\*Open this deck in Archidekt\*\*\]\(https://archidekt\.com/sandbox\?deck=.*\)$",
    re.MULTILINE,
)
SHIELD_COLOR = "0e7c66"


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
    return (
        f"https://img.shields.io/static/v1?label={label}&message={message}"
        f"&color={SHIELD_COLOR}&style=flat-square"
    )


def badge_markdown(tag: dict) -> str:
    alt = f"{tag['name']} {tag['score']}"
    return f"[![{alt}]({shield_url(tag['name'], tag['score'])})]({tag['url']})"


def primer_section(tags: list[dict]) -> str:
    if not tags:
        body = "_No Archidekt tags reach this deck's display cutoff._"
    else:
        body = " ".join(badge_markdown(tag) for tag in tags)
    return f"{PRIMER_START}\n{body}\n{PRIMER_END}"


def overview_section(summary: str, tags: list[dict]) -> str:
    lines = [OVERVIEW_START, summary.strip()]
    if tags:
        lines.append(" ".join(badge_markdown(tag) for tag in tags))
    lines.append(OVERVIEW_END)
    return "\n".join(lines)


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


def primer_entries(text: str) -> list[tuple[str, str, str, int]]:
    start = text.find("## Deck primers")
    if start < 0:
        return []
    rest = text[start:]
    next_heading = rest.find("\n## ", 1)
    section = rest if next_heading < 0 else rest[:next_heading]
    entries = []
    offset = start
    for line in section.splitlines(keepends=True):
        match = PRIMER_LINK.match(line.rstrip("\n"))
        if match:
            entries.append(
                (
                    match.group("badge"),
                    match.group("label"),
                    match.group("path"),
                    offset,
                )
            )
        offset += len(line)
    return entries


def replace_root_overview(text: str, primer_path: str, section: str) -> str:
    entries = primer_entries(text)
    match = next((entry for entry in entries if entry[2] == primer_path), None)
    if match is None:
        raise ValueError(f"root README has no primer link for {primer_path}")
    _, _, _, start = match
    line_end = text.find("\n", start)
    if line_end < 0:
        line_end = len(text)
    after = text[line_end:]
    overview = OVERVIEW_SECTION.match(after.lstrip("\n"))
    prefix = text[: line_end + 1] if line_end < len(text) else text + "\n"
    if overview:
        stripped = after.lstrip("\n")
        rest = stripped[overview.end() :]
        if rest.startswith("\n"):
            rest = rest[1:]
        return prefix + section + "\n" + rest
    return prefix + section + "\n" + after.lstrip("\n")


def relative_primer_path(deck_dir: Path, root: Path) -> str:
    return str((deck_dir / "README.md").relative_to(root))
