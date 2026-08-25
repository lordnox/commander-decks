#!/usr/bin/env python3
"""Render scored Archidekt tags onto a primer and the root README overview."""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("deck_tags", SCRIPT_DIR / "deck_tags.py")
deck_tags = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deck_tags)


def update_surfaces(deck_dir: Path, *, check: bool = False) -> int:
    root = deck_tags.repository_root(deck_dir)
    catalog = deck_tags.load_catalog(root)
    data = deck_tags.load_deck_tags(deck_dir)
    errors = deck_tags.validate_deck_tags(data, catalog)
    if errors:
        raise ValueError("; ".join(errors))
    visible = deck_tags.visible_tags(data, catalog)
    primer_block = deck_tags.primer_section(visible)
    overview_block = deck_tags.overview_section(data["summary"], visible)

    primer_path = deck_dir / "README.md"
    if not primer_path.is_file():
        raise FileNotFoundError(f"missing primer: {primer_path}")
    original_primer = primer_path.read_text(encoding="utf-8")
    updated_primer = deck_tags.insert_primer_section(original_primer, primer_block)

    root_readme = root / "README.md"
    if not root_readme.is_file():
        raise FileNotFoundError(f"missing root README: {root_readme}")
    original_root = root_readme.read_text(encoding="utf-8")
    primer_rel = deck_tags.relative_primer_path(deck_dir, root)
    updated_root = deck_tags.replace_root_overview(original_root, primer_rel, overview_block)

    changed = updated_primer != original_primer or updated_root != original_root
    if check and changed:
        print(f"{deck_dir}: Archidekt tag badges or root overview are missing or stale")
        return 1
    if updated_primer != original_primer:
        primer_path.write_text(updated_primer, encoding="utf-8")
    if updated_root != original_root:
        root_readme.write_text(updated_root, encoding="utf-8")
    print(
        f"{deck_dir}: {len(visible)} visible Archidekt tag(s) "
        f"(cutoff {data.get('cutoff') or catalog['default_cutoff']})"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", type=Path, help="deck directory or README.md path")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report missing or stale badges without writing",
    )
    args = parser.parse_args()
    target = args.deck.resolve()
    deck_dir = target.parent if target.is_file() else target
    try:
        return update_surfaces(deck_dir, check=args.check)
    except (FileNotFoundError, ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
