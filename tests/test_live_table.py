import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/live-table/scripts/encode_live.py"


def load_script():
    spec = importlib.util.spec_from_file_location("encode_live", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


encode_live = load_script()


FAKE_REPLAY = {
    "schema": 2,
    "headline": "Test table",
    "seats": [
        {
            "id": "p1",
            "name": "Alpha",
            "commanders": ["Sygg, River Cutthroat"],
            "color": "#111111",
        },
        {
            "id": "p2",
            "name": "Beta",
            "commanders": ["Hazel of the Rootbloom"],
            "color": "#222222",
        },
        {
            "id": "p3",
            "name": "Gamma",
            "commanders": ["Osgir, the Reconstructor"],
            "color": "#333333",
        },
        {
            "id": "p4",
            "name": "Delta",
            "commanders": ["Homer, the Hermit"],
            "color": "#444444",
        },
    ],
    "catalog": {
        "Sygg, River Cutthroat": {
            "scryfall_uri": "https://scryfall.com/card/x/1/sygg",
            "image_small": "https://example.test/sygg-s.jpg",
            "image_normal": "https://example.test/sygg-n.jpg",
        },
        "Hazel of the Rootbloom": {
            "scryfall_uri": "https://scryfall.com/card/x/2/hazel",
            "image_small": "https://example.test/hazel-s.jpg",
            "image_normal": "https://example.test/hazel-n.jpg",
        },
        "Osgir, the Reconstructor": {
            "scryfall_uri": "https://scryfall.com/card/x/3/osgir",
            "image_small": "https://example.test/osgir-s.jpg",
            "image_normal": "https://example.test/osgir-n.jpg",
        },
        "Homer, the Hermit": {
            "scryfall_uri": "https://scryfall.com/card/x/4/homer",
            "image_small": "https://example.test/homer-s.jpg",
            "image_normal": "https://example.test/homer-n.jpg",
        },
        "Sol Ring": {
            "scryfall_uri": "https://scryfall.com/card/x/5/sol-ring",
            "image_small": "https://example.test/sol-s.jpg",
            "image_normal": "https://example.test/sol-n.jpg",
        },
        "Forest": {
            "scryfall_uri": "https://scryfall.com/card/x/6/forest",
            "image_small": "https://example.test/forest-s.jpg",
            "image_normal": "https://example.test/forest-n.jpg",
        },
        "Unused Tutor": {
            "scryfall_uri": "https://scryfall.com/card/x/7/unused",
            "image_small": "https://example.test/unused-s.jpg",
            "image_normal": "https://example.test/unused-n.jpg",
        },
        "Counterspell": {
            "scryfall_uri": "https://scryfall.com/card/x/8/counterspell",
            "image_small": "https://example.test/counter-s.jpg",
            "image_normal": "https://example.test/counter-n.jpg",
        },
    },
    "tokens": {},
    "events": [
        {
            "id": 0,
            "turn": 0,
            "phase": "setup",
            "seat": None,
            "kind": "setup",
            "summary": "Opening",
            "state": {
                "active": "p1",
                "turn": 0,
                "phase": "setup",
                "stack": [],
                "players": {
                    "p1": {
                        "life": 40,
                        "poison": 0,
                        "commander_damage": {"p2": 0, "p3": 0, "p4": 0},
                        "commander_tax": 0,
                        "library_count": 90,
                        "hand": ["Island", "Swamp"],
                        "battlefield": [],
                        "graveyard": [],
                        "exile": [],
                        "command": ["Sygg, River Cutthroat"],
                        "revealed_top": [],
                    },
                    "p2": {
                        "life": 40,
                        "poison": 0,
                        "commander_damage": {"p1": 0, "p3": 0, "p4": 0},
                        "commander_tax": 0,
                        "library_count": 89,
                        "hand": ["Forest", "Sol Ring", "Cultivate"],
                        "battlefield": [],
                        "graveyard": [],
                        "exile": [],
                        "command": ["Hazel of the Rootbloom"],
                        "revealed_top": ["Forest"],
                    },
                    "p3": {
                        "life": 40,
                        "poison": 0,
                        "commander_damage": {"p1": 0, "p2": 0, "p4": 0},
                        "commander_tax": 0,
                        "library_count": 90,
                        "hand": ["Mountain"],
                        "battlefield": [],
                        "graveyard": [],
                        "exile": [],
                        "command": ["Osgir, the Reconstructor"],
                        "revealed_top": [],
                    },
                    "p4": {
                        "life": 40,
                        "poison": 0,
                        "commander_damage": {"p1": 0, "p2": 0, "p3": 0},
                        "commander_tax": 0,
                        "library_count": 90,
                        "hand": ["Plains"],
                        "battlefield": [],
                        "graveyard": [],
                        "exile": [],
                        "command": ["Homer, the Hermit"],
                        "revealed_top": [],
                    },
                },
            },
        },
        {
            "id": 1,
            "turn": 1,
            "phase": "main1",
            "seat": "p2",
            "kind": "cast",
            "summary": "Beta casts Sol Ring.",
            "combat": {
                "step": "attackers",
                "attackers": [],
                "possible_blockers": {},
            },
            "state": {
                "active": "p2",
                "turn": 1,
                "phase": "main1",
                "stack": [
                    {
                        "name": "Counterspell",
                        "controller": "p1",
                        "text": "on Sol Ring",
                    }
                ],
                "players": {
                    "p1": {
                        "life": 40,
                        "poison": 0,
                        "commander_damage": {"p2": 0, "p3": 0, "p4": 0},
                        "commander_tax": 0,
                        "library_count": 90,
                        "hand": ["Island", "Swamp", "Secret Hand"],
                        "battlefield": [],
                        "graveyard": [],
                        "exile": [],
                        "command": ["Sygg, River Cutthroat"],
                        "revealed_top": [],
                    },
                    "p2": {
                        "life": 39,
                        "poison": 0,
                        "commander_damage": {"p1": 0, "p3": 0, "p4": 0},
                        "commander_tax": 0,
                        "library_count": 89,
                        "hand": ["Forest", "Cultivate"],
                        "battlefield": [
                            {
                                "name": "Sol Ring",
                                "tapped": False,
                                "token": False,
                            }
                        ],
                        "graveyard": [],
                        "exile": [],
                        "command": ["Hazel of the Rootbloom"],
                        "revealed_top": ["Forest"],
                    },
                    "p3": {
                        "life": 40,
                        "poison": 0,
                        "commander_damage": {"p1": 0, "p2": 0, "p4": 0},
                        "commander_tax": 0,
                        "library_count": 90,
                        "hand": ["Mountain", "Hidden"],
                        "battlefield": [],
                        "graveyard": [],
                        "exile": [],
                        "command": ["Osgir, the Reconstructor"],
                        "revealed_top": [],
                    },
                    "p4": {
                        "life": 40,
                        "poison": 0,
                        "commander_damage": {"p1": 0, "p2": 0, "p3": 0},
                        "commander_tax": 0,
                        "library_count": 90,
                        "hand": ["Plains", "Also Hidden"],
                        "battlefield": [],
                        "graveyard": [],
                        "exile": [],
                        "command": ["Homer, the Hermit"],
                        "revealed_top": [],
                    },
                },
            },
        },
    ],
}


class LiveTableEncodeTests(unittest.TestCase):
    def test_payload_prefix_and_round_trip(self):
        private = encode_live.build_snapshot(
            FAKE_REPLAY,
            you="p2",
            talk="Hold up Counterspell.",
            waiting="What do you do?",
            public=False,
        )
        payload = encode_live.encode_payload(private)
        self.assertTrue(payload.startswith("v1."))
        decoded = encode_live.decode_payload(payload)
        self.assertEqual(decoded, private)

    def test_event_id_selects_that_snapshot(self):
        opening = encode_live.build_snapshot(
            FAKE_REPLAY,
            you="p2",
            talk="",
            waiting="Keep or mulligan?",
            public=False,
            event_id=0,
        )
        self.assertEqual(opening["turn"], 0)
        self.assertEqual(opening["phase"], "setup")
        self.assertEqual(opening["stack"], [])
        by_id = {seat["id"]: seat for seat in opening["seats"]}
        self.assertEqual(by_id["p2"]["hand"], ["Forest", "Sol Ring", "Cultivate"])

        with self.assertRaises(ValueError):
            encode_live.build_snapshot(
                FAKE_REPLAY,
                you="p2",
                talk="",
                waiting="",
                public=False,
                event_id=999,
            )

    def test_public_snapshot_redacts_hands_and_you(self):
        public = encode_live.build_snapshot(
            FAKE_REPLAY,
            you=None,
            talk="Hold up Counterspell.",
            waiting="What do you do?",
            public=True,
        )
        self.assertIsNone(public["you"])
        for seat in public["seats"]:
            self.assertNotIn("hand", seat)
            self.assertIn("hand_count", seat)
        self.assertEqual(public["seats"][1]["hand_count"], 2)
        self.assertEqual(public["seats"][1]["revealed_top"], ["Forest"])
        self.assertNotIn("Unused Tutor", public["catalog"])
        self.assertIn("Sol Ring", public["catalog"])
        self.assertIn("Counterspell", public["catalog"])

    def test_private_snapshot_includes_only_viewer_hand(self):
        private = encode_live.build_snapshot(
            FAKE_REPLAY,
            you="p2",
            talk="Hold up Counterspell.",
            waiting="What do you do?",
            public=False,
        )
        self.assertEqual(private["you"], "p2")
        by_id = {seat["id"]: seat for seat in private["seats"]}
        self.assertEqual(by_id["p2"]["hand"], ["Forest", "Cultivate"])
        self.assertEqual(by_id["p2"]["hand_count"], 2)
        self.assertNotIn("hand", by_id["p1"])
        self.assertNotIn("hand", by_id["p3"])
        self.assertNotIn("hand", by_id["p4"])
        self.assertEqual(by_id["p1"]["hand_count"], 3)
        self.assertEqual(private["combat"]["step"], "attackers")
        self.assertEqual(private["turn"], 1)
        self.assertEqual(private["phase"], "main1")
        self.assertEqual(private["active"], "p2")

    def test_cli_json_and_urls(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fake.json"
            path.write_text(json.dumps(FAKE_REPLAY), encoding="utf-8")
            from io import StringIO
            import contextlib

            stdout = StringIO()
            with contextlib.redirect_stdout(stdout):
                code = encode_live.main(
                    [
                        str(path),
                        "--you",
                        "p2",
                        "--talk",
                        "Hold up.",
                        "--waiting",
                        "What do you do?",
                        "--json",
                    ]
                )
            self.assertEqual(code, 0)
            snapshot = json.loads(stdout.getvalue())
            self.assertEqual(snapshot["you"], "p2")
            self.assertIn("hand", snapshot["seats"][1])

            stdout = StringIO()
            with contextlib.redirect_stdout(stdout):
                code = encode_live.main(
                    [
                        str(path),
                        "--you",
                        "p2",
                        "--talk",
                        "Hold up.",
                        "--waiting",
                        "What do you do?",
                    ]
                )
            self.assertEqual(code, 0)
            lines = stdout.getvalue().strip().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertTrue(lines[0].startswith("private: "))
            self.assertTrue(lines[1].startswith("public:  "))
            private_url = lines[0].split(" ", 1)[1]
            public_url = lines[1].split("  ", 1)[1]
            self.assertIn("?s=v1.", private_url)
            self.assertIn("?s=v1.", public_url)
            private_payload = private_url.split("?s=", 1)[1]
            public_payload = public_url.split("?s=", 1)[1]
            private_snap = encode_live.decode_payload(private_payload)
            public_snap = encode_live.decode_payload(public_payload)
            self.assertEqual(private_snap["you"], "p2")
            self.assertIsNone(public_snap["you"])
            self.assertIn("hand", private_snap["seats"][1])
            self.assertTrue(all("hand" not in seat for seat in public_snap["seats"]))

    def test_cli_game_short_link(self):
        import tempfile
        from io import StringIO
        import contextlib

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fake.json"
            path.write_text(json.dumps(FAKE_REPLAY), encoding="utf-8")
            stdout = StringIO()
            with contextlib.redirect_stdout(stdout):
                code = encode_live.main(
                    [
                        str(path),
                        "--game",
                        "seed1729-homer-sin-osgir-hazel",
                        "--event",
                        "131",
                        "--you",
                        "p1",
                        "--talk",
                        "hold the line",
                        "--waiting",
                        "block or no?",
                    ]
                )
            self.assertEqual(code, 0)
            lines = stdout.getvalue().strip().splitlines()
            self.assertEqual(len(lines), 2)
            private_url = lines[0].split(" ", 1)[1]
            public_url = lines[1].split("  ", 1)[1]
            self.assertTrue(private_url.startswith(encode_live.DEFAULT_BASE + "?"))
            self.assertIn("game=seed1729-homer-sin-osgir-hazel", private_url)
            self.assertIn("event=131", private_url)
            self.assertIn("you=p1", private_url)
            self.assertIn("talk=hold%20the%20line", private_url)
            self.assertIn("waiting=block%20or%20no%3F", private_url)
            self.assertNotIn("you=", public_url)
            self.assertIn("game=seed1729-homer-sin-osgir-hazel", public_url)
            self.assertIn("event=131", public_url)
            self.assertNotIn("s=v1.", private_url)
            self.assertNotIn("s=v1.", public_url)

            stdout = StringIO()
            with contextlib.redirect_stdout(stdout):
                code = encode_live.main(
                    [
                        str(path),
                        "--game",
                        "seed1729-homer-sin-osgir-hazel",
                        "--you",
                        "p2",
                        "--talk",
                        "",
                        "--waiting",
                        "",
                    ]
                )
            self.assertEqual(code, 0)
            no_event = stdout.getvalue()
            self.assertNotIn("event=", no_event)
            self.assertIn("you=p2", no_event.splitlines()[0])
            self.assertNotIn("talk=", no_event)
            self.assertNotIn("waiting=", no_event)

    def test_base_keeps_trailing_slash_before_query(self):
        url = encode_live.snapshot_url(encode_live.DEFAULT_BASE, "v1.abc")
        self.assertTrue(url.startswith("https://lordnox.github.io/commander-decks/live/?"))
        self.assertNotIn("/live?", url)
        hashed = encode_live.snapshot_url(encode_live.DEFAULT_BASE, "v1.abc", hash_form=True)
        self.assertTrue(hashed.startswith("https://lordnox.github.io/commander-decks/live/#"))
        self.assertEqual(encode_live.DEFAULT_BASE, "https://lordnox.github.io/commander-decks/live/")

    def test_catalog_uses_scryfall_id_instead_of_image_urls(self):
        card_id = "cc0b3756-2eb1-4558-8d0c-4b5b8c2d9e01"
        replay = json.loads(json.dumps(FAKE_REPLAY))
        replay["catalog"]["Sol Ring"] = {
            "scryfall_uri": "https://scryfall.com/card/x/5/sol-ring",
            "image_small": f"https://cards.scryfall.io/small/front/c/c/{card_id}.jpg?123",
            "image_normal": f"https://cards.scryfall.io/normal/front/c/c/{card_id}.jpg?123",
            "type_line": "Artifact",
            "mana_cost": "{1}",
            "oracle_text": "{T}: Add {C}{C}.",
            "stats": "",
            "faces": [
                {
                    "name": "Sol Ring",
                    "image_small": f"https://cards.scryfall.io/small/front/c/c/{card_id}.jpg?123",
                    "image_normal": f"https://cards.scryfall.io/normal/front/c/c/{card_id}.jpg?123",
                    "type_line": "Artifact",
                }
            ],
        }
        private = encode_live.build_snapshot(
            replay,
            you="p2",
            talk="",
            waiting="What do you do?",
            public=False,
        )
        entry = private["catalog"]["Sol Ring"]
        self.assertEqual(entry, {"id": card_id})
        leftover = private["catalog"]["Forest"]
        self.assertNotIn("id", leftover)
        self.assertIn("image_small", leftover)

    def test_visible_tokens_are_compacted_and_unused_tokens_are_dropped(self):
        token_id = "11111111-2222-4333-8444-555555555555"
        replay = json.loads(json.dumps(FAKE_REPLAY))
        replay["tokens"] = {
            "treasure": {
                "id": token_id,
                "name": "Treasure",
                "image_small": "https://example.test/treasure.jpg",
                "type_line": "Token Artifact — Treasure",
                "oracle_text": "{T}, Sacrifice this artifact: Add one mana of any color.",
            },
            "unused": {
                "name": "Clue",
                "type_line": "Token Artifact — Clue",
            },
        }
        replay["events"][-1]["state"]["players"]["p2"]["battlefield"].append(
            {
                "name": "Treasure",
                "token": True,
                "token_id": "treasure",
            }
        )

        snapshot = encode_live.build_snapshot(
            replay,
            you="p2",
            talk="",
            waiting="",
            public=False,
        )
        self.assertEqual(snapshot["tokens"], {"treasure": {"id": token_id}})

    def test_token_catalog_is_omitted_when_no_tokens_are_visible(self):
        replay = json.loads(json.dumps(FAKE_REPLAY))
        replay["tokens"] = {
            "clue": {
                "name": "Clue",
                "type_line": "Token Artifact — Clue",
            }
        }
        snapshot = encode_live.build_snapshot(
            replay,
            you="p2",
            talk="",
            waiting="",
            public=False,
        )
        self.assertNotIn("tokens", snapshot)

    def test_inline_fallback_details_remain_without_recoverable_id(self):
        details = {
            "scryfall_uri": "https://scryfall.com/search?q=custom",
            "image_small": "https://example.test/custom-small.jpg",
            "image_normal": "https://example.test/custom-normal.jpg",
            "type_line": "Token Creature — Custom",
            "mana_cost": "{2}",
            "oracle_text": "This fallback remains readable.",
            "stats": "2/2",
        }
        self.assertEqual(encode_live._compact_card(details), details)


if __name__ == "__main__":
    unittest.main()
