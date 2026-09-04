#!/usr/bin/env python3
"""Validate replay JSON and render a self-contained HTML table viewer."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

TEMPLATE = Path(__file__).with_name("replay.html")


def referenced_cards(events: list[dict]) -> tuple[set[str], set[str]]:
    names: set[str] = set()
    tokens: set[str] = set()
    for event in events:
        names.update(event.get("cards") or [])
        state = event.get("state") or {}
        for item in state.get("stack") or []:
            if isinstance(item, dict) and item.get("name"):
                names.add(item["name"])
        for player in (state.get("players") or {}).values():
            if not isinstance(player, dict):
                continue
            for zone in ("hand", "graveyard", "exile", "command", "revealed_top"):
                names.update(player.get(zone) or [])
            for entry in player.get("battlefield") or []:
                if not isinstance(entry, dict) or not entry.get("name"):
                    continue
                names.add(entry["name"])
                if entry.get("token"):
                    tokens.add(entry["name"])
    return names, tokens


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

    validate_turn_draws(events)

    catalog = cleaned.get("catalog")
    if not isinstance(catalog, dict):
        raise ValueError("replay JSON needs a card catalog")
    names, tokens = referenced_cards(events)
    missing = sorted(names - set(catalog) - tokens)
    if missing:
        raise ValueError(f"catalog is missing referenced cards: {', '.join(missing)}")
    cleaned["catalog"] = {
        name: entry for name, entry in catalog.items() if name in names
    }
    return cleaned


def render(game: dict) -> str:
    payload = json.dumps(public_game(game), ensure_ascii=False)
    payload = payload.replace("<", "\\u003c")
    template = TEMPLATE.read_text(encoding="utf-8")
    if "__GAME_JSON__" not in template:
        raise ValueError(f"missing __GAME_JSON__ placeholder in {TEMPLATE}")
    return template.replace("__GAME_JSON__", payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and render a Commander table replay"
    )
    parser.add_argument("log", type=Path)
    parser.add_argument("--out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        game = json.loads(args.log.read_text(encoding="utf-8"))
        html = render(game)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    out = args.out or args.log.with_suffix(".html")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
