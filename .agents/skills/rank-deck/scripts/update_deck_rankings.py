#!/usr/bin/env python3
"""Render ranking scores onto a deck primer."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("deck_rankings", SCRIPT_DIR / "deck_rankings.py")
deck_rankings = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deck_rankings)


def update_primer(deck_dir: Path, *, check: bool = False) -> int:
    primer_path = deck_dir / "README.md"
    if not primer_path.is_file():
        raise FileNotFoundError(f"missing primer: {primer_path}")
    original = primer_path.read_text(encoding="utf-8")
    data = deck_rankings.load_rankings(deck_dir)
    if data is None:
        section = None
    else:
        errors = deck_rankings.validate_rankings(data)
        if errors:
            raise ValueError("; ".join(errors))
        section = deck_rankings.primer_badges(data)
    updated = deck_rankings.insert_primer_section(original, section)
    if check and updated != original:
        print(f"{deck_dir}: ranking badges are missing or stale")
        return 1
    if updated != original:
        primer_path.write_text(updated, encoding="utf-8")
    if data is None:
        print(f"{deck_dir}: no rankings.json; ranking badges omitted")
    else:
        print(f"{deck_dir}: ranking badges ({len(deck_rankings.score_columns(data))} scores)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", type=Path, help="deck directory or README.md path")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report missing or stale ranking badges without writing",
    )
    args = parser.parse_args()
    target = args.deck.resolve()
    deck_dir = target.parent if target.is_file() else target
    try:
        return update_primer(deck_dir, check=args.check)
    except (FileNotFoundError, ValueError, OSError, json.JSONDecodeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
