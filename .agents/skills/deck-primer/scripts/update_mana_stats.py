#!/usr/bin/env python3
"""Create or verify color-cost, production, and mana-curve stats in a deck primer."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

START_MARKER = "<!-- mana-stats:start -->"
END_MARKER = "<!-- mana-stats:end -->"
SECTION_PATTERN = re.compile(
    rf"{re.escape(START_MARKER)}.*?{re.escape(END_MARKER)}",
    re.DOTALL,
)
CATEGORY_END = "<!-- category-probabilities:end -->"
KEY_CARDS_HEADING = re.compile(r"^## Key cards\s*$", re.MULTILINE)
HEADING = re.compile(r"^## ", re.MULTILINE)
MANA_SYMBOL = re.compile(r"\{([^}]+)\}")

COLOR_ORDER = ("W", "U", "B", "R", "G", "C")
COLOR_LABELS = {
    "W": "White (W)",
    "U": "Blue (U)",
    "B": "Black (B)",
    "R": "Red (R)",
    "G": "Green (G)",
    "C": "Colorless (C)",
}
GENERIC_SYMBOLS = {"X", "Y", "Z", "S"}
BAR_WIDTH = 20


def repository_root(deck_dir: Path) -> Path:
    for parent in (deck_dir, *deck_dir.parents):
        if (parent / "cards").is_dir() and (parent / "decks").is_dir():
            return parent
    raise FileNotFoundError("could not locate repository root")


def is_deck_card(entry: dict) -> bool:
    return not any("{noDeck}" in category for category in entry.get("categories", []))


def front_type_line(type_line: str) -> str:
    return type_line.split("//", 1)[0]


def is_land(type_line: str) -> bool:
    return bool(re.search(r"\bLand\b", front_type_line(type_line)))


def load_cached(entry: dict, root: Path) -> dict:
    relative = entry.get("cache")
    if not relative:
        oracle_id = entry.get("oracle_id")
        if oracle_id:
            relative = f"cards/{oracle_id}.json"
    if not relative:
        return {}
    path = root / relative
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def merged_card(entry: dict, root: Path) -> dict:
    return {**load_cached(entry, root), **(entry.get("card") or {})}


def front_mana_cost(mana_cost: str) -> str:
    return mana_cost.split("//", 1)[0].strip()


def pip_weights(mana_cost: str) -> Counter[str]:
    weights: Counter[str] = Counter()
    for symbol in MANA_SYMBOL.findall(front_mana_cost(mana_cost)):
        inner = symbol.upper()
        if inner in GENERIC_SYMBOLS or inner.isdigit():
            continue
        colors = [part for part in inner.split("/") if part in COLOR_ORDER]
        if not colors:
            continue
        share = 1.0 / len(colors)
        for color in colors:
            weights[color] += share
    return weights


def mana_value(card: dict) -> float:
    cmc = card.get("cmc")
    if isinstance(cmc, (int, float)):
        return float(cmc)
    weights = pip_weights(card.get("mana_cost") or "")
    generic = 0.0
    for symbol in MANA_SYMBOL.findall(front_mana_cost(card.get("mana_cost") or "")):
        inner = symbol.upper()
        if inner.isdigit():
            generic += int(inner)
    return generic + sum(weights.values())


def percentages(counts: Counter[str]) -> dict[str, float]:
    total = sum(counts.values())
    if total <= 0:
        return {color: 0.0 for color in COLOR_ORDER}
    return {color: counts[color] / total for color in COLOR_ORDER}


def bar(count: int, maximum: int) -> str:
    if maximum <= 0 or count <= 0:
        return ""
    return "█" * max(1, round(BAR_WIDTH * count / maximum))


def collect_stats(manifest: dict, root: Path) -> dict:
    cost: Counter[str] = Counter()
    production: Counter[str] = Counter()
    curve = [0] * 9
    total_mv = 0.0
    nonland_cards = 0

    for entry in manifest.get("cards", []):
        if not is_deck_card(entry):
            continue
        quantity = entry.get("quantity")
        if not isinstance(quantity, int) or quantity < 1:
            raise ValueError(f"invalid manifest quantity: {entry!r}")
        card = merged_card(entry, root)
        cost.update(
            {
                color: weight * quantity
                for color, weight in pip_weights(card.get("mana_cost") or "").items()
            }
        )
        for color in card.get("produced_mana") or []:
            if color in COLOR_ORDER:
                production[color] += quantity
        if is_land(card.get("type_line") or ""):
            continue
        value = mana_value(card)
        total_mv += value * quantity
        nonland_cards += quantity
        bucket = 8 if value >= 8 else int(value)
        curve[bucket] += quantity

    return {
        "cost": percentages(cost),
        "production": percentages(production),
        "curve": curve,
        "total_mv": total_mv,
        "nonland_cards": nonland_cards,
        "avg_mv": (total_mv / nonland_cards) if nonland_cards else 0.0,
    }


def visible_colors(stats: dict) -> list[str]:
    colors = [
        color
        for color in COLOR_ORDER
        if stats["cost"][color] > 0 or stats["production"][color] > 0
    ]
    return colors or ["C"]


def render_section(stats: dict) -> str:
    colors = visible_colors(stats)
    maximum = max(stats["curve"], default=0)
    lines = [
        START_MARKER,
        "## Mana",
        "",
        "Color cost counts mana symbols in card costs: generic numerals and "
        "`{X}` are ignored, and hybrid symbols split evenly. Production counts "
        "each color in a card's Scryfall `produced_mana`. Lands are omitted from "
        "the curve and mana-value totals. The commander is included; `{noDeck}` "
        "extras are not.",
        "",
        "| Color | Cost | Prod |",
        "|---|---:|---:|",
    ]
    lines.extend(
        f"| {COLOR_LABELS[color]} | {stats['cost'][color]:.0%} | "
        f"{stats['production'][color]:.0%} |"
        for color in colors
    )
    lines.extend(
        [
            "",
            f"Avg mana value: **{stats['avg_mv']:.2f}** · "
            f"Total mana value: **{stats['total_mv']:.2f}** · "
            f"Nonland cards: **{stats['nonland_cards']}**",
            "",
            "| MV | Cards |  |",
            "|---:|---:|:---|",
        ]
    )
    labels = [str(value) for value in range(8)] + ["8+"]
    lines.extend(
        f"| {label} | {count} | {bar(count, maximum)} |"
        for label, count in zip(labels, stats["curve"])
    )
    lines.append(END_MARKER)
    return "\n".join(lines)


def insert_mana_section(original: str, section: str) -> str:
    body = SECTION_PATTERN.sub("", original)
    category_at = body.find(CATEGORY_END)
    if category_at >= 0:
        insert_at = category_at + len(CATEGORY_END)
        return (
            body[:insert_at].rstrip()
            + "\n\n"
            + section
            + "\n\n"
            + body[insert_at:].lstrip()
        )
    key_match = KEY_CARDS_HEADING.search(body)
    if key_match:
        next_heading = HEADING.search(body, key_match.end())
        insert_at = next_heading.start() if next_heading else len(body)
    else:
        heading = "## How the deck works"
        insert_at = body.find(heading)
        if insert_at < 0:
            return body.rstrip() + "\n\n" + section + "\n"
    return (
        body[:insert_at].rstrip()
        + "\n\n"
        + section
        + "\n\n"
        + body[insert_at:].lstrip()
    )


def update_primer(deck_dir: Path, *, check: bool = False) -> int:
    manifest_path = deck_dir / "cards.json"
    readme_path = deck_dir / "README.md"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"missing manifest: {manifest_path}")
    if not readme_path.is_file():
        raise FileNotFoundError(f"missing primer: {readme_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    stats = collect_stats(manifest, repository_root(deck_dir))
    section = render_section(stats)
    original = readme_path.read_text(encoding="utf-8")
    updated = insert_mana_section(original, section)

    if check and updated != original:
        print(f"{readme_path}: mana stats are missing or stale")
        return 1
    if updated != original:
        readme_path.write_text(updated, encoding="utf-8")
    print(
        f"{readme_path}: mana stats current "
        f"(avg {stats['avg_mv']:.2f}, {stats['nonland_cards']} nonlands)"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", type=Path, help="deck directory or README.md path")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report missing or stale mana stats without changing the README",
    )
    args = parser.parse_args()

    target = args.deck.resolve()
    deck_dir = target.parent if target.is_file() else target
    try:
        return update_primer(deck_dir, check=args.check)
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
