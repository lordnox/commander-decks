# Live table snapshot

One public "now" frame for the GitHub Pages player. Not a replay. No event
log, no libraries, no other players' hands.

Always keep the trailing slash on `/live/`. GitHub Pages redirects `/live` to
`/live/`, and a redirect can drop the fragment.

## Two link forms

**Short link — preferred whenever the game is already published.** The page
fetches the public replay itself, so the URL stays about 80 characters and
survives chat, mail, and phones intact.

```text
https://lordnox.github.io/commander-decks/live/?game=<slug>&event=<id>&you=<seat>
```

| Parameter | Meaning |
|---|---|
| `game` | Published replay slug, fetched from `<base>replays/<slug>.json` |
| `event` | Event id to show; omit for the last event |
| `you` | Viewer seat `p1`–`p4`; omit for a public board |
| `talk` | Optional table talk / standing plan |
| `waiting` | Optional prompt, default `What do you do?` |

The page must render only the `you` seat's hand and reduce every other seat to
`hand_count`, even though the fetched replay contains all hands.

**Payload link — for a game that is not published.** Self-contained game state;
the browser may fetch card display details from Scryfall:

```text
https://lordnox.github.io/commander-decks/live/?s=<payload>
```

The page also reads `#s=<payload>` or `#<payload>` when the query string is
empty. Prefer the query form; use the hash only past 8000 characters. A payload
link over ~6000 characters is fragile in chat, so publish the game and send a
short link instead.

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
| `catalog` | Card name → `{id}` when a Scryfall printing is known, otherwise inline fallback details |
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

### Catalog hydration

When a Scryfall printing is known, payload catalog and token entries contain
only its printing `id`; do not inline rules, faces, image URLs, or other card
details. The browser batches missing IDs into Scryfall collection requests of
at most 75 identifiers and caches the compact display data in the
`commander-cards` IndexedDB database for seven days.

If Scryfall or IndexedDB fails, the payload still renders card names and IDs;
hydration is an enhancement, not a requirement for opening the board. Entries
without a recoverable printing ID retain their inline fallback details.

Published replay short links use the replay's full catalog and do not hydrate
through Scryfall. Older payloads carrying explicit rules, faces, or images
remain supported and those explicit fields win over hydrated values.

The encoder snapshots the last event by default; `--event <id>` picks an
earlier frame from the same log.

## Session file (private, not Pages)

Working hot-seat games may keep `table-games/<slug>.live.json` locally
(gitignored). Shape: replay fields plus `_libraries`, `human` (`p1`–`p4`),
`talk`, `waiting`, and optional `plan` (standing line). Strip `_libraries`
before any public commit. The Pages URL is only the snapshot, never this file.
