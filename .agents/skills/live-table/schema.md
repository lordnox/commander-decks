# Live table snapshot

One public "now" frame for the GitHub Pages player. Not a replay. No event
log, no libraries, no other players' hands.

Always keep the trailing slash on `/live/`. GitHub Pages redirects `/live` to
`/live/`, and a redirect can drop the fragment.

## Conduit links

Hot-seat transport is conduit: Pages watches the `host` bin; **Send plan**
writes the seat inbox. Query params, mint labels, inbox JSON, and watch
frames are frozen in [`CONDUIT.md`](CONDUIT.md). Do not invent extra params.

Private (post this once; later snapshots update bins, not the URL):

```text
https://lordnox.github.io/commander-decks/live/?k=<seatRead>%7C<inboxWrite>
```

Public (Copy public link): `?k=<hostRead>` only. Optional `c` = conduit
origin (no trailing slash). Omit `c` on the default origin.

The `v1` / `v2` payload shapes below still apply: the host and seat bins hold
the same `v2.` snapshot bytes the encoder produces. Payload `?s=` and short
`?game=` links remain valid fallbacks when mint fails.

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
| `talk` | Optional explicit player table talk |
| `waiting` | Optional prompt, default `Would this line work? Confirm or replace it.` |

The page must render only the `you` seat's hand and reduce every other seat to
`hand_count`, even though the fetched replay contains all hands.

**Payload link — for a game that is not published.** Board occupancy plus the
four deck slugs; the browser downloads each deck's card table and may fetch
display details from Scryfall:

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
4. Prefix `v2.` (`v1.` snapshots still decode).

Python: `base64.urlsafe_b64encode(zlib.compress(json_bytes)).rstrip(b"=")`.
Browser: `DecompressionStream("deflate")` on the decoded bytes.

Reject unknown prefixes. Do not put libraries or opponent hands in the JSON
before compression.

## Snapshot object (`v: 2`)

New payload links cite each seat's published 99 instead of repeating names and
Scryfall ids. `site:prepare` writes `site/public/decks/<slug>.json` as
`{cards:[{n,id,a?}]}` in `cards.json` order. A card on the table is
`deckIndex * 128 + slot` (`0`–`3` are the four seats, `4` is extras, `5` is
tokens). Seat state is a 9-slot array:

| Index | Contents |
|---|---|
| 0 | `[life, poison, commander_tax, library_count, hand_count]` |
| 1 | commander damage to `p1`–`p4` |
| 2 | commander refs |
| 3 | hand refs, or `0` when hidden |
| 4 | battlefield (int, `[ref, flags]`, or `[ref, flags, extra]`) |
| 5 | graveyard refs |
| 6 | exile refs |
| 7 | command-zone refs |
| 8 | revealed top refs, or `0` when absent |

Battlefield flags: tapped `1`, token `2`, commander `4`. `extra` holds `p` /
`n` / `c` / `f` for power-toughness, note, counters, and face.

| Field | Meaning |
|---|---|
| `v` | `2` |
| `y` | Viewer seat `0`–`3`; omit on a public link |
| `h` | Headline |
| `w` | Prompt; omit when it is `Would this line work? Confirm or replace it.` |
| `k` | Explicit player table talk; omit when empty |
| `j` | Judge note for this bin: full analysis only in its originating private seat bin; generic status everywhere else |
| `u` | `1` when the prompt is addressed to this viewer; omit otherwise |
| `r` | Allowed action bitmask: plan `1`, confirm `2`, replace `4`, pass `8` |
| `i` | Per-seat action ID; play messages must echo it |
| `t` | Turn number |
| `p` | Phase index |
| `a` | Active seat `0`–`3` |
| `q` | Seat the judge is waiting on `0`–`3`; steps past a seat that just ended its turn |
| `d` | Four deck folder slugs |
| `n` | Four brew titles |
| `c` | Four CSS colors; omit when they match the default seat palette |
| `x` | Names that are not in any of the four 99s |
| `g` | Compact catalog for those extras only |
| `o` | Visible tokens as `[key, details]` |
| `z` | Four seat arrays |
| `e` | Up to 20 recent redacted events as `[id, turn, phase, seat, kind, summary]` |
| `s` | Stack: ref, `[ref, controller]`, or `[ref, controller, text]` |
| `m` | Packed combat |

The page fetches `<base>decks/<slug>.json`, rebuilds names and `{id}` catalog
entries, then hydrates through Scryfall as for `v1`.

## Snapshot object (`v: 1`)

Older links still decode. The expanded board the React page renders matches
this object.

| Field | Meaning |
|---|---|
| `v` | `1` |
| `you` | Viewer seat `p1`–`p4`, or omit/`null` on a public link |
| `headline` | Short table title |
| `waiting` | Prompt for the human, e.g. `Would this line work? Confirm or replace it.` |
| `talk` | Explicit player table talk |
| `judge` | Judge note for this viewer; private detail only for the originating seat |
| `youAct` | Whether the prompt is addressed to this viewer |
| `actions` | Play actions currently accepted from this viewer |
| `actionId` | Per-seat ID echoed by the next play action |
| `events` | Up to 20 recent redacted event summaries for the viewer timeline |
| `turn` | Turn number |
| `phase` | Same strings as replay: `setup`, `untap`, `upkeep`, `draw`, `main1`, `combat`, `main2`, `end`, `priority` |
| `active` | Active seat |
| `awaiting` | Seat the judge needs a message from next |
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
`talk`, `waiting`, optional `plan` (standing line), and optional `_conduit`
keys. A gitignored `table-games/<slug>.conduit.json` may hold the same mint
keys (`--conduit-keys`). Strip `_libraries` and all write keys before any
public commit. The Pages URL is only the snapshot (or conduit read keys),
never this file.
