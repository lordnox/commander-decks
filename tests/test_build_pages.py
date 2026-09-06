import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents/skills/render-table-replay/scripts/build_pages.py"
sys.path.insert(0, str(SCRIPT.parent))


def load_script():
    spec = importlib.util.spec_from_file_location("build_pages", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build_pages = load_script()


class RankGamesTest(unittest.TestCase):
    def test_newest_first_oldest_is_index_one(self):
        ranked = build_pages.rank_games(
            [
                {"slug": "old", "played_at": "2026-09-04T15:15:04+02:00"},
                {"slug": "new", "played_at": "2026-09-06T20:12:28+02:00"},
                {"slug": "mid", "played_at": "2026-09-05T20:30:55+02:00"},
            ]
        )
        self.assertEqual([game["slug"] for game in ranked], ["new", "mid", "old"])
        self.assertEqual([game["index"] for game in ranked], [3, 2, 1])

    def test_slug_breaks_ties(self):
        ranked = build_pages.rank_games(
            [
                {"slug": "b-game", "played_at": "2026-09-06T12:00:00Z"},
                {"slug": "a-game", "played_at": "2026-09-06T12:00:00Z"},
            ]
        )
        self.assertEqual([game["slug"] for game in ranked], ["b-game", "a-game"])
        self.assertEqual([game["index"] for game in ranked], [2, 1])


if __name__ == "__main__":
    unittest.main()
