import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINKER_SCRIPT = ROOT / ".agents/skills/deck-primer/scripts/link_card_mentions.py"
ARCHIDEKT_SCRIPT = ROOT / ".agents/skills/deck-primer/scripts/update_archidekt_link.py"
CATEGORY_SCRIPT = ROOT / ".agents/skills/deck-primer/scripts/update_category_probabilities.py"
MANA_SCRIPT = ROOT / ".agents/skills/deck-primer/scripts/update_mana_stats.py"
TAG_SCRIPT = ROOT / ".agents/skills/tag-deck/scripts/update_deck_tags.py"
TAG_LIB = ROOT / ".agents/skills/tag-deck/scripts/deck_tags.py"
RANKING_SCRIPT = ROOT / ".agents/skills/rank-deck/scripts/update_deck_rankings.py"
RANKING_LIB = ROOT / ".agents/skills/rank-deck/scripts/deck_rankings.py"
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
MANA_SPEC = importlib.util.spec_from_file_location(
    "update_mana_stats",
    MANA_SCRIPT,
)
mana_stats = importlib.util.module_from_spec(MANA_SPEC)
MANA_SPEC.loader.exec_module(mana_stats)
TAG_SPEC = importlib.util.spec_from_file_location("update_deck_tags", TAG_SCRIPT)
update_deck_tags = importlib.util.module_from_spec(TAG_SPEC)
TAG_SPEC.loader.exec_module(update_deck_tags)
TAG_LIB_SPEC = importlib.util.spec_from_file_location("deck_tags", TAG_LIB)
deck_tags = importlib.util.module_from_spec(TAG_LIB_SPEC)
TAG_LIB_SPEC.loader.exec_module(deck_tags)
RANKING_SPEC = importlib.util.spec_from_file_location(
    "update_deck_rankings",
    RANKING_SCRIPT,
)
update_deck_rankings = importlib.util.module_from_spec(RANKING_SPEC)
RANKING_SPEC.loader.exec_module(update_deck_rankings)
RANKING_LIB_SPEC = importlib.util.spec_from_file_location("deck_rankings", RANKING_LIB)
deck_rankings = importlib.util.module_from_spec(RANKING_LIB_SPEC)
RANKING_LIB_SPEC.loader.exec_module(deck_rankings)


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
            self.assertIn("[![Open in Archidekt](", lines[2])

    def test_replaces_legacy_link_and_decisions_hint(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck_dir = root / "decks/test"
            cards_dir = root / "cards"
            deck_dir.mkdir(parents=True)
            cards_dir.mkdir()
            (cards_dir / "commander-id.json").write_text(
                json.dumps({"id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}),
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
            (deck_dir / "DECISIONS.md").write_text("## How to use\n", encoding="utf-8")
            (deck_dir / "README.md").write_text(
                "# Test primer\n\n"
                "> Bracket 2 core deck.\n\n"
                "[**Open this deck in Archidekt**](https://archidekt.com/sandbox?deck=%5B%5D)\n\n"
                "A short identity paragraph.\n\n"
                "Reasons for the list, cuts, and rules checks are in "
                "[DECISIONS.md](DECISIONS.md).\n\n"
                "## Key cards\n",
                encoding="utf-8",
            )

            archidekt.update_primer(deck_dir, {})
            primer = (deck_dir / "README.md").read_text(encoding="utf-8")

            self.assertNotIn("Open this deck in Archidekt", primer)
            self.assertNotIn("Reasons for the list", primer)
            self.assertIn("[![Decisions](", primer)
            self.assertIn("](DECISIONS.md)", primer)
            self.assertIn("A short identity paragraph.\n\n## Key cards\n", primer)

    def test_actions_line_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck_dir = root / "decks/test"
            cards_dir = root / "cards"
            deck_dir.mkdir(parents=True)
            cards_dir.mkdir()
            (cards_dir / "commander-id.json").write_text(
                json.dumps({"id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}),
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
            (deck_dir / "DECISIONS.md").write_text("## How to use\n", encoding="utf-8")
            (deck_dir / "README.md").write_text(
                "# Test primer\n\n> Bracket 2 core deck.\n\n## Key cards\n",
                encoding="utf-8",
            )

            archidekt.update_primer(deck_dir, {})
            first = (deck_dir / "README.md").read_text(encoding="utf-8")
            self.assertEqual(archidekt.update_primer(deck_dir, {}, check=True), 0)
            self.assertEqual((deck_dir / "README.md").read_text(encoding="utf-8"), first)


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


class ManaStatsTests(unittest.TestCase):
    def test_inserts_stats_after_category_table(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck_dir = root / "decks/test"
            cards_dir = root / "cards"
            deck_dir.mkdir(parents=True)
            cards_dir.mkdir()
            (cards_dir / "commander.json").write_text(
                json.dumps({
                    "mana_cost": "{2}{B}",
                    "cmc": 3,
                    "type_line": "Legendary Creature",
                }),
                encoding="utf-8",
            )
            (cards_dir / "swamp.json").write_text(
                json.dumps({
                    "mana_cost": "",
                    "cmc": 0,
                    "type_line": "Basic Land — Swamp",
                    "produced_mana": ["B"],
                }),
                encoding="utf-8",
            )
            (cards_dir / "sol-ring.json").write_text(
                json.dumps({
                    "mana_cost": "{1}",
                    "cmc": 1,
                    "type_line": "Artifact",
                    "produced_mana": ["C"],
                }),
                encoding="utf-8",
            )
            (deck_dir / "cards.json").write_text(
                json.dumps({
                    "cards": [
                        {
                            "name": "Black Commander",
                            "quantity": 1,
                            "cache": "cards/commander.json",
                            "categories": ["Commander{top}"],
                            "card": {"mana_cost": "{2}{B}", "type_line": "Legendary Creature"},
                        },
                        {
                            "name": "Swamp",
                            "quantity": 1,
                            "cache": "cards/swamp.json",
                            "categories": ["Land"],
                            "card": {"type_line": "Basic Land — Swamp"},
                        },
                        {
                            "name": "Sol Ring",
                            "quantity": 1,
                            "cache": "cards/sol-ring.json",
                            "categories": ["Ramp"],
                            "card": {"mana_cost": "{1}", "type_line": "Artifact"},
                        },
                    ],
                }),
                encoding="utf-8",
            )
            (deck_dir / "README.md").write_text(
                "# Test primer\n\n"
                "## Key cards\n\n"
                "gallery\n\n"
                "<!-- category-probabilities:start -->\n"
                "## Category access by turn three\n"
                "table\n"
                "<!-- category-probabilities:end -->\n\n"
                "## How the deck works\n\n"
                "plan\n",
                encoding="utf-8",
            )

            result = mana_stats.update_primer(deck_dir)
            primer = (deck_dir / "README.md").read_text(encoding="utf-8")
            category_at = primer.index("## Category access by turn three")
            mana_at = primer.index("## Mana")
            play_at = primer.index("## How the deck works")

            self.assertEqual(result, 0)
            self.assertLess(category_at, mana_at)
            self.assertLess(mana_at, play_at)
            self.assertIn("| Black (B) | 100% | 50% |", primer)
            self.assertIn("| Colorless (C) | 0% | 50% |", primer)
            self.assertIn("Avg mana value: **2.00**", primer)
            self.assertIn("| 1 | 1 |", primer)
            self.assertIn("| 3 | 1 |", primer)
            self.assertEqual(mana_stats.update_primer(deck_dir, check=True), 0)


class DeckTagTests(unittest.TestCase):
    def test_hides_tags_below_cutoff_and_renders_badges(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck_dir = root / "decks/test"
            catalog_dir = root / ".agents/skills/tag-deck"
            deck_dir.mkdir(parents=True)
            catalog_dir.mkdir(parents=True)
            (root / "cards").mkdir()
            (catalog_dir / "archidekt-tags.json").write_text(
                json.dumps({
                    "schema_version": 1,
                    "default_cutoff": 3,
                    "tags": [
                        {
                            "name": "combo",
                            "slug": "combo",
                            "url": "https://archidekt.com/tags/combo",
                        },
                        {
                            "name": "crabs",
                            "slug": "crabs",
                            "url": "https://archidekt.com/tags/crabs",
                        },
                    ],
                }),
                encoding="utf-8",
            )
            (deck_dir / "tags.json").write_text(
                json.dumps({
                    "schema_version": 1,
                    "cutoff": 3,
                    "summary": "A mill combo that happens to be a crab.",
                    "tags": [
                        {"name": "combo", "score": 5, "reason": "Primary plan."},
                        {"name": "crabs", "score": 2, "reason": "Commander type only."},
                    ],
                }),
                encoding="utf-8",
            )
            (deck_dir / "README.md").write_text(
                "# Test primer\n\n"
                "> Bracket 3 combo deck.\n\n"
                "[![Open in Archidekt]"
                "(https://img.shields.io/badge/Open%20in%20Archidekt-0b6b58?style=for-the-badge)]"
                "(https://archidekt.com/sandbox?deck=%5B%5D)\n",
                encoding="utf-8",
            )
            (root / "README.md").write_text(
                "## Deck primers\n\n"
                "<!-- deck-index:start -->\n<!-- deck-index:end -->\n",
                encoding="utf-8",
            )

            result = update_deck_tags.update_surfaces(deck_dir)
            primer = (deck_dir / "README.md").read_text(encoding="utf-8")
            overview = (root / "README.md").read_text(encoding="utf-8")
            catalog = deck_tags.load_catalog(root)
            visible = deck_tags.visible_tags(
                json.loads((deck_dir / "tags.json").read_text(encoding="utf-8")),
                catalog,
            )

            self.assertEqual(result, 0)
            self.assertEqual([tag["name"] for tag in visible], ["combo"])
            self.assertIn("deck-tags:start", primer)
            self.assertIn("combo", primer)
            self.assertNotIn("crabs", primer.split("deck-tags:start", 1)[1].split("deck-tags:end", 1)[0])
            self.assertIn("A mill combo that happens to be a crab.", overview)
            self.assertIn("[Test primer](decks/test/README.md)", overview)
            self.assertIn("combo", overview)
            self.assertNotIn("crabs", overview)
            self.assertEqual(update_deck_tags.update_surfaces(deck_dir, check=True), 0)


class DeckRankingTests(unittest.TestCase):
    def test_primer_table_and_root_index_follow_goal_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck_dir = root / "decks/3-_test"
            catalog_dir = root / ".agents/skills/tag-deck"
            deck_dir.mkdir(parents=True)
            catalog_dir.mkdir(parents=True)
            (root / "cards").mkdir()
            (catalog_dir / "archidekt-tags.json").write_text(
                json.dumps({
                    "schema_version": 1,
                    "default_cutoff": 3,
                    "tags": [
                        {
                            "name": "combo",
                            "slug": "combo",
                            "url": "https://archidekt.com/tags/combo",
                        },
                    ],
                }),
                encoding="utf-8",
            )
            (deck_dir / "tags.json").write_text(
                json.dumps({
                    "schema_version": 1,
                    "cutoff": 3,
                    "summary": "A mill combo.",
                    "tags": [
                        {"name": "combo", "score": 5, "reason": "Primary plan."},
                    ],
                }),
                encoding="utf-8",
            )
            (deck_dir / "rankings.json").write_text(
                json.dumps({
                    "goals": ["Voltron", "Theft"],
                    "scores": {
                        "fun": 8,
                        "oppressiveness": 6,
                        "jankiness": 7,
                        "identity": {"Voltron": 9, "Theft": 5},
                    },
                    "notes": "Test scores.",
                }),
                encoding="utf-8",
            )
            (deck_dir / "README.md").write_text(
                "# Test primer\n\n"
                "> Bracket 3− combo deck.\n\n"
                "[![Open in Archidekt]"
                "(https://img.shields.io/badge/Open%20in%20Archidekt-0b6b58?style=for-the-badge)]"
                "(https://archidekt.com/sandbox?deck=%5B%5D)\n",
                encoding="utf-8",
            )
            (root / "README.md").write_text(
                "## Deck primers\n\n"
                "<!-- deck-index:start -->\n<!-- deck-index:end -->\n",
                encoding="utf-8",
            )

            self.assertEqual(update_deck_tags.update_surfaces(deck_dir), 0)
            self.assertEqual(update_deck_rankings.update_primer(deck_dir), 0)
            primer = (deck_dir / "README.md").read_text(encoding="utf-8")
            overview = (root / "README.md").read_text(encoding="utf-8")
            table = primer.split("deck-rankings:start", 1)[1].split("deck-rankings:end", 1)[0]
            tags_end = primer.index("<!-- deck-tags:end -->")
            ranking_start = primer.index("<!-- deck-rankings:start -->")

            self.assertLess(tags_end, ranking_start)
            self.assertIn(
                "| Fun | Oppressiveness | Jankiness | Voltron | Theft |",
                table,
            )
            self.assertIn("| 8 | 6 | 7 | 9 | 5 |", table)
            self.assertIn(
                "**[Test primer](decks/3-_test/README.md)** `3−` "
                "Fun 8 · Oppressiveness 6 · Jankiness 7 · Voltron 9 · Theft 5",
                overview,
            )
            self.assertEqual(update_deck_rankings.update_primer(deck_dir, check=True), 0)
            self.assertEqual(update_deck_tags.update_surfaces(deck_dir, check=True), 0)

    def test_missing_rankings_leave_index_and_primer_unchanged(self):
        primer = "# Test\n\n> Bracket 2.\n"
        self.assertEqual(deck_rankings.insert_primer_section(primer, None), primer)
        self.assertIsNone(deck_rankings.load_rankings(Path("/tmp/does-not-exist-deck")))


if __name__ == "__main__":
    unittest.main()
