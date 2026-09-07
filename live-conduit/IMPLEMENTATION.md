# live-conduit — implementation plan

Capability-keyed **append-only blob log** with snapshot/delta frames, size quotas, 5-day idle TTL, and WebSocket fanout. The server never inspects payload bytes. No user accounts.

This file is the source of truth. Do not invent extra endpoints, JSON wrappers around blobs, or game-specific logic (no Magic, no Scryfall, no Commander).

Product name: **live-conduit**  
Repo / binary / Docker image: `live-conduit`  
Env prefix: `LIVE_CONDUIT_`

---

## How to run several agents at once

### Frozen contract

Section [Protocol](#protocol) and the file tree below are locked. If `src/protocol.ts` is missing, the first agent to touch it **creates it verbatim from this document**. Nobody else edits it.

### File ownership (do not cross)

| Agent | Owns | Must not touch |
|---|---|---|
| **A — scaffold** | `package.json`, `tsconfig.json`, `src/protocol.ts`, `src/index.ts` (thin compose), `.gitignore` | store/http/ws internals |
| **B — store** | `src/store.ts`, `src/store.test.ts` | HTTP, WebSocket |
| **C — HTTP** | `src/http.ts`, `src/http.test.ts` | SQLite, WebSocket |
| **D — watch** | `src/watch.ts`, `src/watch.test.ts` | SQLite schema, HTTP routes except calling watch helpers |
| **E — ship** | `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md` | feature code |

**A** should finish first if you serialize. If you launch **B–E in parallel** with **A**: copy `src/protocol.ts` from this doc immediately so imports resolve.

**F — integrate** starts only when B–D are green: wire `index.ts`, add `src/server.test.ts` (end-to-end against listen), fix collisions.

Paste [Agent briefs](#agent-briefs) as each agent’s first message. Tell each agent the repo path and “read `IMPLEMENTATION.md` first.”

---

## Target layout

```text
live-conduit/
  IMPLEMENTATION.md      # this file
  README.md
  package.json
  tsconfig.json
  Dockerfile
  docker-compose.yml
  .env.example
  .gitignore
  src/
    protocol.ts          # types, limits, framing, errors — FROZEN
    store.ts             # SQLite
    http.ts              # mint / append / get / index / delete
    watch.ts             # WebSocket
    index.ts             # listen, compose, expiry loop
  src/*.test.ts
```

Runtime: **Bun** + TypeScript. Arrow functions, no semicolons, return types only when inference fails. `bun test` for tests.

---

## Protocol

### Mental model

```text
bin  = log of frames (independent; mint labels are echo-only)
frame = { generation, kind: snapshot | delta, body, bytes, at }
```

- **snapshot** — complete document. Default `GET` returns the latest snapshot.
- **delta** — opaque follow-up. Server does not apply it. Phone Back uses `?snapshot=N`, not raw deltas, unless the client asked for an exact `?gen=`.

Keys: 32 random bytes, `base64url` without padding (~43 chars). Persist only `sha256(key)` (raw 32-byte digest).

Each bin: **read** key (GET, index, watch) and **write** key (append, prune, destroy).

Prefer `Authorization: Bearer <key>`. Also accept `/v1/bins/{key}` and `/v1/bins/{key}/index` for curl. Watch: `GET /v1/watch` then first **text** message JSON `{ "read", "from"?, "snapshotsOnly"? }`.

### Limits

| Name | Default |
|---|---|
| Idle TTL | **5 days** (`432000` s) from last successful append; mint with no append still expires after TTL from mint |
| Max TTL override | 5 days |
| Min TTL override | 3600 s |
| Per-frame body | 1 MiB (`1048576`) |
| Per-bin total bytes | 32 MiB (`33554432`) |
| Index JSON cap | 256 KiB |
| Range body cap | 2 MiB per response |
| Watchers / bin | 32 |
| Append rate | 10 / s / bin |
| Mint rate | 30 / min / IP |
| Labels / mint | 1–16, `/^[a-z0-9-]{1,32}$/`, unique in the request |

Mint may set `quotaBytes` per label (still ≤ 32 MiB). Default quota 32 MiB.

### Quota headers (every append, GET body, GET index)

```http
X-Live-Conduit-Generation: 84
X-Live-Conduit-Head-Generation: 84
X-Live-Conduit-Used-Bytes: 1192033
X-Live-Conduit-Limit-Bytes: 33554432
X-Live-Conduit-Frame-Limit-Bytes: 1048576
X-Live-Conduit-Expires-At: 1773600000
```

`X-Live-Conduit-Generation` on default GET is the **snapshot’s** generation. `Head-Generation` is the log head (may be a trailing delta).

Expose those headers in CORS: `Access-Control-Expose-Headers`.

### Binary frame prefix (range GET and WebSocket binary)

Big-endian:

```text
u32 bodyLength | u8 kind | u64 generation | body
kind: 0 = snapshot, 1 = delta
```

`bodyLength` is the body size only (not including the 13-byte header).

### `src/protocol.ts` (create verbatim)

```ts
export const DEFAULT_TTL_SECONDS = 432000
export const MIN_TTL_SECONDS = 3600
export const MAX_TTL_SECONDS = 432000
export const FRAME_LIMIT_BYTES = 1048576
export const BIN_LIMIT_BYTES = 33554432
export const INDEX_LIMIT_BYTES = 262144
export const RANGE_LIMIT_BYTES = 2097152
export const MAX_WATCHERS = 32
export const APPEND_PER_SEC = 10
export const MINT_PER_MIN = 30
export const MAX_BINS_PER_MINT = 16
export const LABEL_RE = /^[a-z0-9-]{1,32}$/

export const KIND_SNAPSHOT = 0
export const KIND_DELTA = 1

export type Kind = "snapshot" | "delta"

export const kindToByte = (kind: Kind) =>
  kind === "delta" ? KIND_DELTA : KIND_SNAPSHOT

export const byteToKind = (byte: number): Kind | null => {
  if (byte === KIND_SNAPSHOT) return "snapshot"
  if (byte === KIND_DELTA) return "delta"
  return null
}

export const encodePrefix = (kind: Kind, generation: number, body: Uint8Array) => {
  const out = new Uint8Array(13 + body.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.byteLength)
  out[4] = kindToByte(kind)
  view.setBigUint64(5, BigInt(generation))
  out.set(body, 13)
  return out
}

export const decodePrefix = (bytes: Uint8Array) => {
  if (bytes.byteLength < 13) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bodyLength = view.getUint32(0)
  const kind = byteToKind(bytes[4] ?? 255)
  const generation = Number(view.getBigUint64(5))
  if (kind == null || bytes.byteLength !== 13 + bodyLength) return null
  return { kind, generation, body: bytes.subarray(13) }
}

export type MintRequest = {
  bins: string[]
  ttlSeconds?: number
  quotaBytes?: Record<string, number>
}

export type KeyPair = { read: string; write: string }

export type FrameRow = {
  generation: number
  kind: Kind
  body: Uint8Array
  bytes: number
  at: number
}

export type IndexJson = {
  head: number
  latestSnapshot: number | null
  usedBytes: number
  limitBytes: number
  expiresAt: number
  frames: { gen: number; kind: Kind; bytes: number; at: number }[]
}
```

---

## HTTP

JSON only for mint, index, errors, health. Blobs are `application/octet-stream`.

### `GET /health`

`200` `{ "ok": true }`

### `POST /v1/mint`

```json
{
  "bins": ["host", "p1", "p1-inbox", "p2", "p2-inbox", "p3", "p3-inbox", "p4", "p4-inbox"],
  "ttlSeconds": 432000
}
```

`201`:

```json
{
  "ttlSeconds": 432000,
  "bins": {
    "host": { "read": "…", "write": "…" }
  }
}
```

Do not store label grouping. Losing this response loses the keys.

### `POST /v1/bins/{writeKey}` (append)

- Body = raw bytes  
- Header `X-Live-Conduit-Kind: snapshot | delta` (default `snapshot`)  
- `201` empty body + quota headers  
- Generation starts at `1`, gapless, +1 per append  
- No in-place overwrite  

### `GET /v1/bins/{readKey}`

Latest **snapshot** body (skip trailing deltas).

- `200` + quota headers (Generation = that snapshot)  
- `204` if the bin exists but has no snapshot yet  
- `404` unknown / expired  

### `GET /v1/bins/{readKey}?gen=N`

Exact frame `N`. `404` if pruned or missing.

### `GET /v1/bins/{readKey}?snapshot=N`

Newest snapshot with `generation <= N`. `404`/`204` if none.

### `GET /v1/bins/{readKey}?from=A&to=B`

Concatenated prefixed frames `A..=B`. If over 2 MiB, `416` with `X-Live-Conduit-Next-Gen` set to the first generation not included.

### `GET /v1/bins/{readKey}/index`

`IndexJson` as above. No bodies. If JSON would exceed 256 KiB, omit `frames` and add `"truncated": true` plus `head` / `usedBytes` (still useful for quota).

### `DELETE /v1/bins/{writeKey}?until=N`

Drop frames with `gen <= N`. Head generation does not reset. `204`.

### `DELETE /v1/bins/{writeKey}`

Destroy bin + watchers. `204`. Watch close code `4003`.

### Errors

| Status | `error` |
|---|---|
| 404 | `not_found` |
| 413 | `frame_too_large` or `bin_full` |
| 416 | `range_too_large` |
| 429 | `rate_limited` |
| 400 | `bad_request` |

`413` example:

```json
{
  "error": "bin_full",
  "usedBytes": 33554400,
  "limitBytes": 33554432,
  "frameLimitBytes": 1048576
}
```

Bearer vs path: if both present, they must match.

---

## WebSocket

`GET /v1/watch` → 101. First message must be text JSON:

```json
{ "read": "<readKey>", "from": 83, "snapshotsOnly": true }
```

Then:

1. If `snapshotsOnly` (or `from` omitted): send latest snapshot as **one prefixed binary frame** (or skip if none).
2. If `from: N`: do not backfill `1..N`; afterwards only push generations `> N`.
3. Each append: one prefixed binary frame. If `snapshotsOnly`, skip deltas.
4. Server ping every 20s; drop after 60s silence.
5. Max 32 watchers; extra connect closes `4004`.
6. Unknown key `4001`, expired `4002`, deleted `4003`.

CLI hosts may poll HTTP only. Both paths are required.

---

## Store (SQLite)

Single file `LIVE_CONDUIT_DB` (default `./live-conduit.db`).

```sql
CREATE TABLE bins (
  read_hash  BLOB PRIMARY KEY,
  write_hash BLOB UNIQUE NOT NULL,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  limit_bytes INTEGER NOT NULL,
  head INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE frames (
  read_hash BLOB NOT NULL,
  generation INTEGER NOT NULL,
  kind INTEGER NOT NULL,
  body BLOB NOT NULL,
  bytes INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (read_hash, generation)
);
```

Sweep expired bins (and their frames) every 30s. `GET`/`POST`/`watch` on expired hash → 404 / 4002 and delete.

Hash: SHA-256 of the **decoded** key bytes (not the base64 string).

Key generate: `crypto.getRandomValues(32)` → base64url, strip `=`.

Restart must keep blobs. Watchers are memory-only; clients reconnect.

---

## HTTP server notes

- `LIVE_CONDUIT_PORT` default `8787`
- `LIVE_CONDUIT_ORIGINS` comma list. Production must not default to `*`. Include a flag `LIVE_CONDUIT_CORS_ALL=0`. Tests may set `*`.
- HTTPS is the reverse proxy’s job.
- Do not log keys or bodies. Log `read_hash` hex prefix (8 chars) only.
- No `GET /v1/bins` directory.

---

## Tests (must exist)

Store + HTTP + watch unit tests, plus one e2e file:

1. Mint 9 bins → 18 unique keys; hashes ≠ tokens  
2. GET before append → 204  
3. Append snapshot then GET exact bytes (including NULs)  
4. Read cannot append; write cannot GET  
5. Two snapshots + trailing delta → default GET is snapshot 2; `Head-Generation` is 3  
6. `?gen=3` is the delta; `?snapshot=3` is snapshot 2  
7. Range `from=1&to=3` round-trips via `decodePrefix`  
8. Index `usedBytes` equals sum of frame lengths  
9. Oversize frame → 413, log unchanged  
10. Append that would exceed bin quota → `bin_full`, unchanged  
11. `DELETE ?until=2` then `gen=1` is 404; later gens remain  
12. Idle expiry (test TTL 1s) wipes frames  
13. Two watchers: both get snapshot; append; both receive the same prefixed bytes  
14. `snapshotsOnly` watch does not emit a delta  
15. CORS preflight from a configured origin exposes quota headers  

---

## Docker / run

```text
bun src/index.ts
```

`Dockerfile`: `oven/bun` (or distroless + bun binary), volume for the db.

`docker-compose.yml`: port `8787:8787`, volume `live-conduit-data`.

`.env.example`:

```text
LIVE_CONDUIT_PORT=8787
LIVE_CONDUIT_DB=/data/live-conduit.db
LIVE_CONDUIT_ORIGINS=https://lordnox.github.io
LIVE_CONDUIT_CORS_ALL=0
```

README: what it is, mint example with `curl`, watch is out of scope for a one-liner, **not** WebRTC.

---

## Agent briefs

Copy one brief per agent. They share this repo. Commit on their own files only.

### Agent A — scaffold

Create `package.json` (`name`: `live-conduit`, scripts `start` / `test` via bun), `tsconfig.json` (strict, `src`), `.gitignore` (`node_modules`, `*.db`, `.env`), and `src/protocol.ts` **exactly** as in IMPLEMENTATION.md. `src/index.ts` should export a `start(env)` that will later call store/http/watch; until those exist, listen `/health` only. Do not implement bins.

### Agent B — store

Implement `src/store.ts` against SQLite (bun:sqlite). API: `mint`, `append`, `getLatestSnapshot`, `getExact`, `getSnapshotAtOrBefore`, `getRange`, `index`, `pruneUntil`, `destroy`, `touchExpiry` as needed, `sweepExpired`, `getBinByReadHash`, `getBinByWriteHash`. No HTTP. Tests in `src/store.test.ts` covering items 1–4, 8–12 at the store layer (generate keys in the test). Enforce quotas and TTL using constants from `protocol.ts`.

### Agent C — HTTP

Implement `src/http.ts`: a `fetch(req, ctx)` (or Bun `{ fetch }`) that uses a `Store` interface matching B (import type from `store.ts` or a small `src/storeTypes.ts` **only if B has not landed**; if you create `storeTypes.ts`, B must switch to it). Cover mint, append, all GETs, deletes, health, CORS, bearer vs path, rate limits (in-memory maps). Tests with a fake in-memory store if `store.ts` is incomplete; switch to real store when present. Do not implement WebSocket.

### Agent D — watch

Implement `src/watch.ts`: attach to Bun websocket, hub `Map<hexReadHash, Set<ws>>`, broadcast on append (C or index must call `hub.publish(readHash, prefixedBytes, kind)` — define `WatchHub` in `watch.ts`). Tests: fake ws sockets or bun’s websocket client against a tiny listener. Close codes 4001–4004. `snapshotsOnly` filter.

### Agent E — ship

Dockerfile, compose, `.env.example`, README (protocol summary + curl mint/append/get). No product code. Mention 5-day TTL and that bodies are opaque.

### Agent F — integrate (after A–D)

Wire `src/index.ts`: open db, sweep interval, HTTP + watch on one port, publish to hub after successful append. Add `src/server.test.ts` for the full numbered test list against `127.0.0.1`. Fix import/type mismatches without changing protocol. `bun test` must pass.

---

## Out of scope

Auth beyond keys, listing bins, JSON Patch, applying deltas on the server, relating bins after mint, TLS in-process, Commander/live UI clients.

## Acceptance

A host can mint the 9-bin bundle, append NUL-containing snapshots and deltas to `host`, and a second machine’s `GET` of a `p2` **read** key returns only `p2`’s latest snapshot. `GET ?snapshot=<gen-1>` returns the previous snapshot. `/index` shows sizes. Idle 5 days deletes the bin. The process never parses body bytes as JSON unless the client sent JSON to `/v1/mint`.
