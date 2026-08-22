import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / ".agents/skills/deck-workspace/scripts"


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cache_deck = load_script("cache_deck")
validate_deck = load_script("validate_deck")


def card(name, oracle_id, *, type_line="Creature", color_identity=None):
    return {
        "name": name,
        "oracle_id": oracle_id,
        "type_line": type_line,
        "oracle_text": "",
        "keywords": [],
        "color_identity": color_identity or [],
        "legalities": {"commander": "legal"},
        "released_at": "2020-01-01",
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
        (deck_dir / "README.md").write_text("# Test primer\n", encoding="utf-8")
        (deck_dir / "DECISIONS.md").write_text(
            "# Decisions\n\n- **Green Commander** — Leads the deck.\n"
            "- **Forest ×99** — Supplies green mana.\n",
            encoding="utf-8",
        )
        (repo / "README.md").write_text(
            "- [Test](decks/test/README.md)\n",
            encoding="utf-8",
        )

        commander = card("Green Commander", "commander-id", color_identity=["G"])
        forest = card(
            "Forest",
            "forest-id",
            type_line="Basic Land — Forest",
            color_identity=["G"],
        )
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
            },
            {
                "quantity": 99,
                "name": "Forest",
                "submitted_name": "Forest",
                "oracle_id": "forest-id",
                "cache": "cards/forest-id.json",
                "categories": ["land"],
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


if __name__ == "__main__":
    unittest.main()
