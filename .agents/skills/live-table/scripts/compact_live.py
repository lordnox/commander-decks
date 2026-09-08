"""Pack a live snapshot so the URL cites deck lists instead of card names.

Each seat's 99 is a lookup table published at /decks/<slug>.json. A card on the
board is `deckIndex * 128 + slot`. Seat state is a 9-slot array so zone order
stays fixed and zlib has repeated structure to chew on.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
SEAT_IDS = ("p1", "p2", "p3", "p4")
SEAT_COLORS = ("#c45c26", "#2f6f64", "#4a5d9e", "#8a3d6b")
STRIDE = 128
EXTRA_DECK = 4
TOKEN_DECK = 5
PHASES = (
    "setup",
    "planning",
    "untap",
    "upkeep",
    "draw",
    "impact",
    "main1",
    "combat",
    "main2",
    "end",
    "priority",
)
COMBAT_STEPS = ("attackers", "blockers", "first_strike_damage", "combat_damage")
DEFAULT_WAITING = "Would this line work? Confirm or replace it."
FLAG_TAPPED = 1
FLAG_TOKEN = 2
FLAG_COMMANDER = 4

# Seat tuple: stats, commander damage, commanders, hand, board, gy, exile, command, top.
SEAT_STATS = 0
SEAT_DAMAGE = 1
SEAT_COMMANDERS = 2
SEAT_HAND = 3
SEAT_BATTLEFIELD = 4
SEAT_GRAVEYARD = 5
SEAT_EXILE = 6
SEAT_COMMAND = 7
SEAT_REVEALED = 8
HIDDEN = 0
ABSENT = 0


def deck_slug(path: str | None) -> str | None:
    if not isinstance(path, str) or not path:
        return None
    name = Path(path).name
    return name or None


def card_aliases(entry: dict) -> list[str]:
    names: list[str] = []

    def add(value: Any) -> None:
        if not isinstance(value, str) or not value:
            return
        if value not in names:
            names.append(value)
        if " // " in value:
            for part in value.split("//"):
                add(part.strip())

    add(entry.get("submitted_name"))
    add(entry.get("name"))
    card = entry.get("card") if isinstance(entry.get("card"), dict) else {}
    for face in card.get("faces") or []:
        if isinstance(face, dict):
            add(face.get("name"))
    return names


def load_deck_index(deck_path: Path) -> list[dict[str, Any]]:
    data = json.loads(deck_path.joinpath("cards.json").read_text(encoding="utf-8"))
    cards = []
    for entry in data.get("cards") or []:
        if not isinstance(entry, dict):
            continue
        aliases = card_aliases(entry)
        if not aliases:
            continue
        printing = None
        cache_rel = entry.get("cache")
        cache_path = ROOT / cache_rel if isinstance(cache_rel, str) else None
        if cache_path and cache_path.is_file():
            try:
                cache = json.loads(cache_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                cache = {}
            printing = cache.get("id") if isinstance(cache, dict) else None
        item = {"n": aliases[0], "id": printing}
        extra = [name for name in aliases[1:] if name != aliases[0]]
        if extra:
            item["a"] = extra
        cards.append(item)
        if len(cards) >= STRIDE:
            break
    return cards


def public_deck_index(cards: list[dict[str, Any]]) -> dict[str, Any]:
    out = []
    for card in cards:
        item = {"n": card["n"]}
        printing = card.get("id")
        if isinstance(printing, str) and printing:
            item["id"] = printing.lower()
        aliases = card.get("a") or []
        if aliases:
            item["a"] = aliases
        out.append(item)
    return {"cards": out}


def indexes_from_replay(replay: dict, *, root: Path = ROOT) -> dict[str, list[dict[str, Any]]]:
    indexes: dict[str, list[dict[str, Any]]] = {}
    for seat in replay.get("seats") or []:
        if not isinstance(seat, dict):
            continue
        slug = deck_slug(seat.get("deck"))
        if not slug or slug in indexes:
            continue
        folder = root / "decks" / slug
        if not folder.joinpath("cards.json").is_file():
            continue
        indexes[slug] = load_deck_index(folder)
    return indexes


def _normalize(name: str) -> str:
    return " ".join(name.casefold().split())


class CardTable:
    def __init__(self, slugs: list[str], indexes: dict[str, list[dict[str, Any]]]):
        self.slugs = slugs
        self.lists = [indexes.get(slug) or [] for slug in slugs]
        self.extras: list[str] = []
        self.tokens: list[tuple[str, dict[str, Any]]] = []
        self._alias: list[dict[str, int]] = []
        for cards in self.lists:
            lookup: dict[str, int] = {}
            for index, card in enumerate(cards):
                for name in [card.get("n"), *(card.get("a") or [])]:
                    if isinstance(name, str) and name and _normalize(name) not in lookup:
                        lookup[_normalize(name)] = index
            self._alias.append(lookup)

    def card_ref(self, name: Any, *, prefer: int | None = None) -> int | Any:
        parsed = _as_name(name)
        if parsed is None:
            return name
        key = _normalize(parsed)
        order = list(range(len(self.slugs)))
        if prefer is not None:
            order = [prefer, *[index for index in order if index != prefer]]
        for deck in order:
            slot = self._alias[deck].get(key) if deck < len(self._alias) else None
            if slot is not None:
                return deck * STRIDE + slot
        if parsed not in self.extras:
            self.extras.append(parsed)
        return EXTRA_DECK * STRIDE + self.extras.index(parsed)

    def token_ref(self, token_id: str, details: dict[str, Any] | None = None) -> int:
        for index, (key, _) in enumerate(self.tokens):
            if key == token_id:
                return TOKEN_DECK * STRIDE + index
        self.tokens.append((token_id, details or {}))
        return TOKEN_DECK * STRIDE + (len(self.tokens) - 1)


def _as_name(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    if isinstance(value, dict):
        name = value.get("name")
        if isinstance(name, str) and name:
            return name
    return None


def _phase_index(phase: Any) -> int:
    if isinstance(phase, str) and phase in PHASES:
        return PHASES.index(phase)
    return PHASES.index("main1")


def _pack_flags(entry: dict) -> int:
    flags = 0
    if entry.get("tapped"):
        flags |= FLAG_TAPPED
    if entry.get("token"):
        flags |= FLAG_TOKEN
    if entry.get("commander"):
        flags |= FLAG_COMMANDER
    return flags


def _pack_extra(entry: dict) -> dict[str, Any] | None:
    extra: dict[str, Any] = {}
    pt = entry.get("pt")
    if isinstance(pt, str) and pt:
        extra["p"] = pt
    note = entry.get("note")
    if isinstance(note, str) and note:
        extra["n"] = note
    counters = entry.get("counters")
    if isinstance(counters, dict) and counters:
        extra["c"] = counters
    face = entry.get("face")
    if face not in (None, "", "front"):
        extra["f"] = face
    return extra or None


def _pack_card_list(values: list, table: CardTable, *, prefer: int) -> list:
    return [table.card_ref(value, prefer=prefer) for value in values]


def _pack_battlefield(entries: list, table: CardTable, *, prefer: int) -> list:
    packed = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            packed.append(table.card_ref(entry, prefer=prefer))
            continue
        token_id = entry.get("token_id") if entry.get("token") else None
        if isinstance(token_id, str) and token_id:
            ref = table.token_ref(token_id, {"name": _as_name(entry)})
        elif entry.get("token"):
            # A token copy of a printed card has no token printing of its own.
            # Point at the card so the board keeps its art, type line, and
            # Oracle text; the token flag still travels in the packed flags.
            ref = table.card_ref(entry, prefer=prefer)
        else:
            ref = table.card_ref(entry, prefer=prefer)
        flags = _pack_flags(entry)
        extra = _pack_extra(entry)
        if not flags and extra is None:
            packed.append(ref)
        elif extra is None:
            packed.append([ref, flags])
        else:
            packed.append([ref, flags, extra])
    return packed


def _pack_stack(stack: list, table: CardTable) -> list:
    packed = []
    for item in stack or []:
        if not isinstance(item, dict):
            packed.append(table.card_ref(item, prefer=0))
            continue
        ref = table.card_ref(item.get("name"), prefer=0)
        controller = item.get("controller")
        controller_index = SEAT_IDS.index(controller) if controller in SEAT_IDS else None
        text = item.get("text")
        if controller_index is None and not text:
            packed.append(ref)
        elif not text:
            packed.append([ref, controller_index])
        else:
            packed.append([ref, controller_index, text])
    return packed


def _pack_combat(combat: dict, table: CardTable) -> dict[str, Any]:
    out: dict[str, Any] = {}
    step = combat.get("step")
    if step in COMBAT_STEPS:
        out["s"] = COMBAT_STEPS.index(step)
    attackers = []
    for attacker in combat.get("attackers") or []:
        if not isinstance(attacker, dict):
            continue
        card = table.card_ref(attacker.get("card"), prefer=0)
        defender = attacker.get("defender")
        if defender in SEAT_IDS:
            defender = SEAT_IDS.index(defender)
        else:
            defender = table.card_ref(defender, prefer=0)
        row: list[Any] = [card, defender]
        flags = FLAG_TAPPED if attacker.get("tapped") else 0
        extra: dict[str, Any] = {}
        if attacker.get("pt"):
            extra["p"] = attacker["pt"]
        if attacker.get("keywords"):
            extra["k"] = attacker["keywords"]
        if flags or extra:
            row.append(flags)
        if extra:
            row.append(extra)
        attackers.append(row)
    if attackers:
        out["a"] = attackers
    blocks = []
    for block in combat.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        blocks.append(
            [
                table.card_ref(block.get("attacker"), prefer=0),
                [table.card_ref(blocker, prefer=0) for blocker in block.get("blockers") or []],
            ]
        )
    if blocks:
        out["b"] = blocks
    possible = []
    for attacker, blockers in (combat.get("possible_blockers") or {}).items():
        possible.append(
            [
                table.card_ref(attacker, prefer=0),
                [table.card_ref(blocker, prefer=0) for blocker in blockers or []],
            ]
        )
    if possible:
        out["p"] = possible
    unblocked = [table.card_ref(name, prefer=0) for name in combat.get("unblocked") or []]
    if unblocked:
        out["u"] = unblocked
    return out


def compact_snapshot(
    snapshot: dict,
    *,
    replay: dict | None = None,
    indexes: dict[str, list[dict[str, Any]]] | None = None,
    root: Path = ROOT,
) -> dict[str, Any]:
    seats_in = snapshot.get("seats") or []
    if isinstance(seats_in, dict):
        seats_in = [seats_in[seat_id] for seat_id in SEAT_IDS if seat_id in seats_in]
    meta = {
        seat["id"]: seat
        for seat in (replay or {}).get("seats") or []
        if isinstance(seat, dict) and seat.get("id") in SEAT_IDS
    }
    slugs: list[str] = []
    for seat_id, seat in zip(SEAT_IDS, seats_in):
        slug = deck_slug(seat.get("deck") if isinstance(seat, dict) else None)
        if not slug:
            slug = deck_slug((meta.get(seat_id) or {}).get("deck"))
        slugs.append(slug or "")
    loaded = indexes if indexes is not None else indexes_from_replay(replay or {"seats": [
        {"id": seat_id, "deck": f"decks/{slug}"} for seat_id, slug in zip(SEAT_IDS, slugs) if slug
    ]}, root=root)
    table = CardTable(slugs, loaded)

    packed_seats = []
    for index, seat in enumerate(seats_in):
        if not isinstance(seat, dict):
            packed_seats.append([])
            continue
        stats = [
            seat.get("life", 40),
            seat.get("poison", 0),
            seat.get("commander_tax", 0),
            seat.get("library_count", 0),
            seat.get("hand_count", 0),
        ]
        damage_map = seat.get("commander_damage") or {}
        damage = [int(damage_map.get(seat_id, 0) or 0) for seat_id in SEAT_IDS]
        hand = seat.get("hand")
        packed = [
            stats,
            damage,
            _pack_card_list(seat.get("commanders") or [], table, prefer=index),
            HIDDEN if hand is None else _pack_card_list(hand, table, prefer=index),
            _pack_battlefield(seat.get("battlefield") or [], table, prefer=index),
            _pack_card_list(seat.get("graveyard") or [], table, prefer=index),
            _pack_card_list(seat.get("exile") or [], table, prefer=index),
            _pack_card_list(seat.get("command") or [], table, prefer=index),
            ABSENT
            if "revealed_top" not in seat
            else _pack_card_list(seat.get("revealed_top") or [], table, prefer=index),
        ]
        packed_seats.append(packed)

    you = snapshot.get("you")
    wire: dict[str, Any] = {
        "v": 2,
        "h": snapshot.get("headline") or "",
        "t": snapshot.get("turn", 0),
        "p": _phase_index(snapshot.get("phase")),
        "a": SEAT_IDS.index(snapshot["active"]) if snapshot.get("active") in SEAT_IDS else 0,
        "z": packed_seats,
    }
    if you in SEAT_IDS:
        wire["y"] = SEAT_IDS.index(you)
    waiting = snapshot.get("waiting")
    if waiting and waiting != DEFAULT_WAITING:
        wire["w"] = waiting
    talk = snapshot.get("talk")
    if talk:
        wire["k"] = talk
    if any(slugs):
        wire["d"] = slugs
    names = [seat.get("name") or seat_id for seat, seat_id in zip(seats_in, SEAT_IDS)]
    colors = [
        seat.get("color") or SEAT_COLORS[index]
        for index, seat in enumerate(seats_in)
    ]
    wire["n"] = names
    if colors != list(SEAT_COLORS[: len(colors)]):
        wire["c"] = colors
    stack = _pack_stack(snapshot.get("stack") or [], table)
    if stack:
        wire["s"] = stack
    combat = snapshot.get("combat")
    if isinstance(combat, dict) and combat:
        packed_combat = _pack_combat(combat, table)
        if packed_combat:
            wire["m"] = packed_combat
    if table.extras:
        wire["x"] = table.extras
        catalog = snapshot.get("catalog") or {}
        extra_catalog = {}
        for name in table.extras:
            details = catalog.get(name)
            if isinstance(details, dict) and details:
                extra_catalog[name] = details
        if extra_catalog:
            wire["g"] = extra_catalog
    if table.tokens:
        token_catalog = snapshot.get("tokens") or {}
        wire["o"] = []
        for key, fallback in table.tokens:
            details = token_catalog.get(key) if isinstance(token_catalog.get(key), dict) else fallback
            wire["o"].append([key, details or fallback])
    return wire


def _lookup_ref(
    ref: Any,
    *,
    lists: list[list[dict[str, Any]]],
    extras: list[str],
    tokens: list[tuple[str, dict]],
) -> Any:
    if not isinstance(ref, int) or isinstance(ref, bool):
        return ref
    deck, slot = divmod(ref, STRIDE)
    if deck < len(lists) and 0 <= slot < len(lists[deck]):
        return lists[deck][slot].get("n")
    if deck == EXTRA_DECK and 0 <= slot < len(extras):
        return extras[slot]
    if deck == TOKEN_DECK and 0 <= slot < len(tokens):
        return tokens[slot][1].get("name") or tokens[slot][0]
    return ref


def _unpack_card_list(values: Any, **lookup) -> list:
    if values in (HIDDEN, ABSENT) or not isinstance(values, list):
        return []
    return [_lookup_ref(value, **lookup) for value in values]


def _unpack_battlefield(values: Any, **lookup) -> list[dict[str, Any]]:
    tokens = lookup.get("tokens") or []
    out = []
    for item in values or []:
        extra: dict[str, Any] = {}
        flags = 0
        if isinstance(item, int) and not isinstance(item, bool):
            ref = item
        elif isinstance(item, list) and item:
            ref = item[0]
            flags = item[1] if len(item) > 1 and isinstance(item[1], int) else 0
            extra = item[2] if len(item) > 2 and isinstance(item[2], dict) else {}
        else:
            continue
        deck = ref // STRIDE if isinstance(ref, int) and not isinstance(ref, bool) else -1
        entry: dict[str, Any] = {"name": _lookup_ref(ref, **lookup)}
        if flags & FLAG_TAPPED:
            entry["tapped"] = True
        if flags & FLAG_TOKEN or deck == TOKEN_DECK:
            entry["token"] = True
            if isinstance(ref, int) and not isinstance(ref, bool):
                slot = ref % STRIDE
                if deck == TOKEN_DECK and 0 <= slot < len(tokens):
                    entry["token_id"] = tokens[slot][0]
        if flags & FLAG_COMMANDER:
            entry["commander"] = True
        if extra.get("p"):
            entry["pt"] = extra["p"]
        if extra.get("n"):
            entry["note"] = extra["n"]
        if extra.get("c"):
            entry["counters"] = extra["c"]
        if extra.get("f") is not None:
            entry["face"] = extra["f"]
        out.append(entry)
    return out


def _unpack_stack(values: Any, **lookup) -> list:
    out = []
    for item in values or []:
        if isinstance(item, int) and not isinstance(item, bool):
            out.append({"name": _lookup_ref(item, **lookup)})
            continue
        if not isinstance(item, list) or not item:
            continue
        packed = {"name": _lookup_ref(item[0], **lookup)}
        if len(item) > 1 and isinstance(item[1], int) and 0 <= item[1] < 4:
            packed["controller"] = SEAT_IDS[item[1]]
        if len(item) > 2 and item[2]:
            packed["text"] = item[2]
        out.append(packed)
    return out


def _unpack_combat(combat: dict, **lookup) -> dict[str, Any]:
    out: dict[str, Any] = {}
    step = combat.get("s")
    if isinstance(step, int) and 0 <= step < len(COMBAT_STEPS):
        out["step"] = COMBAT_STEPS[step]
    attackers = []
    for row in combat.get("a") or []:
        if not isinstance(row, list) or len(row) < 2:
            continue
        defender = row[1]
        if isinstance(defender, int) and not isinstance(defender, bool) and 0 <= defender < 4:
            defender_value: Any = SEAT_IDS[defender]
        else:
            defender_value = _lookup_ref(defender, **lookup)
        attacker = {
            "card": _lookup_ref(row[0], **lookup),
            "defender": defender_value,
        }
        flags = row[2] if len(row) > 2 and isinstance(row[2], int) else 0
        extra = row[3] if len(row) > 3 and isinstance(row[3], dict) else {}
        if len(row) > 2 and isinstance(row[2], dict):
            extra = row[2]
        if flags & FLAG_TAPPED:
            attacker["tapped"] = True
        if extra.get("p"):
            attacker["pt"] = extra["p"]
        if extra.get("k"):
            attacker["keywords"] = extra["k"]
        attackers.append(attacker)
    if attackers:
        out["attackers"] = attackers
    blocks = []
    for row in combat.get("b") or []:
        if not isinstance(row, list) or len(row) < 2:
            continue
        blocks.append(
            {
                "attacker": _lookup_ref(row[0], **lookup),
                "blockers": [_lookup_ref(blocker, **lookup) for blocker in row[1] or []],
            }
        )
    if blocks:
        out["blocks"] = blocks
    possible = {}
    for row in combat.get("p") or []:
        if not isinstance(row, list) or len(row) < 2:
            continue
        possible[_lookup_ref(row[0], **lookup)] = [
            _lookup_ref(blocker, **lookup) for blocker in row[1] or []
        ]
    if possible:
        out["possible_blockers"] = possible
    if combat.get("u"):
        out["unblocked"] = [_lookup_ref(name, **lookup) for name in combat["u"]]
    return out


def catalog_from_indexes(
    slugs: list[str],
    indexes: dict[str, list[dict[str, Any]]],
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    catalog: dict[str, Any] = {}
    for slug in slugs:
        for card in indexes.get(slug) or []:
            details = {"id": card["id"]} if card.get("id") else {}
            for name in [card.get("n"), *(card.get("a") or [])]:
                if isinstance(name, str) and name and name not in catalog:
                    catalog[name] = dict(details)
    if extras:
        catalog.update(extras)
    return catalog


def expand_snapshot(wire: dict, indexes: dict[str, list[dict[str, Any]]] | None = None) -> dict[str, Any]:
    if wire.get("v") != 2:
        return wire
    slugs = list(wire.get("d") or ["", "", "", ""])
    while len(slugs) < 4:
        slugs.append("")
    lists = [(indexes or {}).get(slug) or [] for slug in slugs[:4]]
    extras = list(wire.get("x") or [])
    tokens = []
    for item in wire.get("o") or []:
        if isinstance(item, list) and item:
            tokens.append((str(item[0]), item[1] if len(item) > 1 and isinstance(item[1], dict) else {}))
        elif isinstance(item, dict) and item.get("k"):
            tokens.append((str(item["k"]), item.get("d") or {}))
    lookup = {"lists": lists, "extras": extras, "tokens": tokens}

    names = list(wire.get("n") or [])
    colors = list(wire.get("c") or SEAT_COLORS)
    seats = []
    for index, packed in enumerate(wire.get("z") or []):
        seat_id = SEAT_IDS[index]
        stats = packed[SEAT_STATS] if isinstance(packed, list) and packed else [40, 0, 0, 0, 0]
        damage = packed[SEAT_DAMAGE] if isinstance(packed, list) and len(packed) > SEAT_DAMAGE else [0, 0, 0, 0]
        hand_value = packed[SEAT_HAND] if isinstance(packed, list) and len(packed) > SEAT_HAND else HIDDEN
        revealed = packed[SEAT_REVEALED] if isinstance(packed, list) and len(packed) > SEAT_REVEALED else ABSENT
        seat: dict[str, Any] = {
            "id": seat_id,
            "name": names[index] if index < len(names) else seat_id,
            "commanders": _unpack_card_list(
                packed[SEAT_COMMANDERS] if isinstance(packed, list) else [], **lookup
            ),
            "color": colors[index] if index < len(colors) else SEAT_COLORS[index],
            "life": stats[0] if stats else 40,
            "poison": stats[1] if len(stats) > 1 else 0,
            "commander_tax": stats[2] if len(stats) > 2 else 0,
            "library_count": stats[3] if len(stats) > 3 else 0,
            "hand_count": stats[4] if len(stats) > 4 else 0,
            "commander_damage": {
                SEAT_IDS[other]: damage[other] if other < len(damage) else 0
                for other in range(4)
                if other != index
            },
            "battlefield": _unpack_battlefield(
                packed[SEAT_BATTLEFIELD] if isinstance(packed, list) else [], **lookup
            ),
            "graveyard": _unpack_card_list(
                packed[SEAT_GRAVEYARD] if isinstance(packed, list) else [], **lookup
            ),
            "exile": _unpack_card_list(
                packed[SEAT_EXILE] if isinstance(packed, list) else [], **lookup
            ),
            "command": _unpack_card_list(
                packed[SEAT_COMMAND] if isinstance(packed, list) else [], **lookup
            ),
        }
        slug = slugs[index] if index < len(slugs) else ""
        if slug:
            seat["deck"] = f"decks/{slug}"
        if hand_value != HIDDEN:
            seat["hand"] = _unpack_card_list(hand_value, **lookup)
        if revealed != ABSENT:
            seat["revealed_top"] = _unpack_card_list(revealed, **lookup)
        seats.append(seat)

    you = wire.get("y")
    snapshot: dict[str, Any] = {
        "v": 1,
        "you": SEAT_IDS[you] if isinstance(you, int) and 0 <= you < 4 else None,
        "headline": wire.get("h") or "",
        "waiting": wire.get("w") or DEFAULT_WAITING,
        "talk": wire.get("k") or "",
        "turn": wire.get("t", 0),
        "phase": PHASES[wire["p"]] if isinstance(wire.get("p"), int) and 0 <= wire["p"] < len(PHASES) else "main1",
        "active": SEAT_IDS[wire["a"]] if isinstance(wire.get("a"), int) and 0 <= wire["a"] < 4 else "p1",
        "stack": _unpack_stack(wire.get("s") or [], **lookup),
        "seats": seats,
        "catalog": catalog_from_indexes(slugs, indexes or {}, wire.get("g")),
        "decks": [slug for slug in slugs if slug],
    }
    if wire.get("m"):
        snapshot["combat"] = _unpack_combat(wire["m"], **lookup)
    if tokens:
        snapshot["tokens"] = {key: details for key, details in tokens}
    return snapshot
