#!/usr/bin/env python3
"""Compact table-replay digests. Drops per-event snapshots so review stays readable."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TABLE_GAMES = ROOT / "table-games"

SEAT_IDS = ("p1", "p2", "p3", "p4")
INSTANT_SPEED = re.compile(r"\bflash\b", re.I)
ADD_MANA = re.compile(r": add\b", re.I)
SACRIFICE = re.compile(r"\bsacrific", re.I)
CREATURE_TYPE = re.compile(r"\bcreature\b", re.I)
REACTIVE = re.compile(
    r"counter target"
    r"|destroy target"
    r"|exile target"
    r"|return target .+ to (its|their) owner'?s hand"
    r"|prevent all (combat )?damage"
    r"|draw (a|two|three) cards?"
    r"|deals? \w+ damage to any target"
    r"|tap target"
    r"|can't (attack|cast|activate)",
    re.I,
)


def normalize(value: str) -> str:
    lowered = value.casefold()
    return re.sub(r"[^a-z0-9]+", " ", lowered).strip()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def reference_row(references: list[dict], value: object) -> dict | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if value < 0 or value >= len(references):
        return None
    row = references[value]
    return row if isinstance(row, dict) else None


def reference_name(references: list[dict], value: object) -> str:
    row = reference_row(references, value)
    if row and row.get("kind") in {"card", "player"} and row.get("name"):
        return str(row["name"])
    return str(value)


def resolve_cards(references: list[dict], values: list[object]) -> list[str]:
    return [reference_name(references, value) for value in values]


def deal_reference(references: list[dict], value: object) -> dict:
    row = reference_row(references, value)
    if not row or row.get("kind") != "deal":
        return {"id": value, "missing_reference": True}
    return {
        "id": value,
        "from": reference_name(references, row.get("from")),
        "to": resolve_cards(references, row.get("to") or []),
        "terms": row.get("terms") or "",
        "if_refused": row.get("if_refused") or "",
        "expires": row.get("expires") or "",
    }


def replay_paths(explicit: list[str]) -> list[Path]:
    if explicit:
        paths = [Path(item).expanduser() for item in explicit]
        resolved = []
        for path in paths:
            candidate = path if path.is_absolute() else ROOT / path
            if not candidate.exists():
                raise SystemExit(f"replay not found: {path}")
            resolved.append(candidate.resolve())
        return resolved
    if not TABLE_GAMES.is_dir():
        return []
    return sorted(
        path
        for path in TABLE_GAMES.glob("*.json")
        if not path.name.endswith(".working.json")
    )


def catalog_entry(catalog: dict, name: str) -> dict:
    entry = catalog.get(name) or {}
    return entry if isinstance(entry, dict) else {}


def type_line(catalog: dict, name: str) -> str:
    return str(catalog_entry(catalog, name).get("type_line") or "")


def oracle_text(catalog: dict, name: str) -> str:
    return str(catalog_entry(catalog, name).get("oracle_text") or "")


def is_land(catalog: dict, name: str) -> bool:
    return "land" in type_line(catalog, name).casefold()


def is_creature(catalog: dict, name: str, token: bool = False) -> bool:
    line = type_line(catalog, name)
    if line:
        return bool(CREATURE_TYPE.search(line))
    return token


def is_instant_speed(catalog: dict, name: str) -> bool:
    line = type_line(catalog, name).casefold()
    if "instant" in line:
        return True
    return bool(INSTANT_SPEED.search(oracle_text(catalog, name)))


def is_reactive(catalog: dict, name: str) -> bool:
    if not is_instant_speed(catalog, name):
        return False
    return bool(REACTIVE.search(oracle_text(catalog, name)))


def produces_mana(catalog: dict, name: str) -> bool:
    if is_land(catalog, name):
        return True
    return bool(ADD_MANA.search(oracle_text(catalog, name)))


def compact_permanent(entry: dict) -> dict:
    compact = {"name": entry.get("name")}
    if entry.get("tapped"):
        compact["tapped"] = True
    if entry.get("token"):
        compact["token"] = True
    if entry.get("commander"):
        compact["commander"] = True
    counters = entry.get("counters") or {}
    if counters:
        compact["counters"] = counters
    note = entry.get("note") or ""
    if note:
        compact["note"] = note
    return compact


def compact_player(player: dict, references: list[dict] | None = None) -> dict:
    rows = references or []
    battlefield = [
        compact_permanent(entry)
        for entry in player.get("battlefield") or []
        if isinstance(entry, dict)
    ]
    return {
        "life": player.get("life"),
        "poison": player.get("poison") or 0,
        "commander_damage": player.get("commander_damage") or {},
        "commander_tax": player.get("commander_tax") or 0,
        "library_count": player.get("library_count"),
        "hand": resolve_cards(rows, player.get("hand") or []),
        "battlefield": battlefield,
        "graveyard": resolve_cards(rows, player.get("graveyard") or []),
        "exile": resolve_cards(rows, player.get("exile") or []),
        "command": resolve_cards(rows, player.get("command") or []),
        "revealed_top": resolve_cards(rows, player.get("revealed_top") or []),
    }


def untapped_mana_sources(catalog: dict, battlefield: list[dict]) -> list[str]:
    names = []
    for entry in battlefield:
        name = entry.get("name")
        if not name or entry.get("tapped"):
            continue
        if produces_mana(catalog, name):
            names.append(name)
    return names


def token_creatures(catalog: dict, battlefield: list[dict]) -> list[str]:
    names = []
    for entry in battlefield:
        name = entry.get("name")
        if not name or not entry.get("token"):
            continue
        if is_creature(catalog, name, token=True):
            names.append(name)
    return names


def compact_decision(decision: dict, references: list[dict]) -> dict:
    if not decision:
        return {}
    compact = {
        "open_mana": decision.get("open_mana"),
        "available": resolve_cards(references, decision.get("available") or []),
        "held": resolve_cards(references, decision.get("held") or []),
        "held_for": decision.get("held_for") or "",
        "play_later": decision.get("play_later") or "",
        "reason": decision.get("reason") or "",
    }
    if "honors_deal" in decision:
        compact["honors_deal"] = deal_reference(
            references, decision.get("honors_deal")
        )
    return compact


def event_log(event: dict, references: list[dict] | None = None) -> dict:
    rows = references or []
    compact = {
        "id": event.get("id"),
        "turn": event.get("turn"),
        "phase": event.get("phase"),
        "seat": event.get("seat"),
        "kind": event.get("kind"),
        "summary": event.get("summary") or "",
        "cards": resolve_cards(rows, event.get("cards") or []),
        "notes": event.get("notes") or "",
    }
    decision = compact_decision(event.get("decision") or {}, rows)
    if decision:
        compact["decision"] = decision
    deal = event.get("deal") or {}
    if deal:
        compact["deal"] = {
            **deal_reference(rows, deal.get("id")),
            "action": deal.get("action") or "",
        }
    return compact


def players_of(event: dict) -> dict:
    state = event.get("state") or {}
    players = state.get("players") or {}
    return players if isinstance(players, dict) else {}


def load_deck_categories(deck_path: str) -> dict[str, list[str]]:
    manifest = ROOT / deck_path / "cards.json"
    if not manifest.is_file():
        return {}
    data = load_json(manifest)
    mapping: dict[str, list[str]] = {}
    for entry in data.get("cards") or []:
        name = entry.get("name")
        categories = entry.get("categories") or []
        if name and isinstance(categories, list):
            mapping[name] = [str(item) for item in categories]
    return mapping


def match_seat(seat: dict, query: str) -> bool:
    needle = normalize(query)
    if not needle:
        return False
    haystacks = [
        seat.get("id") or "",
        seat.get("name") or "",
        seat.get("deck") or "",
        " ".join(seat.get("commanders") or []),
        Path(seat.get("deck") or "").name,
    ]
    return any(needle in normalize(str(item)) for item in haystacks)


def game_matches_deck(game: dict, query: str) -> bool:
    return any(match_seat(seat, query) for seat in game.get("seats") or [])


def list_entry(path: Path, game: dict) -> dict:
    result = game.get("result") or {}
    return {
        "file": str(path.relative_to(ROOT)),
        "format": (
            "references-decisions-politics"
            if game.get("references")
            else "legacy"
        ),
        "seed": game.get("seed"),
        "headline": game.get("headline"),
        "result": result,
        "seats": [
            {
                "id": seat.get("id"),
                "name": seat.get("name"),
                "deck": seat.get("deck"),
                "commanders": seat.get("commanders") or [],
                "mulligans": seat.get("mulligans"),
            }
            for seat in game.get("seats") or []
        ],
    }


def track_hands(
    events: list[dict], references: list[dict]
) -> dict[str, dict[str, set[str]]]:
    seen: dict[str, set[str]] = defaultdict(set)
    spent: dict[str, set[str]] = defaultdict(set)
    for event in events:
        kind = event.get("kind")
        seat = event.get("seat")
        cards = resolve_cards(references, event.get("cards") or [])
        if kind in {"keep", "draw"} and seat:
            seen[seat].update(cards)
        if kind in {"cast", "play_land", "activate"} and seat:
            spent[seat].update(cards)
        for seat_id, player in players_of(event).items():
            seen[seat_id].update(player.get("hand") or [])
    leftover = {}
    last = players_of(events[-1]) if events else {}
    for seat_id in SEAT_IDS:
        final_hand = set(last.get(seat_id, {}).get("hand") or [])
        leftover[seat_id] = {
            "seen": seen.get(seat_id, set()),
            "spent": spent.get(seat_id, set()),
            "final_hand": final_hand,
        }
    return leftover


def missed_land_drops(catalog: dict, events: list[dict]) -> list[dict]:
    flags = []
    by_turn: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for event in events:
        turn = event.get("turn") or 0
        seat = event.get("seat")
        if turn < 1 or seat not in SEAT_IDS:
            continue
        by_turn[(turn, seat)].append(event)
    for (turn, seat), group in sorted(by_turn.items()):
        if any(item.get("kind") == "play_land" for item in group):
            continue
        if not any(item.get("phase") in {"main1", "main2"} for item in group):
            continue
        last = group[-1]
        player = players_of(last).get(seat) or {}
        lands_in_hand = [
            name for name in player.get("hand") or [] if is_land(catalog, name)
        ]
        if lands_in_hand:
            flags.append(
                {
                    "turn": turn,
                    "seat": seat,
                    "lands_in_hand": lands_in_hand,
                    "event": last.get("id"),
                }
            )
    return flags


def unused_reactive(
    catalog: dict, events: list[dict], references: list[dict]
) -> list[dict]:
    flags = []
    for index, event in enumerate(events):
        if event.get("kind") not in {"cast", "attack"}:
            continue
        actor = event.get("seat")
        if actor not in SEAT_IDS:
            continue
        previous = events[index - 1] if index else event
        players = players_of(previous)
        stack = (event.get("state") or {}).get("stack") or []
        for seat_id, player in players.items():
            if seat_id == actor:
                continue
            hand = list(player.get("hand") or [])
            reactive = [name for name in hand if is_reactive(catalog, name)]
            mana = untapped_mana_sources(catalog, player.get("battlefield") or [])
            if not reactive or not mana:
                continue
            later = events[index + 1 : index + 8]
            answered = any(
                item.get("seat") == seat_id
                and item.get("kind") in {"cast", "activate"}
                for item in later
            )
            if answered:
                continue
            flags.append(
                {
                    "event": event.get("id"),
                    "turn": event.get("turn"),
                    "phase": event.get("phase"),
                    "threat_seat": actor,
                    "threat": event.get("summary"),
                    "idle_seat": seat_id,
                    "reactive_in_hand": reactive,
                    "untapped_mana": mana,
                    "stack": [
                        reference_name(references, item.get("name"))
                        for item in stack
                        if isinstance(item, dict) and item.get("name")
                    ],
                }
            )
    return flags


def sac_before_attack(
    catalog: dict, events: list[dict], references: list[dict]
) -> list[dict]:
    flags = []
    by_turn: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for event in events:
        turn = event.get("turn") or 0
        seat = event.get("seat")
        if turn < 1 or seat not in SEAT_IDS:
            continue
        by_turn[(turn, seat)].append(event)
    for (turn, seat), group in sorted(by_turn.items()):
        attack = next((item for item in group if item.get("kind") == "attack"), None)
        if not attack:
            continue
        attack_index = group.index(attack)
        earlier = group[:attack_index]
        sacrificed = [
            item
            for item in earlier
            if SACRIFICE.search(item.get("summary") or "")
            or SACRIFICE.search(item.get("notes") or "")
        ]
        if not sacrificed:
            continue
        first_id = sacrificed[0].get("id")
        previous = events[first_id - 1] if isinstance(first_id, int) and first_id > 0 else sacrificed[0]
        before = players_of(previous).get(seat) or {}
        tokens = token_creatures(catalog, before.get("battlefield") or [])
        if not tokens:
            continue
        flags.append(
            {
                "turn": turn,
                "seat": seat,
                "tokens_before": tokens,
                "sacrifices": [
                    event_log(item, references) for item in sacrificed
                ],
                "attack": event_log(attack, references),
            }
        )
    return flags


def never_deployed(
    catalog: dict,
    events: list[dict],
    categories: dict[str, dict[str, list[str]]],
    references: list[dict],
) -> dict[str, list[dict]]:
    tracked = track_hands(events, references)
    report: dict[str, list[dict]] = {}
    for seat_id, bags in tracked.items():
        leftover = sorted((bags["seen"] - bags["spent"]) & bags["final_hand"])
        rows = []
        seat_categories = categories.get(seat_id) or {}
        for name in leftover:
            rows.append(
                {
                    "name": name,
                    "instant_speed": is_instant_speed(catalog, name),
                    "land": is_land(catalog, name),
                    "categories": seat_categories.get(name) or [],
                }
            )
        report[seat_id] = rows
    return report


def turn_summaries(
    catalog: dict, events: list[dict], references: list[dict]
) -> list[dict]:
    grouped: dict[int, list[dict]] = defaultdict(list)
    for event in events:
        turn = event.get("turn") or 0
        if turn < 1:
            continue
        grouped[turn].append(event)
    turns = []
    for turn, group in sorted(grouped.items()):
        seats = {}
        for seat_id in SEAT_IDS:
            seat_events = [item for item in group if item.get("seat") == seat_id]
            last = seat_events[-1] if seat_events else group[-1]
            player = players_of(last).get(seat_id) or {}
            compact = compact_player(player, references)
            battlefield = player.get("battlefield") or []
            seats[seat_id] = {
                **compact,
                "lands": sum(
                    1
                    for entry in battlefield
                    if isinstance(entry, dict) and is_land(catalog, entry.get("name") or "")
                ),
                "untapped_mana": untapped_mana_sources(catalog, battlefield),
                "token_creatures": token_creatures(catalog, battlefield),
                "drew": [
                    name
                    for item in seat_events
                    if item.get("kind") == "draw"
                    for name in resolve_cards(
                        references, item.get("cards") or []
                    )
                ],
                "cast": [
                    name
                    for item in seat_events
                    if item.get("kind") == "cast"
                    for name in resolve_cards(
                        references, item.get("cards") or []
                    )
                ],
                "lands_played": [
                    name
                    for item in seat_events
                    if item.get("kind") == "play_land"
                    for name in resolve_cards(
                        references, item.get("cards") or []
                    )
                ],
                "attacked": [
                    name
                    for item in seat_events
                    if item.get("kind") == "attack"
                    for name in resolve_cards(
                        references, item.get("cards") or []
                    )
                ],
                "actions": [
                    event_log(item, references) for item in seat_events
                ],
            }
        turns.append({"turn": turn, "seats": seats})
    return turns


def recorded_decisions(
    events: list[dict], references: list[dict]
) -> list[dict]:
    return [
        event_log(event, references)
        for event in events
        if event.get("decision")
    ]


def politics_log(events: list[dict], references: list[dict]) -> dict:
    deals = [
        deal_reference(references, index)
        for index, row in enumerate(references)
        if isinstance(row, dict) and row.get("kind") == "deal"
    ]
    events_with_deals = [
        event_log(event, references)
        for event in events
        if event.get("kind") in {"talk", "deal"} or event.get("deal")
    ]
    final_state = (events[-1].get("state") or {}) if events else {}
    active = []
    for state_deal in final_state.get("deals") or []:
        if not isinstance(state_deal, dict):
            continue
        active.append(
            {
                **deal_reference(references, state_deal.get("id")),
                "status": state_deal.get("status") or "",
                "offered_event": state_deal.get("offered_event"),
                "resolved_event": state_deal.get("resolved_event"),
            }
        )
    return {"references": deals, "events": events_with_deals, "final": active}


def unexplained_holds(
    catalog: dict, events: list[dict], references: list[dict]
) -> list[dict]:
    if not references:
        return []
    flags = []
    for index, event in enumerate(events):
        if event.get("kind") != "pass" or event.get("decision"):
            continue
        previous = events[index - 1] if index else {}
        if (
            previous.get("seat") == event.get("seat")
            and previous.get("kind") == "think"
            and previous.get("decision")
        ):
            continue
        seat = event.get("seat")
        player = players_of(event).get(seat) or {}
        mana = untapped_mana_sources(
            catalog, player.get("battlefield") or []
        )
        hand = list(player.get("hand") or [])
        if not mana or not hand:
            continue
        flags.append(
            {
                "event": event.get("id"),
                "turn": event.get("turn"),
                "phase": event.get("phase"),
                "seat": seat,
                "untapped_mana": mana,
                "cards_in_hand": hand,
                "summary": event.get("summary") or "",
            }
        )
    return flags


def digest_game(path: Path, game: dict, seat_query: str | None) -> dict:
    seats = game.get("seats") or []
    catalog = game.get("catalog") or {}
    events = game.get("events") or []
    references = game.get("references") or []
    focus = [
        seat.get("id")
        for seat in seats
        if seat_query and match_seat(seat, seat_query)
    ]
    categories = {
        seat.get("id"): load_deck_categories(seat.get("deck") or "")
        for seat in seats
        if seat.get("id")
    }
    digest = {
        **list_entry(path, game),
        "horizon": game.get("horizon"),
        "starting_life": game.get("starting_life"),
        "format": "references-decisions-politics" if references else "legacy",
        "event_count": len(events),
        "events": [event_log(event, references) for event in events],
        "turns": turn_summaries(catalog, events, references),
        "decisions": recorded_decisions(events, references),
        "politics": politics_log(events, references),
        "flags": {
            "missed_land_drops": missed_land_drops(catalog, events),
            "unused_reactive": unused_reactive(
                catalog, events, references
            ),
            "sac_before_attack": sac_before_attack(
                catalog, events, references
            ),
            "unexplained_holds": unexplained_holds(
                catalog, events, references
            ),
        },
        "never_deployed": never_deployed(
            catalog, events, categories, references
        ),
        "final": {
            seat_id: compact_player(player, references)
            for seat_id, player in players_of(events[-1] if events else {}).items()
        },
    }
    if focus:
        digest["focus"] = focus
        digest["flags"] = {
            key: [
                row
                for row in rows
                if row.get("seat") in focus
                or row.get("idle_seat") in focus
            ]
            for key, rows in digest["flags"].items()
        }
        digest["never_deployed"] = {
            seat_id: rows
            for seat_id, rows in digest["never_deployed"].items()
            if seat_id in focus
        }
        for turn in digest["turns"]:
            turn["seats"] = {
                seat_id: row
                for seat_id, row in turn["seats"].items()
                if seat_id in focus
            }
    return digest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="List or summarize simulate-table replay JSON without snapshots."
    )
    parser.add_argument(
        "replays",
        nargs="*",
        help="Replay JSON paths. Default: every table-games/*.json file.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print one row per matching replay instead of a full digest.",
    )
    parser.add_argument(
        "--deck",
        help="Keep replays whose seat name, commander, or folder matches this query.",
    )
    parser.add_argument(
        "--seat",
        help="In a digest, keep flags and turn rows for matching seats only.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    paths = replay_paths(args.replays)
    if not paths:
        print("no replay JSON found under table-games/", file=sys.stderr)
        return 1

    listed = []
    digests = []
    for path in paths:
        game = load_json(path)
        if args.deck and not game_matches_deck(game, args.deck):
            continue
        listed.append(list_entry(path, game))
        if not args.list:
            digests.append(digest_game(path, game, args.seat))

    if args.list or args.deck and not digests and not listed:
        json.dump({"replays": listed}, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
        if args.deck and not listed:
            print(f"no replays matched deck {args.deck!r}", file=sys.stderr)
            return 1
        return 0

    payload = {"replays": listed, "games": digests}
    json.dump(payload, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
