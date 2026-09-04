# Table replay JSON

`simulate-table` writes `schema: 1`. `render-table-replay` validates and
renders it. Snapshots are the source of truth for the viewer; the renderer
does not apply Magic rules.

## Top level

| Field | Meaning |
|---|---|
| `schema` | `1` |
| `seed` | Deal seed |
| `starting_life` | Usually `40` |
| `headline` | One-line result |
| `result` | `{winner, ended, turn, summary}` — `ended` is `win`, `draw`, or `truncated` |
| `horizon` | Optional `{throughTurn, extraTurns, fromTurn}` — stop after this turn unless someone wins sooner |
| `seats` | Four objects, `id` `p1`–`p4` |
| `catalog` | Map of card name → `{scryfall_uri, image_small, image_normal, type_line, mana_cost, oracle_text, stats}` |
| `tokens` | Map of exact Scryfall token printing ID → compact token details and images |
| `token_sources` | Map of seat → source card name → exact token printing IDs |
| `events` | Ordered list; index `0` is the opening snapshot |

### Seat

`id`, `name` (brew title), `deck` (path), `commanders`, `plan`, `mulligans`,
`color` (CSS color for the seat chip).

## Event

| Field | Meaning |
|---|---|
| `id` | Integer, stable |
| `turn` | `0` during setup |
| `phase` | `setup`, `untap`, `upkeep`, `draw`, `main1`, `combat`, `main2`, `end`, or `priority` |
| `seat` | Acting seat, or `null` |
| `kind` | See below |
| `summary` | Short log line |
| `cards` | Names to highlight (cast, drawn, attacking) |
| `notes` | Optional rules or politics aside |
| `state` | Full public board after the event |

`kind`: `setup`, `keep`, `mulligan`, `draw`, `play_land`, `cast`, `activate`,
`resolve`, `move`, `attack`, `block`, `damage`, `life`, `counters`, `eliminate`,
`win`, `pass`, `note`.

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
using the battlefield entry's `note`.

## State

```json
{
  "active": "p1",
  "turn": 3,
  "phase": "main1",
  "stack": [{"name": "Counterspell", "controller": "p2", "text": "on Cultivate"}],
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
and `note`.
Do **not** put remaining library names in `state`.

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
