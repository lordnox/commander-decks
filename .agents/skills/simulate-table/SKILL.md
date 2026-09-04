---
name: simulate-table
description: >-
  Play a four-player Commander game among resolved decks, each trying to
  win from its primer, then write a step-through HTML replay. Use when the
  user asks for a table game, pod sim, four-deck match, multiplayer
  simulation, matchup, or to watch stored decks play against each other.
  Goldfish-only tests stay on simulate-deck.
---

# Simulate Table

Run one four-player Commander game. Each seat plays to win using that deck's
primer, Oracle text, and the cards it actually draws. This is not a rules
engine: the scripts deal libraries and render the replay; the agent plays
legal Magic and records snapshots.

A table result is entertainment and a matchup sketch, not a power rating and
not authorization to edit any deck.

## 1. Pick the pod

1. Inspect directories under `decks/` and match requested decks. Confirm
   ambiguous names.
2. Need **four** resolved seats. If the user names fewer, ask which decks
   fill the pod, or propose a mixed-bracket table from stored lists and wait.
3. Run `validate_deck.py` on each seat. Stop if a list is unresolved.
4. Read each primer's plan, backup, expected win texture, and interaction.
   Read [`BRACKET-DEFINITIONS.md`](../../../BRACKET-DEFINITIONS.md) only to
   describe the table, not to invent extra opponents.

Do not simulate from names alone when a `cards.json` exists.

## 2. Deal

```bash
python3 .agents/skills/simulate-table/scripts/deal_table.py \
  decks/<a> decks/<b> decks/<c> decks/<d> \
  --seed 1729 \
  --format json
```

Use a user-supplied seed when given; otherwise 1729. Seats are `p1`–`p4` in
the order given (turn order, clockwise).

The helper prints, for each seat, three London candidates (keep 7, mulligan 1,
mulligan 2) and a card catalog with Scryfall images. Choose a keep the way
that deck would: lands and early plan first, not a perfect hand.

Apply the keeps:

```bash
python3 .agents/skills/simulate-table/scripts/deal_table.py \
  decks/<a> decks/<b> decks/<c> decks/<d> \
  --seed 1729 \
  --apply \
  --mulligans 0,1,0,0 \
  --bottom p2=Mountain,Forest \
  --out table-games/<slug>.json
```

`--bottom` is London cards sent to the bottom, named exactly, comma-separated
per seat. Omit seats that kept seven.

Keep the apply JSON private while playing (it contains libraries). The replay
file must store **library counts only**.

## 3. Play

Default: start at 40 life, Commander damage and poison on, turn-one draw on
for every seat, continue until one player wins or **turn 12**, whichever
first. Honor a user-supplied horizon.

For every seat, every turn:

1. Play that deck's plan, not a generic good-stuff pilot.
2. Spend mana legally. Track tapped lands, commander tax, summoning sickness,
   once-per-turn clauses, and replacement effects.
3. Interact when the primer would: hold up counters, fogs, removal, or
   politics rather than dump the hand because it is a sim.
4. Attack, race, or stall according to the win condition, threat assessment,
   and life totals. Do not kingmake unless that deck's documented plan is
   political.
5. Never tutor, draw, or produce a card that was not in hand, in a known
   zone, or actually found by a resolved search of that library.
6. Walk claimed loops; "fat once" is not infinite.

Record **every** game action as an event with a full board snapshot (see
[schema.md](schema.md)). Hidden libraries stay in the agent's working notes,
not in the replay JSON.

If the game hits the turn cap with multiple players alive, stop and name the
leader rather than inventing a win.

## 4. Render

Write the public replay next to the apply file, then:

```bash
python3 .agents/skills/simulate-table/scripts/render_replay.py \
  table-games/<slug>.json \
  --out table-games/<slug>.html
```

The renderer keeps only the cards this game actually referenced, so the log may
carry the full four-deck catalog. Write the log compact; it is a generated
artifact, not a file anyone reads by hand.

Open the HTML in a browser when tools allow so the table, slider, and card
images actually work. Replays are scratch by default (`table-games/` is
gitignored). To keep one, `git add -f` the log and HTML and write a short
`table-games/<slug>.md` recap, since GitHub renders neither JSON nor HTML.

Do not dump the HTML source into chat.

## 5. Report in chat

Lead with the winner (or the turn-12 leader), the turn, and the winning
action. Then:

1. Seat table: deck, commander, mulligans, final life, what the plan did.
2. Four to eight **turning points** (keeps, commander casts, answers,
   attacks, the win). Featured cards get small Scryfall images per
   `.cursor/rules/card-chat-images.mdc`.
3. The replay path, in a fenced block so it is easy to open:

```text
table-games/<slug>.html
```

4. Limits: imperfect judging, truncated turns, and that one seed is not a
   metagame.

Do not edit, reassess, or recategorize decks from a table result unless the
user asks to act on it.
