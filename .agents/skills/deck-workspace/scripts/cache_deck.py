#!/usr/bin/env python3
"""Resolve a deck list with Scryfall and maintain card and category caches."""

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


def read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def infer_categories(card: dict) -> list[str]:
    """Provide conservative universal defaults for later agent review."""
    faces = card.get("card_faces") or [card]
    text = " ".join(face.get("oracle_text", "") for face in faces).casefold()
    type_line = " ".join(face.get("type_line", "") for face in faces)
    categories: list[str] = []

    def add(category: str) -> None:
        if category not in categories:
            categories.append(category)

    if "Land" in type_line:
        add("land")
    if re.search(r"\b(add [\{a-z]|search your library for (?:a basic|up to .* land|a .* land))", text):
        add("ramp")
    if re.search(r"\bdraw (?:a|one|two|three|x|that many|cards?)\b", text):
        add("card-draw")
    if "counter target spell" in text:
        add("counterspell")
    if re.search(r"\b(?:destroy|exile) (?:target|up to one|another)\b", text):
        add("removal")
    if re.search(r"\b(?:destroy|exile) all\b", text):
        add("board-wipe")
    if re.search(r"\b(?:hexproof|indestructible|protection from)\b", text):
        add("protection")
    if "search your library for" in text and "land" not in text:
        add("tutor")
    if re.search(r"return .* from your graveyard|return target .* card from .* graveyard", text):
        add("recursion")
    if "create" in text and " token" in text:
        add("token-production")
    if re.search(r"exile .* then return|exile .* return (?:it|that card)", text):
        add("blink")
    if "sacrifice" in text:
        add("sacrifice")
    if "discard" in text:
        add("discard")
    if not categories:
        add("other")
    return categories



def compact_card_details(card: dict) -> dict:
    """Embed analysis-relevant Oracle data in the deck manifest."""
    fields = (
        "mana_cost", "type_line", "oracle_text", "power", "toughness",
        "loyalty", "defense",
    )
    details = {
        field: card[field]
        for field in fields
        if card.get(field) is not None
    }
    details["keywords"] = card.get("keywords", [])

    faces = card.get("card_faces")
    if faces:
        details["faces"] = [
            {
                field: face[field]
                for field in ("name",) + fields
                if face.get(field) is not None
            }
            for face in faces
        ]

    return details


def category_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return ["other"]
    categories = list(dict.fromkeys(
        str(item).strip().casefold().replace(" ", "-")
        for item in value if str(item).strip()
    ))
    return categories or ["other"]


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
    category_path = cache_dir / "categories.json"
    override_path = deck_dir / "category-overrides.json"

    index = read_json(index_path, {"schema_version": 1, "names": {}})
    category_registry = read_json(category_path, {"schema_version": 1, "cards": {}})
    overrides = read_json(override_path, {"schema_version": 1, "cards": {}})
    aliases: dict[str, str] = index.setdefault("names", {})
    universal_cards: dict[str, dict] = category_registry.setdefault("cards", {})
    override_cards: dict[str, dict] = overrides.setdefault("cards", {})

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
            card = read_json(cache_path, {})
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

        universal = universal_cards.setdefault(oracle_id, {
            "name": canonical_name,
            "categories": infer_categories(card),
        })
        universal["name"] = canonical_name
        universal["categories"] = category_list(universal.get("categories"))

        override = override_cards.get(oracle_id)
        if override is not None:
            categories = category_list(override.get("categories"))
            category_source = "deck"
        else:
            categories = universal["categories"]
            category_source = "universal"

        resolved.append({
            "quantity": entry["quantity"],
            "name": canonical_name,
            "submitted_name": submitted_name,
            "oracle_id": oracle_id,
            "cache": f"cards/{oracle_id}.json",
            "categories": categories,
            "category_source": category_source,
            "scryfall_uri": card.get("scryfall_uri"),
            "card": compact_card_details(card),
        })

    now = datetime.now(timezone.utc).isoformat()
    index["updated_at"] = now
    category_registry["updated_at"] = now
    write_json(index_path, index)
    write_json(category_path, category_registry)

    manifest = {
        "schema_version": 3,
        "generated_at": now,
        "source": str(decklist.relative_to(repo_root)),
        "total_cards": sum(card["quantity"] for card in resolved),
        "unique_cards": len(resolved),
        "categorized_cards": sum(bool(card["categories"]) for card in resolved),
        "unresolved": unresolved,
        "cards": resolved,
    }
    write_json(deck_dir / "cards.json", manifest)

    print(
        f"Resolved {manifest['total_cards']} cards "
        f"({manifest['unique_cards']} unique, "
        f"{manifest['categorized_cards']} categorized); "
        f"{len(unresolved)} unresolved."
    )
    if unresolved:
        for item in unresolved:
            print(f"line {item['line']}: {item['text']} — {item['reason']}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
