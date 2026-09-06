# Table replay JSON

`simulate-table` writes `schema: 2`. `render-table-replay` validates and
renders it. Snapshots are the source of truth for the viewer; the renderer
does not apply Magic rules.

Schema 2 adds the [combat record](#combat): declared attackers, declared
blockers, and damage typed as combat or non-combat. Schema 1 files are legacy
recordings that predate it; they still render, and the renderer does not
demand combat detail from them.

## Top level

| Field | Meaning |
|---|---|
| `schema` | `2` (`1` is a legacy replay without combat records) |
| `planning` | Optional planning contract version. New deals write `1`; old replays omit it. |
| `seed` | Deal seed |
| `starting_life` | Usually `40` |
| `headline` | One-line result |
| `result` | `{winner, ended, turn, summary}` — `ended` is `win`, `draw`, or `truncated` |
| `horizon` | Optional `{throughTurn, extraTurns, fromTurn}` — stop after this turn unless someone wins sooner |
| `seats` | Four objects, `id` `p1`–`p4` |
| `references` | Mixed array of players, cards, and deals; index is the ID |
| `catalog` | Map of card name → `{scryfall_uri, image_small, image_normal, type_line, mana_cost, oracle_text, stats}`, plus `faces` on cards printed with one image per side |
| `tokens` | Map of exact Scryfall token printing ID → compact token details and images |
| `token_sources` | Map of seat → source card name → exact token printing IDs |
| `events` | Ordered list; index `0` is the opening snapshot |

### Seat

`id`, `name` (brew title), `deck` (path), `commanders`, `plan`, `mulligans`,
`color` (CSS color for the seat chip).

### References

A glossary at the top of the file. Players, cards, and deals share one
array; the ID is the index (`0`, `1`, `2`, …). Structured fields cite that
number. Prose never does: `summary`, `notes`, `decision.reason`, and deal
`terms` use brew titles and Oracle names so a human can read the log without
the table.

```json
"references": [
  { "kind": "player", "name": "The Polyfisher", "seat": "p1", "commander": 4 },
  { "kind": "player", "name": "Unwanted Presents", "seat": "p2", "commander": 5 },
  { "kind": "player", "name": "Foggy Blood Transfusion", "seat": "p3", "commander": 6 },
  { "kind": "player", "name": "Thousand Cuts", "seat": "p4", "commander": 7 },
  { "kind": "card", "name": "Jalira, Master Polymorphist" },
  { "kind": "card", "name": "Jon Irenicus, Shattered One" },
  { "kind": "card", "name": "Lady Evangela" },
  { "kind": "card", "name": "Sygg, River Cutthroat" },
  { "kind": "card", "name": "Yukora, the Prisoner" },
  {
    "kind": "deal",
    "from": 1,
    "to": [3],
    "terms": "Jon will not exile the Yukora copy this turn. Sygg will not target or attack Jon until Jon's next turn. Rug and Vile Consumption are exempt.",
    "if_refused": "Cast Yukora now.",
    "expires": "start of Unwanted Presents' next turn"
  }
]
```

`kind` is `player`, `card`, or `deal`. Seat ids `p1`–`p4` stay on the player
row and in `event.seat` / `state.players` — those are turn-order keys, not
glossary IDs. Card rows hold the Oracle name; images stay in `catalog` keyed
by that name. Deal rows hold the full terms once. Later snapshots keep
`{ "id": 9, "status": "accepted" }`.

Write players first, then cards in catalog key order, then deals in offer
order. `decision.available`, `decision.held`, `deal.from`, `deal.to`,
`decision.honors_deal`, and `event.cards` use indexes. Zone lists stay as
card names so a snapshot is readable without the table. Old replays may omit
`references`.

## Event

| Field | Meaning |
|---|---|
| `id` | Integer, stable |
| `turn` | `0` during setup |
| `phase` | `setup`, `planning`, `untap`, `upkeep`, `draw`, `impact`, `main1`, `combat`, `main2`, `end`, or `priority` |
| `seat` | Acting seat, or `null` |
| `kind` | See below |
| `summary` | Short log line |
| `cards` | Reference indexes or Oracle names to highlight (cast, drawn, attacking) |
| `notes` | Optional rules or politics aside |
| `decision` | Optional why-this-play object; required on a pass that leaves unused mana |
| `plan` | Optional structured game, turn, or impact plan on a `think` event |
| `deal` | Optional table-talk payload on `talk` / `deal` events |
| `combat` | Combat step payload on `attack` / `block` / combat `damage` events |
| `damage` | List of damage entries on a `damage` event |
| `state` | Full public board after the event, including `deals` |

`kind`: `setup`, `keep`, `mulligan`, `draw`, `play_land`, `cast`, `activate`,
`resolve`, `move`, `attack`, `block`, `damage`, `life`, `counters`, `eliminate`,
`win`, `pass`, `note`, `think`, `talk`, `deal`.

Each rejected London candidate gets its own `mulligan` event. Its `cards`
contains the complete seven-card hand and `decision.reason` explains why it
was rejected. The final `keep` event also contains the complete seven-card
candidate; after one or more mulligans, its summary names the cards put on the
bottom while the state snapshot contains the resulting smaller hand.

Every turn after setup needs an `untap` event and a separate normal draw event:

```json
{
  "id": 15,
  "turn": 2,
  "phase": "draw",
  "seat": "p3",
  "kind": "draw",
  "summary": "Osgir draws Plains.",
  "cards": ["Plains"],
  "notes": "",
  "state": {}
}
```

The draw snapshot includes the card in hand and the decremented
`library_count`. Record replacement effects and payments in that event. Extra
draws are additional `draw` events. Do not combine a draw with the spell or
land that follows it.

Split and modal cards are one catalog key using the full `A // B` name, with
faces joined by ` // ` in `type_line` and `oracle_text`. Refer to them by that
full name in `hand`, `battlefield`, and `cards`, and say which face is in play
using the battlefield entry's `face` (see [Faces](#faces)).

## State

```json
{
  "active": "p1",
  "turn": 3,
  "phase": "main1",
  "stack": [{"name": "Counterspell", "controller": "p2", "text": "on Cultivate"}],
  "deals": [
    { "id": 9, "status": "accepted", "offered_event": 162, "resolved_event": 168 }
  ],
  "players": {
    "p1": {
      "life": 37,
      "poison": 0,
      "commander_damage": {"p2": 0, "p3": 0, "p4": 6},
      "commander_tax": 0,
      "library_count": 88,
      "hand": ["Island", "Swords to Plowshares"],
      "battlefield": [
        {
          "name": "Sol Ring",
          "tapped": true,
          "token": false,
          "token_id": null,
          "pt": "",
          "commander": false,
          "counters": {},
          "note": ""
        }
      ],
      "graveyard": [],
      "exile": [],
      "command": ["Lady Evangela"],
      "revealed_top": []
    }
  }
}
```

Battlefield entries may omit `token`, `token_id`, `commander`, `counters`,
`note`, and `face`. `tapped` is physical tap state only. A creature with
summoning sickness stays `tapped: false` unless something actually tapped
it. Do **not** put remaining library names in `state`.

### Decisions

Record why unused mana, attacks, or abilities were left on the table. Attach
`decision` to the `pass`, or emit a preceding `think` event. Old replays may
omit it; new ones must not pass with unused playable spells and no reason.

| Field | Meaning |
|---|---|
| `open_mana` | Untapped mana available right now |
| `available` | Legal plays, as reference indexes |
| `held` | The subset not taken, as reference indexes |
| `held_for` | Short tag: `protection`, `instant speed`, `politics`, `wait for commander`, `unplayable` |
| `play_later` | When the held line will fire, if known |
| `reason` | One or two sentences the seat would actually say, using names not indexes |
| `honors_deal` | Optional deal index this hold is keeping |

```json
{
  "kind": "think",
  "summary": "The Polyfisher has four mana open and does not activate Jalira.",
  "decision": {
    "open_mana": 4,
    "available": [4],
    "held": [4],
    "held_for": "instant speed",
    "play_later": "end step of the opponent to her right, or in response to removal on the fodder",
    "reason": "The ability has no timing restriction. Firing it now costs the chance to sacrifice Artisans if someone points removal at them."
  }
}
```

A `think` or `talk` event uses the phase where the decision happened. Do
not insert one between `untap` and the normal `draw`.

### Plans

Replays with top-level `planning: 1` record concise intentions, not private
chain-of-thought. Every seat creates a `game` plan after keeps and before turn
one. Before each of its untap steps it creates a `turn` plan from information
currently available. Every draw is followed by an `impact` plan that either
restates the still-valid plan with `status: "kept"` or replaces it with
`status: "revised"`. Public reveals, responses, and deals get another impact
update when they materially change the line.

```json
{
  "kind": "think",
  "phase": "planning",
  "seat": "p1",
  "summary": "Death Aspect plans to tutor Living Death and cast it this turn.",
  "plan": {
    "scope": "turn",
    "status": "set",
    "summary": "Tutor Living Death, then cast it.",
    "details": "Beseech the Mirror and Cabal Ritual turn the completed Iname mill into a recovery.",
    "steps": [
      "Untap and resolve mandatory upkeep triggers",
      "Use Cabal Ritual to reach Beseech plus Living Death mana",
      "Rebuild the Spirit board"
    ]
  },
  "state": {}
}
```

`scope` is `game`, `turn`, or `impact`; `status` is `set`, `kept`, or
`revised`. `summary` is the short text shown beside the commander in the
viewer. It must describe the current plan, even when an impact did not change
it. `details` explains the relevant game facts and `steps` is the intended
sequence. Plan events are visible to the replay audience but are not public
table speech and must not be copied into another seat's packet. Use `talk` for
anything opponents hear.

### Politics

`talk` is spoken table talk. `deal` is a state change on an offer (accept,
counter, reject, breach, expire). Put the full terms on the deal row in
`references`. Events and snapshots cite that row's index.

```json
{
  "kind": "talk",
  "seat": "p2",
  "summary": "Unwanted Presents offers Thousand Cuts a deal over Yukora.",
  "deal": {
    "id": 9,
    "action": "offer"
  }
}
```

Terms must be specific, observable, and things the speaker can actually do.
Symmetrical taxes cannot be promised away. Hidden cards cannot be promised
unless the term is conditional on drawing them.

### Combat

One combat is at least three events in the `combat` phase, in order:
`attack` (declare attackers), `block` (declare blockers, even when nobody
blocks), then `damage` (the combat damage step). A lone `damage` event does
not say who attacked whom, what could have blocked, or why it did not, so it
is not a legal record of a combat.

`attack` names every attacker and what it is attacking:

```json
{
  "kind": "attack",
  "phase": "combat",
  "seat": "p3",
  "summary": "Osgir, the Reconstructor attacks Misty Critters.",
  "cards": ["Osgir, the Reconstructor"],
  "combat": {
    "step": "attackers",
    "attackers": [
      {
        "card": "Osgir, the Reconstructor",
        "defender": "p4",
        "pt": "4/4",
        "tapped": false,
        "keywords": ["vigilance"]
      }
    ],
    "possible_blockers": {
      "p4": ["Hazel of the Rootbloom", "Squirrel ×10"]
    }
  }
}
```

| Field | Meaning |
|---|---|
| `step` | `attackers`, `blockers`, `first_strike_damage`, or `combat_damage` |
| `attackers[].card` | Attacking creature, as a reference index or Oracle name |
| `attackers[].defender` | Defending seat id, or the planeswalker or battle attacked |
| `attackers[].pt` | Power and toughness as it attacks, after counters and anthems |
| `attackers[].tapped` | Whether declaring it tapped the creature; `false` needs vigilance or another named reason |
| `attackers[].keywords` | Combat-relevant keywords: flying, menace, trample, deathtouch, first strike, vigilance, protection |
| `possible_blockers` | Per defending seat, the untapped creatures that could legally block this attack; `[]` when the attack cannot be blocked |

`possible_blockers` is read by humans, not resolved against the catalog, so a
repeated token may be written once with a count (`"Squirrel ×10"`). Every other
card in a combat payload is a reference index or an exact Oracle name.

The attacker's `tapped` value must agree with that seat's battlefield snapshot:
a vigilant attacker stays untapped, everything else is tapped in the snapshot
taken after the declaration.

`block` is declared by each defending seat, including the seat that declines:

```json
{
  "kind": "block",
  "phase": "combat",
  "seat": "p4",
  "summary": "Misty Critters blocks Osgir with two Squirrels.",
  "combat": {
    "step": "blockers",
    "blocks": [
      {
        "attacker": "Osgir, the Reconstructor",
        "blockers": ["Squirrel", "Squirrel"]
      }
    ],
    "unblocked": []
  }
}
```

| Field | Meaning |
|---|---|
| `blocks[].attacker` | The attacker being blocked |
| `blocks[].blockers` | Creatures blocking it, in damage assignment order |
| `unblocked` | Attackers this seat let through |

An empty `blocks` list needs a `decision` on the same event explaining why
untapped creatures stayed home — the defender's actual reason, such as saving
Squirrels for a sacrifice outlet, keeping a blocker for a bigger attacker, or
being happy to take four at 15 life. A seat the attack recorded as having no
`possible_blockers` has nothing to explain and needs no reason.

`damage` types every point it deals:

```json
{
  "kind": "damage",
  "phase": "combat",
  "seat": "p3",
  "summary": "Osgir deals 4 combat damage to Misty Critters.",
  "combat": {"step": "combat_damage"},
  "damage": [
    {
      "source": "Osgir, the Reconstructor",
      "target": "p4",
      "amount": 4,
      "type": "combat",
      "commander": false
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `source` | Permanent, spell, or ability dealing the damage |
| `target` | Defending seat id, or the permanent or planeswalker taking it |
| `amount` | Integer |
| `type` | `combat` or `noncombat` |
| `commander` | `true` when it also counts toward commander damage |
| `keyword` | Optional: `trample`, `first strike`, `deathtouch`, `infect`, `lifelink` when it changed the assignment or the result |

Magic keys triggers, replacement effects, and commander damage off the
combat / non-combat split, so a burn spell, a drain, or a damage trigger uses
`"type": "noncombat"`, carries no `combat` field, and sits in the phase where
it happened. Write "deals 4 combat damage" in a summary only for a combat
damage step; other damage is just "deals 4 damage".

### Power and toughness

The viewer prints current power and toughness in the corner of every
battlefield card that has them. It reads the printed values from the catalog
or token entry and applies the `+1/+1` and `-1/-1` counters in that snapshot,
so counters alone need no extra field.

For any other change to the values — an anthem, an Aura or Equipment, a
pump spell, a layer effect, an animated land — record the resulting values
with `pt`:

```json
{"name": "Dryad Arbor", "pt": "5/6", "counters": {"+1/+1": 1}}
```

`pt` is the final value shown, so it already includes counters and the viewer
does not add them again. Use `"power/toughness"`; a characteristic-defining
value may be `*`.

### Counters and effects

`counters` maps a counter kind to its count, spelled the way the card does:
`+1/+1`, `-1/-1`, `charge`, `time`, `loyalty`, `stun`, `oil`. The viewer prints
each kind as a chip in the card's top corner and spells it out on the hover
preview, so a kind it does not know still reads correctly.

`note` carries everything else true about that permanent, as short segments
separated by `;`:

```json
{"name": "Changing Loyalty", "note": "enchanting Sun Titan; goaded"}
```

Each segment becomes its own chip. Goad, attachment (`enchanting`, `equipping`,
`attached`), copy, haste, and the monarch get their own icon; any other segment
gets a neutral dot. Hovering the card lists every segment in full, so write the
segment for a reader rather than as a code: `enchanting Sun Titan`, not
`aura:st`.

### Faces

A card whose sides are printed as separate images — modal double-faced,
transforming, or a double-faced token — carries a `faces` list in its catalog
entry, front side first:

```json
"faces": [
  {
    "name": "Malakir Rebirth",
    "image_small": "https://cards.scryfall.io/small/front/…jpg",
    "image_normal": "https://cards.scryfall.io/normal/front/…jpg",
    "type_line": "Instant",
    "mana_cost": "{B}",
    "oracle_text": "…",
    "stats": ""
  },
  { "name": "Malakir Mire", "type_line": "Land", "…": "…" }
]
```

`deal-table.ts` writes it from the cached Scryfall object, and the renderer
backfills it from `cards/` for replays recorded before the field existed. Cards
printed as one image — split, adventure, Room — have no `faces`.

Name the side in play with the battlefield entry's `face`, using the face name,
`front`, `back`, or the index:

```json
{"name": "Malakir Rebirth // Malakir Mire", "face": "Malakir Mire", "tapped": false}
```

The viewer then draws that side's art, name, and printed power and toughness,
so a transformed creature shows its back-side stats without a `pt`. When `face`
is absent it falls back to the side named in `note` (including `transformed`),
and then to the only side that can be a permanent, which covers an MDFC land
half. Hand, graveyard, exile, command, and `revealed_top` always show the front
side.

### Tokens

Before dealing, `deck:tokens` reads every deck card's cached Scryfall
`all_parts`, fetches each related `component: token` printing, and writes
`decks/<deck>/tokens.json`. The deal copies those entries into top-level
`tokens` and puts each seat's source-card relationships in `token_sources`.

When a source creates a token, use the exact ID it lists:

```json
{
  "name": "Squirrel",
  "token": true,
  "token_id": "977ddd05-1aae-46fc-95ce-866710d1c5c6",
  "tapped": false
}
```

The ID chooses the image and Oracle characteristics. This matters when several
tokens share a name but differ in color, stats, abilities, or art. Tokens
copied from another permanent may omit `token_id` when there is no printed
token matching the copied object.

A double-faced token printing holds two different tokens under one ID, so its
entry carries `faces` and the battlefield entry needs `face` to say which one
is on the table.

### Revealed top of library

`revealed_top` lists library cards the seat may already look at, topmost first,
and the viewer shows them as their own zone. Use it only while an effect grants
that knowledge — [Fblthp, Lost on the
Range](https://scryfall.com/search?q=%22Fblthp%2C+Lost+on+the+Range%22),
[Bolas's Citadel](https://scryfall.com/search?q=%22Bolas%27s+Citadel%22),
[Oracle of Mul Daya](https://scryfall.com/search?q=%22Oracle+of+Mul+Daya%22),
[Future Sight](https://scryfall.com/search?q=%22Future+Sight%22) — or while a
card is revealed to the whole table.

Those cards are still in the library, so they stay inside `library_count`, and
the count must never be smaller than the list. Refresh the list in the next
event whenever the top changes: a draw, a play from the top, a shuffle, or a
scry. Clear it when the effect leaves the battlefield.

## Horizon

`horizon.throughTurn` is the last turn number to play. `table:deal --turns 8`
sets it at the opening keep. `table:continue --turns 3` adds three turns after
the current turn number and writes `<slug>.working.json`, keeping the recorded
replay untouched.

A finished public replay has no remaining library order; continue rebuilds the
leftover cards from public zones and reseeds their order. The working file
carries `_libraries` and the previous `headline` and `result` until the extra
turns are recorded. A finished replay has no `horizon` and no `_libraries`.
