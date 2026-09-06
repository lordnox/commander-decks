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


if __name__ == "__main__":
    unittest.main()
