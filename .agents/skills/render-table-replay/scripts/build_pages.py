#!/usr/bin/env python3
"""Write compact replay metadata for the React table-games index."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from render_replay import REPLAYS, ROOT, replay_paths

GAMES_JSON = ROOT / "site" / "public" / "games.json"


def commander_art(game: dict, commander: str) -> str:
    entry = (game.get("catalog") or {}).get(commander) or {}
    return entry.get("image_normal") or entry.get("image_small") or ""


def parse_played_at(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def git_added_at(log: Path) -> str | None:
    try:
        result = subprocess.run(
            [
                "git",
                "log",
                "--follow",
                "--diff-filter=A",
                "--format=%aI",
                "--",
                str(log.relative_to(ROOT)),
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return lines[-1] if lines else None


def file_mtime_iso(log: Path) -> str:
    return datetime.fromtimestamp(log.stat().st_mtime, tz=timezone.utc).isoformat()


def played_at_iso(log: Path, game: dict) -> str:
    recorded = parse_played_at(game.get("played_at"))
    if recorded is not None:
        return recorded.isoformat()
    added = parse_played_at(git_added_at(log))
    if added is not None:
        return added.isoformat()
    return file_mtime_iso(log)


def rank_games(games: list[dict]) -> list[dict]:
    """Oldest game is index 1; return newest first."""
    ranked = sorted(
        games,
        key=lambda game: (
            parse_played_at(game.get("played_at"))
            or datetime.min.replace(tzinfo=timezone.utc),
            game.get("slug") or "",
        ),
    )
    numbered = [
        {**game, "index": index}
        for index, game in enumerate(ranked, start=1)
    ]
    numbered.reverse()
    return numbered


def public_game(log: Path) -> dict:
    game = json.loads(log.read_text(encoding="utf-8"))
    result = game.get("result") or {}
    seats = game.get("seats") or []
    winner_id = result.get("winner")
    winner = next((seat for seat in seats if seat.get("id") == winner_id), None)

    return {
        "slug": log.stem,
        "headline": game.get("headline") or result.get("summary") or log.stem,
        "summary": result.get("summary") or "",
        "seed": game.get("seed"),
        "turn": result.get("turn"),
        "ended": result.get("ended") or "unknown",
        "winner": (winner or {}).get("name") if winner else None,
        "played_at": played_at_iso(log, game),
        "seats": [
            {
                "id": seat.get("id"),
                "name": seat.get("name") or seat.get("id"),
                "commander": (seat.get("commanders") or ["Unknown"])[0],
                "color": seat.get("color") or "#7aa89a",
                "image": commander_art(
                    game,
                    (seat.get("commanders") or [""])[0],
                ),
            }
            for seat in seats
        ],
    }


def main() -> int:
    try:
        logs = replay_paths([])
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    missing = [
        REPLAYS / f"{log.stem}.json"
        for log in logs
        if not (REPLAYS / f"{log.stem}.json").is_file()
    ]
    if missing:
        for replay in missing:
            print(
                f"ERROR: missing {replay.relative_to(ROOT)}; "
                "run bun run table:render",
                file=sys.stderr,
            )
        return 1

    slugs = {log.stem for log in logs}
    for stale in sorted(REPLAYS.glob("*.json")):
        if stale.stem not in slugs:
            print(
                f"WARNING: {stale.relative_to(ROOT)} has no replay JSON",
                file=sys.stderr,
            )

    games = rank_games([public_game(log) for log in logs])
    GAMES_JSON.parent.mkdir(parents=True, exist_ok=True)
    GAMES_JSON.write_text(
        json.dumps(games, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(GAMES_JSON.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
