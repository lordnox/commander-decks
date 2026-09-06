# Live table snapshot

One public "now" frame for the GitHub Pages player. Not a replay. No event
log, no libraries, no other players' hands.

Canonical URL:

```text
https://lordnox.github.io/commander-decks/live?s=<payload>
```

The page also reads a hash payload (`#s=<payload>` or `#<payload>`) when the
query string is empty. Prefer the query form in chat. Hash is the fallback
when a payload is too long for a query.

## Wire payload

1. Compact JSON (`separators=(",", ":")`, UTF-8).
2. `zlib.compress` (RFC 1950 zlib wrapper, default level).
3. URL-safe base64, strip `=` padding.
4. Prefix `v1.`.

Python: `base64.urlsafe_b64encode(zlib.compress(json_bytes)).rstrip(b"=")`.
Browser: `DecompressionStream("deflate")` on the decoded bytes.

Reject unknown prefixes. Do not put libraries or opponent hands in the JSON
before compression.

## Snapshot object (`v: 1`)

| Field | Meaning |
|---|---|
| `v` | `1` |
| `you` | Viewer seat `p1`–`p4`, or omit/`null` on a public link |
| `headline` | Short table title |
| `waiting` | Prompt for the human, e.g. `What do you do?` |
| `talk` | Table talk and the current standing plan |
| `turn` | Turn number |
| `phase` | Same strings as replay: `setup`, `untap`, `upkeep`, `draw`, `main1`, `combat`, `main2`, `end`, `priority` |
| `active` | Active seat |
| `stack` | `{name, controller?, text?}[]` |
| `combat` | Optional replay combat object (attackers, blocks, possible blockers) |
| `seats` | Four seats, `p1`–`p4` clockwise |
| `catalog` | Card name → `{scryfall_uri, image_small, image_normal, type_line?, mana_cost?, oracle_text?, stats?, faces?}` |
| `tokens` | Optional token catalog, same shape as replay |

### Seat

| Field | Meaning |
|---|---|
| `id` | `p1`–`p4` |
| `name` | Brew title |
| `commanders` | Commander names |
| `color` | CSS color |
| `life` | Life total |
| `poison` | Poison counters |
| `commander_damage` | Map of opponent seat → damage |
| `commander_tax` | Tax on the next commander cast |
| `library_count` | Remaining library size |
| `hand_count` | Cards in hand |
| `hand` | Names, **only** when `you` equals this seat |
| `battlefield` | Replay battlefield entries |
| `graveyard` | Names |
| `exile` | Names |
| `command` | Names |
| `revealed_top` | Public revealed tops, or the viewer's private top |

Public encode **must** drop every `hand` array and set `you` to null. Keep
`hand_count`. `revealed_top` stays when the table can see it; private
look-at-top stays only on the matching `you` seat.

## Session file (private, not Pages)

Working hot-seat games may keep `table-games/<slug>.live.json` locally
(gitignored). Shape: replay fields plus `_libraries`, `human` (`p1`–`p4`),
`talk`, `waiting`, and optional `plan` (standing line). Strip `_libraries`
before any public commit. The Pages URL is only the snapshot, never this file.
