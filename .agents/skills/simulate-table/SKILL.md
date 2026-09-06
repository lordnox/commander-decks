---
name: simulate-table
description: >-
  Play a four-player Commander game among resolved decks, each trying to
  win from its primer, and record a deterministic replay JSON file. Use when
  the user asks for a table game, pod sim, four-deck match, multiplayer
  simulation, or matchup. Publishing that file to the React player belongs to
  render-table-replay. Goldfish-only tests stay on simulate-deck.
---

# Simulate Table

Run one four-player Commander game. This is not a rules engine: the deal
script fixes hidden information; **one game-master agent** judges legality
and writes the replay; **one persistent seat agent per player** chooses
that seat's plays.

A table result is entertainment and a matchup sketch, not a power rating and
not authorization to edit any deck. Do not re-record an old seed unless the
user asks for a new game.

## 1. Pick the pod

1. Inspect directories under `decks/` and match requested decks. Confirm
   ambiguous names.
2. Need **four** resolved seats. If the user names fewer, ask which decks
   fill the pod, or propose a mixed-bracket table from stored lists and wait.
3. Run `validate_deck.py` on each seat. Stop if a list is unresolved.
4. Read each primer's plan, backup, expected win texture, and interaction.
   Read [`GAMEPLAY-HINTS.md`](GAMEPLAY-HINTS.md) once for every seat. Read
   that deck's `AGENT-HINTS.md` when the file exists. Read
   [`BRACKET-DEFINITIONS.md`](../../../BRACKET-DEFINITIONS.md) only to
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

### 3a. Four seat agents and one game master

Do **not** have one model play all four seats in a single pass. Late-game
quality collapses when one context holds every hand, every plan, and the
rules log. Split the work:

| Role | Who | Sees | Returns |
|---|---|---|---|
| Game master | This agent | Public board, stack, all libraries (private), catalog, Oracle | Legal events and snapshots in the replay |
| Seat `p1`–`p4` | One persistent subagent each | Public board plus **only that seat's** hand, library, and command zone | Proposed actions and a `decision` for leftover mana |

After the opening keep, launch four `generalPurpose` subagents (the Task
tool). Resume the **same** four agent IDs through the whole game so each
pilot keeps its plan. If a seat agent dies, relaunch it with the primer,
[`GAMEPLAY-HINTS.md`](GAMEPLAY-HINTS.md), that deck's `AGENT-HINTS.md`,
and a compact recap of its public history — never another seat's hand.

Each priority window:

1. The game master writes a seat packet: turn, phase, stack, public
   snapshots, that seat's private hand and command zone, legal timing, and
   the questions in GAMEPLAY-HINTS plus AGENT-HINTS. Never include another
   seat's hand, library, or unrevealed search.
2. The seat agent answers with ordered proposed actions (cast, activate,
   play land, attack, block, talk, pass) and, on a pass, a `decision` whose
   `open_mana` is counted from the packet's untapped permanents.
3. The game master checks Oracle, costs, tax, timing, hidden information,
   and additional-trigger counts. Illegal or leaked proposals are rejected
   with the rule that failed; the same seat agent revises.
4. Only then append events and snapshots. The game master never invents a
   "better" line for a seat except to refuse an illegal one.

Combat is two packets: attackers from the active seat, then blockers from
each defending seat. Politics is a packet to the offering seat, then to
each named answerer.

Seat agents do not write replay JSON. The game master owns schema, IDs,
and `_libraries`.

### 3b. Seat checklist

For every seat, every turn, the seat agent:

1. Before choosing a value play, inspect the complete hand, battlefield,
   graveyard, command zone, and known cards for a deterministic win or forced
   winning line. Walk the full line, including mana and legal targets. Take it
   unless playing around a specific visible answer is stronger.
2. Play that deck's plan, not a generic good-stuff pilot. Setup pieces are not
   automatically better than ramp: compare what each sequence unlocks on the
   next turn. Walk [`GAMEPLAY-HINTS.md`](GAMEPLAY-HINTS.md) and that deck's
   `AGENT-HINTS.md` before passing.
3. Spend mana legally. Track tapped lands, commander tax, summoning sickness,
   once-per-turn clauses, replacement effects, and **additional-trigger**
   permanents. Summoning sickness is not tapped: a creature that does not
   say it enters tapped enters untapped.
4. Interact when the primer would: hold up counters, fogs, removal, or
   politics rather than dump the hand because it is a sim. A pass with
   unused mana is a recorded decision, not silence. Recalculate `open_mana`
   from the snapshot; do not copy last turn's `think` text.
5. Attack, race, or stall according to the win condition, threat assessment,
   and life totals, and play the whole combat as three recorded steps
   (see [3e](#3e-combat)). Do not kingmake unless that deck's documented plan
   is political. Politics is a game action: negotiate before spending
   irreversible leverage (board wipe, lethal, lock gift, counter, targeted
   removal). Record offers, answers, and active deals in the replay.
6. Never tutor, draw, or produce a card that was not in hand, in a known
   zone, or actually found by a resolved search of that library. Never name
   another seat's hidden card in a reason.
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
12. When a double-faced permanent enters or transforms, name the side in play
    in the battlefield entry's `face`, for example
    `"face": "Malakir Mire"` for the land half of an MDFC. The viewer draws
    that side's art, name, and printed power and toughness.
13. Keep each of that seat's commanders in `command`, on the battlefield, in
    graveyard, in exile, or in hand. A living player with an empty `command`
    list and no commander permanent has dropped the commander — a sim bug.

Record **every** game action as an event with a full board snapshot (see
[schema.md](schema.md)). Hidden libraries stay in the **game master's**
working notes, not in the replay JSON and not in other seats' packets.
Decisions, table talk, and deals belong in the replay too — they are not
chat-only commentary.

Every normal draw step is its own `draw` event, even when the card is
immediately played, discarded, revealed, replaced, or taxed. Extra draws and
their replacement/tax result are separate events too. Put triggered abilities
on the end step where they actually trigger; never defer a trigger across the
next player's untap.

If the game hits the turn cap with multiple players alive, stop and name the
leader rather than inventing a win.

## 3c. Recorded decisions

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

## 3d. Politics

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

## 3e. Combat

The defending seats are players, not a damage sponge. Play every combat as
three events — `attack`, `block`, `damage` — with the fields in
[schema.md](schema.md#combat).

**Declaring attackers.** For each attacker, name the defending player,
planeswalker, or battle, tap it unless it has vigilance, and list its
combat keywords. Before committing, look at what each defender can actually
block with: their untapped creatures, their power and toughness, and their
open mana. Record those creatures in `combat.possible_blockers`, so the
reader can see the attack the attacking seat chose to make.

An attack that hands the defender a free kill is a pilot error, not flavor. A
4/4 swinging into ten untapped 1/1s and a 3/5 is a gift unless the attacking
seat has a stated reason: lethal on another seat, trample or evasion, a
pump or protection spell held up, a sacrifice outlet that wants the creature
dead, a deal, or a race where four damage matters more than the body. Put
that reason in `notes` or a `decision` on the `attack` event, or do not
declare the attack.

Taxes: if the defender has a permanent that charges `{1}` per attacker,
those costs are paid from the attacking seat's mana or the attack is
illegal. Record the payment in `notes`.

**Declaring blockers.** Every defending seat answers with its own `block`
event, including one that blocks nothing. Block the way that seat would: a
free or profitable block, a chump block that saves lethal, or a gang block
that kills the attacker. Declining a block that would kill the attacker for
nothing is a pilot error unless the seat has a reason it would say out loud
— those creatures are food for a sacrifice outlet this turn, they are held
for a bigger attacker, the deck wants the life loss for a payoff, or a deal
covers this attack. A `block` event with no blocks needs that reason in
`decision`.

**Damage.** Assign combat damage from the blocks actually declared: blocked
attackers hit their blockers, trample spills over, unblocked attackers hit
the defending player, and creatures with lethal damage die in the same event.
Type every entry: `"type": "combat"` in the combat damage step, and
`"type": "noncombat"` for burn, drains, pingers, and damage triggers. Magic
keys "whenever ~ deals combat damage" triggers and commander damage off that
split, so a summary says "deals 4 combat damage" only when it is combat
damage.

## 3f. Continue

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
5. Confirm every combat has `attack`, `block`, and `damage` events, that the
   attackers' tapped state matches the snapshot, and that each damage entry
   is typed `combat` or `noncombat`.
6. Confirm `state.deals` is copied forward after an accepted offer, and that
   a later breach has a `deal` event with `action: "breach"`.
7. Confirm each living seat's commanders still exist in some zone (that
   seat's `command` list, battlefield, graveyard, exile, or hand, or another
   seat's battlefield if stolen).
8. Confirm a `cast` or `play_land` snapshot does not show the new permanent
   tapped unless its Oracle text can enter tapped. Summoning sickness is
   not tapped.
9. Confirm `decision.open_mana` is not far below the number of untapped
   lands in that snapshot.
10. Confirm `decision.reason` does not name a card that exists only in
    another seat's hand.
11. Remove `_libraries`, keep only `library_count`, and write compact JSON to
    `table-games/<slug>.json`.

`render-table-replay` always checks that commanders still exist in a zone.
Run `bun run table:render -- table-games/<slug>.json --strict` on a **new**
recording so illegal ETB taps, impossible `open_mana`, and hidden-card
reasons fail the build. Do not rewrite an old replay to satisfy `--strict`
unless the user asked for a new game.

The replay JSON is the simulation's terminal output. Invoke
`render-table-replay` separately when the user wants it in the React player.
Invoke `review-table` when they want a postmortem of this file or of every
game a deck has on disk.

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

4. If `render-table-replay` was also requested, link its React player URL.
5. Limits: imperfect judging, truncated turns, and that one seed is not a
   metagame.

Do not edit, reassess, or recategorize decks from a table result unless the
user asks to act on it. Grading the line or the 99 from recorded games is
`review-table`, not this skill.
