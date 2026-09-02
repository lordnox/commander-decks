#!/usr/bin/env python3
"""Deal reproducible Commander opening hands and turn draws."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path


def is_library_card(entry: dict) -> bool:
    categories = entry.get("categories", [])
    return not any(
        category == "Commander{top}" or "{noDeck}" in category
        for category in categories
    )


def load_manifest(deck: Path) -> tuple[list[str], list[str]]:
    manifest_path = deck if deck.name == "cards.json" else deck / "cards.json"
    if not manifest_path.is_file():
        raise ValueError(f"missing resolved manifest: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    library: list[str] = []
    commanders: list[str] = []

    for entry in manifest.get("cards", []):
        name = entry.get("name")
        quantity = entry.get("quantity")
        categories = entry.get("categories", [])
        if not isinstance(name, str) or not isinstance(quantity, int) or quantity < 1:
            raise ValueError(f"invalid manifest entry: {entry!r}")
        if "Commander{top}" in categories:
            commanders.extend([name] * quantity)
        elif is_library_card(entry):
            library.extend([name] * quantity)

    if len(library) not in (98, 99):
        raise ValueError(
            "expected a 99-card Commander library, or 98 with two commanders, "
            f"found {len(library)}"
        )
    if len(commanders) not in (1, 2):
        raise ValueError(f"expected one or two commanders, found {len(commanders)}")
    if len(library) + len(commanders) != 100:
        raise ValueError(
            f"expected 100 total cards, found {len(library) + len(commanders)}"
        )

    return library, commanders


def deal(
    library: list[str],
    *,
    runs: int,
    turns: int,
    seed: int,
    mulligans: int = 2,
) -> list[dict]:
    rng = random.Random(seed)
    results = []

    for run_number in range(1, runs + 1):
        candidates = []
        for mulligan_count in range(mulligans + 1):
            shuffled = library.copy()
            rng.shuffle(shuffled)
            candidates.append({
                "mulligans": mulligan_count,
                "opening_hand": shuffled[:7],
                "bottom_count": mulligan_count,
                "draws": [
                    {"turn": turn, "card": shuffled[6 + turn]}
                    for turn in range(1, turns + 1)
                ],
            })
        results.append({"run": run_number, "candidates": candidates})

    return results


def render_markdown(
    results: list[dict],
    commanders: list[str],
    *,
    seed: int,
    turns: int,
) -> str:
    lines = [
        f"# Goldfish draws — seed {seed}",
        "",
        f"Commander: {', '.join(commanders)}",
        f"Draws shown through turn {turns}.",
    ]

    for result in results:
        lines.extend(["", f"## Run {result['run']}"])
        for candidate in result["candidates"]:
            mulligans = candidate["mulligans"]
            label = "keep seven" if mulligans == 0 else f"mulligan {mulligans}"
            opening = ", ".join(candidate["opening_hand"])
            draws = "; ".join(
                f"T{draw['turn']} {draw['card']}" for draw in candidate["draws"]
            )
            lines.extend([
                "",
                f"### {label}",
                f"- Opening: {opening}",
                f"- Bottom: {candidate['bottom_count']} card(s)",
                f"- Draws: {draws}",
            ])

    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Deal reproducible Commander hands from cards.json"
    )
    parser.add_argument("deck", type=Path, help="deck directory or cards.json")
    parser.add_argument("--runs", type=int, default=8)
    parser.add_argument("--turns", type=int, default=5)
    parser.add_argument("--seed", type=int, default=1729)
    parser.add_argument("--mulligans", type=int, default=2)
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    args = parser.parse_args()

    for name in ("runs", "turns"):
        if getattr(args, name) < 1:
            parser.error(f"--{name} must be at least 1")
    if args.mulligans < 0:
        parser.error("--mulligans cannot be negative")
    return args


def main() -> int:
    args = parse_args()
    try:
        library, commanders = load_manifest(args.deck)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}")
        return 1

    results = deal(
        library,
        runs=args.runs,
        turns=args.turns,
        seed=args.seed,
        mulligans=args.mulligans,
    )
    if args.format == "json":
        print(json.dumps({
            "seed": args.seed,
            "turns": args.turns,
            "commanders": commanders,
            "runs": results,
        }, indent=2))
    else:
        print(render_markdown(
            results,
            commanders,
            seed=args.seed,
            turns=args.turns,
        ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
