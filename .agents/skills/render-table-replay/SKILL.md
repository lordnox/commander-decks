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
Judging those decisions belongs to `review-table`.

## 1. Validate the input

Read `.agents/skills/simulate-table/schema.md`, then rebuild HTML from the
current viewer template:

```bash
bun run table:render
bun run table:render -- table-games/<slug>.json
```

No arguments rewrites every finished `table-games/*.json` file (not
`*.working.json`) as `pages/<slug>.html`. That is the command after viewer or
template changes. A single path still accepts `--out`.

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
- token IDs referenced by battlefield entries but absent from the token
  catalog;
- a battlefield `pt` that is not `power/toughness`;
- a battlefield `face` that the card does not have;
- malformed rows in `references`;
- a `revealed_top` list longer than that seat's `library_count`.

It trims unused catalog entries before embedding JSON in the HTML, and fills in
missing per-side `faces` art from the `cards/` cache so replays recorded before
that field still show the correct side of a double-faced card.

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
   into three digits; `notes`, `decision.reason`, and live `state.deals` show
   when present;
7. a seat with `revealed_top` shows a Top of library zone above its
   battlefield;
8. battlefield tokens with `token_id` show the exact art named by that ID;
9. a double-faced permanent shows the side in play — the land half of an MDFC,
   the back of a transformed creature — while hand and graveyard copies stay on
   the front;
10. creatures in play show current power and toughness in the card corner,
    counting `+1/+1` counters and any recorded `pt`;
11. counters and `note` segments show as chips on the card, and hovering it
    lists them in full under the large image;
12. narrow layouts remain usable with the fixed controls and collapsed log.

Do not dump HTML source into chat.

## 3. Store and report

The served site is the tracked `docs/` directory: one `<slug>.html` per game
plus the generated `index.html` and `.nojekyll`. Rebuild both after a viewer
change and commit the result:

```bash
bun run table:render
bun run table:pages
```

`build_pages.py` regenerates `docs/index.html` from the replay JSON, so a new
game appears in the listing without hand-editing HTML. It warns about a
`docs/*.html` whose JSON is gone instead of deleting it; remove that file
yourself once the game is really retired.

Replay logs stay scratch (`table-games/*.json` is gitignored). To keep a game,
`git add -f` its JSON, commit its `docs/<slug>.html`, and add a short
`table-games/<slug>.md` recap because GitHub renders neither JSON nor HTML.

GitHub Pages serves `main` at `/docs`, so an uncommitted render never reaches
the site and no build runs in CI. Pages must be enabled for the repository
(public, or a plan that includes private Pages); the index is then
`https://lordnox.github.io/commander-decks/`.

Return the HTML path:

```text
docs/<slug>.html
```
