#!/usr/bin/env python3
"""Resolve a deck list with Scryfall and maintain the repository card cache."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.scryfall.com"
USER_AGENT = "commander-decks/1.0"
SECTION_NAMES = {
    "commander", "commanders", "deck", "mainboard", "sideboard", "maybeboard",
    "considering", "creatures", "instants", "sorceries", "artifacts",
    "enchantments", "planeswalkers", "lands", "other",
}
COUNTED_CARD = re.compile(r"^(?P<count>\d+)\s*x?\s+(?P<name>.+?)\s*$", re.IGNORECASE)
SET_SUFFIX = re.compile(r"\s+\([A-Z0-9]{2,8}\)\s+[A-Za-z0-9-]+(?:\s+\*\w+\*)?\s*$")


def normalized_name(name: str) -> str:
    value = unicodedata.normalize("NFKD", name).casefold()
    return " ".join(value.split())


def clean_card_name(value: str) -> str:
    value = SET_SUFFIX.sub("", value.strip())
    return re.sub(r"\s+\*(?:F|E|ETCHED)\*\s*$", "", value, flags=re.IGNORECASE).strip()


def parse_decklist(path: Path) -> tuple[list[dict], list[dict]]:
    merged: OrderedDict[str, dict] = OrderedDict()
    ignored: list[dict] = []

    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith(("#", "//")):
            continue
        heading = line.rstrip(":").strip().casefold()
        if heading in SECTION_NAMES or line.endswith(":"):
            continue

        match = COUNTED_CARD.match(line)
        if match:
            quantity = int(match.group("count"))
            name = clean_card_name(match.group("name"))
        else:
            quantity = 1
            name = clean_card_name(line)

        if not name:
            ignored.append({"line": number, "text": raw, "reason": "empty card name"})
            continue

        key = normalized_name(name)
        if key in merged:
            merged[key]["quantity"] += quantity
        else:
            merged[key] = {"quantity": quantity, "submitted_name": name, "line": number}

    return list(merged.values()), ignored


def api_json(path: str, params: dict[str, str]) -> dict:
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def lookup_card(name: str) -> dict:
    try:
        return api_json("/cards/named", {"exact": name})
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    return api_json("/cards/named", {"fuzzy": name})


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("decklist", type=Path)
    parser.add_argument("--refresh", action="store_true", help="refresh already cached cards")
    args = parser.parse_args()

    decklist = args.decklist.resolve()
    if not decklist.is_file():
        parser.error(f"deck list not found: {decklist}")

    repo_root = Path(__file__).resolve().parents[4]
    try:
        deck_dir = decklist.parent
        deck_dir.relative_to(repo_root / "decks")
    except ValueError:
        parser.error("deck list must be inside decks/<deck-name>/")

    cache_dir = repo_root / "cards"
    index_path = cache_dir / "index.json"
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding="utf-8"))
    else:
        index = {"schema_version": 1, "names": {}}
    aliases: dict[str, str] = index.setdefault("names", {})

    submitted, ignored = parse_decklist(decklist)
    resolved: list[dict] = []
    unresolved: list[dict] = list(ignored)

    for entry in submitted:
        submitted_name = entry["submitted_name"]
        key = normalized_name(submitted_name)
        oracle_id = aliases.get(key)
        cache_path = cache_dir / f"{oracle_id}.json" if oracle_id else None
        card = None

        if cache_path and cache_path.exists() and not args.refresh:
            card = json.loads(cache_path.read_text(encoding="utf-8"))
        else:
            try:
                card = lookup_card(submitted_name)
                time.sleep(0.1)
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
                unresolved.append({
                    "line": entry["line"],
                    "text": submitted_name,
                    "reason": str(error),
                })
                continue

            oracle_id = card.get("oracle_id")
            if not oracle_id:
                unresolved.append({
                    "line": entry["line"],
                    "text": submitted_name,
                    "reason": "Scryfall response has no oracle_id",
                })
                continue
            cache_path = cache_dir / f"{oracle_id}.json"
            write_json(cache_path, card)

        oracle_id = card["oracle_id"]
        canonical_name = card["name"]
        aliases[key] = oracle_id
        aliases[normalized_name(canonical_name)] = oracle_id
        resolved.append({
            "quantity": entry["quantity"],
            "name": canonical_name,
            "submitted_name": submitted_name,
            "oracle_id": oracle_id,
            "cache": f"cards/{oracle_id}.json",
            "scryfall_uri": card.get("scryfall_uri"),
        })

    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    write_json(index_path, index)

    manifest = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": str(decklist.relative_to(repo_root)),
        "total_cards": sum(card["quantity"] for card in resolved),
        "unique_cards": len(resolved),
        "unresolved": unresolved,
        "cards": resolved,
    }
    write_json(deck_dir / "cards.json", manifest)

    print(
        f"Resolved {manifest['total_cards']} cards "
        f"({manifest['unique_cards']} unique); {len(unresolved)} unresolved."
    )
    if unresolved:
        for item in unresolved:
            print(f"line {item['line']}: {item['text']} — {item['reason']}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
