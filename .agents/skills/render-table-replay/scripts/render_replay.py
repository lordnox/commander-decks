#!/usr/bin/env python3
"""Validate replay logs and publish sanitized JSON for the React player."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TABLE_GAMES = ROOT / "table-games"
REPLAYS = ROOT / "site" / "public" / "replays"
PT = re.compile(r"^[^/\s]+/[^/\s]+$")
SCHEMAS = {1, 2}
COMBAT_STEPS = {"attackers", "blockers", "first_strike_damage", "combat_damage"}
DAMAGE_STEPS = {"first_strike_damage", "combat_damage"}
DAMAGE_TYPES = {"combat", "noncombat"}


def normalized_name(name: str) -> str:
    value = unicodedata.normalize("NFKD", name).casefold()
    return " ".join(value.split())


def cache_root() -> Path | None:
    for base in Path(__file__).resolve().parents:
        if (base / "cards" / "index.json").is_file():
            return base
    return None


def cached_faces(cache: dict) -> list[dict] | None:
    faces = [
        face for face in cache.get("card_faces") or []
        if (face.get("image_uris") or {}).get("small")
    ]
    if len(faces) < 2:
        return None
    return [
        {
            "name": face.get("name") or "",
            "image_small": face["image_uris"].get("small") or "",
            "image_normal": face["image_uris"].get("normal")
            or face["image_uris"].get("small") or "",
            "type_line": face.get("type_line") or "",
            "mana_cost": face.get("mana_cost") or "",
            "oracle_text": face.get("oracle_text") or "",
            "stats": f"{face['power']}/{face['toughness']}" if face.get("power") is not None else "",
        }
        for face in faces
    ]


def backfill_faces(catalog: dict) -> None:
    """Give pre-`faces` replays the per-side art the viewer needs."""
    wanted = [
        name for name, entry in catalog.items()
        if isinstance(entry, dict) and not entry.get("faces") and " // " in name
    ]
    root = cache_root()
    if not wanted or root is None:
        return
    try:
        index = json.loads((root / "cards" / "index.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    aliases = {
        normalized_name(alias): oracle_id
        for alias, oracle_id in (index.get("names") or {}).items()
    }
    for name in wanted:
        oracle_id = aliases.get(normalized_name(name))
        if not oracle_id:
            continue
        try:
            cache = json.loads((root / "cards" / f"{oracle_id}.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        faces = cached_faces(cache)
        if faces:
            catalog[name]["faces"] = faces


def resolve_name(value: object, rows: list[dict]) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return str(value)
    row = None
    if isinstance(value, int) and 0 <= value < len(rows):
        row = rows[value]
    if isinstance(row, dict) and row.get("kind") in {"card", "player"} and row.get("name"):
        return row["name"]
    return str(value)


def deck_tokens(deck: str) -> dict:
    try:
        data = json.loads((ROOT / deck / "tokens.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def token_printing(name: str, data: dict, catalog: dict) -> tuple[str, dict] | None:
    """A deck's printing of `name`, preferring one a card in this game makes."""
    entries = {
        token_id: entry
        for token_id, entry in (data.get("tokens") or {}).items()
        if isinstance(entry, dict)
        and normalized_name(entry.get("name") or "") == normalized_name(name)
    }
    if not entries:
        return None
    sources: dict[str, list[str]] = {}
    for card, token_ids in (data.get("produced_by") or {}).items():
        for token_id in token_ids or []:
            if token_id in entries:
                sources.setdefault(token_id, []).append(card)

    def rank(item: tuple[str, dict]) -> tuple[int, str, str]:
        token_id = item[0]
        cards = sorted(sources.get(token_id) or [])
        played = [card for card in cards if card in catalog]
        return (0 if played else 1, (played or cards or [""])[0], token_id)

    return sorted(entries.items(), key=rank)[0]


def backfill_tokens(
    seats: list, events: list[dict], catalog: dict, tokens: dict, rows: list[dict]
) -> None:
    """Point a token recorded without `token_id` at its deck's printing."""
    decks = {
        seat.get("id"): seat.get("deck")
        for seat in seats
        if isinstance(seat, dict) and seat.get("deck")
    }
    files: dict[str, dict] = {}
    picks: dict[tuple[str, str], str | None] = {}
    for event in events:
        players = (event.get("state") or {}).get("players") or {}
        for seat_id, player in players.items():
            deck = decks.get(seat_id)
            if not isinstance(player, dict) or not deck:
                continue
            for entry in player.get("battlefield") or []:
                if not isinstance(entry, dict) or not entry.get("token"):
                    continue
                if entry.get("token_id") or not entry.get("name"):
                    continue
                name = resolve_name(entry["name"], rows)
                key = (seat_id, normalized_name(name))
                if key not in picks:
                    if deck not in files:
                        files[deck] = deck_tokens(deck)
                    found = token_printing(name, files[deck], catalog)
                    picks[key] = found[0] if found else None
                    if found:
                        tokens.setdefault(found[0], found[1])
                if picks[key]:
                    entry["token_id"] = picks[key]


def referenced_cards(events: list[dict], references: list[dict] | None = None) -> tuple[set[str], set[str], set[str]]:
    names: set[str] = set()
    token_names: set[str] = set()
    token_ids: set[str] = set()
    rows = references or []

    def resolve(value: object) -> str:
        return resolve_name(value, rows)

    for event in events:
        names.update(resolve(name) for name in event.get("cards") or [])
        decision = event.get("decision") or {}
        for key in ("available", "held"):
            names.update(resolve(name) for name in decision.get(key) or [])
        combat = event.get("combat")
        if isinstance(combat, dict):
            names.update(
                resolve(attacker["card"])
                for attacker in combat.get("attackers") or []
                if isinstance(attacker, dict) and attacker.get("card")
            )
            names.update(resolve(name) for name in combat.get("unblocked") or [])
            for block in combat.get("blocks") or []:
                if not isinstance(block, dict):
                    continue
                if block.get("attacker"):
                    names.add(resolve(block["attacker"]))
                names.update(resolve(name) for name in block.get("blockers") or [])
        names.update(
            resolve(entry["source"])
            for entry in event.get("damage") or []
            if isinstance(entry, dict) and entry.get("source")
        )
        state = event.get("state") or {}
        for item in state.get("stack") or []:
            if isinstance(item, dict) and item.get("name"):
                names.add(resolve(item["name"]))
        for player in (state.get("players") or {}).values():
            if not isinstance(player, dict):
                continue
            for zone in ("hand", "graveyard", "exile", "command", "revealed_top"):
                names.update(resolve(name) for name in player.get(zone) or [])
            for entry in player.get("battlefield") or []:
                if not isinstance(entry, dict) or not entry.get("name"):
                    continue
                names.add(resolve(entry["name"]))
                if entry.get("token"):
                    token_names.add(resolve(entry["name"]))
                    if entry.get("token_id"):
                        token_ids.add(entry["token_id"])
    return names, token_names, token_ids


def validate_faces(events: list[dict], catalog: dict, tokens: dict, rows: list[dict]) -> None:
    for event in events:
        players = (event.get("state") or {}).get("players") or {}
        for player in players.values():
            if not isinstance(player, dict):
                continue
            for entry in player.get("battlefield") or []:
                if not isinstance(entry, dict) or entry.get("face") in (None, ""):
                    continue
                face = entry["face"]
                name = resolve_name(entry.get("name"), rows)
                if isinstance(face, bool) or not isinstance(face, (int, str)):
                    raise ValueError(
                        f"event {event['id']}: {name} face must be a face name or index"
                    )
                source = tokens.get(entry.get("token_id")) or catalog.get(name) or {}
                faces = source.get("faces") or []
                if not faces:
                    continue
                if isinstance(face, int):
                    if not 0 <= face < len(faces):
                        raise ValueError(
                            f"event {event['id']}: {name} has no face {face}"
                        )
                    continue
                known = {normalized_name(item.get("name") or "") for item in faces}
                known.update({"front", "back"})
                if normalized_name(face) not in known:
                    raise ValueError(
                        f"event {event['id']}: {name} has no face {face!r}"
                    )


def validate_turn_draws(events: list[dict]) -> None:
    for index, event in enumerate(events):
        if event.get("phase") != "untap" or event.get("turn", 0) < 1:
            continue
        seat = event.get("seat")
        turn = event.get("turn")
        window = events[index + 1 :]
        next_untap = next(
            (offset for offset, item in enumerate(window)
             if item.get("phase") == "untap"),
            len(window),
        )
        turn_events = [
            item
            for item in window[:next_untap]
            if item.get("seat") == seat
            and item.get("turn") == turn
            and item.get("phase") != "upkeep"
        ]
        first = turn_events[0] if turn_events else {}
        if first.get("phase") != "draw" or first.get("kind") != "draw":
            raise ValueError(
                f"turn {turn} {seat}: untap is not immediately followed by "
                "a normal draw event"
            )


def battlefield_entry(event: dict, name: str, rows: list[dict]) -> dict | None:
    players = (event.get("state") or {}).get("players") or {}
    player = players.get(event.get("seat")) or {}
    matches = [
        entry
        for entry in player.get("battlefield") or []
        if isinstance(entry, dict) and resolve_name(entry.get("name"), rows) == name
    ]
    return matches[0] if len(matches) == 1 else None


def is_combat_damage(event: dict) -> bool:
    combat = event.get("combat") or {}
    if isinstance(combat, dict) and combat.get("step") in DAMAGE_STEPS:
        return True
    return any(
        isinstance(entry, dict) and entry.get("type") == "combat"
        for entry in event.get("damage") or []
    )


def validate_combat_shape(event: dict, rows: list[dict]) -> None:
    """Check the combat fields a replay actually carries, whatever its schema."""
    event_id = event.get("id")
    combat = event.get("combat")
    if combat is not None:
        if not isinstance(combat, dict):
            raise ValueError(f"event {event_id}: combat must be an object")
        step = combat.get("step")
        if step is not None and step not in COMBAT_STEPS:
            raise ValueError(
                f"event {event_id}: combat step {step!r} is not one of "
                f"{', '.join(sorted(COMBAT_STEPS))}"
            )
        for attacker in combat.get("attackers") or []:
            if not isinstance(attacker, dict) or not attacker.get("card"):
                raise ValueError(f"event {event_id}: an attacker is missing its card")
            name = resolve_name(attacker["card"], rows)
            if not attacker.get("defender"):
                raise ValueError(f"event {event_id}: {name} attacks no defender")
            entry = battlefield_entry(event, name, rows)
            if entry is None or attacker.get("tapped") is None:
                continue
            if bool(entry.get("tapped")) != bool(attacker["tapped"]):
                raise ValueError(
                    f"event {event_id}: {name} declares tapped="
                    f"{bool(attacker['tapped'])} but its snapshot says "
                    f"tapped={bool(entry.get('tapped'))}"
                )
        for block in combat.get("blocks") or []:
            if not isinstance(block, dict) or not block.get("attacker"):
                raise ValueError(f"event {event_id}: a block names no attacker")
            if not block.get("blockers"):
                raise ValueError(
                    f"event {event_id}: the block on "
                    f"{resolve_name(block['attacker'], rows)} names no blockers"
                )
    damage = event.get("damage")
    if damage is None:
        return
    if not isinstance(damage, list) or not damage:
        raise ValueError(f"event {event_id}: damage must be a non-empty list")
    for entry in damage:
        if not isinstance(entry, dict):
            raise ValueError(f"event {event_id}: each damage entry must be an object")
        if entry.get("type") not in DAMAGE_TYPES:
            raise ValueError(
                f"event {event_id}: damage from "
                f"{resolve_name(entry.get('source'), rows)} needs type "
                '"combat" or "noncombat"'
            )
        if not entry.get("source") or not entry.get("target"):
            raise ValueError(f"event {event_id}: a damage entry needs source and target")
        if not isinstance(entry.get("amount"), int) or isinstance(entry.get("amount"), bool):
            raise ValueError(f"event {event_id}: a damage entry needs an integer amount")


def validate_combat_flow(events: list[dict], seat_ids: set[str], rows: list[dict]) -> None:
    """Require declare attackers, declare blockers, and typed damage."""
    attack: dict = {}
    for index, event in enumerate(events):
        kind = event.get("kind")
        if kind == "damage":
            if not event.get("damage"):
                raise ValueError(
                    f"event {event['id']}: a damage event needs typed damage entries"
                )
            if is_combat_damage(event) and not any(
                item.get("kind") == "attack" and item.get("turn") == event.get("turn")
                for item in events[:index]
            ):
                raise ValueError(
                    f"event {event['id']}: combat damage without a declared attack"
                )
            continue
        if kind == "block":
            blocks = (event.get("combat") or {}).get("blocks")
            possible = ((attack.get("combat") or {}).get("possible_blockers") or {})
            could_block = possible.get(event.get("seat"), True)
            if not blocks and could_block and not (event.get("decision") or {}).get("reason"):
                raise ValueError(
                    f"event {event['id']}: declining to block needs decision.reason"
                )
            continue
        if kind != "attack":
            continue
        attack = event
        attackers = (event.get("combat") or {}).get("attackers")
        if not attackers:
            raise ValueError(f"event {event['id']}: an attack needs combat.attackers")
        defenders = {
            attacker.get("defender")
            for attacker in attackers
            if attacker.get("defender") in seat_ids
        }
        answered: set[str] = set()
        for item in events[index + 1 :]:
            if item.get("turn") != event.get("turn") or item.get("kind") == "attack":
                break
            if item.get("kind") == "block":
                answered.add(item.get("seat"))
            if item.get("kind") == "damage" and is_combat_damage(item):
                break
        silent = sorted(defenders - answered)
        if silent:
            raise ValueError(
                f"event {event['id']}: {', '.join(silent)} never declared blockers"
            )


def public_game(game: dict) -> dict:
    cleaned = dict(game)
    cleaned.pop("_libraries", None)
    if cleaned.get("schema") not in SCHEMAS:
        raise ValueError("replay JSON must set schema to 1 or 2")

    seats = cleaned.get("seats")
    events = cleaned.get("events")
    if not isinstance(seats, list) or len(seats) != 4:
        raise ValueError("replay JSON needs exactly four seats")
    if not isinstance(events, list) or not events:
        raise ValueError("replay JSON needs a non-empty events list")

    expected_ids = list(range(len(events)))
    actual_ids = [event.get("id") for event in events]
    if actual_ids != expected_ids:
        raise ValueError("event IDs must be contiguous integers starting at zero")

    for event in events:
        state = event.get("state")
        if not isinstance(state, dict) or "players" not in state:
            raise ValueError(f"event {event.get('id')!r} is missing a state snapshot")
        if state.get("turn") != event.get("turn"):
            raise ValueError(f"event {event['id']}: state turn does not match event")
        if state.get("phase") != event.get("phase"):
            raise ValueError(f"event {event['id']}: state phase does not match event")
        for player in state["players"].values():
            if not isinstance(player, dict):
                continue
            if "library" in player:
                raise ValueError("do not put remaining library cards in state snapshots")
            top = player.get("revealed_top") or []
            if len(top) > (player.get("library_count") or 0):
                raise ValueError(
                    f"event {event['id']}: revealed_top holds more cards than the library"
                )
            for entry in player.get("battlefield") or []:
                if not isinstance(entry, dict):
                    continue
                stated = entry.get("pt")
                if stated is not None and not PT.match(str(stated)):
                    raise ValueError(
                        f"event {event['id']}: {entry.get('name', '?')} has pt "
                        f"{stated!r}; use \"power/toughness\""
                    )
        deals = state.get("deals")
        if deals is not None and not isinstance(deals, list):
            raise ValueError(f"event {event['id']}: state.deals must be a list")

    references = cleaned.get("references")
    if references is not None:
        if not isinstance(references, list):
            raise ValueError("references must be a list")
        seen_seats = {seat.get("id") for seat in seats}
        for ref_index, row in enumerate(references):
            if not isinstance(row, dict) or not row.get("kind"):
                raise ValueError(f"references[{ref_index}] needs kind")
            kind = row["kind"]
            if kind == "card" and not row.get("name"):
                raise ValueError(f"references[{ref_index}] card needs a name")
            if kind == "player":
                if not row.get("name"):
                    raise ValueError(f"references[{ref_index}] player needs a name")
                if row.get("seat") not in seen_seats:
                    raise ValueError(f"references[{ref_index}] player seat is not a seat id")
            if kind == "deal" and not row.get("terms"):
                raise ValueError(f"references[{ref_index}] deal needs terms")

    validate_turn_draws(events)
    rows = references if isinstance(references, list) else []
    for event in events:
        validate_combat_shape(event, rows)
    if cleaned["schema"] >= 2:
        validate_combat_flow(events, {seat.get("id") for seat in seats}, rows)

    catalog = cleaned.get("catalog")
    if not isinstance(catalog, dict):
        raise ValueError("replay JSON needs a card catalog")
    rows = references if isinstance(references, list) else []
    tokens = dict(cleaned.get("tokens") or {})
    backfill_tokens(seats, events, catalog, tokens, rows)
    names, token_names, token_ids = referenced_cards(events, rows)
    missing = sorted(names - set(catalog) - token_names)
    if missing:
        raise ValueError(f"catalog is missing referenced cards: {', '.join(missing)}")
    cleaned["catalog"] = {
        name: dict(entry) if isinstance(entry, dict) else entry
        for name, entry in catalog.items() if name in names
    }
    backfill_faces(cleaned["catalog"])
    missing_tokens = sorted(token_ids - set(tokens))
    if missing_tokens:
        raise ValueError(
            f"token catalog is missing referenced IDs: {', '.join(missing_tokens)}"
        )
    cleaned["tokens"] = {
        token_id: entry for token_id, entry in tokens.items()
        if token_id in token_ids
    }
    validate_faces(events, cleaned["catalog"], cleaned["tokens"], rows)
    return cleaned


def replay_paths(explicit: list[Path]) -> list[Path]:
    if explicit:
        resolved = []
        for path in explicit:
            candidate = path if path.is_absolute() else ROOT / path
            if not candidate.exists():
                raise ValueError(f"replay not found: {path}")
            resolved.append(candidate.resolve())
        return resolved
    if not TABLE_GAMES.is_dir():
        return []
    return sorted(
        path
        for path in TABLE_GAMES.glob("*.json")
        if not path.name.endswith(".working.json")
    )


def render_file(log: Path, out: Path | None) -> Path:
    game = json.loads(log.read_text(encoding="utf-8"))
    payload = json.dumps(
        public_game(game),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    target = out or REPLAYS / f"{log.stem}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(payload, encoding="utf-8")
    try:
        return target.relative_to(ROOT)
    except ValueError:
        return target


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate replay JSON and write site/public/replays/<slug>.json for "
            "the React player. With no paths, rebuild every finished "
            "table-games/*.json file."
        )
    )
    parser.add_argument(
        "logs",
        nargs="*",
        type=Path,
        help="Replay JSON paths. Default: table-games/*.json except *.working.json.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help=(
            "JSON path. Default site/public/replays/<slug>.json; "
            "only valid for a single replay."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.out and len(args.logs) != 1:
        print("ERROR: --out requires exactly one replay path", file=sys.stderr)
        return 1
    try:
        paths = replay_paths(args.logs)
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    if not paths:
        print("ERROR: no replay JSON found under table-games/", file=sys.stderr)
        return 1

    failed = 0
    for log in paths:
        try:
            print(render_file(log, args.out))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            print(f"ERROR: {log}: {error}", file=sys.stderr)
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
