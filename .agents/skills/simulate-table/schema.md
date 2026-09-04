# Table replay JSON

`render_replay.py` expects `schema: 1`. Snapshots are the source of truth for
the viewer; it does not apply Magic rules.

## Top level

| Field | Meaning |
|---|---|
| `schema` | `1` |
| `seed` | Deal seed |
| `starting_life` | Usually `40` |
| `headline` | One-line result |
| `result` | `{winner, ended, turn, summary}` — `ended` is `win`, `draw`, or `truncated` |
| `seats` | Four objects, `id` `p1`–`p4` |
| `catalog` | Map of card name → `{scryfall_uri, image_small, image_normal, type_line, mana_cost, oracle_text}` |
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
          "commander": false,
          "counters": {},
          "note": ""
        }
      ],
      "graveyard": [],
      "exile": [],
      "command": ["Lady Evangela"]
    }
  }
}
```

Battlefield entries may omit `token`, `commander`, `counters`, and `note`.
Do **not** put remaining library names in `state`.
