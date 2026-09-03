#!/usr/bin/env python3
"""Refresh the cached Game Changers snapshot in BRACKET-DEFINITIONS.md."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

SEARCH_URL = (
    "https://api.scryfall.com/cards/search"
    "?q=is%3Agamechanger&unique=cards&order=name"
)
HEADERS = {"User-Agent": "commander-decks/1.0", "Accept": "application/json"}
START = "<!-- game-changers:start -->"
END = "<!-- game-changers:end -->"
BLOCK = re.compile(re.escape(START) + r".*?" + re.escape(END), re.DOTALL)

# Wizards groups the printed list this way; keep the same order.
GROUPS = [
    ("White", ("W",)),
    ("Blue", ("U",)),
    ("Black", ("B",)),
    ("Red", ("R",)),
    ("Green", ("G",)),
]


def repository_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "BRACKET-DEFINITIONS.md").is_file():
            return candidate
    raise FileNotFoundError("BRACKET-DEFINITIONS.md not found above " + str(start))


def fetch_game_changers() -> list[dict]:
    cards: list[dict] = []
    url = SEARCH_URL
    while url:
        request = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(request) as response:
            payload = json.load(response)
        cards.extend(payload["data"])
        url = payload.get("next_page") if payload.get("has_more") else None
        if url:
            time.sleep(0.1)
    return cards


def group_of(card: dict) -> str:
    identity = tuple(card.get("color_identity") or ())
    if not identity:
        return "Colorless"
    if len(identity) > 1:
        return "Multicolor"
    for label, colors in GROUPS:
        if identity == colors:
            return label
    return "Multicolor"


def render(cards: list[dict], snapshot: str) -> str:
    grouped: dict[str, list[dict]] = {}
    for card in cards:
        grouped.setdefault(group_of(card), []).append(card)

    lines = [
        START,
        f"Snapshot of Scryfall `is:gamechanger` taken {snapshot}: **{len(cards)} cards**.",
        "",
        "| Group | Cards |",
        "| --- | --- |",
    ]
    for label in [name for name, _ in GROUPS] + ["Multicolor", "Colorless"]:
        entries = sorted(grouped.get(label, []), key=lambda card: card["name"])
        if not entries:
            continue
        links = ", ".join(
            f"[{card['name']}]({card['scryfall_uri'].split('?')[0]})" for card in entries
        )
        lines.append(f"| {label} ({len(entries)}) | {links} |")
    lines.extend(["", END])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the cached snapshot differs from Scryfall",
    )
    parser.add_argument(
        "--date",
        default=date.today().isoformat(),
        help="snapshot date written into the block (default: today)",
    )
    args = parser.parse_args()

    root = repository_root(Path(__file__).resolve().parent)
    target = root / "BRACKET-DEFINITIONS.md"
    original = target.read_text(encoding="utf-8")
    if not BLOCK.search(original):
        print(f"{target}: missing {START} / {END} markers", file=sys.stderr)
        return 1

    try:
        cards = fetch_game_changers()
    except (urllib.error.URLError, urllib.error.HTTPError) as error:
        print(f"Scryfall request failed: {error}", file=sys.stderr)
        return 2

    names = sorted(card["name"] for card in cards)
    cached = sorted(re.findall(r"\[([^\]]+)\]\(https://scryfall\.com/card/", BLOCK.search(original).group(0)))

    if args.check:
        if names != cached:
            missing = sorted(set(names) - set(cached))
            extra = sorted(set(cached) - set(names))
            print(f"{target}: cached snapshot is stale ({len(cached)} cached, {len(names)} live)")
            if missing:
                print("  add: " + ", ".join(missing))
            if extra:
                print("  remove: " + ", ".join(extra))
            return 1
        print(f"{target}: cached snapshot matches Scryfall ({len(names)} cards)")
        return 0

    updated = BLOCK.sub(lambda _: render(cards, args.date), original, count=1)
    if updated != original:
        target.write_text(updated, encoding="utf-8")
    print(f"{target}: cached {len(names)} Game Changer(s) as of {args.date}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
