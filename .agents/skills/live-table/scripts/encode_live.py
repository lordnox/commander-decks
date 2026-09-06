#!/usr/bin/env python3
"""Encode a simulate-table replay into a live-table snapshot URL."""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import zlib
from pathlib import Path
from typing import Any
from urllib.parse import quote

DEFAULT_BASE = "https://lordnox.github.io/commander-decks/live/"
PAYLOAD_PREFIX = "v1."
CHAT_WARN_CHARS = 6000
QUERY_WARN_CHARS = 8000
SEAT_IDS = ("p1", "p2", "p3", "p4")
SCRYFALL_IMAGE_ID_RE = re.compile(
    r"cards\.scryfall\.io/[^/]+/(?:front|back)/[0-9a-f]/[0-9a-f]/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.IGNORECASE,
)
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


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


CATALOG_FIELDS = (
    "id",
    "scryfall_uri",
    "image_small",
    "image_normal",
    "type_line",
    "mana_cost",
    "oracle_text",
    "stats",
    "faces",
)
FACE_FIELDS = (
    "id",
    "name",
    "image_small",
    "image_normal",
    "type_line",
    "mana_cost",
    "oracle_text",
    "stats",
)
TEXT_FIELDS = ("type_line", "mana_cost", "oracle_text", "stats")


def live_base(base: str) -> str:
    return base if base.endswith("/") else f"{base}/"


def snapshot_url(base: str, payload: str, *, hash_form: bool = False) -> str:
    root = live_base(base)
    encoded = quote(payload, safe="._-")
    if hash_form:
        return f"{root}#s={encoded}"
    return f"{root}?s={encoded}"


def short_link(
    base: str,
    *,
    game: str,
    event: int | None = None,
    you: str | None = None,
    talk: str = "",
    waiting: str = "",
) -> str:
    root = live_base(base)
    parts = [f"game={quote(game, safe='')}"]
    if event is not None:
        parts.append(f"event={event}")
    if you:
        parts.append(f"you={quote(you, safe='')}")
    if talk:
        parts.append(f"talk={quote(talk, safe='')}")
    if waiting:
        parts.append(f"waiting={quote(waiting, safe='')}")
    return f"{root}?{'&'.join(parts)}"


def _scryfall_id_from_image_urls(*urls: Any) -> str | None:
    for url in urls:
        if not isinstance(url, str) or not url:
            continue
        match = SCRYFALL_IMAGE_ID_RE.search(url)
        if match:
            return match.group(1).lower()
    return None


def _as_uuid(value: Any) -> str | None:
    if isinstance(value, str) and UUID_RE.fullmatch(value):
        return value.lower()
    return None


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


def _compact_face(face: Any) -> Any:
    if not isinstance(face, dict):
        return face
    recovered = _scryfall_id_from_image_urls(face.get("image_small"), face.get("image_normal"))
    if recovered is None:
        recovered = _as_uuid(face.get("id"))
    if recovered:
        out: dict[str, Any] = {"id": recovered}
        name = face.get("name")
        if isinstance(name, str) and name:
            out["name"] = name
        for key in TEXT_FIELDS:
            if key in face and face[key]:
                out[key] = face[key]
        return out
    return {key: face[key] for key in FACE_FIELDS if key in face and face[key]}


def _compact_card(details: Any) -> Any:
    if not isinstance(details, dict):
        return details
    recovered = _scryfall_id_from_image_urls(details.get("image_small"), details.get("image_normal"))
    if recovered is None:
        recovered = _as_uuid(details.get("id"))
    if recovered:
        return {"id": recovered}
    faces = details.get("faces")
    out = {key: details[key] for key in CATALOG_FIELDS if key in details and details[key]}
    if isinstance(faces, list):
        out["faces"] = [_compact_face(face) for face in faces]
    return out


def _trim_catalog(catalog: dict | None, names: set[str]) -> dict:
    if not isinstance(catalog, dict):
        return {}
    return {name: _compact_card(catalog[name]) for name in sorted(names) if name in catalog}


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
        return None
    trimmed = {}
    for key, value in tokens.items():
        if key in keep:
            trimmed[key] = _compact_card(value)
            continue
        if isinstance(value, dict) and value.get("name") in keep:
            trimmed[key] = _compact_card(value)
            continue
        if isinstance(value, dict) and value.get("id") in keep:
            trimmed[key] = _compact_card(value)
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


def select_event(events: list, event_id: int | None) -> dict:
    if event_id is None:
        return events[-1]
    for event in events:
        if event.get("id") == event_id:
            return event
    raise ValueError(f"replay has no event with id {event_id}")


def build_snapshot(
    replay: dict,
    *,
    you: str | None,
    talk: str,
    waiting: str,
    public: bool = False,
    event_id: int | None = None,
) -> dict:
    events = replay.get("events") or []
    if not events:
        raise ValueError("replay has no events")
    last = select_event(events, event_id)
    state = last.get("state") or {}
    if not isinstance(state, dict):
        raise ValueError(f"event {last.get('id')} state must be an object")

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
        "--event",
        type=int,
        help="event id to snapshot (default: the last event)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="write the uncompressed snapshot JSON to stdout",
    )
    parser.add_argument(
        "--game",
        help="published replay slug; emit a short ?game= link instead of a payload",
    )
    args = parser.parse_args(argv)

    if not args.public and not args.you:
        parser.error("--you is required unless --public is set")

    if args.game:
        if args.public:
            print(
                short_link(
                    args.base,
                    game=args.game,
                    event=args.event,
                    you=None,
                    talk=args.talk,
                    waiting=args.waiting,
                )
            )
            return 0
        print(
            f"private: {short_link(args.base, game=args.game, event=args.event, you=args.you, talk=args.talk, waiting=args.waiting)}"
        )
        print(
            f"public:  {short_link(args.base, game=args.game, event=args.event, you=None, talk=args.talk, waiting=args.waiting)}"
        )
        return 0

    replay = load_replay(args.replay)

    if args.public:
        snapshot = build_snapshot(
            replay,
            you=None,
            talk=args.talk,
            waiting=args.waiting,
            public=True,
            event_id=args.event,
        )
        if args.json:
            json.dump(snapshot, sys.stdout, separators=(",", ":"), ensure_ascii=False)
            sys.stdout.write("\n")
            return 0
        payload = encode_payload(snapshot)
        url = snapshot_url(args.base, payload)
        if len(url) > CHAT_WARN_CHARS:
            print(
                f"warning: query URL is {len(url)} characters "
                f"(over {CHAT_WARN_CHARS}); publish the game and use --game instead of a payload link",
                file=sys.stderr,
            )
        if len(url) > QUERY_WARN_CHARS:
            print(
                f"warning: query URL is {len(url)} characters "
                f"(over {QUERY_WARN_CHARS}); posting hash form so hosts do not truncate",
                file=sys.stderr,
            )
            print(snapshot_url(args.base, payload, hash_form=True))
            return 0
        print(url)
        return 0

    private = build_snapshot(
        replay,
        you=args.you,
        talk=args.talk,
        waiting=args.waiting,
        public=False,
        event_id=args.event,
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
        event_id=args.event,
    )
    private_payload = encode_payload(private)
    public_payload = encode_payload(public)
    private_query = snapshot_url(args.base, private_payload)
    public_query = snapshot_url(args.base, public_payload)
    if len(private_query) > CHAT_WARN_CHARS:
        print(
            f"warning: private query URL is {len(private_query)} characters "
            f"(over {CHAT_WARN_CHARS}); publish the game and use --game instead of a payload link",
            file=sys.stderr,
        )
    use_hash = len(private_query) > QUERY_WARN_CHARS
    if use_hash:
        print(
            f"warning: private query URL is {len(private_query)} characters "
            f"(over {QUERY_WARN_CHARS}); posting hash form so hosts do not truncate",
            file=sys.stderr,
        )
        print(f"private: {snapshot_url(args.base, private_payload, hash_form=True)}")
        print(f"public:  {snapshot_url(args.base, public_payload, hash_form=True)}")
        return 0
    print(f"private: {private_query}")
    print(f"public:  {public_query}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
