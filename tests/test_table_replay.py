import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/render-table-replay/scripts/render_replay.py"


def load_script():
    spec = importlib.util.spec_from_file_location("render_replay", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


render_replay = load_script()

SEATS = [
    {"id": "p1", "name": "Attacker", "commanders": ["Osgir, the Reconstructor"]},
    {"id": "p2", "name": "Defender", "commanders": ["Hazel of the Rootbloom"]},
    {"id": "p3", "name": "Third", "commanders": ["Sin, Spira's Punishment"]},
    {"id": "p4", "name": "Fourth", "commanders": ["Homer, the Hermit"]},
]


def state(turn, phase, osgir_tapped=True):
    players = {
        seat["id"]: {
            "life": 40,
            "library_count": 80,
            "hand": [],
            "battlefield": [],
            "graveyard": [],
            "command": list(seat["commanders"]),
        }
        for seat in SEATS
    }
    players["p1"]["battlefield"] = [
        {"name": "Osgir, the Reconstructor", "tapped": osgir_tapped, "pt": "4/4"}
    ]
    players["p2"]["battlefield"] = [{"name": "Squirrel", "token": True, "pt": "1/1"}]
    return {"active": "p1", "turn": turn, "phase": phase, "players": players}


def game(schema=2, osgir_tapped=True):
    events = [
        {"id": 0, "turn": 0, "phase": "setup", "seat": None, "kind": "setup",
         "summary": "Opening", "state": state(0, "setup")},
        {"id": 1, "turn": 1, "phase": "untap", "seat": "p1", "kind": "note",
         "summary": "Turn 1", "state": state(1, "untap")},
        {"id": 2, "turn": 1, "phase": "draw", "seat": "p1", "kind": "draw",
         "summary": "Draws a card", "state": state(1, "draw")},
        {
            "id": 3, "turn": 1, "phase": "combat", "seat": "p1", "kind": "attack",
            "summary": "Osgir attacks Defender.",
            "cards": ["Osgir, the Reconstructor"],
            "combat": {
                "step": "attackers",
                "attackers": [
                    {
                        "card": "Osgir, the Reconstructor",
                        "defender": "p2",
                        "pt": "4/4",
                        "tapped": osgir_tapped,
                        "keywords": [],
                    }
                ],
                "possible_blockers": {"p2": ["Squirrel"]},
            },
            "state": state(1, "combat", osgir_tapped),
        },
        {
            "id": 4, "turn": 1, "phase": "combat", "seat": "p2", "kind": "block",
            "summary": "Defender chump blocks.",
            "combat": {
                "step": "blockers",
                "blocks": [
                    {"attacker": "Osgir, the Reconstructor", "blockers": ["Squirrel"]}
                ],
                "unblocked": [],
            },
            "state": state(1, "combat", osgir_tapped),
        },
        {
            "id": 5, "turn": 1, "phase": "combat", "seat": "p1", "kind": "damage",
            "summary": "Osgir deals 4 combat damage to Squirrel.",
            "combat": {"step": "combat_damage"},
            "damage": [
                {
                    "source": "Osgir, the Reconstructor",
                    "target": "Squirrel",
                    "amount": 4,
                    "type": "combat",
                    "commander": True,
                }
            ],
            "state": state(1, "combat", osgir_tapped),
        },
    ]
    return {
        "schema": schema,
        "seed": 1729,
        "starting_life": 40,
        "headline": "Test",
        "result": {"winner": None, "ended": "truncated", "turn": 1, "summary": ""},
        "seats": copy.deepcopy(SEATS),
        "catalog": {
            "Osgir, the Reconstructor": {"type_line": "Legendary Creature"},
            "Hazel of the Rootbloom": {"type_line": "Legendary Creature"},
            "Sin, Spira's Punishment": {"type_line": "Legendary Creature"},
            "Homer, the Hermit": {"type_line": "Legendary Creature"},
            "Squirrel": {"type_line": "Token Creature"},
        },
        "events": events,
    }


class CombatRecordTests(unittest.TestCase):
    def test_recorded_combat_passes(self):
        cleaned = render_replay.public_game(game())

        self.assertEqual(cleaned["schema"], 2)

    def test_attack_without_declared_blockers_is_rejected(self):
        replay = game()
        del replay["events"][4]
        for index, event in enumerate(replay["events"]):
            event["id"] = index

        with self.assertRaisesRegex(ValueError, "never declared blockers"):
            render_replay.public_game(replay)

    def test_declining_to_block_needs_a_reason(self):
        replay = game()
        replay["events"][4]["combat"]["blocks"] = []

        with self.assertRaisesRegex(ValueError, "decision.reason"):
            render_replay.public_game(replay)

    def test_declining_to_block_with_a_reason_passes(self):
        replay = game()
        replay["events"][4]["combat"]["blocks"] = []
        replay["events"][4]["decision"] = {
            "reason": "The Squirrels are food for the sacrifice outlet this turn."
        }

        render_replay.public_game(replay)

    def test_defender_with_no_blockers_needs_no_reason(self):
        replay = game()
        replay["events"][3]["combat"]["possible_blockers"] = {"p2": []}
        replay["events"][4]["combat"]["blocks"] = []

        render_replay.public_game(replay)

    def test_untyped_damage_is_rejected(self):
        replay = game()
        del replay["events"][5]["damage"][0]["type"]

        with self.assertRaisesRegex(ValueError, "combat.*noncombat"):
            render_replay.public_game(replay)

    def test_attacker_tapped_state_must_match_the_snapshot(self):
        replay = game()
        replay["events"][3]["combat"]["attackers"][0]["tapped"] = False

        with self.assertRaisesRegex(ValueError, "declares tapped"):
            render_replay.public_game(replay)

    def test_vigilant_attacker_stays_untapped(self):
        replay = game(osgir_tapped=False)
        replay["events"][3]["combat"]["attackers"][0]["keywords"] = ["vigilance"]

        render_replay.public_game(replay)

    def test_legacy_schema_one_keeps_rendering_without_combat_records(self):
        replay = game(schema=1)
        replay["events"] = replay["events"][:4]
        replay["events"][3] = {
            "id": 3, "turn": 1, "phase": "combat", "seat": "p1", "kind": "damage",
            "summary": "Osgir deals 4 to Defender.",
            "state": state(1, "combat"),
        }

        render_replay.public_game(replay)

    def test_combat_damage_needs_a_declared_attack(self):
        replay = game()
        replay["events"] = replay["events"][:3] + replay["events"][5:]
        for index, event in enumerate(replay["events"]):
            event["id"] = index

        with self.assertRaisesRegex(ValueError, "without a declared attack"):
            render_replay.public_game(replay)


class PlayInvariantTests(unittest.TestCase):
    def test_commander_must_remain_in_a_zone(self):
        replay = game()
        last = replay["events"][-1]
        last["state"]["players"]["p1"]["command"] = []
        last["state"]["players"]["p1"]["battlefield"] = []

        with self.assertRaisesRegex(ValueError, "missing Osgir"):
            render_replay.public_game(replay)

    def test_cast_permanent_does_not_enter_tapped(self):
        replay = game()
        catalog = {
            "Phial of Galadriel": {
                "type_line": "Legendary Artifact",
                "oracle_text": "{T}: Add one mana of any color.",
            }
        }
        empty = {
            "life": 40,
            "library_count": 80,
            "hand": [],
            "battlefield": [],
            "graveyard": [],
            "command": ["Osgir, the Reconstructor"],
        }
        events = [
            {
                "id": 0,
                "kind": "setup",
                "seat": None,
                "state": {"players": {"p1": empty}},
            },
            {
                "id": 1,
                "kind": "cast",
                "seat": "p1",
                "cards": ["Phial of Galadriel"],
                "state": {
                    "players": {
                        "p1": {
                            **empty,
                            "battlefield": [
                                {"name": "Phial of Galadriel", "tapped": True}
                            ],
                        }
                    }
                },
            },
        ]

        with self.assertRaisesRegex(ValueError, "entered tapped"):
            render_replay.validate_enter_untapped(events, catalog, [])

    def test_open_mana_cannot_ignore_untapped_lands(self):
        catalog = {"Island": {"type_line": "Basic Land — Island"}}
        events = [
            {
                "id": 1,
                "seat": "p1",
                "decision": {"open_mana": 0, "reason": "Hold interaction."},
                "state": {
                    "players": {
                        "p1": {
                            "battlefield": [
                                {"name": "Island", "tapped": False},
                                {"name": "Island", "tapped": False},
                                {"name": "Island", "tapped": False},
                            ]
                        }
                    }
                },
            }
        ]

        with self.assertRaisesRegex(ValueError, "open_mana is 0"):
            render_replay.validate_open_mana(events, catalog, [])

    def test_reason_cannot_cite_another_hand(self):
        replay = game()
        replay["catalog"]["Tasha's Hideous Laughter"] = {"type_line": "Sorcery"}
        event = replay["events"][3]
        event["decision"] = {
            "reason": "Attack to stop Tasha's Hideous Laughter."
        }
        event["state"]["players"]["p3"]["hand"] = ["Tasha's Hideous Laughter"]

        with self.assertRaisesRegex(ValueError, "hidden card"):
            render_replay.public_game(replay, strict=True)


if __name__ == "__main__":
    unittest.main()
