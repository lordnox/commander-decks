#!/usr/bin/env python3
"""Render a Markdown table of cards added and removed between two deck-list revisions."""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS.parents[3]


def load_cache_deck():
    spec = importlib.util.spec_from_file_location("cache_deck", SCRIPTS / "cache_deck.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cache_deck = load_cache_deck()


def normalized_name(name: str) -> str:
    value = unicodedata.normalize("NFKD", name).casefold()
    return " ".join(value.split())


def read_ref(ref: str | None, path: Path) -> str | None:
    relative = path.relative_to(REPO_ROOT).as_posix()
    if ref is None:
        return path.read_text(encoding="utf-8") if path.is_file() else None
    result = subprocess.run(
        ["git", "show", f"{ref}:{relative}"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout if result.returncode == 0 else None


def quantities(text: str | None) -> dict[str, tuple[str, int]]:
    """Map each normalized card name to its display name and quantity."""
    if text is None:
        return {}
    with tempfile.TemporaryDirectory() as directory:
        temporary = Path(directory) / "decklist.txt"
        temporary.write_text(text, encoding="utf-8")
        cards, _ = cache_deck.parse_decklist(temporary)
    counts: dict[str, tuple[str, int]] = {}
    for card in cards:
        if any("{noDeck}" in category for category in card.get("submitted_categories", [])):
            continue
        name = card["submitted_name"]
        key = normalized_name(name)
        _, previous = counts.get(key, (name, 0))
        counts[key] = (name, previous + card["quantity"])
    return counts


def scryfall_links(wanted: set[str], refs: list[str | None]) -> dict[str, str]:
    """Map the requested card names to Scryfall URLs, preferring the newest revision available."""
    links: dict[str, str] = {}
    for ref in refs:
        missing = wanted - set(links)
        if not missing:
            break
        index_text = read_ref(ref, REPO_ROOT / "cards/index.json")
        if not index_text:
            continue
        names = json.loads(index_text).get("names", {})
        aliases = {normalized_name(alias): oracle_id for alias, oracle_id in names.items()}
        for key in missing:
            oracle_id = aliases.get(key)
            if not oracle_id:
                continue
            cache_text = read_ref(ref, REPO_ROOT / f"cards/{oracle_id}.json")
            if not cache_text:
                continue
            uri = json.loads(cache_text).get("scryfall_uri")
            if uri:
                links[key] = uri.split("?", 1)[0]
    return links


def cell(name: str, delta: int, links: dict[str, str]) -> str:
    uri = links.get(normalized_name(name))
    label = f"[{name}]({uri})" if uri else name
    return f"{label} ×{delta}" if delta > 1 else label


def render(deck_dir: Path, base: str, head: str | None) -> str:
    decklist = deck_dir / "decklist.txt"
    before = quantities(read_ref(base, decklist))
    after = quantities(read_ref(head, decklist))
    if not after:
        raise FileNotFoundError(f"no deck list found for {head or 'the working tree'}")

    changes: list[tuple[str, str, int]] = []
    for key in sorted(set(before) | set(after)):
        old_name, old_count = before.get(key, (None, 0))
        new_name, new_count = after.get(key, (None, 0))
        delta = new_count - old_count
        if delta:
            changes.append((key, new_name or old_name, delta))

    links = scryfall_links({key for key, _, _ in changes}, [head, base])
    added = [cell(name, delta, links) for _, name, delta in changes if delta > 0]
    removed = [cell(name, -delta, links) for _, name, delta in changes if delta < 0]

    if not added and not removed:
        return f"No card changes in `{deck_dir.name}`.\n"

    lines = ["| In | Out |", "|---|---|"]
    for index in range(max(len(added), len(removed))):
        lines.append(f"| {added[index] if index < len(added) else '—'} "
                     f"| {removed[index] if index < len(removed) else '—'} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", type=Path, help="deck directory or decklist.txt path")
    parser.add_argument("--base", default="origin/main", help="git ref holding the previous list")
    parser.add_argument("--head", default=None, help="git ref for the new list; default is the working tree")
    args = parser.parse_args()

    target = args.deck.resolve()
    deck_dir = target.parent if target.is_file() else target
    try:
        deck_dir.relative_to(REPO_ROOT / "decks")
    except ValueError:
        parser.error("deck must be inside decks/<deck-name>/")

    try:
        print(render(deck_dir, args.base, args.head), end="")
    except (FileNotFoundError, json.JSONDecodeError) as error:
        print(f"deck_change_table.py: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
