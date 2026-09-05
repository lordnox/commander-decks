---
name: render-table-replay
description: >-
  Validate a simulate-table replay JSON file and publish sanitized data for the
  React step-through Commander table. Use when the user asks to view, watch,
  visualize, render, or open a recorded table game. This skill does not play
  or reinterpret the game.
---

# Render Table Replay

Transform an existing replay file without changing its game decisions:

```text
simulate-table → replay JSON → validation/public JSON → React player
```

The recorded JSON remains the source of truth. The React player must not repair
illegal plays, reorder events, infer missing draws, or continue a truncated game.
Judging those decisions belongs to `review-table`.

## 1. Validate the input

Read `.agents/skills/simulate-table/schema.md`, then validate and publish the
public replay payload:

```bash
bun run table:render
bun run table:render -- table-games/<slug>.json
```

No arguments rewrites every finished `table-games/*.json` file (not
`*.working.json`) as `site/public/replays/<slug>.json`. That is the command
after player or schema changes. A single path still accepts `--out`.

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

It trims unused catalog entries before publishing JSON, and fills in
missing per-side `faces` art from the `cards/` cache so replays recorded before
that field still show the correct side of a double-faced card. A battlefield
token recorded without a `token_id` also gets one: the renderer matches its name
against that seat's `decks/<deck>/tokens.json`, prefers a printing made by a card
in this game, and embeds that entry so the token shows art and a body instead of
an empty frame.

## 2. Check the viewer

Open the React route `?game=<slug>` when browser tools are available and verify:

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
8. battlefield tokens with `token_id` show the exact art named by that ID, and a
   token without one shows the printing backfilled from its deck;
9. a double-faced permanent shows the side in play — the land half of an MDFC,
   the back of a transformed creature — while hand and graveyard copies stay on
   the front;
10. creatures in play show current power and toughness in the card corner,
    counting `+1/+1` counters and any recorded `pt`; a printed body alone does
    not qualify, so an uncrewed Vehicle and a Spacecraft below its station
    threshold show none;
11. counters and status show on the card, and selecting it opens the inspector
    with Oracle text, counters, notes, and its Scryfall link;
12. narrow layouts remain usable with the fixed controls and collapsed log.

Do not dump replay JSON into chat.

## 3. Build and report

The React index and player live under `site/`. Sanitized replay payloads and
compact index metadata are generated into `site/public/`, which Vite copies
into `dist/`:

```bash
bun run site:prepare
bun run build
```

`site:prepare` runs `table:render` and then `table:pages`.
`build_pages.py` regenerates `site/public/games.json` from the replay JSON, so
a new game appears in the React index without hand-editing it. It warns about a
`site/public/replays/*.json` whose source log is gone instead of deleting it; remove
that file yourself once the game is really retired.

Replay logs stay scratch (`table-games/*.json` is gitignored). To keep a game,
`git add -f` its JSON and add a short `table-games/<slug>.md` recap. Generated
public JSON, metadata, and `dist/` remain ignored; GitHub Actions rebuilds them from
the committed JSON.

GitHub Pages must use **GitHub Actions** as its source. The workflow typechecks
and builds the Vite app, then deploys `dist/`. Pages must also be enabled for
the repository (public, or a plan that includes private Pages); the index is
then `https://lordnox.github.io/commander-decks/`.

Return the React URL:

```text
https://lordnox.github.io/commander-decks/?game=<slug>
```
