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
| `host` | agent | anyone with the public link | public v2 snapshot bytes (`v2.` zlib payload, **no** `v2.` prefix on the wire — raw compressed payload **or** the same bytes `encode_live.encode_payload` produces including `v2.` prefix). **Use the full `v2.…` ASCII string as the snapshot body** so the page can `openLivePayload`. |
| `p1`…`p4` | agent | that seat | private v2 snapshot (`you` set, hand included) |
| `pN-inbox` | that human | agent | UTF-8 JSON inbox message |

Keys live only in gitignored `table-games/<slug>.live.json` under `_conduit`. Never in a committed replay. Never put write keys or other seats' read keys on a public URL.

## Pages URL

Private:

```text
https://lordnox.github.io/commander-decks/live/?host=<hostRead>&you=p2&seat=<p2Read>&inbox=<p2InboxWrite>
```

Optional `c` = conduit origin (no trailing slash). Omit `c` when it is the default.

Public (Copy public link):

```text
https://lordnox.github.io/commander-decks/live/?host=<hostRead>
```

Keep `/live/` trailing slash. Payload `?s=` and short `?game=` links remain valid fallbacks.

## Inbox JSON

```json
{"type":"plan","text":"…"}
```

`type` is `plan` | `confirm` | `replace`. `text` is the line. POST as `X-Live-Conduit-Kind: snapshot` (replace previous plan) unless appending a follow-up, then `delta` is allowed; the page uses `snapshot`.

## Watch

`wss://<origin>/v1/watch`, first text message `{ "read": "<readKey>", "snapshotsOnly": true }`. Binary frames: `u32 bodyLength | u8 kind | u64 generation | body` (big-endian). `kind` 0 = snapshot.

## Seat layout

On the live page, put the `you` seat first (top-left). Then the other seats in `p1`–`p4` order excluding `you`. Spectators keep `p3, p2, p4, p1`.
