# Live-conduit contract

Frozen for the `/live` + `live-table` cut. Do not invent extra query params or inbox fields.

## Service

- Default origin: `https://conduit.app.kopelke.online`
- Override: `LIVE_CONDUIT_URL` (agent/python) or `?c=` / `import.meta.env.VITE_LIVE_CONDUIT_URL`
- Mint: `POST /v1/mint` with `LIVE_CONDUIT_API_KEY` as `Authorization: Bearer` or `X-API-Key`
- Key source: process env, else `~/.config/commander-decks/live-conduit.env` (shared across worktrees; never committed)
- Production may still accept mint without a key until that deploy lands; the client always sends the key when set

## Bins (mint labels, unique)

`host`, `p1`, `p1-inbox`, `p2`, `p2-inbox`, `p3`, `p3-inbox`, `p4`, `p4-inbox`

| Label | Write | Read | Body |
|---|---|---|---|
| `host` | host | spectators | public v2 snapshot (`v2.` string as body) |
| `p1`…`p4` | host | that seat | private v2 snapshot (`y` set, hand included) |
| `pN-inbox` | that seat | host | UTF-8 JSON |

Never put host write in an invite.

## Chat invite (one string)

```text
<readKey>|<mailboxWrite>
```

- `readKey` — GET/watch this bin. **Host read** = public table (no hands). **Seat read** = that seat’s private NOW (`y` set, hand included).
- `mailboxWrite` — POST that seat’s inbox. Omit for spectate (readKey only).

Pages: `/live/?k=<readKey>` or `/live/?k=<readKey>%7C<mailboxWrite>`. Optional `c`. Trailing slash on `/live/`.

Do not put `you` or `seat` in the URL. After decode, `you` is snapshot `y`. Spectators omit `y`. Copy public link = host read only.

### What `you` and `seat` used to do

- `you=p2` — UI whose hand / order. Redundant if the body has `y`.
- `seat=` — extra read key next to `host=`. One `k=` replaces both: the key you hold is the board you see.

One host-read key: everyone with it sees the same public game. A seat pipe string is a different read key (that hand). Payload `?s=` and `?game=` stay as fallbacks.

## Inbox JSON

```json
{"type":"plan","text":"…","actionId":7}
```

`type` is `plan` | `confirm` | `pass` | `replace` | `join` | `ready` | `rules` | `talk` | `swap` | `pregame`.
POST as snapshot (latest wins). Host does not record agent vs human.

`pass` means no game action in the current priority window. `talk` is social
speech visible to every player; never use it as a pass or host-control message.
Play actions (`plan`, `replace`, `confirm`, `pass`) must echo the current
snapshot `actionId`. The host rejects a missing or stale ID and any action not
listed in that snapshot's `actions`. IDs are per seat, so several responders
may answer the same priority window concurrently without invalidating each
other.

Plan checks and rules discussions are private. The originating seat bin gets
the complete judge response. Every other seat bin and the public host bin get
only a generic status such as `Tea Party submitted a plan and is conferring
with the judge.` Do not publish a merely card-name-redacted analysis: mana,
timing, and strategic clues can still reveal the private line.

### Lobby (host script)

Publish only explicit player **table talk** on snapshot `k`. Snapshot `j` is
the generic host status in public and other-seat bins, but the complete judge
response in the originating seat's private bin.

1. **Gather** — four `join`s (name + deck). Host binds each mailbox → `pN`.
2. **Seat** — host announces assignment (`p1` … `p4` clockwise) in talk and asks if anyone wants to swap. `swap` names the other seat (or free text in `talk`). Host asks the table; if **all four** agree, those two **exchange pipe invites** (bins stay `p1`–`p4`; people trade keys). Then host re-announces seating.
3. **Dice** — d20s (or one roll + clockwise). First player + turn order in talk and snapshot `a`.
4. **Pregame** — in **turn order** (starting player first), host asks that seat for pregame (Leyline, Gemstone Caverns, …). Seat replies `{ "type": "pregame", "cards": ["…"] }` or skip. Host applies, then the next seat. Host is the judge.
5. **Start?** — host asks if the game can begin. Each seat `{ "type": "ready" }`. Any new `talk`/`swap` about seating **clears ready** and returns to step 2 or 4 as needed. Four `ready` → deal/play.

`waiting` on the snapshot is the current host prompt (`p2: pregame?`, `Can we start?`).

## Watch

`wss://<origin>/v1/watch`, first text `{ "read": "<readKey>", "from"?, "snapshotsOnly": true }`. Prefix: `u32 bodyLength | u8 kind | u64 generation | body`. `kind` 0 = snapshot.

## Seat layout

Snapshot `you` / `y` first (top-left). Spectators (no `y`): `p3, p2, p4, p1`.
