#!/usr/bin/env python3
"""Encode a simulate-table replay into a live-table snapshot URL."""

from __future__ import annotations

import argparse
import base64
import json
import sys
import zlib
from pathlib import Path
from typing import Any
from urllib.parse import quote

DEFAULT_BASE = "https://lordnox.github.io/commander-decks/live"
PAYLOAD_PREFIX = "v1."
QUERY_WARN_CHARS = 8000
SEAT_IDS = ("p1", "p2", "p3", "p4")


def decode_payload(s: str) -> dict:
    raw = s.strip()
    if raw.startswith("#"):
        raw = raw[1:]
    if raw.startswith("s="):
        raw = raw[2:]
    if not raw.startswith(PAYLOAD_PREFIX):
        raise ValueError(f"unknown live payload prefix (expected {PAYLOAD_PREFIX!r})")
    body = raw[len(PAYLOAD_PREFIX) :]
    pad = "=" * (-len(body) % 4)
    data = zlib.decompress(base64.urlsafe_b64decode(body + pad))
    obj = json.loads(data.decode("utf-8"))
    if not isinstance(obj, dict):
        raise ValueError("live payload must decode to an object")
    return obj


def encode_payload(snapshot: dict) -> str:
    raw = json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    encoded = base64.urlsafe_b64encode(zlib.compress(raw)).rstrip(b"=").decode("ascii")
    return PAYLOAD_PREFIX + encoded


def snapshot_url(base: str, payload: str) -> str:
    return f"{base.rstrip('/')}?s={quote(payload, safe='._-')}"


def _as_name(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    if isinstance(value, dict):
        name = value.get("name")
        if isinstance(name, str) and name:
            return name
        card = value.get("card")
        if isinstance(card, str) and card:
            return card
    return None


def _collect_names(snapshot: dict) -> set[str]:
    names: set[str] = set()

    def add(value: Any) -> None:
        name = _as_name(value)
        if name:
            names.add(name)
        if isinstance(value, dict):
            face = value.get("face")
            if isinstance(face, str) and face:
                names.add(face)

    for item in snapshot.get("stack") or []:
        add(item)

    combat = snapshot.get("combat")
    if isinstance(combat, dict):
        for attacker in combat.get("attackers") or []:
            add(attacker)
            if isinstance(attacker, dict):
                add(attacker.get("defender"))
        for block in combat.get("blocks") or []:
            if isinstance(block, dict):
                add(block.get("attacker"))
                for blocker in block.get("blockers") or []:
                    add(blocker)
        for unblocked in combat.get("unblocked") or []:
            add(unblocked)
        possible = combat.get("possible_blockers") or {}
        if isinstance(possible, dict):
            for blockers in possible.values():
                for blocker in blockers or []:
                    add(blocker)

    for seat in snapshot.get("seats") or []:
        if not isinstance(seat, dict):
            continue
        for commander in seat.get("commanders") or []:
            add(commander)
        for zone in ("hand", "graveyard", "exile", "command", "revealed_top"):
            for card in seat.get(zone) or []:
                add(card)
        for entry in seat.get("battlefield") or []:
            add(entry)

    return names


def _trim_catalog(catalog: dict | None, names: set[str]) -> dict:
    if not isinstance(catalog, dict):
        return {}
    return {name: catalog[name] for name in names if name in catalog}


def _trim_tokens(tokens: dict | None, snapshot: dict) -> dict | None:
    if not isinstance(tokens, dict) or not tokens:
        return tokens if tokens else None
    keep: set[str] = set()
    for seat in snapshot.get("seats") or []:
        if not isinstance(seat, dict):
            continue
        for entry in seat.get("battlefield") or []:
            if not isinstance(entry, dict):
                continue
            token_id = entry.get("token_id")
            if isinstance(token_id, str) and token_id:
                keep.add(token_id)
            name = entry.get("name")
            if entry.get("token") and isinstance(name, str):
                keep.add(name)
    if not keep:
        return {key: tokens[key] for key in tokens}
    trimmed = {}
    for key, value in tokens.items():
        if key in keep:
            trimmed[key] = value
            continue
        if isinstance(value, dict) and value.get("name") in keep:
            trimmed[key] = value
            continue
        if isinstance(value, dict) and value.get("id") in keep:
            trimmed[key] = value
    return trimmed or None


def _map_seat(
    seat_meta: dict,
    player: dict,
    *,
    you: str | None,
    public: bool,
) -> dict:
    seat_id = seat_meta["id"]
    hand = list(player.get("hand") or [])
    hand_count = player.get("hand_count")
    if not isinstance(hand_count, int):
        hand_count = len(hand)

    out: dict[str, Any] = {
        "id": seat_id,
        "name": seat_meta.get("name") or seat_id,
        "commanders": list(seat_meta.get("commanders") or []),
        "color": seat_meta.get("color") or "#888888",
        "life": player.get("life", 40),
        "poison": player.get("poison", 0),
        "commander_damage": dict(player.get("commander_damage") or {}),
        "commander_tax": player.get("commander_tax", 0),
        "library_count": player.get("library_count", 0),
        "hand_count": hand_count,
        "battlefield": list(player.get("battlefield") or []),
        "graveyard": list(player.get("graveyard") or []),
        "exile": list(player.get("exile") or []),
        "command": list(player.get("command") or []),
    }

    if not public and you == seat_id:
        out["hand"] = hand

    if "revealed_top" in player:
        # Replay state already carries revealed_top; treat it as table-visible.
        out["revealed_top"] = list(player.get("revealed_top") or [])
    elif not public and you == seat_id:
        # Visibility unknown: only the viewer may see a private top.
        private_top = player.get("revealed_top")
        if private_top:
            out["revealed_top"] = list(private_top)

    return out


def build_snapshot(
    replay: dict,
    *,
    you: str | None,
    talk: str,
    waiting: str,
    public: bool = False,
) -> dict:
    events = replay.get("events") or []
    if not events:
        raise ValueError("replay has no events")
    last = events[-1]
    state = last.get("state") or {}
    if not isinstance(state, dict):
        raise ValueError("last event state must be an object")

    players = state.get("players") or {}
    if not isinstance(players, dict):
        raise ValueError("state.players must be an object")

    seats_meta = {seat["id"]: seat for seat in replay.get("seats") or [] if "id" in seat}
    viewer = None if public else you

    seats = []
    for seat_id in SEAT_IDS:
        meta = seats_meta.get(seat_id) or {"id": seat_id, "name": seat_id, "commanders": []}
        player = players.get(seat_id) or {}
        seats.append(_map_seat(meta, player, you=viewer, public=public))

    snapshot: dict[str, Any] = {
        "v": 1,
        "you": viewer,
        "headline": replay.get("headline") or "",
        "waiting": waiting,
        "talk": talk,
        "turn": state.get("turn", last.get("turn", 0)),
        "phase": state.get("phase", last.get("phase", "setup")),
        "active": state.get("active", last.get("seat")),
        "stack": list(state.get("stack") or []),
        "seats": seats,
    }

    combat = last.get("combat")
    if combat is None and isinstance(state.get("combat"), dict):
        combat = state.get("combat")
    if combat is not None:
        snapshot["combat"] = combat

    names = _collect_names(snapshot)
    snapshot["catalog"] = _trim_catalog(replay.get("catalog"), names)

    tokens = _trim_tokens(replay.get("tokens"), snapshot)
    if tokens:
        snapshot["tokens"] = tokens

    return snapshot


def load_replay(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("replay root must be an object")
    schema = data.get("schema")
    if schema not in (1, 2, None):
        raise ValueError(f"unsupported replay schema: {schema!r}")
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replay", type=Path, help="simulate-table replay JSON path")
    parser.add_argument("--you", choices=SEAT_IDS, help="viewer seat for the private link")
    parser.add_argument("--talk", default="", help="table talk / standing plan")
    parser.add_argument("--waiting", default="What do you do?", help="prompt for the human")
    parser.add_argument(
        "--public",
        action="store_true",
        help="emit only the redacted public snapshot/URL",
    )
    parser.add_argument("--base", default=DEFAULT_BASE, help="live page base URL")
    parser.add_argument(
        "--json",
        action="store_true",
        help="write the uncompressed snapshot JSON to stdout",
    )
    args = parser.parse_args(argv)

    if not args.public and not args.you:
        parser.error("--you is required unless --public is set")

    replay = load_replay(args.replay)

    if args.public:
        snapshot = build_snapshot(
            replay,
            you=None,
            talk=args.talk,
            waiting=args.waiting,
            public=True,
        )
        if args.json:
            json.dump(snapshot, sys.stdout, separators=(",", ":"), ensure_ascii=False)
            sys.stdout.write("\n")
            return 0
        payload = encode_payload(snapshot)
        print(snapshot_url(args.base, payload))
        return 0

    private = build_snapshot(
        replay,
        you=args.you,
        talk=args.talk,
        waiting=args.waiting,
        public=False,
    )
    if args.json:
        json.dump(private, sys.stdout, separators=(",", ":"), ensure_ascii=False)
        sys.stdout.write("\n")
        return 0

    public = build_snapshot(
        replay,
        you=None,
        talk=args.talk,
        waiting=args.waiting,
        public=True,
    )
    private_url = snapshot_url(args.base, encode_payload(private))
    public_url = snapshot_url(args.base, encode_payload(public))
    if len(private_url) > QUERY_WARN_CHARS:
        print(
            f"warning: private query URL is {len(private_url)} characters "
            f"(over {QUERY_WARN_CHARS}); prefer the hash form if hosts truncate",
            file=sys.stderr,
        )
    print(f"private: {private_url}")
    print(f"public:  {public_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
