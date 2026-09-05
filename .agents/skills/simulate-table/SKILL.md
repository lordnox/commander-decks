---
name: simulate-table
description: >-
  Play a four-player Commander game among resolved decks, each trying to
  win from its primer, and record a deterministic replay JSON file. Use when
  the user asks for a table game, pod sim, four-deck match, multiplayer
  simulation, or matchup. Rendering that file as HTML belongs to
  render-table-replay. Goldfish-only tests stay on simulate-deck.
---

# Simulate Table

Run one four-player Commander game. Each seat plays to win using that deck's
primer, Oracle text, and the cards it actually draws. This is not a rules
engine: the deal script fixes hidden information; the agent plays legal Magic
and records snapshots.

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

Fetch the exact token printings required by the four decklists:

```bash
bun run deck:tokens -- \
  "Thousand Cuts" "Borrowed Time" \
  "Captain of the Dawnsire" "Graveyard Shift"
```

This reads Scryfall `all_parts` from the cached deck cards, batches only
missing token IDs through Scryfall, and writes each deck's `tokens.json`.
Names accept the same title, commander, and folder-slug matching as the dealer;
omit them for an interactive choice. Commit changed token manifests.

Then deal:

```bash
bun run table:deal -- \
  "Thousand Cuts" "Borrowed Time" \
  "Captain of the Dawnsire" "Graveyard Shift" \
  --seed 1729 \
  --turns 12 \
  --format json
```

Use a user-supplied seed when given; otherwise 1729. `--turns` is the last
turn to play; default 12. Seats are `p1`–`p4` in the order given (turn order,
clockwise).

Deck arguments accept the brew title, commander, or folder slug. An exact
match is selected directly. Missing or ambiguous arguments open numbered
choices in an interactive terminal. Use `bun run table:deal -- --list` to
inspect every selectable deck.

The helper prints, for each seat, three London candidates (keep 7, mulligan 1,
mulligan 2) and a card catalog with Scryfall images. Choose a keep the way
that deck would: lands and early plan first, not a perfect hand.

Apply the keeps:

```bash
bun run table:deal -- \
  "Thousand Cuts" "Borrowed Time" \
  "Captain of the Dawnsire" "Graveyard Shift" \
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

## 3. Play to win

Default: start at 40 life, Commander damage and poison on, turn-one draw on
for every seat, continue until one player wins or the replay's
`horizon.throughTurn` (default **turn 12**), whichever first. Honor a
user-supplied `--turns` or continue request.

For every seat, every turn:

1. Before choosing a value play, inspect the complete hand, battlefield,
   graveyard, command zone, and known cards for a deterministic win or forced
   winning line. Walk the full line, including mana and legal targets. Take it
   unless playing around a specific visible answer is stronger.
2. Play that deck's plan, not a generic good-stuff pilot. Setup pieces are not
   automatically better than ramp: compare what each sequence unlocks on the
   next turn.
3. Spend mana legally. Track tapped lands, commander tax, summoning sickness,
   once-per-turn clauses, and replacement effects.
4. Interact when the primer would: hold up counters, fogs, removal, or
   politics rather than dump the hand because it is a sim. A pass with
   unused mana is a recorded decision, not silence.
5. Attack, race, or stall according to the win condition, threat assessment,
   and life totals. Do not kingmake unless that deck's documented plan is
   political. Politics is a game action: negotiate before spending
   irreversible leverage (board wipe, lethal, lock gift, counter, targeted
   removal). Record offers, answers, and active deals in the replay.
6. Never tutor, draw, or produce a card that was not in hand, in a known
   zone, or actually found by a resolved search of that library.
7. Walk claimed loops; "fat once" is not infinite.
8. When a seat may look at the top of its library — Fblthp, Bolas's Citadel,
   Oracle of Mul Daya, Future Sight — decide from that card and publish it in
   `revealed_top` (see [schema.md](schema.md)), refreshed whenever the top
   changes.
9. When creating a token, read that source card under the seat's
   `token_sources` and put its exact Scryfall ID in the battlefield entry's
   `token_id`. Do not choose a same-name token by memory; printed tokens with
   the same name can have different characteristics.
10. Record `+1/+1` and `-1/-1` counters in `counters`; the viewer adds them to
    the printed power and toughness. When anything else changes those values —
    an anthem, Aura, Equipment, pump spell, or animated land — put the
    resulting values in the battlefield entry's `pt`.
11. Keep every other counter kind in `counters` too, and put the rest of a
    permanent's state in `note` as `;`-separated segments such as
    `enchanting Sun Titan; goaded`. The viewer turns both into icons on the
    card and spells them out on the hover preview.

Record **every** game action as an event with a full board snapshot (see
[schema.md](schema.md)). Hidden libraries stay in the agent's working notes,
not in the replay JSON. Decisions, table talk, and deals belong in the
replay too — they are not chat-only commentary.

Every normal draw step is its own `draw` event, even when the card is
immediately played, discarded, revealed, replaced, or taxed. Extra draws and
their replacement/tax result are separate events too. Put triggered abilities
on the end step where they actually trigger; never defer a trigger across the
next player's untap.

If the game hits the turn cap with multiple players alive, stop and name the
leader rather than inventing a win.

## 3b. Recorded decisions

Before a seat passes priority with unused mana, unused attacks, or an unused
activated ability, emit a `think` event (or attach `decision` to the `pass`).
List every legal play that mana could still buy, then name the ones held and
why. Typical reasons: hold-up for a named counter or fog; wait for instant
speed on the last opponent's end step; the card is a present that needs the
commander; dumping it would kingmake.

```json
{
  "kind": "think",
  "summary": "Unwanted Presents keeps four mana up instead of casting Yukora.",
  "decision": {
    "open_mana": 4,
    "available": [8, 12],
    "held": [8],
    "held_for": "politics",
    "play_later": "after Thousand Cuts answers the offer, or as the refused line",
    "reason": "Yukora can wait; firing it now spends the Artisans wipe before talking to Thousand Cuts."
  }
}
```

Do not invent a hold that the deck would not take. If the primer would dump
the hand, dump it and skip the `think`. A silent pass with four open mana and
a three-mana creature in hand is a missed record.

## 3c. Politics

Commander is not four goldfishes. Before an irreversible line that another
seat would bargain over, open a negotiation window:

1. Append a `deal` row to `references`, then emit `talk` with
   `{ "id": 9, "action": "offer" }` (the index of that row).
2. Named seats answer with `talk` (`accept`, `counter`, or `reject`). Other
   seats may counteroffer; they heard the offer.
3. Put `{ "id": 9, "status": "accepted" }` in `state.deals`. Later
   `think` / `pass` / `cast` events that honor or break it cite that index.
4. Terms must be actions the speaker can actually control. "Don't hurt me"
   is invalid when the deck's taxes are symmetrical. "No targeted effects or
   attacks against you until my next turn; group-slug permanents are exempt"
   is valid.
5. Use only public information. A seat may not promise a card it has not
   shown unless the term is "if I draw an answer, I will use it on X."
6. Deals are nonbinding. Break them when honoring would cause an immediate
   loss, and emit `deal` with `action: "breach"`. Political primers (donate,
   goad, group slug) start talks more often; any seat with removal,
   protection, fogs, or combat influence may bargain.
7. Copy `{ id, status }` into every later snapshot until the deal expires,
   completes, or breaks. Full terms live only on the `references` row.

When writing the replay, put `references` immediately after `seats`: four
player rows, then one card row per catalog name in key order, then every deal
in offer order. The ID is the array index. `summary`, `reason`, and `terms`
always use names, never indexes.

## 3d. Continue

To play extra turns of an existing replay:

```bash
bun run table:continue -- table-games/<slug>.json --turns 3
```

`--turns` is extra turns after the current turn number, so a game truncated at
turn 12 with `--turns 3` plays through turn 15. Omit the path to pick from
`table-games/` interactively. Already-won games refuse unless `--force`.

Output goes to `table-games/<slug>.working.json`, leaving the recorded replay
alone; `--in-place` or `--out` override that. The working file keeps the old
`headline` and `result` until the new turns exist, and adds `horizon`.

The command restores `_libraries` from the file when present; otherwise it
rebuilds leftover cards from public zones and reseeds their order. **It does
not play Magic.** Continue the working file from its last event through
`horizon.throughTurn` under the same play-to-win rules. When the extra turns
are recorded, refresh `headline` and `result`, drop `horizon` and
`_libraries`, and write `table-games/<slug>.json`.

## 4. Validate the replay

Before reporting:

1. Replay each seat's mana and zone changes from the previous snapshot.
2. Confirm every draw has a preceding draw event and decrements the library.
3. Confirm triggered abilities occur in the correct phase and before the next
   untap.
4. At every main phase, repeat the deterministic-win check against the cards
   then available. A missed win invalidates the simulation. A pass with
   unused mana and no `think` / `decision` is also a miss unless every
   remaining card is uncastable.
5. Confirm `state.deals` is copied forward after an accepted offer, and that
   a later breach has a `deal` event with `action: "breach"`.
6. Remove `_libraries`, keep only `library_count`, and write compact JSON to
   `table-games/<slug>.json`.

The replay JSON is the simulation's terminal output. Invoke
`render-table-replay` separately when the user wants an HTML viewer.

## 5. Report in chat

Lead with the winner (or the leader at the horizon), the turn, and the winning
action. Then:

1. Seat table: deck, commander, mulligans, final life, what the plan did.
2. Four to eight **turning points** (keeps, commander casts, answers,
   attacks, deals, the win). Featured cards get small Scryfall images per
   `.cursor/rules/card-chat-images.mdc`. Quote recorded `decision.reason`
   lines when a hold or a deal changed the game.
3. The replay path:

```text
table-games/<slug>.json
```

4. If `render-table-replay` was also requested, link its HTML path.
5. Limits: imperfect judging, truncated turns, and that one seed is not a
   metagame.

Do not edit, reassess, or recategorize decks from a table result unless the
user asks to act on it.
