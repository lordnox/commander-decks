import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/simulate-deck/scripts/goldfish.py"


def load_script():
    spec = importlib.util.spec_from_file_location("goldfish", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


goldfish = load_script()


def entry(name, categories=None):
    return {
        "name": name,
        "quantity": 1,
        "categories": categories or ["Test"],
    }


class GoldfishTests(unittest.TestCase):
    def write_manifest(self, directory, cards):
        deck = Path(directory) / "deck"
        deck.mkdir()
        (deck / "cards.json").write_text(
            json.dumps({"cards": cards}),
            encoding="utf-8",
        )
        return deck

    def test_load_manifest_excludes_commander_and_no_deck_cards(self):
        with tempfile.TemporaryDirectory() as temporary:
            cards = [entry(f"Library Card {number}") for number in range(99)]
            cards.append(entry("Commander", ["Commander{top}"]))
            cards.append(entry("Maybeboard", ["Maybe{noDeck}"]))
            deck = self.write_manifest(temporary, cards)

            library, commanders = goldfish.load_manifest(deck)

            self.assertEqual(len(library), 99)
            self.assertNotIn("Commander", library)
            self.assertNotIn("Maybeboard", library)
            self.assertEqual(commanders, ["Commander"])

    def test_deals_are_reproducible_and_include_turn_five(self):
        library = [f"Card {number}" for number in range(99)]

        first = goldfish.deal(library, runs=2, turns=5, seed=1729)
        second = goldfish.deal(library, runs=2, turns=5, seed=1729)

        self.assertEqual(first, second)
        self.assertEqual(len(first[0]["candidates"]), 3)
        self.assertEqual(len(first[0]["candidates"][0]["opening_hand"]), 7)
        self.assertEqual(first[0]["candidates"][0]["draws"][-1]["turn"], 5)

    def test_partner_manifest_accepts_ninety_eight_card_library(self):
        with tempfile.TemporaryDirectory() as temporary:
            cards = [entry(f"Library Card {number}") for number in range(98)]
            cards.extend([
                entry("Partner One", ["Commander{top}"]),
                entry("Partner Two", ["Commander{top}"]),
            ])
            deck = self.write_manifest(temporary, cards)

            library, commanders = goldfish.load_manifest(deck)

            self.assertEqual(len(library), 98)
            self.assertEqual(commanders, ["Partner One", "Partner Two"])


if __name__ == "__main__":
    unittest.main()
