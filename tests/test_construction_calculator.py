import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (
    ROOT
    / ".agents/skills/design-deck/scripts/construction_calculator.py"
)


def load_script():
    spec = importlib.util.spec_from_file_location("construction_calculator", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


calculator = load_script()


class ConstructionCalculatorTests(unittest.TestCase):
    def test_reproduces_rebell_engine_examples(self):
        self.assertAlmostEqual(
            calculator.hypergeometric_at_least(99, 12, 7),
            0.607486829,
        )
        self.assertAlmostEqual(
            calculator.hypergeometric_at_least(99, 12, 11),
            0.777825145,
        )
        self.assertAlmostEqual(
            calculator.hypergeometric_at_least(99, 12, 11, 2),
            0.396953966,
        )
        self.assertAlmostEqual(
            calculator.hypergeometric_at_least(99, 6, 11),
            0.516361368,
        )

    def test_turn_four_is_eleven_cards_seen(self):
        self.assertEqual(calculator.cards_seen_by_turn(4), 11)

    def test_land_video_twelve_card_assumption_changes_result(self):
        correct = calculator.hypergeometric_at_least(99, 40, 11, 4)
        video_assumption = calculator.hypergeometric_at_least(99, 40, 12, 4)

        self.assertAlmostEqual(correct, 0.726277644)
        self.assertAlmostEqual(video_assumption, 0.799356099)
        self.assertLess(correct, video_assumption)

    def test_engine_online_requires_both_package_halves(self):
        probability = calculator.engine_online_probability(99, 12, 6, 11)

        self.assertAlmostEqual(probability, 0.390371508)
        self.assertEqual(
            calculator.engine_online_probability(99, 12, 0, 11),
            0,
        )

    def test_engine_online_supports_multirole_overlap(self):
        disjoint = calculator.engine_online_probability(99, 12, 6, 11)
        overlapping = calculator.engine_online_probability(
            99,
            12,
            6,
            11,
            overlap=2,
        )

        self.assertGreater(overlapping, disjoint)

    def test_ramp_draw_advice_follows_published_threshold_table(self):
        expected = {
            1: (8, 16),
            2: (8, 16),
            3: (10, 14),
            4: (12, 12),
            5: (14, 10),
            8: (14, 10),
        }

        for threshold, counts in expected.items():
            advice = calculator.ramp_draw_advice(threshold)
            self.assertEqual((advice.ramp, advice.draw), counts)
            self.assertEqual(advice.combined, 24)

    def test_rejects_impossible_packages(self):
        with self.assertRaises(ValueError):
            calculator.engine_online_probability(99, 60, 40, 11)
        with self.assertRaises(ValueError):
            calculator.engine_online_probability(99, 12, 6, 11, overlap=7)


if __name__ == "__main__":
    unittest.main()
