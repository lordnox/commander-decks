#!/usr/bin/env python3
"""Create or verify a hypergeometric category table in a deck primer."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from pathlib import Path

START_MARKER = "<!-- category-probabilities:start -->"
END_MARKER = "<!-- category-probabilities:end -->"
SECTION_PATTERN = re.compile(
    rf"{re.escape(START_MARKER)}.*?{re.escape(END_MARKER)}",
    re.DOTALL,
)


def choose(population: int, count: int) -> int:
    if count < 0 or count > population:
        return 0
    return math.comb(population, count)


def parse_thresholds(values: list[str]) -> dict[str, int]:
    thresholds = {"land": 3}
    for value in values:
        if "=" not in value:
            raise ValueError(f"invalid threshold: {value!r}")
        category, raw_count = (part.strip() for part in value.split("=", 1))
        if not category:
            raise ValueError(f"invalid threshold: {value!r}")
        try:
            count = int(raw_count)
        except ValueError as error:
            raise ValueError(f"invalid threshold count: {value!r}") from error
        if count < 1:
            raise ValueError(f"threshold must be positive: {value!r}")
        thresholds[category.casefold()] = count
    return thresholds


def is_library_card(entry: dict) -> bool:
    categories = entry.get("categories", [])
    if "Commander{top}" in categories:
        return False
    return not any("{noDeck}" in category for category in categories)


def category_counts(manifest: dict) -> tuple[int, dict[str, int]]:
    counts: defaultdict[str, int] = defaultdict(int)
    library_size = 0

    for entry in manifest.get("cards", []):
        if not is_library_card(entry):
            continue
        quantity = entry.get("quantity")
        if not isinstance(quantity, int) or quantity < 1:
            raise ValueError(f"invalid manifest quantity: {entry!r}")
        library_size += quantity
        for category in entry.get("categories", []):
            counts[category] += quantity

    if library_size != 99:
        raise ValueError(f"expected a 99-card Commander library, found {library_size}")
    if not counts:
        raise ValueError("manifest contains no library categories")
    return library_size, dict(counts)


def probability_at_least(
    library_size: int, category_count: int, draws: int, threshold: int
) -> float:
    if draws > library_size:
        raise ValueError("cards seen cannot exceed library size")
    denominator = choose(library_size, draws)
    misses = sum(
        choose(category_count, hits)
        * choose(library_size - category_count, draws - hits)
        for hits in range(threshold)
    )
    return 1.0 - misses / denominator


def render_section(
    library_size: int,
    counts: dict[str, int],
    draws: int,
    thresholds: dict[str, int],
) -> str:
    rows = []
    for category, count in counts.items():
        threshold = thresholds.get(category.casefold(), 1)
        probability = probability_at_least(
            library_size, count, draws, threshold
        )
        rows.append((probability, count, category, threshold))
    rows.sort(key=lambda row: (-row[0], -row[1], row[2].casefold()))

    lines = [
        START_MARKER,
        "## Category access by turn three",
        "",
        f"Using a hypergeometric calculation with a {library_size}-card library and "
        f"{draws} cards seen: the opening seven plus three normal draw steps, with "
        "no mulligans or additional draw. The commander and `{noDeck}` extras are "
        "excluded.",
        "",
        "For a category containing K cards:",
        "",
        "\\[",
        f"P(X \\ge 1)=1-\\frac{{\\binom{{{library_size}-K}}{{{draws}}}}}"
        f"{{\\binom{{{library_size}}}{{{draws}}}}}",
        "\\]",
        "",
        "All categories require at least one card except Land, which requires at "
        "least three. Categories overlap, so each row is an independent access "
        "probability.",
        "",
        "| Category | Cards | Required | Probability |",
        "|---|---:|---:|---:|",
    ]
    lines.extend(
        f"| {category} | {count} | ≥{threshold} | {probability:.2%} |"
        for probability, count, category, threshold in rows
    )
    lines.append(END_MARKER)
    return "\n".join(lines)


def update_primer(
    deck_dir: Path,
    *,
    draws: int,
    thresholds: dict[str, int],
    check: bool = False,
) -> int:
    manifest_path = deck_dir / "cards.json"
    readme_path = deck_dir / "README.md"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"missing manifest: {manifest_path}")
    if not readme_path.is_file():
        raise FileNotFoundError(f"missing primer: {readme_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    library_size, counts = category_counts(manifest)
    section = render_section(library_size, counts, draws, thresholds)
    original = readme_path.read_text(encoding="utf-8")

    if SECTION_PATTERN.search(original):
        updated = SECTION_PATTERN.sub(lambda _match: section, original, count=1)
    else:
        heading = "## How the deck works"
        index = original.find(heading)
        if index < 0:
            updated = original.rstrip() + "\n\n" + section + "\n"
        else:
            updated = (
                original[:index].rstrip()
                + "\n\n"
                + section
                + "\n\n"
                + original[index:].lstrip()
            )

    if check and updated != original:
        print(f"{readme_path}: category probability table is missing or stale")
        return 1
    if updated != original:
        readme_path.write_text(updated, encoding="utf-8")
    print(
        f"{readme_path}: category probabilities current "
        f"({len(counts)} categories, {draws} cards seen)"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", type=Path, help="deck directory or README.md path")
    parser.add_argument(
        "--draws",
        type=int,
        default=10,
        help="number of cards seen; defaults to 10 through turn three",
    )
    parser.add_argument(
        "--threshold",
        action="append",
        default=[],
        metavar="CATEGORY=COUNT",
        help="override a category's minimum count; Land defaults to 3",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="report a missing or stale table without changing the README",
    )
    args = parser.parse_args()

    if args.draws < 1:
        parser.error("cards seen must be positive")
    target = args.deck.resolve()
    deck_dir = target.parent if target.is_file() else target
    try:
        thresholds = parse_thresholds(args.threshold)
        return update_primer(
            deck_dir,
            draws=args.draws,
            thresholds=thresholds,
            check=args.check,
        )
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
