import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / ".agents/skills/deck-workspace/scripts"
PRIMER_SCRIPTS = ROOT / ".agents/skills/deck-primer/scripts"


def load_script(name, directory=SCRIPTS):
    spec = importlib.util.spec_from_file_location(name, directory / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cache_deck = load_script("cache_deck")
validate_deck = load_script("validate_deck")
change_table = load_script("deck_change_table")
archidekt = load_script("update_archidekt_link", PRIMER_SCRIPTS)
category_probs = load_script("update_category_probabilities", PRIMER_SCRIPTS)
mana_stats = load_script("update_mana_stats", PRIMER_SCRIPTS)


def card(
    name,
    oracle_id,
    *,
    type_line="Creature",
    color_identity=None,
    printing_id=None,
    digital=False,
    games=None,
):
    return {
        "name": name,
        "oracle_id": oracle_id,
        "id": printing_id or str(uuid.uuid5(uuid.NAMESPACE_URL, oracle_id)),
        "type_line": type_line,
        "oracle_text": "",
        "keywords": [],
        "color_identity": color_identity or [],
        "legalities": {"commander": "legal"},
        "released_at": "2020-01-01",
        "digital": digital,
        "games": ["mtgo"] if digital else (games if games is not None else ["paper", "mtgo"]),
        "scryfall_uri": f"https://scryfall.com/card/test/1/{name.lower().replace(' ', '-')}",
    }


class CacheDeckTests(unittest.TestCase):
    def test_collection_requests_are_batched_at_75(self):
        names = [f"Card {number}" for number in range(76)]
        calls = []

        def fake_post(path, payload):
            calls.append((path, payload))
            return {
                "data": [
                    card(identifier["name"], f"id-{identifier['name']}")
                    for identifier in payload["identifiers"]
                ],
                "not_found": [],
            }

        with mock.patch.object(cache_deck, "api_post_json", side_effect=fake_post), \
             mock.patch.object(cache_deck.time, "sleep"):
            resolved, missing, requests = cache_deck.lookup_collection(names)

        self.assertEqual(requests, 2)
        self.assertEqual([len(call[1]["identifiers"]) for call in calls], [75, 1])
        self.assertEqual(len(resolved), 76)
        self.assertEqual(missing, [])

    def test_resolver_reuses_cache_batches_exact_names_and_fuzzes_only_misses(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            deck_dir = repo / "decks/test"
            cards_dir = repo / "cards"
            deck_dir.mkdir(parents=True)
            cards_dir.mkdir()
            decklist = deck_dir / "decklist.txt"
            decklist.write_text("1 Cached Card\n1 Exact Card\n1 Typo Crad\n", encoding="utf-8")

            cached = card("Cached Card", "cached-id")
            (cards_dir / "cached-id.json").write_text(json.dumps(cached), encoding="utf-8")
            (cards_dir / "index.json").write_text(
                json.dumps({
                    "schema_version": 1,
                    "names": {"z alias": "unused-id", "cached card": "cached-id"},
                }),
                encoding="utf-8",
            )
            (cards_dir / "categories.json").write_text(
                json.dumps({"schema_version": 1, "cards": {}}),
                encoding="utf-8",
            )

            post_calls = []

            def fake_post(path, payload):
                post_calls.append((path, payload))
                return {
                    "data": [card("Exact Card", "exact-id")],
                    "not_found": [{"name": "Typo Crad"}],
                }

            fuzzy = card("Typo Card", "typo-id")
            output = io.StringIO()
            with mock.patch.object(cache_deck, "api_post_json", side_effect=fake_post), \
                 mock.patch.object(cache_deck, "api_json", return_value=fuzzy) as fuzzy_call, \
                 mock.patch.object(cache_deck.time, "sleep"), \
                 contextlib.redirect_stdout(output):
                result = cache_deck.resolve_deck(decklist, repo)

            self.assertEqual(result, 0)
            self.assertEqual(
                [item["name"] for item in post_calls[0][1]["identifiers"]],
                ["Exact Card", "Typo Crad"],
            )
            fuzzy_call.assert_called_once_with("/cards/named", {"fuzzy": "Typo Crad"})
            self.assertIn("Cache: 1 hit(s)", output.getvalue())
            self.assertIn("1 exact in 1 collection request(s)", output.getvalue())
            self.assertIn("1/1 fuzzy", output.getvalue())

            index_text = (cards_dir / "index.json").read_text(encoding="utf-8")
            self.assertLess(index_text.index('"z alias"'), index_text.index('"cached card"'))
            self.assertTrue((cards_dir / "exact-id.json").is_file())
            self.assertTrue((cards_dir / "typo-id.json").is_file())

    def test_resolver_replaces_digital_collection_hits_with_paper_printings(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            deck_dir = repo / "decks/test"
            cards_dir = repo / "cards"
            deck_dir.mkdir(parents=True)
            cards_dir.mkdir()
            (deck_dir / "decklist.txt").write_text("1 Exact Card\n", encoding="utf-8")
            (cards_dir / "index.json").write_text(
                json.dumps({"schema_version": 1, "names": {}}),
                encoding="utf-8",
            )
            (cards_dir / "categories.json").write_text(
                json.dumps({"schema_version": 1, "cards": {}}),
                encoding="utf-8",
            )

            digital = card("Exact Card", "exact-id", digital=True)
            paper = card(
                "Exact Card",
                "exact-id",
                printing_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            )

            def fake_json(path, params):
                self.assertEqual(path, "/cards/search")
                self.assertIn("oracleid:exact-id", params["q"])
                return {"data": [paper]}

            with mock.patch.object(
                cache_deck,
                "api_post_json",
                return_value={"data": [digital], "not_found": []},
            ), mock.patch.object(cache_deck, "api_json", side_effect=fake_json), \
               mock.patch.object(cache_deck.time, "sleep"), \
               contextlib.redirect_stdout(io.StringIO()):
                result = cache_deck.resolve_deck(deck_dir / "decklist.txt", repo)

            self.assertEqual(result, 0)
            cached = json.loads((cards_dir / "exact-id.json").read_text(encoding="utf-8"))
            self.assertEqual(cached["id"], paper["id"])
            self.assertFalse(cached["digital"])
            self.assertIn("paper", cached["games"])

    def test_repository_lock_rejects_a_second_resolver(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            with cache_deck.repository_lock(repo):
                with self.assertRaisesRegex(RuntimeError, "already updating"):
                    with cache_deck.repository_lock(repo):
                        pass

    def test_cached_resolution_does_not_rewrite_unchanged_registries(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            deck_dir = repo / "decks/test"
            cards_dir = repo / "cards"
            deck_dir.mkdir(parents=True)
            cards_dir.mkdir()
            decklist = deck_dir / "decklist.txt"
            decklist.write_text("1 Cached Card\n", encoding="utf-8")
            cached = card("Cached Card", "cached-id")
            (cards_dir / "cached-id.json").write_text(json.dumps(cached), encoding="utf-8")
            index_path = cards_dir / "index.json"
            categories_path = cards_dir / "categories.json"
            index_path.write_text(
                json.dumps({"schema_version": 1, "names": {"cached card": "cached-id"}}),
                encoding="utf-8",
            )
            categories_path.write_text(
                json.dumps({
                    "schema_version": 1,
                    "cards": {
                        "cached-id": {"name": "Cached Card", "categories": ["other"]},
                    },
                }),
                encoding="utf-8",
            )
            before_index = index_path.read_bytes()
            before_categories = categories_path.read_bytes()

            with contextlib.redirect_stdout(io.StringIO()):
                result = cache_deck.resolve_deck(decklist, repo)

            self.assertEqual(result, 0)
            self.assertEqual(index_path.read_bytes(), before_index)
            self.assertEqual(categories_path.read_bytes(), before_categories)


class DeckChangeTableTests(unittest.TestCase):
    def render(self, base_list, head_list):
        lists = {"base": base_list, "head": head_list}
        links = {
            "steam vents": "https://scryfall.com/card/grn/257/steam-vents",
            "portent": "https://scryfall.com/card/dsc/74/portent",
            "island": "https://scryfall.com/card/blb/278/island",
        }
        with mock.patch.object(change_table, "read_ref", lambda ref, path: lists[ref or "head"]), \
             mock.patch.object(change_table, "scryfall_links", lambda wanted, refs: links):
            return change_table.render(ROOT / "decks/test", "base", "head")

    def test_pairs_added_and_removed_cards_with_links(self):
        table = self.render(
            "1x Portent [Card Selection]\n14x Island [Land]\n",
            "1x Steam Vents [Land]\n14x Island [Land]\n",
        )

        self.assertIn("| In | Out |", table)
        self.assertIn(
            "| [Steam Vents](https://scryfall.com/card/grn/257/steam-vents) "
            "| [Portent](https://scryfall.com/card/dsc/74/portent) |",
            table,
        )

    def test_reports_quantity_changes_and_pads_uneven_columns(self):
        table = self.render(
            "14x Island [Land]\n1x Portent [Card Selection]\n1x Aetherize [Interaction]\n",
            "16x Island [Land]\n",
        )

        self.assertIn("[Island](https://scryfall.com/card/blb/278/island) ×2", table)
        self.assertIn("| — |", table)

    def test_reports_when_nothing_changed(self):
        table = self.render("14x Island [Land]\n", "14x Island [Land]\n")

        self.assertIn("No card changes", table)


class ValidateDeckTests(unittest.TestCase):
    def make_workspace(self, root):
        repo = Path(root)
        deck_dir = repo / "decks/test"
        cards_dir = repo / "cards"
        deck_dir.mkdir(parents=True)
        cards_dir.mkdir()
        (deck_dir / "decklist.txt").write_text(
            "1 Green Commander [Commander{top}]\n99 Forest [land]\n",
            encoding="utf-8",
        )
        (deck_dir / "README.md").write_text(
            "# Test primer\n\n"
            "> Bracket 2 core deck. Usually threatens a win around turn eight.\n\n"
            "Reasons for the list, cuts, and rules checks are in [DECISIONS.md](DECISIONS.md).\n\n"
            "## Key cards\n\n"
            "## How the deck works\n\n"
            "The deck ramps and attacks.\n",
            encoding="utf-8",
        )
        (deck_dir / "DECISIONS.md").write_text(
            "# Decisions\n\n"
            "## How to use\n\n"
            "This file is the deck's memory.\n\n"
            "## Cards in\n\n"
            "- **Green Commander** — Leads the deck.\n"
            "- **Forest ×99** — Supplies green mana.\n",
            encoding="utf-8",
        )
        (repo / "README.md").write_text(
            "## Deck primers\n\n"
            "- `2` [Test](decks/test/README.md)\n",
            encoding="utf-8",
        )

        commander = card("Green Commander", "commander-id", color_identity=["G"])
        commander["mana_cost"] = "{2}{G}"
        commander["cmc"] = 3
        forest = card(
            "Forest",
            "forest-id",
            type_line="Basic Land — Forest",
            color_identity=["G"],
        )
        forest["produced_mana"] = ["G"]
        for cached in (commander, forest):
            (cards_dir / f"{cached['oracle_id']}.json").write_text(
                json.dumps(cached),
                encoding="utf-8",
            )

        cards = [
            {
                "quantity": 1,
                "name": "Green Commander",
                "submitted_name": "Green Commander",
                "oracle_id": "commander-id",
                "cache": "cards/commander-id.json",
                "categories": ["Commander{top}"],
                "scryfall_uri": "https://scryfall.com/card/test/1/green-commander",
            },
            {
                "quantity": 99,
                "name": "Forest",
                "submitted_name": "Forest",
                "oracle_id": "forest-id",
                "cache": "cards/forest-id.json",
                "categories": ["land"],
                "scryfall_uri": "https://scryfall.com/card/test/2/forest",
            },
        ]
        manifest = {
            "schema_version": 3,
            "source": "decks/test/decklist.txt",
            "total_cards": 100,
            "unique_cards": 2,
            "categorized_cards": 2,
            "unresolved": [],
            "cards": cards,
        }
        (deck_dir / "cards.json").write_text(json.dumps(manifest), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            archidekt.update_primer(deck_dir, {})
            category_probs.update_primer(
                deck_dir,
                draws=10,
                thresholds={"land": 3},
            )
            mana_stats.update_primer(deck_dir)
        return repo, deck_dir

    def test_valid_workspace_with_decision_log_passes(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, deck_dir = self.make_workspace(temporary)
            errors, warnings = validate_deck.validate(
                deck_dir,
                repo,
                require_decisions=True,
            )
            self.assertEqual(errors, [])
            self.assertEqual(warnings, [])

    def test_validator_catches_decision_and_singleton_errors(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, deck_dir = self.make_workspace(temporary)
            manifest_path = deck_dir / "cards.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["cards"][1]["name"] = "Sol Ring"
            manifest["cards"][1]["submitted_name"] = "Sol Ring"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            cached = card("Sol Ring", "forest-id", type_line="Artifact")
            (repo / "cards/forest-id.json").write_text(json.dumps(cached), encoding="utf-8")

            errors, _ = validate_deck.validate(deck_dir, repo, require_decisions=True)
            self.assertTrue(any("singleton violation" in error for error in errors))
            self.assertTrue(any("decision log is missing: Sol Ring" in error for error in errors))

    def test_decision_log_ignores_notes_outside_cards_in(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, deck_dir = self.make_workspace(temporary)
            (deck_dir / "DECISIONS.md").write_text(
                "# Decisions\n\n"
                "## How to use\n\n"
                "This file is the deck's memory.\n\n"
                "## Cards in\n\n"
                "- **Green Commander** — Leads the deck.\n"
                "- **Forest ×99** — Supplies green mana.\n\n"
                "## Cards out\n\n"
                "- **Sol Ring** — Cut as too fast for the intended bracket.\n\n"
                "## Rules\n\n"
                "Checked that Forest is a basic land.\n",
                encoding="utf-8",
            )
            errors, warnings = validate_deck.validate(
                deck_dir,
                repo,
                require_decisions=True,
            )
            self.assertEqual(errors, [])
            self.assertEqual(warnings, [])

    def test_validator_catches_unlinked_primer_mentions(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, deck_dir = self.make_workspace(temporary)
            (deck_dir / "README.md").write_text(
                "# Green Commander primer\n",
                encoding="utf-8",
            )

            errors, _ = validate_deck.validate(deck_dir, repo)

            self.assertTrue(any("primer has unlinked card mentions" in error for error in errors))

    def test_validator_rejects_unsorted_primer_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, deck_dir = self.make_workspace(temporary)
            (repo / "README.md").write_text(
                "## Deck primers\n\n"
                "- `3` [Zebra](decks/test/README.md)\n"
                "- `3-` [Apple](decks/other/README.md)\n",
                encoding="utf-8",
            )
            errors, _ = validate_deck.validate(deck_dir, repo)
            self.assertTrue(
                any("Deck primers section is unsorted" in error for error in errors)
            )

    def test_validator_rejects_primer_links_without_bracket_badge(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, deck_dir = self.make_workspace(temporary)
            (repo / "README.md").write_text(
                "## Deck primers\n\n"
                "- [3− — Apple](decks/other/README.md)\n"
                "- [3 — Zebra](decks/test/README.md)\n",
                encoding="utf-8",
            )
            errors, _ = validate_deck.validate(deck_dir, repo)
            self.assertTrue(
                any("must start with a bracket badge" in error for error in errors)
            )

    def test_validator_rejects_assessment_below_archidekt(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo, deck_dir = self.make_workspace(temporary)
            (deck_dir / "README.md").write_text(
                "# Test primer\n\n"
                "[**Open this deck in Archidekt**](https://archidekt.com/sandbox?deck=x)\n\n"
                "> Bracket 2 core deck. Usually threatens a win around turn eight.\n\n"
                "## Key cards\n\n"
                "## How the deck works\n",
                encoding="utf-8",
            )
            errors, _ = validate_deck.validate(deck_dir, repo)
            self.assertTrue(
                any(
                    "assessment blockquote must sit directly below the H1" in error
                    for error in errors
                )
            )


if __name__ == "__main__":
    unittest.main()
