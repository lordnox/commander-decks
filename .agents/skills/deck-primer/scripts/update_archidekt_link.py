#!/usr/bin/env python3
"""Create or verify a deck primer's action buttons."""

from __future__ import annotations

import argparse
import json
import re
import uuid
from pathlib import Path
from urllib.parse import quote

BADGE_BUTTON = "https://img.shields.io/badge/{label}-{color}?style=for-the-badge"
ARCHIDEKT_COLOR = "0b6b58"
DECISIONS_COLOR = "4b5563"
DECISION_FILES = ("DECISIONS.md", "decisions.json")

ACTIONS_PATTERN = re.compile(
    r"^\[!\[Open in Archidekt\]\([^)]*\)\]\(https://archidekt\.com/sandbox\?deck=[^)]*\)"
    r"(?: \[!\[[^\]]*\]\([^)]*\)\]\([^)]*\))*$",
    re.MULTILINE,
)
LEGACY_LINK_PATTERN = re.compile(
    r"^\[\*\*Open this deck in Archidekt\*\*\]\(https://archidekt\.com/sandbox\?deck=.*\)$",
    re.MULTILINE,
)
LEGACY_DECISIONS_HINT = re.compile(
    r"^Reasons for the list, cuts, and rules checks are in \[[^\]]+\]\([^)]+\)\.\n+",
    re.MULTILINE,
)


def parse_overrides(values: list[str]) -> dict[str, str]:
    overrides: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"invalid printing override: {value!r}")
        name, printing_id = (part.strip() for part in value.split("=", 1))
        if not name:
            raise ValueError(f"invalid printing override: {value!r}")
        overrides[name.casefold()] = validate_printing_id(name, printing_id)
    return overrides


def validate_printing_id(name: str, printing_id: str) -> str:
    try:
        uuid.UUID(printing_id)
    except ValueError as error:
        raise ValueError(
            f"invalid Scryfall printing UUID for {name}: {printing_id}"
        ) from error
    return printing_id


def load_file_overrides(deck_dir: Path) -> dict[str, str]:
    path = deck_dir / "printing-overrides.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"invalid printing overrides: {path}")
    cards = data.get("cards", data)
    if "schema_version" in cards:
        cards = {key: value for key, value in cards.items() if key != "schema_version"}
    if not isinstance(cards, dict):
        raise ValueError(f"invalid printing overrides: {path}")
    overrides: dict[str, str] = {}
    for name, printing_id in cards.items():
        if not isinstance(name, str) or not isinstance(printing_id, str):
            raise ValueError(f"invalid printing override for {name!r}")
        overrides[name.casefold()] = validate_printing_id(name, printing_id)
    return overrides


def merged_overrides(deck_dir: Path, cli_overrides: dict[str, str]) -> dict[str, str]:
    return {**load_file_overrides(deck_dir), **cli_overrides}


def repository_root(deck_dir: Path) -> Path:
    for parent in (deck_dir, *deck_dir.parents):
        if (parent / "cards").is_dir() and (parent / "decks").is_dir():
            return parent
    raise FileNotFoundError("could not locate repository root")


def archidekt_payload(
    deck_dir: Path, overrides: dict[str, str]
) -> tuple[list[dict[str, object]], int]:
    manifest_path = deck_dir / "cards.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"missing manifest: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    root = repository_root(deck_dir)
    payload: list[dict[str, object]] = []
    total = 0
    commander_count = 0

    for entry in manifest.get("cards", []):
        name = entry.get("name", "")
        quantity = entry.get("quantity", 0)
        if not name or not isinstance(quantity, int) or quantity < 1:
            raise ValueError(f"invalid manifest entry: {entry!r}")
        if any("{noDeck}" in category for category in entry.get("categories", [])):
            continue

        override = overrides.get(name.casefold())
        cache_path = root / entry.get("cache", "")
        if override:
            printing_id = override
        else:
            if not cache_path.is_file():
                raise FileNotFoundError(f"missing cache for {name}: {cache_path}")
            card = json.loads(cache_path.read_text(encoding="utf-8"))
            games = card.get("games")
            paper = (
                not card.get("digital")
                and not card.get("oversized")
                and (not games or "paper" in games)
            )
            if not paper:
                raise ValueError(
                    f"{name} uses a digital-only or oversized cached printing; add it to "
                    "printing-overrides.json or pass "
                    f"--printing-override '{name}=paper-scryfall-printing-uuid'"
                )
            printing_id = card.get("id")
            try:
                uuid.UUID(printing_id)
            except (TypeError, ValueError) as error:
                raise ValueError(f"invalid cached printing UUID for {name}") from error

        is_commander = "Commander{top}" in entry.get("categories", [])
        commander_count += int(is_commander)
        total += quantity
        payload.append(
            {
                "u": printing_id,
                "q": quantity,
                "f": 0,
                "c": "c" if is_commander else "m",
            }
        )

    if not payload:
        raise ValueError("manifest contains no resolved cards")
    if commander_count != 1:
        raise ValueError(f"expected exactly one commander, found {commander_count}")
    return payload, total


def badge_button(label: str, color: str, href: str) -> str:
    badge = BADGE_BUTTON.format(label=quote(label, safe=""), color=color)
    return f"[![{label}]({badge})]({href})"


def decision_file(deck_dir: Path) -> str | None:
    for name in DECISION_FILES:
        if (deck_dir / name).is_file():
            return name
    return None


def actions_line(deck_dir: Path, payload: list[dict[str, object]]) -> str:
    compact = json.dumps(payload, separators=(",", ":"))
    url = "https://archidekt.com/sandbox?deck=" + quote(compact, safe="")
    buttons = [badge_button("Open in Archidekt", ARCHIDEKT_COLOR, url)]
    decisions = decision_file(deck_dir)
    if decisions:
        buttons.append(badge_button("Decisions", DECISIONS_COLOR, decisions))
    return " ".join(buttons)


def insert_after_assessment(original: str, expected: str) -> str:
    body = LEGACY_DECISIONS_HINT.sub("", original)
    body = LEGACY_LINK_PATTERN.sub("", body)
    body = ACTIONS_PATTERN.sub("", body)
    lines = body.splitlines(keepends=True)
    if not lines or not lines[0].startswith("# "):
        raise ValueError("primer must begin with a Markdown H1 title")
    newline = "\r\n" if lines[0].endswith("\r\n") else "\n"
    index = 1
    while index < len(lines) and not lines[index].strip():
        index += 1
    quotes = []
    while index < len(lines) and lines[index].lstrip().startswith(">"):
        quotes.append(lines[index].rstrip())
        index += 1
    prefix_parts = [lines[0].rstrip()]
    if quotes:
        prefix_parts.extend(["", *quotes])
    prefix = newline.join(prefix_parts)
    suffix = "".join(lines[index:]).lstrip()
    parts = [prefix, "", expected, ""]
    if suffix:
        parts.append(suffix if suffix.endswith(("\n", "\r\n")) else suffix + newline)
    return newline.join(parts)


def update_primer(
    deck_dir: Path, overrides: dict[str, str], *, check: bool = False
) -> int:
    readme_path = deck_dir / "README.md"
    if not readme_path.is_file():
        raise FileNotFoundError(f"missing primer: {readme_path}")

    payload, total = archidekt_payload(deck_dir, overrides)
    expected = actions_line(deck_dir, payload)
    original = readme_path.read_text(encoding="utf-8")
    updated = insert_after_assessment(original, expected)

    if check and updated != original:
        print(f"{readme_path}: action buttons are missing or stale")
        return 1
    if updated != original:
        readme_path.write_text(updated, encoding="utf-8")
    print(
        f"{readme_path}: action buttons current "
        f"({len(payload)} unique, {total} total, 1 commander)"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", type=Path, help="deck directory or README.md path")
    parser.add_argument(
        "--printing-override",
        action="append",
        default=[],
        metavar="NAME=UUID",
        help="use a paper Scryfall printing UUID for one card",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="report missing or stale action buttons without changing the README",
    )
    args = parser.parse_args()

    target = args.deck.resolve()
    deck_dir = target.parent if target.is_file() else target
    try:
        overrides = merged_overrides(deck_dir, parse_overrides(args.printing_override))
        return update_primer(deck_dir, overrides, check=args.check)
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
