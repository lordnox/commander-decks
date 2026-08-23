#!/usr/bin/env python3
"""Resolve a deck list with Scryfall and maintain card and category caches."""

from __future__ import annotations

import argparse
import copy
import contextlib
import hashlib
import json
import re
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows
    fcntl = None

try:
    import msvcrt
except ImportError:  # pragma: no cover - POSIX
    msvcrt = None

API = "https://api.scryfall.com"
USER_AGENT = "commander-decks/1.0"
COLLECTION_BATCH_SIZE = 75
REQUEST_DELAY = 0.1
SECTION_NAMES = {
    "commander", "commanders", "deck", "mainboard", "sideboard", "maybeboard",
    "considering", "creatures", "instants", "sorceries", "artifacts",
    "enchantments", "planeswalkers", "lands", "other",
}
COUNTED_CARD = re.compile(r"^(?P<count>\d+)\s*x?\s+(?P<name>.+?)\s*$", re.IGNORECASE)
SET_SUFFIX = re.compile(
    r"\s+\([A-Z0-9]{2,8}\)\s+[A-Za-z0-9-]+(?:\s+\*\w+\*)?\s*$",
    re.IGNORECASE,
)
CATEGORY_SUFFIX = re.compile(r"\s+\[(?P<categories>[^]]*)\]\s*$")


def normalized_name(name: str) -> str:
    value = unicodedata.normalize("NFKD", name).casefold()
    return " ".join(value.split())


def parse_card_entry(value: str) -> tuple[str, list[str]]:
    """Separate a card name from source categories without normalizing them."""
    value = value.strip()
    category_match = CATEGORY_SUFFIX.search(value)
    categories: list[str] = []
    if category_match:
        categories = list(dict.fromkeys(
            category.strip()
            for category in category_match.group("categories").split(",")
            if category.strip()
        ))
        value = value[:category_match.start()].rstrip()

    value = SET_SUFFIX.sub("", value)
    name = re.sub(r"\s+\*(?:F|E|ETCHED)\*\s*$", "", value, flags=re.IGNORECASE).strip()
    return name, categories


def parse_decklist(path: Path) -> tuple[list[dict], list[dict]]:
    merged: OrderedDict[str, dict] = OrderedDict()
    ignored: list[dict] = []

    lines = path.read_text(encoding="utf-8").splitlines()
    # Grouped exports label every card line with a count and a category suffix, so
    # bare lines in such a file are custom section headings rather than cards.
    counted_lines = [
        line.strip()
        for line in lines
        if line.strip()
        and not line.strip().startswith(("#", "//"))
        and COUNTED_CARD.match(line.strip())
    ]
    grouped_export = bool(counted_lines) and all(
        CATEGORY_SUFFIX.search(line) for line in counted_lines
    )

    for number, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line or line.startswith(("#", "//")):
            continue
        heading = line.rstrip(":").strip().casefold()
        if heading in SECTION_NAMES or line.endswith(":"):
            continue
        if grouped_export and not COUNTED_CARD.match(line):
            continue

        match = COUNTED_CARD.match(line)
        if match:
            quantity = int(match.group("count"))
            name, submitted_categories = parse_card_entry(match.group("name"))
        else:
            quantity = 1
            name, submitted_categories = parse_card_entry(line)

        if not name:
            ignored.append({"line": number, "text": raw, "reason": "empty card name"})
            continue

        key = normalized_name(name)
        if key in merged:
            merged[key]["quantity"] += quantity
            for category in submitted_categories:
                if category not in merged[key]["submitted_categories"]:
                    merged[key]["submitted_categories"].append(category)
        else:
            merged[key] = {
                "quantity": quantity,
                "submitted_name": name,
                "submitted_categories": submitted_categories,
                "line": number,
            }

    return list(merged.values()), ignored


def api_json(path: str, params: dict[str, str]) -> dict:
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def api_post_json(path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def card_names(card: dict) -> list[str]:
    names = [card.get("name", "")]
    names.extend(face.get("name", "") for face in card.get("card_faces", []))
    return [name for name in names if name]


def is_paper_printing(card: dict) -> bool:
    """True when the cached object is usable as a paper Archidekt printing."""
    if not isinstance(card, dict) or card.get("digital"):
        return False
    games = card.get("games")
    if not games:
        return True
    return "paper" in games


def fetch_paper_printing(card: dict) -> dict:
    """Replace a digital-only Scryfall object with a paper printing when one exists."""
    if is_paper_printing(card):
        return card
    oracle_id = card.get("oracle_id")
    if not oracle_id:
        return card
    try:
        response = api_json(
            "/cards/search",
            {
                "q": f"oracleid:{oracle_id} game:paper -is:digital",
                "unique": "prints",
                "order": "released",
                "dir": "desc",
            },
        )
        time.sleep(REQUEST_DELAY)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return card
    for printing in response.get("data") or []:
        if is_paper_printing(printing):
            return printing
    return card


def lookup_collection(names: list[str]) -> tuple[dict[str, dict], list[str], int]:
    """Resolve exact names in Scryfall collection batches of at most 75."""
    resolved: dict[str, dict] = {}
    requests = 0

    for offset in range(0, len(names), COLLECTION_BATCH_SIZE):
        chunk = names[offset:offset + COLLECTION_BATCH_SIZE]
        response = api_post_json(
            "/cards/collection",
            {"identifiers": [{"name": name} for name in chunk]},
        )
        requests += 1
        cards_by_name = {
            normalized_name(alias): card
            for card in response.get("data", [])
            for alias in card_names(card)
        }
        for name in chunk:
            card = cards_by_name.get(normalized_name(name))
            if card is not None:
                resolved[normalized_name(name)] = card
        time.sleep(REQUEST_DELAY)

    missing = [name for name in names if normalized_name(name) not in resolved]
    return resolved, missing, requests


def read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: object, *, sort_keys: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=sort_keys) + "\n",
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


@contextlib.contextmanager
def repository_lock(repo_root: Path):
    """Prevent concurrent resolver runs from racing on shared registries."""
    digest = hashlib.sha256(str(repo_root.resolve()).encode("utf-8")).hexdigest()[:16]
    lock_path = Path(tempfile.gettempdir()) / f"commander-decks-{digest}.lock"
    with lock_path.open("a+b") as handle:
        try:
            if fcntl is not None:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            elif msvcrt is not None:  # pragma: no cover - Windows
                handle.seek(0)
                handle.write(b"\0")
                handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:  # pragma: no cover - unsupported platform
                raise OSError("no supported file-lock implementation")
        except (BlockingIOError, OSError) as error:
            raise RuntimeError(
                "another cache_deck.py process is already updating this repository; "
                "wait for it to finish instead of starting a second resolver"
            ) from error
        yield


def resolve_deck(decklist: Path, repo_root: Path, *, refresh: bool = False) -> int:
    deck_dir = decklist.parent
    cache_dir = repo_root / "cards"
    index_path = cache_dir / "index.json"
    category_path = cache_dir / "categories.json"
    override_path = deck_dir / "category-overrides.json"

    index = read_json(index_path, {"schema_version": 1, "names": {}})
    category_registry = read_json(category_path, {"schema_version": 1, "cards": {}})
    overrides = read_json(override_path, {"schema_version": 1, "cards": {}})
    original_index = copy.deepcopy(index)
    original_category_registry = copy.deepcopy(category_registry)
    aliases: dict[str, str] = index.setdefault("names", {})
    universal_cards: dict[str, dict] = category_registry.setdefault("cards", {})
    override_cards: dict[str, dict] = overrides.setdefault("cards", {})

    submitted, ignored = parse_decklist(decklist)
    resolved: list[dict] = []
    unresolved: list[dict] = list(ignored)
    cards_by_key: dict[str, dict] = {}
    pending: list[dict] = []
    stats = {
        "cache_hits": 0,
        "collection_requests": 0,
        "collection_resolved": 0,
        "fuzzy_requests": 0,
        "fuzzy_resolved": 0,
        "paper_upgrades": 0,
    }

    for entry in submitted:
        submitted_name = entry["submitted_name"]
        key = normalized_name(submitted_name)
        oracle_id = aliases.get(key)
        cache_path = cache_dir / f"{oracle_id}.json" if oracle_id else None

        if cache_path and cache_path.exists() and not refresh:
            card = read_json(cache_path, {})
            if isinstance(card, dict) and card.get("oracle_id"):
                cards_by_key[key] = card
                stats["cache_hits"] += 1
                continue
        pending.append(entry)

    if pending:
        names = [entry["submitted_name"] for entry in pending]
        try:
            collection_cards, fuzzy_names, request_count = lookup_collection(names)
            stats["collection_requests"] = request_count
            stats["collection_resolved"] = len(collection_cards)
            cards_by_key.update(collection_cards)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            for entry in pending:
                unresolved.append({
                    "line": entry["line"],
                    "text": entry["submitted_name"],
                    "reason": f"collection lookup failed: {error}",
                })
            fuzzy_names = []

        fuzzy_entries = {
            normalized_name(entry["submitted_name"]): entry
            for entry in pending
            if entry["submitted_name"] in fuzzy_names
        }
        for name in fuzzy_names:
            entry = fuzzy_entries[normalized_name(name)]
            stats["fuzzy_requests"] += 1
            try:
                card = api_json("/cards/named", {"fuzzy": name})
                time.sleep(REQUEST_DELAY)
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
                unresolved.append({
                    "line": entry["line"],
                    "text": name,
                    "reason": str(error),
                })
                continue
            cards_by_key[normalized_name(name)] = card
            stats["fuzzy_resolved"] += 1

    for entry in submitted:
        submitted_name = entry["submitted_name"]
        key = normalized_name(submitted_name)
        card = cards_by_key.get(key)
        if card is None:
            continue

        paper = fetch_paper_printing(card)
        upgraded = paper.get("id") != card.get("id")
        if upgraded:
            stats["paper_upgrades"] += 1
            cards_by_key[key] = paper
            card = paper

        oracle_id = card.get("oracle_id")
        if not oracle_id:
            unresolved.append({
                "line": entry["line"],
                "text": submitted_name,
                "reason": "Scryfall response has no oracle_id",
            })
            continue
        cache_path = cache_dir / f"{oracle_id}.json"
        if refresh or upgraded or not cache_path.exists():
            write_json(cache_path, card)

        canonical_name = card["name"]
        for alias in [submitted_name, *card_names(card)]:
            aliases[normalized_name(alias)] = oracle_id

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
        elif entry["submitted_categories"]:
            categories = entry["submitted_categories"]
            category_source = "decklist"
        else:
            categories = universal["categories"]
            category_source = "universal"

        resolved.append({
            "quantity": entry["quantity"],
            "name": canonical_name,
            "submitted_name": submitted_name,
            "submitted_categories": entry["submitted_categories"],
            "oracle_id": oracle_id,
            "cache": f"cards/{oracle_id}.json",
            "categories": categories,
            "category_source": category_source,
            "scryfall_uri": card.get("scryfall_uri"),
            "card": compact_card_details(card),
        })

    now = datetime.now(timezone.utc).isoformat()
    if index != original_index:
        index["updated_at"] = now
        write_json(index_path, index, sort_keys=False)
    if category_registry != original_category_registry:
        category_registry["updated_at"] = now
        write_json(category_path, category_registry, sort_keys=False)

    def is_extra(card):
        return any("{noDeck}" in category for category in card["categories"])

    deck_cards = [card for card in resolved if not is_extra(card)]
    extra_cards = [card for card in resolved if is_extra(card)]
    manifest = {
        "schema_version": 3,
        "generated_at": now,
        "source": str(decklist.relative_to(repo_root)),
        "total_cards": sum(card["quantity"] for card in deck_cards),
        "unique_cards": len(deck_cards),
        "maybeboard_cards": sum(card["quantity"] for card in extra_cards),
        "maybeboard_unique_cards": len(extra_cards),
        "resolved_unique_cards": len(resolved),
        "categorized_cards": sum(bool(card["categories"]) for card in resolved),
        "unresolved": unresolved,
        "cards": resolved,
    }
    write_json(deck_dir / "cards.json", manifest)

    print(
        f"Resolved {manifest['total_cards']} cards "
        f"({manifest['unique_cards']} unique, "
        f"{manifest['categorized_cards']} categorized); "
        f"{len(unresolved)} unresolved. "
        f"Cache: {stats['cache_hits']} hit(s); "
        f"Scryfall: {stats['collection_resolved']} exact in "
        f"{stats['collection_requests']} collection request(s), "
        f"{stats['fuzzy_resolved']}/{stats['fuzzy_requests']} fuzzy"
        + (f"; paper upgrades: {stats['paper_upgrades']}" if stats["paper_upgrades"] else "")
        + "."
    )
    if unresolved:
        for item in unresolved:
            print(f"line {item['line']}: {item['text']} — {item['reason']}", file=sys.stderr)
        return 1
    return 0


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
        decklist.parent.relative_to(repo_root / "decks")
    except ValueError:
        parser.error("deck list must be inside decks/<deck-name>/")

    try:
        with repository_lock(repo_root):
            return resolve_deck(decklist, repo_root, refresh=args.refresh)
    except RuntimeError as error:
        print(f"cache_deck.py: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
