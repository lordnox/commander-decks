#!/usr/bin/env python3
"""Refresh the cached mana-base articles in manabase-sources/."""

from __future__ import annotations

import argparse
import html as htmlmod
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

HEADERS = {
    "User-Agent": "commander-decks/1.0",
    "Accept": "application/json",
}
API = "https://infinite-api.tcgplayer.com/c/article/{id}"

ARTICLES = [
    {
        "id": "dc23a7d2-0a16-4c0b-ad36-586fcca03ad8",
        "file": "karsten-how-many-sources-2022.md",
        "canonical": (
            "https://www.tcgplayer.com/content/article/"
            "How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/"
            "dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/"
        ),
    },
    {
        "id": "cd1c1a24-d439-4a8e-b369-b936edb0b38a",
        "file": "karsten-how-many-lands.md",
        "canonical": (
            "https://www.tcgplayer.com/content/article/"
            "How-Many-Lands-Do-You-Need-in-Your-Deck-An-Updated-Analysis/"
            "cd1c1a24-d439-4a8e-b369-b936edb0b38a/"
        ),
    },
    {
        "id": "e22caad1-b04b-4f8a-951b-a41e9f08da14",
        "file": "karsten-optimal-mana-curve-commander.md",
        "canonical": (
            "https://www.tcgplayer.com/content/article/"
            "What-s-an-Optimal-Mana-Curve-and-Land-Ramp-Count-for-Commander/"
            "e22caad1-b04b-4f8a-951b-a41e9f08da14/"
        ),
    },
    {
        "id": "817630e3-756a-481c-8042-b2bf1e8bbd10",
        "file": "duke-managing-your-mana-base.md",
        "canonical": (
            "https://www.tcgplayer.com/content/article/"
            "Managing-Your-Mana-Base-Deep-Dive/"
            "817630e3-756a-481c-8042-b2bf1e8bbd10/"
        ),
    },
]


class HTMLToMarkdown(HTMLParser):
    skip = {"script", "style", "noscript"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skipping = 0
        self.list_type: list[str] = []
        self.href: str | None = None
        self.in_pre = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_d = dict(attrs)
        if tag in self.skip:
            self.skipping += 1
            return
        if self.skipping:
            return
        if tag == "card-hover-link":
            name = attrs_d.get("display-text") or attrs_d.get("card-name") or ""
            if name:
                self.parts.append(name)
            return
        if tag in ("p", "div", "section", "article", "tr"):
            self.parts.append("\n\n")
        elif tag == "br":
            self.parts.append("\n")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.parts.append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "li":
            prefix = "1. " if self.list_type and self.list_type[-1] == "ol" else "- "
            self.parts.append("\n" + prefix)
        elif tag in ("ul", "ol"):
            self.list_type.append(tag)
        elif tag in ("strong", "b"):
            self.parts.append("**")
        elif tag in ("em", "i"):
            self.parts.append("*")
        elif tag == "blockquote":
            self.parts.append("\n\n> ")
        elif tag == "a":
            self.href = attrs_d.get("href")
            self.parts.append("[")
        elif tag == "img":
            alt = attrs_d.get("alt") or ""
            if alt:
                self.parts.append(f"\n\n_{alt}_\n\n")
        elif tag == "th":
            self.parts.append("| **")
        elif tag == "td":
            self.parts.append("| ")
        elif tag == "pre":
            self.in_pre = True
            self.parts.append("\n\n```\n")
        elif tag == "code" and not self.in_pre:
            self.parts.append("`")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.skip:
            self.skipping = max(0, self.skipping - 1)
            return
        if self.skipping:
            return
        if tag in ("strong", "b"):
            self.parts.append("**")
        elif tag in ("em", "i"):
            self.parts.append("*")
        elif tag == "a":
            href = self.href or ""
            self.parts.append(f"]({href})" if href else "]")
            self.href = None
        elif tag in ("ul", "ol"):
            if self.list_type:
                self.list_type.pop()
            self.parts.append("\n")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6", "p"):
            self.parts.append("\n\n")
        elif tag == "th":
            self.parts.append("** ")
        elif tag == "td":
            self.parts.append(" ")
        elif tag == "tr":
            self.parts.append("|\n")
        elif tag == "pre":
            self.in_pre = False
            self.parts.append("\n```\n\n")
        elif tag == "code" and not self.in_pre:
            self.parts.append("`")

    def handle_data(self, data: str) -> None:
        if self.skipping:
            return
        if not self.in_pre:
            data = re.sub(r"\s+", " ", data)
        if data and data != " ":
            self.parts.append(data)
        elif data == " " and self.parts and not self.parts[-1].endswith(("\n", " ", "|")):
            self.parts.append(" ")

    def text(self) -> str:
        raw = htmlmod.unescape("".join(self.parts))
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        raw = re.sub(r"[ \t]+\n", "\n", raw)
        raw = re.sub(r"\n##\n+", "\n", raw)
        return raw.strip() + "\n"


def repository_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "MANABASE.md").is_file():
            return candidate
    raise FileNotFoundError("MANABASE.md not found above " + str(start))


def fetch_article(article_id: str) -> dict:
    url = API.format(id=article_id)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def render_article(payload: dict, art: dict, cached: str) -> str:
    article = payload["result"]["article"]
    author = (payload["result"].get("author") or {}).get("name") or ""
    parser = HTMLToMarkdown()
    parser.feed(article.get("body") or "")
    parser.close()
    title = article.get("title") or art["file"]
    published = article.get("dateTime") or article.get("date") or ""
    return (
        f"# {title}\n\n"
        f"- Author: {author}\n"
        f"- Original: {art['canonical']}\n"
        f"- Published: {published}\n"
        f"- Cached: {cached} from TCGplayer Infinite API (`/c/article/{art['id']}`)\n"
        "- Note: Offline working copy for this repository. "
        "Copyright remains with the original author and publisher.\n\n"
        "---\n\n"
        + parser.text()
    )


def write_index(out: Path, cached: str) -> None:
    rows = [
        (
            "Frank Karsten, How Many Sources Do You Need to Consistently Cast Your Spells? A 2022 Update",
            "karsten-how-many-sources-2022.md",
            ARTICLES[0]["canonical"],
        ),
        (
            "Frank Karsten, How Many Lands Do You Need in Your Deck? An Updated Analysis",
            "karsten-how-many-lands.md",
            ARTICLES[1]["canonical"],
        ),
        (
            "Frank Karsten, What's an Optimal Mana Curve and Land/Ramp Count for Commander?",
            "karsten-optimal-mana-curve-commander.md",
            ARTICLES[2]["canonical"],
        ),
        (
            "Reid Duke, Managing Your Mana Base - Deep Dive",
            "duke-managing-your-mana-base.md",
            ARTICLES[3]["canonical"],
        ),
        (
            "3/3 Elk, All Underplayed Utility Lands in Commander",
            "33elk-underplayed-utility-lands.md",
            "https://www.youtube.com/watch?v=xy16QHJU-ls",
        ),
    ]
    lines = [
        "# Mana-base source cache",
        "",
        "Offline copies of the articles and video transcript linked from "
        "[`MANABASE.md`](../MANABASE.md).",
        "Read these instead of fetching the live pages. Refresh only when an article "
        "changes or a number in `MANABASE.md` is in doubt.",
        "",
        f"Snapshot date: **{cached}**.",
        "",
        "These files are working copies for local lookup. They are not republication.",
        "Copyright remains with the original authors and publishers.",
        "",
        "| Source | Cached file | Original |",
        "| --- | --- | --- |",
    ]
    for title, fname, url in rows:
        lines.append(f"| {title} | [{fname}]({fname}) | [link]({url}) |")
    lines.append("")
    (out / "README.md").write_text("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify cached article files exist; do not fetch",
    )
    args = parser.parse_args()
    root = repository_root(Path(__file__).resolve())
    out = root / "manabase-sources"
    if args.check:
        missing = [
            art["file"]
            for art in ARTICLES
            if not (out / art["file"]).is_file()
        ]
        if not (out / "33elk-underplayed-utility-lands.md").is_file():
            missing.append("33elk-underplayed-utility-lands.md")
        if missing:
            print("missing: " + ", ".join(missing), file=sys.stderr)
            return 1
        print("ok")
        return 0

    out.mkdir(exist_ok=True)
    cached = date.today().isoformat()
    for art in ARTICLES:
        try:
            payload = fetch_article(art["id"])
        except urllib.error.URLError as exc:
            print(f"failed to fetch {art['file']}: {exc}", file=sys.stderr)
            return 1
        (out / art["file"]).write_text(render_article(payload, art, cached))
        print(art["file"])
    write_index(out, cached)
    print("README.md")
    print(
        "transcript left unchanged; replace 33elk-underplayed-utility-lands.md by hand "
        "if the video changes"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
