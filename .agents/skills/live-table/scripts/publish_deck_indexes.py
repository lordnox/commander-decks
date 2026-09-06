#!/usr/bin/env python3
"""Write compact per-deck card indexes for live-table payload links."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import compact_live as cl  # noqa: E402

ROOT = cl.ROOT
OUT = ROOT / "site" / "public" / "decks"


def main() -> int:
    decks = sorted(
        path.parent
        for path in (ROOT / "decks").glob("*/cards.json")
        if path.parent.is_dir()
    )
    OUT.mkdir(parents=True, exist_ok=True)
    written = set()
    for folder in decks:
        index = cl.public_deck_index(cl.load_deck_index(folder))
        target = OUT / f"{folder.name}.json"
        target.write_text(json.dumps(index, separators=(",", ":"), ensure_ascii=False) + "\n")
        written.add(target.name)
        print(f"wrote {target.relative_to(ROOT)} ({len(index['cards'])} cards)")
    for stale in OUT.glob("*.json"):
        if stale.name not in written:
            stale.unlink()
            print(f"removed stale {stale.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
