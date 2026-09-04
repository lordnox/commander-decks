---
name: render-table-replay
description: >-
  Validate a simulate-table replay JSON file and render it as a self-contained,
  step-through HTML Commander table. Use when the user asks to view, watch,
  visualize, render, or open a recorded table game. This skill does not play or
  reinterpret the game.
---

# Render Table Replay

Transform an existing replay file without changing its game decisions:

```text
simulate-table → replay JSON → render-table-replay → HTML
```

The JSON remains the source of truth. The HTML viewer must not repair illegal
plays, reorder events, infer missing draws, or continue a truncated game.

## 1. Validate the input

Read `.agents/skills/simulate-table/schema.md`, then run:

```bash
python3 .agents/skills/render-table-replay/scripts/render_replay.py \
  table-games/<slug>.json \
  --out table-games/<slug>.html
```

The renderer rejects:

- schemas other than version 1;
- anything other than four seats;
- missing event snapshots;
- hidden library contents in public player state;
- event IDs that are not contiguous from zero;
- state whose turn or phase disagrees with its event;
- an `untap` that follows another player's turn without that turn having a
  normal `draw` event;
- cards referenced by events or public zones but absent from the catalog,
  except tokens;
- a `revealed_top` list longer than that seat's `library_count`.

It trims unused catalog entries before embedding JSON in the HTML.

## 2. Check the viewer

Open the HTML when browser tools are available and verify:

1. header and transport controls remain visible while the page scrolls;
2. Previous, Play/Pause, Next, slider, arrow keys, `j`, `k`, and space work;
3. the event log remains fixed, scrolls independently, and collapses with the
   Log button;
4. collapsing the log gives its width back to the table;
5. each seat, life total, hand, battlefield, graveyard, command zone, stack,
   and card preview match the selected snapshot;
6. the centre panel names the current event, and the log numbers stay readable
   into three digits;
7. a seat with `revealed_top` shows a Top of library zone above its
   battlefield;
8. narrow layouts remain usable with the fixed controls and collapsed log.

Do not dump HTML source into chat.

## 3. Store and report

Replays are scratch by default (`table-games/` ignores JSON and HTML). To keep
one, `git add -f` both files and add a short `<slug>.md` recap because GitHub
renders neither JSON nor HTML.

Return the HTML path:

```text
table-games/<slug>.html
```
