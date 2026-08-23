#!/usr/bin/env python3
"""Turn card mentions in a deck primer into Scryfall links."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

PROTECTED_MARKDOWN = re.compile(
    r"(!?\[[^]\n]*\](?:\([^\n)]*\)|\[[^]\n]*\])"
    r"|\x60[^\x60\n]*\x60"
    r"|https?://[^\s<]+"
    r"|<[^>\n]+>)"
)
CATEGORY_PROBABILITY_START = "<!-- category-probabilities:start -->"
CATEGORY_PROBABILITY_END = "<!-- category-probabilities:end -->"


def card_links(manifest: dict, markdown: str = "") -> dict[str, str]:
    """Return unambiguous card-name aliases mapped to Scryfall URLs."""
    candidates: defaultdict[str, set[str]] = defaultdict(set)

    for entry in manifest.get("cards", []):
        uri = entry.get("scryfall_uri")
        if not uri:
            continue
        names = {
            entry.get("name", ""),
            entry.get("submitted_name", ""),
        }
        names.update(
            face.get("name", "")
            for face in entry.get("card", {}).get("faces", [])
        )
        if "Commander{top}" in entry.get("categories", []):
            commander_name = entry.get("name", "")
            if "," in commander_name:
                short_name = commander_name.split(",", 1)[0].strip()
                if len(short_name) >= 4:
                    names.add(short_name)
        for name in names:
            if name:
                candidates[name.casefold()].add(uri)

    links = {
        name: next(iter(uris))
        for name, uris in candidates.items()
        if len(uris) == 1
    }
    for label in re.findall(r"\*\*([^*\n]+)\*\*", markdown):
        shorthand = label.strip().casefold()
        if len(shorthand) < 4 or shorthand in links:
            continue
        pattern = re.compile(rf"(?<![\w]){re.escape(shorthand)}(?![\w])")
        matching_uris = {
            uri
            for name, uri in links.items()
            if pattern.search(name)
        }
        if len(matching_uris) == 1:
            links[shorthand] = next(iter(matching_uris))
    return links


def canonical_uri(uri: str) -> str:
    return uri.split("#", 1)[0].split("?", 1)[0].rstrip("/")


def lookup_alias(label: str, links: dict[str, str]) -> str | None:
    visible = re.sub(r"[*_]", "", label).strip()
    return links.get(visible.casefold())


MARKDOWN_SCRYFALL_LINK = re.compile(
    r"\[([^\]]+)\]\((https?://scryfall\.com/[^)\s]+)\)"
)
HTML_SCRYFALL_ANCHOR = re.compile(
    r'(<a\s+[^>]*href=")(https?://scryfall\.com/[^"]+)("[^>]*>)(.*?)(</a>)',
    re.IGNORECASE | re.DOTALL,
)


def rewrite_scryfall_hrefs(markdown: str, links: dict[str, str]) -> tuple[str, int]:
    """Point existing Scryfall links at the manifest URI for that card name."""
    if not links:
        return markdown, 0
    replacements = 0

    def replace_markdown(match: re.Match) -> str:
        nonlocal replacements
        target = lookup_alias(match.group(1), links)
        if target and canonical_uri(match.group(2)) != canonical_uri(target):
            replacements += 1
            return f"[{match.group(1)}]({target})"
        return match.group(0)

    def replace_html(match: re.Match) -> str:
        nonlocal replacements
        inner = match.group(4)
        alt = re.search(r'alt="([^"]+)"', inner, re.IGNORECASE)
        label = alt.group(1) if alt else re.sub(r"<[^>]+>", "", inner)
        target = lookup_alias(label, links)
        if target and canonical_uri(match.group(2)) != canonical_uri(target):
            replacements += 1
            return f"{match.group(1)}{target}{match.group(3)}{inner}{match.group(5)}"
        return match.group(0)

    rewritten = MARKDOWN_SCRYFALL_LINK.sub(replace_markdown, markdown)
    rewritten = HTML_SCRYFALL_ANCHOR.sub(replace_html, rewritten)
    return rewritten, replacements


def link_markdown(markdown: str, links: dict[str, str]) -> tuple[str, int]:
    """Link card names while preserving existing links, code, URLs, and HTML."""
    markdown, rewritten = rewrite_scryfall_hrefs(markdown, links)
    if not links:
        return markdown, rewritten

    aliases = sorted(links, key=lambda name: (-len(name), name))
    names = "|".join(re.escape(name) for name in aliases)
    card_pattern = re.compile(
        rf"(?<![\w])(?P<strong>\*\*)?(?P<name>{names})(?(strong)\*\*)(?![\w])",
        re.IGNORECASE,
    )
    replacements = 0

    def link_segment(segment: str) -> str:
        nonlocal replacements

        def replace(match: re.Match) -> str:
            nonlocal replacements
            name = match.group("name")
            if not match.group("strong") and name[:1].islower():
                return match.group(0)
            replacements += 1
            label = f"**{name}**" if match.group("strong") else name
            return f"[{label}]({links[name.casefold()]})"

        return card_pattern.sub(replace, segment)

    output = []
    in_fence = False
    in_category_probabilities = False
    for line in markdown.splitlines(keepends=True):
        stripped = line.lstrip()
        if line.strip() == CATEGORY_PROBABILITY_START:
            in_category_probabilities = True
            output.append(line)
            continue
        if in_category_probabilities:
            output.append(line)
            if line.strip() == CATEGORY_PROBABILITY_END:
                in_category_probabilities = False
            continue
        if stripped.startswith(("\x60\x60\x60", "~~~")):
            in_fence = not in_fence
            output.append(line)
            continue
        if in_fence or line.startswith("    "):
            output.append(line)
            continue
        parts = PROTECTED_MARKDOWN.split(line)
        output.extend(
            part if index % 2 else link_segment(part)
            for index, part in enumerate(parts)
        )

    return "".join(output), replacements + rewritten


def missing_scryfall_uris(manifest: dict) -> list[str]:
    missing = []
    for entry in manifest.get("cards", []):
        categories = entry.get("categories", [])
        if any("{noDeck}" in category for category in categories):
            continue
        if not entry.get("scryfall_uri"):
            missing.append(entry.get("submitted_name") or entry.get("name") or "?")
    return missing


def process_primer(deck_dir: Path, *, check: bool = False) -> int:
    manifest_path = deck_dir / "cards.json"
    readme_path = deck_dir / "README.md"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"missing manifest: {manifest_path}")
    if not readme_path.is_file():
        raise FileNotFoundError(f"missing primer: {readme_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    missing = missing_scryfall_uris(manifest)
    if missing:
        print(f"{manifest_path}: missing scryfall_uri for {', '.join(missing)}")
        return 1
    original = readme_path.read_text(encoding="utf-8")
    updated, replacements = link_markdown(original, card_links(manifest, original))

    if check and updated != original:
        print(f"{readme_path}: {replacements} incorrect or unlinked card mention(s)")
        return 1
    if updated != original:
        readme_path.write_text(updated, encoding="utf-8")
    print(f"{readme_path}: linked {replacements} card mention(s)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", type=Path, help="deck directory or README.md path")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report unlinked mentions without changing the README",
    )
    args = parser.parse_args()

    target = args.deck.resolve()
    deck_dir = target.parent if target.is_file() else target
    try:
        return process_primer(deck_dir, check=args.check)
    except (FileNotFoundError, json.JSONDecodeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
