#!/usr/bin/env python3
"""Build a GitHub Pages site that lists every finished table replay."""

from __future__ import annotations

import html
import json
import shutil
import sys
from pathlib import Path

from render_replay import ROOT, replay_paths

SITE = ROOT / "_site"


def ended_label(ended: str) -> str:
    return {"win": "Win", "draw": "Draw", "truncated": "Truncated"}.get(ended, ended or "Unknown")


def seat_title(seats: list[dict]) -> str:
    return " vs ".join(seat.get("name") or seat.get("id") or "?" for seat in seats)


def game_card(log: Path) -> str:
    game = json.loads(log.read_text(encoding="utf-8"))
    slug = log.stem
    seats = game.get("seats") or []
    result = game.get("result") or {}
    ended = result.get("ended") or ""
    winner_id = result.get("winner")
    winner = next((seat for seat in seats if seat.get("id") == winner_id), None)
    winner_name = (winner or {}).get("name") if winner else ""
    headline = game.get("headline") or result.get("summary") or seat_title(seats)
    summary = result.get("summary") or ""
    turn = result.get("turn")
    seed = game.get("seed")
    chips = "".join(
        f'<span class="chip" style="--seat:{html.escape(seat.get("color") or "#7aa89a")}">'
        f'{html.escape(seat.get("name") or seat.get("id") or "?")}</span>'
        for seat in seats
    )
    meta = []
    if seed is not None:
        meta.append(f"seed {html.escape(str(seed))}")
    if turn is not None:
        meta.append(f"turn {html.escape(str(turn))}")
    if winner_name:
        meta.append(f"winner {html.escape(winner_name)}")
    return f"""
    <article class="game">
      <p class="badge">{html.escape(ended_label(ended))}</p>
      <h2>{html.escape(seat_title(seats))}</h2>
      <p class="headline">{html.escape(headline)}</p>
      <p class="meta">{" · ".join(meta)}</p>
      <div class="chips">{chips}</div>
      <p>{html.escape(summary)}</p>
      <p><a class="watch" href="{html.escape(slug)}.html">Watch replay</a></p>
    </article>
    """


def index_html(cards: list[str]) -> str:
    listing = "\n".join(cards) if cards else "<p>No recorded games yet.</p>"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Table games</title>
  <style>
    :root {{
      --felt: #143d32;
      --ink: #f4efe6;
      --muted: #c5bba8;
      --line: #2a5a4c;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      font: 16px/1.45 ui-sans-serif, system-ui, sans-serif;
      background:
        radial-gradient(circle at 50% 18%, #1b5a48 0%, var(--felt) 48%, #0c2a23 100%);
      color: var(--ink);
    }}
    header, main {{ width: min(1100px, calc(100% - 2rem)); margin: 0 auto; }}
    header {{ padding: 2.2rem 0 1rem; }}
    h1 {{ margin: 0 0 0.4rem; font-size: 1.8rem; }}
    header p {{ margin: 0; color: var(--muted); }}
    .games {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
      padding-bottom: 3rem;
    }}
    .game {{
      padding: 1rem 1.1rem 1.15rem;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #0e241eef;
    }}
    .game h2 {{ margin: 0.15rem 0 0.4rem; font-size: 1.15rem; }}
    .headline {{ margin: 0 0 0.35rem; font-weight: 650; }}
    .meta {{ color: var(--muted); font-size: 0.9rem; }}
    .badge {{
      display: inline-block;
      margin: 0 0 0.45rem;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background: #1f4f43;
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }}
    .chips {{ display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.55rem 0; }}
    .chip {{
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--seat) 70%, #000);
      background: color-mix(in srgb, var(--seat) 28%, #0b1f1a);
      font-size: 0.8rem;
    }}
    .watch {{
      display: inline-block;
      margin-top: 0.2rem;
      padding: 0.45rem 0.75rem;
      border-radius: 8px;
      background: #1f4f43;
      color: var(--ink);
      text-decoration: none;
    }}
    .watch:hover {{ background: #2b6657; }}
    a:focus-visible {{ outline: 2px solid #e6d27a; }}
  </style>
</head>
<body>
  <header>
    <h1>Table games</h1>
    <p>Recorded four-player Commander replays. Open a game to step through the table.</p>
  </header>
  <main class="games">
    {listing}
  </main>
</body>
</html>
"""


def main() -> int:
    try:
        logs = replay_paths([])
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir(parents=True)

    cards = []
    missing = 0
    for log in logs:
        html_path = log.with_suffix(".html")
        if not html_path.is_file():
            print(f"ERROR: missing {html_path.relative_to(ROOT)}; run bun run table:render", file=sys.stderr)
            missing += 1
            continue
        shutil.copy2(html_path, SITE / html_path.name)
        cards.append(game_card(log))

    if missing:
        return 1

    (SITE / "index.html").write_text(index_html(cards), encoding="utf-8")
    (SITE / ".nojekyll").write_text("", encoding="utf-8")
    print(SITE.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
