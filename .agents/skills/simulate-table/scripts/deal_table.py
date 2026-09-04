#!/usr/bin/env python3
"""Deal a four-player Commander table from resolved decks."""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SEAT_IDS = ("p1", "p2", "p3", "p4")
SEAT_COLORS = ("#c45c26", "#2f6f64", "#4a5d9e", "#8a3d6b")
MULLIGAN_MAX = 2


def is_library_card(entry: dict) -> bool:
    return not any(
        category == "Commander{top}" or "{noDeck}" in category
        for category in entry.get("categories", [])
    )


def load_manifest(deck: Path) -> tuple[list[str], list[str], list[dict]]:
    manifest_path = deck if deck.name == "cards.json" else deck / "cards.json"
    if not manifest_path.is_file():
        raise ValueError(f"missing resolved manifest: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    library: list[str] = []
    commanders: list[str] = []
    entries: list[dict] = []

    for entry in manifest.get("cards", []):
        name = entry.get("name")
        quantity = entry.get("quantity")
        categories = entry.get("categories", [])
        if not isinstance(name, str) or not isinstance(quantity, int) or quantity < 1:
            raise ValueError(f"invalid manifest entry: {entry!r}")
        entries.append(entry)
        if "Commander{top}" in categories:
            commanders.extend([name] * quantity)
        elif is_library_card(entry):
            library.extend([name] * quantity)

    if len(library) not in (98, 99):
        raise ValueError(
            f"{deck}: expected a 99-card library or 98 with two commanders, "
            f"found {len(library)}"
        )
    if len(commanders) not in (1, 2):
        raise ValueError(f"{deck}: expected one or two commanders, found {len(commanders)}")
    if len(library) + len(commanders) != 100:
        raise ValueError(
            f"{deck}: expected 100 total cards, found {len(library) + len(commanders)}"
        )
    return library, commanders, entries


def deck_title(deck: Path) -> str:
    readme = deck / "README.md"
    if readme.is_file():
        first = readme.read_text(encoding="utf-8").splitlines()[0]
        match = re.search(r"—\s+(.+)$", first)
        if match:
            return match.group(1).strip()
    return deck.name


def primer_plan(deck: Path) -> str:
    readme = deck / "README.md"
    if not readme.is_file():
        return ""
    for line in readme.read_text(encoding="utf-8").splitlines():
        if line.startswith("**Primary plan:**"):
            return re.sub(r"\*\*|\[([^\]]+)\]\([^)]+\)", r"\1", line).replace(
                "Primary plan:", ""
            ).strip()
    return ""


def image_uris(cache: dict) -> dict:
    uris = cache.get("image_uris")
    if isinstance(uris, dict) and uris.get("small"):
        return uris
    for face in cache.get("card_faces") or []:
        face_uris = face.get("image_uris") if isinstance(face, dict) else None
        if isinstance(face_uris, dict) and face_uris.get("small"):
            return face_uris
    return {}


def joined_faces(cache: dict, field: str) -> str:
    """Split and modal cards carry text per face rather than at the top level."""
    parts = [
        face.get(field) or ""
        for face in cache.get("card_faces") or []
        if isinstance(face, dict)
    ]
    return " // ".join(part for part in parts if part)


def stat_line(cache: dict) -> str:
    if cache.get("power") is not None:
        return f"{cache['power']}/{cache['toughness']}"
    stats = [
        f"{face['power']}/{face['toughness']}"
        for face in cache.get("card_faces") or []
        if isinstance(face, dict) and face.get("power") is not None
    ]
    return " // ".join(stats)


def catalog_entry(entry: dict, repo: Path) -> dict:
    card = entry.get("card") or {}
    cache_rel = entry.get("cache")
    cache: dict = {}
    if isinstance(cache_rel, str):
        cache_path = repo / cache_rel
        if cache_path.is_file():
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
    uris = image_uris(cache)
    return {
        "scryfall_uri": cache.get("scryfall_uri") or entry.get("scryfall_uri") or "",
        "image_small": uris.get("small") or "",
        "image_normal": uris.get("normal") or uris.get("small") or "",
        "type_line": (
            cache.get("type_line")
            or card.get("type_line")
            or joined_faces(cache, "type_line")
        ),
        "mana_cost": (
            cache.get("mana_cost")
            or card.get("mana_cost")
            or joined_faces(cache, "mana_cost")
        ),
        "oracle_text": (
            cache.get("oracle_text")
            or card.get("oracle_text")
            or joined_faces(cache, "oracle_text")
        ),
        "stats": stat_line(cache),
    }


def build_catalog(entries_by_seat: list[list[dict]], repo: Path) -> dict[str, dict]:
    catalog: dict[str, dict] = {}
    for entries in entries_by_seat:
        for entry in entries:
            name = entry.get("name")
            if isinstance(name, str) and name not in catalog:
                catalog[name] = catalog_entry(entry, repo)
    return catalog


def deal_candidates(
    library: list[str],
    rng: random.Random,
    *,
    mulligans: int = MULLIGAN_MAX,
) -> list[dict]:
    candidates = []
    for mulligan_count in range(mulligans + 1):
        shuffled = library.copy()
        rng.shuffle(shuffled)
        hand = shuffled[:7]
        rest = shuffled[7:]
        candidates.append({
            "mulligans": mulligan_count,
            "hand": hand,
            "library": rest,
        })
    return candidates


def parse_bottom(values: list[str]) -> dict[str, list[str]]:
    bottoms: dict[str, list[str]] = {seat: [] for seat in SEAT_IDS}
    for raw in values:
        if "=" not in raw:
            raise ValueError(f"bottom must be seat=Card,Card: {raw!r}")
        seat, cards = raw.split("=", 1)
        seat = seat.strip()
        if seat not in bottoms:
            raise ValueError(f"unknown seat in --bottom: {seat}")
        names = [name.strip() for name in cards.split(",") if name.strip()]
        bottoms[seat] = names
    return bottoms


def apply_london(candidate: dict, bottom: list[str]) -> tuple[list[str], list[str]]:
    hand = list(candidate["hand"])
    library = list(candidate["library"])
    expected = candidate["mulligans"]
    if len(bottom) != expected:
        raise ValueError(
            f"mulligan {expected} needs {expected} bottom card(s), got {bottom!r}"
        )
    remaining = hand
    for name in bottom:
        if name not in remaining:
            raise ValueError(f"cannot bottom {name!r}; hand is {hand}")
        remaining.remove(name)
        library.append(name)
    return remaining, library


def empty_player(commanders: list[str], hand: list[str], library_count: int, seat_id: str) -> dict:
    return {
        "life": 40,
        "poison": 0,
        "commander_damage": {seat: 0 for seat in SEAT_IDS if seat != seat_id},
        "commander_tax": 0,
        "library_count": library_count,
        "hand": hand,
        "battlefield": [],
        "graveyard": [],
        "exile": [],
        "command": commanders,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Deal a four-player Commander table from cards.json manifests"
    )
    parser.add_argument(
        "decks",
        nargs=4,
        type=Path,
        help="four deck directories in turn order",
    )
    parser.add_argument("--seed", type=int, default=1729)
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--mulligans", default="0,0,0,0")
    parser.add_argument(
        "--bottom",
        action="append",
        default=[],
        help="London bottoms, e.g. p2=Mountain,Forest (repeatable)",
    )
    parser.add_argument("--out", type=Path)
    parser.add_argument("--repo", type=Path, default=ROOT)
    args = parser.parse_args()
    if args.seed < 0:
        parser.error("--seed cannot be negative")
    return args


def load_seats(decks: list[Path], seed: int) -> list[dict]:
    rng = random.Random(seed)
    seats = []
    for index, deck in enumerate(decks):
        deck = deck.resolve()
        library, commanders, entries = load_manifest(deck)
        candidates = deal_candidates(library, rng)
        seats.append({
            "id": SEAT_IDS[index],
            "name": deck_title(deck),
            "deck": str(deck.relative_to(ROOT) if ROOT in deck.parents else deck),
            "commanders": commanders,
            "plan": primer_plan(deck),
            "color": SEAT_COLORS[index],
            "entries": entries,
            "candidates": candidates,
        })
    return seats


def render_preview_markdown(seats: list[dict], seed: int) -> str:
    lines = [
        f"# Table deal — seed {seed}",
        "",
        "Turn order: " + " → ".join(f"{seat['id']} {seat['name']}" for seat in seats),
    ]
    for seat in seats:
        lines.extend(["", f"## {seat['id']} — {seat['name']}"])
        lines.append(f"Commander: {', '.join(seat['commanders'])}")
        for candidate in seat["candidates"]:
            label = "keep seven" if candidate["mulligans"] == 0 else (
                f"mulligan {candidate['mulligans']}"
            )
            lines.extend([
                "",
                f"### {label}",
                f"- Hand: {', '.join(candidate['hand'])}",
            ])
    return "\n".join(lines) + "\n"


def preview_payload(seats: list[dict], seed: int, repo: Path) -> dict:
    catalog = build_catalog([seat["entries"] for seat in seats], repo)
    return {
        "seed": seed,
        "seats": [
            {
                "id": seat["id"],
                "name": seat["name"],
                "deck": seat["deck"],
                "commanders": seat["commanders"],
                "plan": seat["plan"],
                "color": seat["color"],
                "candidates": [
                    {
                        "mulligans": candidate["mulligans"],
                        "hand": candidate["hand"],
                        "library_count": len(candidate["library"]),
                    }
                    for candidate in seat["candidates"]
                ],
            }
            for seat in seats
        ],
        "catalog": catalog,
        "_libraries": {
            f"{seat['id']}:{candidate['mulligans']}": {
                "hand": candidate["hand"],
                "library": candidate["library"],
            }
            for seat in seats
            for candidate in seat["candidates"]
        },
    }


def apply_game(seats: list[dict], args: argparse.Namespace) -> dict:
    counts = [int(part.strip()) for part in args.mulligans.split(",")]
    if len(counts) != 4 or any(count < 0 or count > MULLIGAN_MAX for count in counts):
        raise ValueError("--mulligans must be four integers from 0 to 2")
    bottoms = parse_bottom(args.bottom)
    catalog = build_catalog([seat["entries"] for seat in seats], args.repo)
    public_seats = []
    players = {}
    events = []
    libraries: dict[str, list[str]] = {}

    for seat, mulligans in zip(seats, counts):
        candidate = next(
            item for item in seat["candidates"] if item["mulligans"] == mulligans
        )
        hand, library = apply_london(candidate, bottoms.get(seat["id"], []))
        libraries[seat["id"]] = library
        public_seats.append({
            "id": seat["id"],
            "name": seat["name"],
            "deck": seat["deck"],
            "commanders": seat["commanders"],
            "plan": seat["plan"],
            "mulligans": mulligans,
            "color": seat["color"],
        })
        players[seat["id"]] = empty_player(seat["commanders"], hand, len(library), seat["id"])
        summary = (
            f"{seat['name']} keeps 7"
            if mulligans == 0
            else f"{seat['name']} mulligans {mulligans}, bottoms {', '.join(bottoms[seat['id']])}"
        )
        events.append({
            "id": len(events),
            "turn": 0,
            "phase": "setup",
            "seat": seat["id"],
            "kind": "keep" if mulligans == 0 else "mulligan",
            "summary": summary,
            "cards": hand,
            "notes": "",
            "state": None,
        })

    opening_state = {
        "active": "p1",
        "turn": 0,
        "phase": "setup",
        "stack": [],
        "players": players,
    }
    events.insert(0, {
        "id": 0,
        "turn": 0,
        "phase": "setup",
        "seat": None,
        "kind": "setup",
        "summary": "Four players keep. Turn-one draw is on.",
        "cards": [],
        "notes": "",
        "state": opening_state,
    })
    for index, event in enumerate(events[1:], start=1):
        event["id"] = index
        event["state"] = {
            "active": "p1",
            "turn": 0,
            "phase": "setup",
            "stack": [],
            "players": json.loads(json.dumps(players)),
        }

    return {
        "schema": 1,
        "seed": args.seed,
        "starting_life": 40,
        "headline": "In progress",
        "result": {
            "winner": None,
            "ended": "truncated",
            "turn": 0,
            "summary": "Opening keeps only; play the game and overwrite this file.",
        },
        "seats": public_seats,
        "catalog": catalog,
        "events": events,
        "_libraries": libraries,
    }


def main() -> int:
    args = parse_args()
    try:
        seats = load_seats(args.decks, args.seed)
        if args.apply:
            payload = apply_game(seats, args)
            text = json.dumps(payload, indent=2)
        elif args.format == "json":
            payload = preview_payload(seats, args.seed, args.repo)
            text = json.dumps(payload, indent=2)
        else:
            text = render_preview_markdown(seats, args.seed)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    else:
        print(text, end="" if text.endswith("\n") else "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
