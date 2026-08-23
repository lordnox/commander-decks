import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINKER_SCRIPT = ROOT / ".agents/skills/deck-primer/scripts/link_card_mentions.py"
ARCHIDEKT_SCRIPT = ROOT / ".agents/skills/deck-primer/scripts/update_archidekt_link.py"
CATEGORY_SCRIPT = ROOT / ".agents/skills/deck-primer/scripts/update_category_probabilities.py"
SPEC = importlib.util.spec_from_file_location("link_card_mentions", LINKER_SCRIPT)
linker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(linker)
ARCHIDEKT_SPEC = importlib.util.spec_from_file_location(
    "update_archidekt_link",
    ARCHIDEKT_SCRIPT,
)
archidekt = importlib.util.module_from_spec(ARCHIDEKT_SPEC)
ARCHIDEKT_SPEC.loader.exec_module(archidekt)
CATEGORY_SPEC = importlib.util.spec_from_file_location(
    "update_category_probabilities",
    CATEGORY_SCRIPT,
)
category_probs = importlib.util.module_from_spec(CATEGORY_SPEC)
CATEGORY_SPEC.loader.exec_module(category_probs)


class LinkCardMentionsTests(unittest.TestCase):
    def setUp(self):
        self.homer_uri = "https://scryfall.com/card/mbc/40/homer-the-hermit"
        self.throne_uri = "https://scryfall.com/card/lci/258/roaming-throne"
        self.manifest = {
            "cards": [
                {
                    "name": "Homer, the Hermit",
                    "submitted_name": "Homer, the Hermit",
                    "categories": ["Commander{top}"],
                    "scryfall_uri": self.homer_uri,
                    "card": {},
                },
                {
                    "name": "Roaming Throne",
                    "submitted_name": "Roaming Throne",
                    "categories": ["trigger-doubler"],
                    "scryfall_uri": self.throne_uri,
                    "card": {},
                },
            ],
        }

    def test_links_plain_bold_and_commander_shorthand(self):
        markdown = (
            "# Homer primer\n\n"
            "**Homer, the Hermit** works with Roaming Throne and **Throne**. "
            "Homer's triggers get larger.\n"
        )
        updated, count = linker.link_markdown(
            markdown,
            linker.card_links(self.manifest, markdown),
        )

        self.assertEqual(count, 5)
        self.assertIn(f"[Homer]({self.homer_uri}) primer", updated)
        self.assertIn(f"[**Homer, the Hermit**]({self.homer_uri})", updated)
        self.assertIn(f"[Roaming Throne]({self.throne_uri})", updated)
        self.assertIn(f"[**Throne**]({self.throne_uri})", updated)
        self.assertIn(f"[Homer]({self.homer_uri})'s triggers", updated)

    def test_preserves_existing_links_code_urls_and_html(self):
        markdown = (
            f"[Roaming Throne]({self.throne_uri})\n"
            "\x60Roaming Throne\x60\n"
            "\x60\x60\x60text\nRoaming Throne\n\x60\x60\x60\n"
            f'<a href="{self.throne_uri}"><img alt="Roaming Throne"></a>\n'
        )
        updated, count = linker.link_markdown(
            markdown,
            linker.card_links(self.manifest, markdown),
        )

        self.assertEqual(count, 0)
        self.assertEqual(updated, markdown)

    def test_is_idempotent_and_prefers_longer_names(self):
        markdown = "**Homer, the Hermit** and Homer\n"
        once, first_count = linker.link_markdown(
            markdown,
            linker.card_links(self.manifest, markdown),
        )
        twice, second_count = linker.link_markdown(
            once,
            linker.card_links(self.manifest, once),
        )

        self.assertEqual(first_count, 2)
        self.assertEqual(second_count, 0)
        self.assertEqual(twice, once)

    def test_plain_mentions_are_case_sensitive(self):
        six_uri = "https://scryfall.com/card/mh3/169/six"
        manifest = {
            "cards": [{
                "name": "Six",
                "submitted_name": "Six",
                "categories": ["recursion"],
                "scryfall_uri": six_uri,
                "card": {},
            }],
        }
        markdown = "Draw six cards, then cast Six.\n"

        updated, count = linker.link_markdown(
            markdown,
            linker.card_links(manifest, markdown),
        )

        self.assertEqual(count, 1)
        self.assertEqual(updated, f"Draw six cards, then cast [Six]({six_uri}).\n")


    def test_rewrites_incorrect_scryfall_hrefs(self):
        markdown = (
            "[**Homer, the Hermit**](https://scryfall.com/card/zzz/1/wrong-homer) "
            "and [Roaming Throne](https://scryfall.com/card/zzz/2/wrong-throne).\n"
            '<a href="https://scryfall.com/card/zzz/3/wrong">'
            '<img alt="Homer, the Hermit"></a>\n'
        )
        updated, count = linker.link_markdown(
            markdown,
            linker.card_links(self.manifest, markdown),
        )
        self.assertGreaterEqual(count, 3)
        self.assertIn(self.homer_uri, updated)
        self.assertIn(self.throne_uri, updated)
        self.assertNotIn("card/zzz/", updated)

    def test_check_mode_does_not_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            deck_dir = Path(temporary)
            readme = deck_dir / "README.md"
            readme.write_text("Homer meets Roaming Throne.\n", encoding="utf-8")
            (deck_dir / "cards.json").write_text(
                json.dumps(self.manifest),
                encoding="utf-8",
            )

            result = linker.process_primer(deck_dir, check=True)

            self.assertEqual(result, 1)
            self.assertEqual(
                readme.read_text(encoding="utf-8"),
                "Homer meets Roaming Throne.\n",
            )


class ArchidektLinkTests(unittest.TestCase):
    def test_uses_printing_overrides_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck_dir = root / "decks/test"
            cards_dir = root / "cards"
            deck_dir.mkdir(parents=True)
            cards_dir.mkdir()
            printing = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            (cards_dir / "commander-id.json").write_text(
                json.dumps({
                    "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    "digital": True,
                    "games": ["mtgo"],
                }),
                encoding="utf-8",
            )
            (deck_dir / "cards.json").write_text(
                json.dumps({
                    "cards": [{
                        "name": "Green Commander",
                        "quantity": 1,
                        "cache": "cards/commander-id.json",
                        "categories": ["Commander{top}"],
                    }],
                }),
                encoding="utf-8",
            )
            (deck_dir / "printing-overrides.json").write_text(
                json.dumps({
                    "schema_version": 1,
                    "cards": {"Green Commander": printing},
                }),
                encoding="utf-8",
            )
            (deck_dir / "README.md").write_text(
                "# Test primer\n\n> Bracket 2 core deck.\n",
                encoding="utf-8",
            )

            result = archidekt.update_primer(
                deck_dir,
                archidekt.merged_overrides(deck_dir, {}),
            )
            primer = (deck_dir / "README.md").read_text(encoding="utf-8")
            lines = [line for line in primer.splitlines() if line.strip()]

            self.assertEqual(result, 0)
            self.assertIn(printing, primer)
            self.assertTrue(lines[1].startswith("> "))
            self.assertIn("Open this deck in Archidekt", lines[2])


class CategoryProbabilityTests(unittest.TestCase):
    def test_moves_table_after_key_cards(self):
        with tempfile.TemporaryDirectory() as temporary:
            deck_dir = Path(temporary)
            (deck_dir / "cards.json").write_text(
                json.dumps({
                    "cards": [
                        {
                            "name": "Green Commander",
                            "quantity": 1,
                            "categories": ["Commander{top}"],
                        },
                        {
                            "name": "Forest",
                            "quantity": 99,
                            "categories": ["Land"],
                        },
                    ],
                }),
                encoding="utf-8",
            )
            (deck_dir / "README.md").write_text(
                "# Test primer\n\n"
                "## Key cards\n\n"
                "gallery\n\n"
                "## How the deck works\n\n"
                "plan\n\n"
                "<!-- category-probabilities:start -->\n"
                "## Category access by turn three\n"
                "stale\n"
                "<!-- category-probabilities:end -->\n",
                encoding="utf-8",
            )

            result = category_probs.update_primer(
                deck_dir,
                draws=10,
                thresholds={"land": 3},
            )
            primer = (deck_dir / "README.md").read_text(encoding="utf-8")
            key_at = primer.index("## Key cards")
            table_at = primer.index("## Category access by turn three")
            play_at = primer.index("## How the deck works")

            self.assertEqual(result, 0)
            self.assertLess(key_at, table_at)
            self.assertLess(table_at, play_at)
            check = category_probs.update_primer(
                deck_dir,
                draws=10,
                thresholds={"land": 3},
                check=True,
            )
            self.assertEqual(check, 0)


if __name__ == "__main__":
    unittest.main()
