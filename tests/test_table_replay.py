import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SUMMARY_SCRIPT = ROOT / ".agents/skills/review-table/scripts/summarize_replays.py"


def load_summary_script():
    spec = importlib.util.spec_from_file_location("summarize_replays", SUMMARY_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


summarize_replays = load_summary_script()


def combat_events(possible_blockers):
    return [
        {
            "id": 0,
            "turn": 1,
            "phase": "combat",
            "seat": "p1",
            "kind": "attack",
            "combat": {
                "step": "attackers",
                "attackers": [
                    {
                        "card": "Osgir, the Reconstructor",
                        "defender": "p2",
                        "tapped": True,
                    }
                ],
                "possible_blockers": {"p2": possible_blockers},
            },
        },
        {
            "id": 1,
            "turn": 1,
            "phase": "combat",
            "seat": "p2",
            "kind": "block",
            "combat": {"step": "blockers", "blocks": [], "unblocked": []},
        },
    ]


class CombatRecordTests(unittest.TestCase):
    def test_review_does_not_flag_reason_when_no_block_was_legal(self):
        flags = summarize_replays.combat_records(combat_events([]), [])

        self.assertEqual(flags, [])

    def test_review_flags_unexplained_decline_when_block_was_legal(self):
        flags = summarize_replays.combat_records(combat_events(["Squirrel"]), [])

        self.assertEqual(flags[0]["missing"], ["block reason"])


if __name__ == "__main__":
    unittest.main()
