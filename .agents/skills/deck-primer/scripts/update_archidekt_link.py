#!/usr/bin/env python3
"""Create or verify an Archidekt sandbox link in a deck primer."""

from __future__ import annotations

import argparse
import json
import re
import uuid
from pathlib import Path
from urllib.parse import quote

LINK_PATTERN = re.compile(
    r"^\[\*\*Open this deck in Archidekt\*\*\]\(https://archidekt\.com/sandbox\?deck=.*\)$",
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
        try:
            uuid.UUID(printing_id)
        except ValueError as error:
            raise ValueError(
                f"invalid Scryfall printing UUID for {name}: {printing_id}"
            ) from error
        overrides[name.casefold()] = printing_id
    return overrides


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
            if card.get("digital") or "paper" not in card.get("games", []):
                raise ValueError(
                    f"{name} uses a digital-only cached printing; provide "
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


def link_line(payload: list[dict[str, object]]) -> str:
    compact = json.dumps(payload, separators=(",", ":"))
    url = "https://archidekt.com/sandbox?deck=" + quote(compact, safe="")
    return f"[**Open this deck in Archidekt**]({url})"


def update_primer(
    deck_dir: Path, overrides: dict[str, str], *, check: bool = False
) -> int:
    readme_path = deck_dir / "README.md"
    if not readme_path.is_file():
        raise FileNotFoundError(f"missing primer: {readme_path}")

    payload, total = archidekt_payload(deck_dir, overrides)
    expected = link_line(payload)
    original = readme_path.read_text(encoding="utf-8")
    match = LINK_PATTERN.search(original)

    if match:
        updated = original[: match.start()] + expected + original[match.end() :]
    else:
        lines = original.splitlines(keepends=True)
        if not lines or not lines[0].startswith("# "):
            raise ValueError("primer must begin with a Markdown H1 title")
        newline = "\r\n" if lines[0].endswith("\r\n") else "\n"
        updated = lines[0] + newline + expected + newline + "".join(lines[1:])

    if check and updated != original:
        print(f"{readme_path}: Archidekt link is missing or stale")
        return 1
    if updated != original:
        readme_path.write_text(updated, encoding="utf-8")
    print(
        f"{readme_path}: Archidekt link current "
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
        help="report a missing or stale Archidekt link without changing the README",
    )
    args = parser.parse_args()

    target = args.deck.resolve()
    deck_dir = target.parent if target.is_file() else target
    try:
        overrides = parse_overrides(args.printing_override)
        return update_primer(deck_dir, overrides, check=args.check)
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
