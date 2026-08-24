#!/usr/bin/env python3
"""Validate a Commander deck workspace before review."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path

DECISION_LINE = re.compile(
    r"^-\s+\*\*(?P<name>.+?)\*\*\s*(?:—|-)\s+(?P<decision>\S.+)$",
    re.MULTILINE,
)
PRIMER_LINK = re.compile(
    r"^- `(?P<badge>[^`]+)` \[(?P<label>[^\]]+)\]\((?P<path>decks/[^)]+/README\.md)\)\s*$"
)
PRIMER_LINE = re.compile(r"^- .*\]\(decks/[^)]+/README\.md\)\s*$")
PRIMER_BADGE = re.compile(r"^(?P<bracket>\d+)(?P<modifier>[−+-]?)$")
QUANTITY_SUFFIX = re.compile(r"\s+[×x]\s*\d+\s*$", re.IGNORECASE)


def normalized_name(name: str) -> str:
    value = unicodedata.normalize("NFKD", name).casefold()
    return " ".join(value.split())


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def has_directive(card: dict, directive: str) -> bool:
    return any(directive.casefold() in category.casefold() for category in card.get("categories", []))


def oracle_text(card: dict) -> str:
    faces = card.get("card_faces") or [card]
    return " ".join(face.get("oracle_text", "") for face in faces)


def allows_multiple(card: dict) -> bool:
    text = oracle_text(card).casefold()
    return (
        "a deck can have any number of cards named" in text
        or "a deck can have up to" in text and "cards named" in text
    )


def decision_names(path: Path) -> list[str]:
    if path.suffix == ".json":
        data = read_json(path)
        cards = data.get("cards", {})
        if isinstance(cards, dict):
            return [
                value.get("name", key)
                for key, value in cards.items()
                if isinstance(value, dict) and str(value.get("decision", "")).strip()
            ]
        return []

    names = []
    for match in DECISION_LINE.finditer(path.read_text(encoding="utf-8")):
        names.append(QUANTITY_SUFFIX.sub("", match.group("name")).strip())
    return names


def primer_sort_key(entry: tuple[str, str, str]) -> tuple[int, int, str]:
    badge, label, _ = entry
    if badge.casefold() == "unrated":
        return (99, 2, label.casefold())
    match = PRIMER_BADGE.match(badge)
    if not match:
        return (98, 9, label.casefold())
    modifier = match.group("modifier")
    rank = 1
    if modifier in {"−", "-"}:
        rank = 0
    elif modifier == "+":
        rank = 2
    return (int(match.group("bracket")), rank, label.casefold())


def primer_section(text: str) -> list[str]:
    start = text.find("## Deck primers")
    if start < 0:
        return []
    rest = text[start:]
    next_heading = rest.find("\n## ", 1)
    section = rest if next_heading < 0 else rest[:next_heading]
    return section.splitlines()


def primer_links(text: str) -> list[tuple[str, str, str]]:
    links = []
    for line in primer_section(text):
        match = PRIMER_LINK.match(line)
        if match:
            links.append((match.group("badge"), match.group("label"), match.group("path")))
    return links


def primer_errors(root_readme: Path) -> list[str]:
    if not root_readme.is_file():
        return []
    text = root_readme.read_text(encoding="utf-8")
    errors = []
    unbadged = [
        line
        for line in primer_section(text)
        if PRIMER_LINE.match(line) and not PRIMER_LINK.match(line)
    ]
    if unbadged:
        errors.append(
            "root README Deck primers entries must start with a bracket badge, "
            "for example - `3+` [Deck name](decks/3+_deck-name/README.md)"
        )
    entries = primer_links(text)
    if entries and entries != sorted(entries, key=primer_sort_key):
        errors.append("root README Deck primers section is unsorted")
    return errors


def assessment_error(primer_text: str, *, unrated: bool) -> str | None:
    lines = primer_text.splitlines()
    if not lines or not lines[0].startswith("# "):
        return "primer must begin with a Markdown H1 title"
    if unrated:
        return None
    index = 1
    while index < len(lines) and not lines[index].strip():
        index += 1
    if index >= len(lines) or not lines[index].lstrip().startswith(">"):
        return "primer assessment blockquote must sit directly below the H1 title"
    return None


def primer_script(name: str) -> Path:
    return Path(__file__).resolve().parents[2] / "deck-primer/scripts" / name


def run_primer_check(script: Path, deck_dir: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(script), str(deck_dir), "--check"],
        capture_output=True,
        text=True,
        check=False,
    )


def validate(deck_dir: Path, repo_root: Path, *, require_decisions: bool = True) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    manifest_path = deck_dir / "cards.json"
    primer_path = deck_dir / "README.md"

    if not manifest_path.is_file():
        return ["missing cards.json; run cache_deck.py first"], warnings
    manifest = read_json(manifest_path)
    cards = manifest.get("cards", [])
    if not isinstance(cards, list):
        return ["cards.json has no valid cards list"], warnings

    unresolved = manifest.get("unresolved", [])
    if unresolved:
        errors.append(f"{len(unresolved)} unresolved deck-list line(s)")

    expected_source = str((deck_dir / "decklist.txt").relative_to(repo_root))
    if not (deck_dir / "decklist.txt").is_file():
        errors.append("missing decklist.txt source list")
    if manifest.get("source") != expected_source:
        errors.append(f"manifest source must be {expected_source}")

    deck_cards = [card for card in cards if not has_directive(card, "{noDeck}")]
    total_cards = sum(card.get("quantity", 0) for card in deck_cards)
    if total_cards != 100:
        errors.append(f"Commander deck contains {total_cards} cards; expected 100")
    if manifest.get("total_cards") != total_cards:
        errors.append("manifest total_cards does not match its card entries")
    if manifest.get("unique_cards") != len(deck_cards):
        errors.append("manifest unique_cards does not match its card entries")
    if (
        "resolved_unique_cards" in manifest
        and manifest.get("resolved_unique_cards") != len(cards)
    ):
        errors.append("manifest resolved_unique_cards does not match its card entries")
    extras = [card for card in cards if has_directive(card, "{noDeck}")]
    if (
        "maybeboard_cards" in manifest
        and manifest.get("maybeboard_cards")
        != sum(card.get("quantity", 0) for card in extras)
    ):
        errors.append("manifest maybeboard_cards does not match its {noDeck} entries")
    if (
        "maybeboard_unique_cards" in manifest
        and manifest.get("maybeboard_unique_cards") != len(extras)
    ):
        errors.append(
            "manifest maybeboard_unique_cards does not match its {noDeck} entries"
        )
    if manifest.get("categorized_cards") != sum(bool(card.get("categories")) for card in cards):
        errors.append("manifest categorized_cards does not match its card entries")

    uncategorized = [card.get("submitted_name", card.get("name", "?")) for card in cards if not card.get("categories")]
    if uncategorized:
        errors.append("cards without categories: " + ", ".join(uncategorized))
    vague = [card.get("submitted_name", card.get("name", "?")) for card in deck_cards if card.get("categories") == ["other"]]
    if vague:
        warnings.append("cards still using only 'other': " + ", ".join(vague))

    commanders = [card for card in deck_cards if "Commander{top}" in card.get("categories", [])]
    if not 1 <= len(commanders) <= 2:
        errors.append(f"found {len(commanders)} Commander{{top}} entries; expected one or two")
    for commander in commanders:
        if commander.get("quantity") != 1:
            errors.append(f"commander {commander.get('name', '?')} must have quantity 1")

    cache_by_oracle: dict[str, dict] = {}
    for entry in cards:
        oracle_id = entry.get("oracle_id")
        cache_path = repo_root / entry.get("cache", f"cards/{oracle_id}.json")
        if not oracle_id or not cache_path.is_file():
            errors.append(f"missing cache object for {entry.get('submitted_name', entry.get('name', '?'))}")
            continue
        try:
            cache_by_oracle[oracle_id] = read_json(cache_path)
        except (json.JSONDecodeError, OSError) as error:
            errors.append(f"invalid cache object {cache_path.relative_to(repo_root)}: {error}")

    commander_identity: set[str] = set()
    for entry in commanders:
        cached = cache_by_oracle.get(entry.get("oracle_id"), {})
        commander_identity.update(cached.get("color_identity", []))

    today = date.today().isoformat()
    for entry in deck_cards:
        name = entry.get("name", "?")
        cached = cache_by_oracle.get(entry.get("oracle_id"))
        if not cached:
            continue
        if entry.get("quantity", 0) > 1:
            basic = cached.get("type_line", "").startswith("Basic ")
            if not basic and not allows_multiple(cached):
                errors.append(f"singleton violation: {entry['quantity']}× {name}")
        extra_colors = set(cached.get("color_identity", [])) - commander_identity
        if commanders and extra_colors:
            errors.append(f"color-identity violation: {name} adds {''.join(sorted(extra_colors))}")
        legality = cached.get("legalities", {}).get("commander")
        if legality != "legal":
            is_commander = entry in commanders
            if is_commander and cached.get("released_at", "") > today:
                warnings.append(f"{name} is not Commander-legal before its {cached['released_at']} release")
            else:
                errors.append(f"Commander legality is {legality or 'unknown'}: {name}")

    if not primer_path.is_file() or not primer_path.read_text(encoding="utf-8").strip():
        errors.append("missing or empty README.md primer")
    elif primer_path.is_file():
        primer_text = primer_path.read_text(encoding="utf-8")
        assessment = assessment_error(
            primer_text,
            unrated=deck_dir.name.startswith("unrated_"),
        )
        if assessment:
            errors.append(assessment)
        linker_path = primer_script("link_card_mentions.py")
        link_check = run_primer_check(linker_path, deck_dir)
        if link_check.returncode:
            errors.append(
                "primer has unlinked card mentions; run "
                "python3 .agents/skills/deck-primer/scripts/link_card_mentions.py "
                f"{deck_dir.relative_to(repo_root)}"
            )
        archidekt_check = run_primer_check(primer_script("update_archidekt_link.py"), deck_dir)
        if archidekt_check.returncode:
            errors.append(
                "primer Archidekt link is missing or stale; run "
                "python3 .agents/skills/deck-primer/scripts/update_archidekt_link.py "
                f"{deck_dir.relative_to(repo_root)}"
            )
        category_check = run_primer_check(
            primer_script("update_category_probabilities.py"),
            deck_dir,
        )
        if category_check.returncode:
            errors.append(
                "primer category probability table is missing, stale, or misplaced; run "
                "python3 .agents/skills/deck-primer/scripts/update_category_probabilities.py "
                f"{deck_dir.relative_to(repo_root)}"
            )
        mana_check = run_primer_check(primer_script("update_mana_stats.py"), deck_dir)
        if mana_check.returncode:
            errors.append(
                "primer mana stats are missing, stale, or misplaced; run "
                "python3 .agents/skills/deck-primer/scripts/update_mana_stats.py "
                f"{deck_dir.relative_to(repo_root)}"
            )
    root_readme = repo_root / "README.md"
    primer_link = f"({primer_path.relative_to(repo_root)})"
    if not root_readme.is_file() or primer_link not in root_readme.read_text(encoding="utf-8"):
        errors.append("root README does not link to this primer")
    errors.extend(primer_errors(root_readme))

    decision_path = deck_dir / "decisions.json"
    if not decision_path.is_file():
        decision_path = deck_dir / "DECISIONS.md"
    if decision_path.is_file():
        names = decision_names(decision_path)
        counts = Counter(normalized_name(name) for name in names)
        duplicates = sorted(name for name, count in counts.items() if count > 1)
        if duplicates:
            errors.append("duplicate decision entries: " + ", ".join(duplicates))
        covered = set(counts)
        missing = []
        known_aliases: set[str] = set()
        for entry in deck_cards:
            aliases = {
                normalized_name(entry.get("name", "")),
                normalized_name(entry.get("submitted_name", "")),
            }
            cached = cache_by_oracle.get(entry.get("oracle_id"), {})
            aliases.update(normalized_name(name) for name in [cached.get("name", "")] if name)
            aliases.update(
                normalized_name(face.get("name", ""))
                for face in cached.get("card_faces", [])
                if face.get("name")
            )
            known_aliases.update(aliases)
            if not aliases & covered:
                missing.append(entry.get("submitted_name", entry.get("name", "?")))
        if missing:
            errors.append("decision log is missing: " + ", ".join(missing))
        unknown = [name for name in names if normalized_name(name) not in known_aliases]
        if unknown:
            errors.append("decision log has unknown cards: " + ", ".join(unknown))
    elif require_decisions:
        errors.append("missing decisions.json or DECISIONS.md")

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", type=Path, help="deck directory or decklist.txt path")
    parser.add_argument(
        "--require-decisions",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="require one decision-log entry for every deck card (default: true)",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    target = args.deck.resolve()
    deck_dir = target.parent if target.is_file() else target
    try:
        deck_dir.relative_to(repo_root / "decks")
    except ValueError:
        parser.error("deck must be inside decks/<deck-name>/")

    try:
        errors, warnings = validate(deck_dir, repo_root, require_decisions=args.require_decisions)
    except (json.JSONDecodeError, OSError, KeyError, TypeError) as error:
        print(f"validate_deck.py: {error}", file=sys.stderr)
        return 2

    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    if errors:
        print(f"Validation failed: {len(errors)} error(s), {len(warnings)} warning(s).", file=sys.stderr)
        return 1
    print(f"Validation passed: {len(warnings)} warning(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
