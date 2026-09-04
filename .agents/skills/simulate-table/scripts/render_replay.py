#!/usr/bin/env python3
"""Render a table-sim JSON log to a self-contained HTML replay."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

TEMPLATE = Path(__file__).with_name("replay.html")


def referenced_cards(events: list) -> set:
    """Every card name the viewer can actually display for this game."""
    names = set()
    for event in events:
        names.update(event.get("cards") or [])
        state = event.get("state") or {}
        for item in state.get("stack") or []:
            if isinstance(item, dict) and item.get("name"):
                names.add(item["name"])
        for player in (state.get("players") or {}).values():
            if not isinstance(player, dict):
                continue
            for zone in ("hand", "graveyard", "exile", "command"):
                names.update(player.get(zone) or [])
            for entry in player.get("battlefield") or []:
                if isinstance(entry, dict) and entry.get("name"):
                    names.add(entry["name"])
    return names


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
    for event in events:
        state = event.get("state")
        if not isinstance(state, dict) or "players" not in state:
            raise ValueError(f"event {event.get('id')!r} is missing a state snapshot")
        for player in state["players"].values():
            if isinstance(player, dict) and "library" in player:
                raise ValueError("do not put remaining library cards in state snapshots")

    catalog = cleaned.get("catalog")
    if isinstance(catalog, dict):
        seen = referenced_cards(events)
        cleaned["catalog"] = {
            name: entry for name, entry in catalog.items() if name in seen
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
    parser = argparse.ArgumentParser(description="Render a Commander table replay HTML file")
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
