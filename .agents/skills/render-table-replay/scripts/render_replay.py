#!/usr/bin/env python3
"""Validate replay JSON and render a self-contained HTML table viewer."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

TEMPLATE = Path(__file__).with_name("replay.html")
ROOT = Path(__file__).resolve().parents[4]
TABLE_GAMES = ROOT / "table-games"
PAGES = ROOT / "pages"
PT = re.compile(r"^[^/\s]+/[^/\s]+$")


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


def public_game(game: dict) -> dict:
    cleaned = dict(game)
    cleaned.pop("_libraries", None)
    if cleaned.get("schema") != 1:
        raise ValueError("replay JSON must set schema to 1")

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

    catalog = cleaned.get("catalog")
    if not isinstance(catalog, dict):
        raise ValueError("replay JSON needs a card catalog")
    names, token_names, token_ids = referenced_cards(
        events, references if isinstance(references, list) else None
    )
    missing = sorted(names - set(catalog) - token_names)
    if missing:
        raise ValueError(f"catalog is missing referenced cards: {', '.join(missing)}")
    cleaned["catalog"] = {
        name: dict(entry) if isinstance(entry, dict) else entry
        for name, entry in catalog.items() if name in names
    }
    backfill_faces(cleaned["catalog"])
    tokens = cleaned.get("tokens") or {}
    missing_tokens = sorted(token_ids - set(tokens))
    if missing_tokens:
        raise ValueError(
            f"token catalog is missing referenced IDs: {', '.join(missing_tokens)}"
        )
    cleaned["tokens"] = {
        token_id: entry for token_id, entry in tokens.items()
        if token_id in token_ids
    }
    validate_faces(
        events,
        cleaned["catalog"],
        cleaned["tokens"],
        references if isinstance(references, list) else [],
    )
    return cleaned


def render(game: dict) -> str:
    payload = json.dumps(public_game(game), ensure_ascii=False)
    payload = payload.replace("<", "\\u003c")
    template = TEMPLATE.read_text(encoding="utf-8")
    if "__GAME_JSON__" not in template:
        raise ValueError(f"missing __GAME_JSON__ placeholder in {TEMPLATE}")
    return template.replace("__GAME_JSON__", payload)


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
    html = render(game)
    target = out or PAGES / f"{log.stem}.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, encoding="utf-8")
    try:
        return target.relative_to(ROOT)
    except ValueError:
        return target


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate replay JSON and write pages/<slug>.html with the current "
            "viewer. With no paths, rebuild every finished table-games/*.json file."
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
        help="HTML path. Default pages/<slug>.html; only valid for a single replay.",
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
