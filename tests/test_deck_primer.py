import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/deck-primer/scripts/link_card_mentions.py"
SPEC = importlib.util.spec_from_file_location("link_card_mentions", SCRIPT)
linker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(linker)


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


if __name__ == "__main__":
    unittest.main()
