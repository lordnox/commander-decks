# Live table — implementation plan

Build a long-running Bun host/seat so Cursor chat does not poll conduit, and
align Pages + encode + the live-table skill with the frozen invite string.

Protocol: `.agents/skills/live-table/CONDUIT.md`  
Layout and CLI: `live-runner/IMPLEMENTATION.md`  
Do not invent bins, query params, or inbox `type`s.

---

## Assumptions

- One table = nine bins. Host is the only writer of `host` and `p1`–`p4`.
- A seat is a capability (`read|mailbox`). Host does not care who pilots it.
- Table talk (`k`) and `waiting` are always host-authored on the snapshot.
- v1 play still uses existing `encode_live.py` / `table:deal`. No LLM brain.
- Local agents may daemonize the runner. Cloud VMs must not be the host.

## Already done

- Conduit Python client, mint/append/GET/watch, `encode_live.py --conduit`
- Pages GET + WSS decode (`site/src/liveConduit.ts`)
- Inbox Send for `plan` (old query: `host` / `you` / `seat` / `inbox`)
- Gitignore for `*.conduit.json` and planned `*.runner.*`

## Success (v1)

1. `host --fg` mints, prints four pipe invites + spectator, stays on WSS.
2. Four `join`s → host assigns `pN` in talk → optional unanimous swap → d20
   → pregame in turn order → four `ready` → deal.
3. Pages `/live/?k=<read>` and `/live/?k=<read>%7C<mailbox>` work; `you` from
   snapshot `y`. Spectator `k` = host read only.
4. `resume --slug` after kill does not remint; watch uses `from: lastGen`.
5. Agent start: pid + log, no AwaitShell; `stop --slug` is idempotent.

---

## Phase 0 — freeze files, no features

1. Point skill, schema, `table-games/README.md` at `?k=` (drop `you`/`seat`
   from the live URL). Keep payload `?s=` and short `?game=` as fallbacks.
2. `src/protocol.ts`: invite parse/format, inbox union, lobby phases
   (`gathering` | `seated` | `pregame` | `ready` | `play` | `ended`).
3. Gitignore: `*.runner.json`, `*.runner.log`, `*.runner.pid`,
   `*.invite-p*.json`.

Done when: skill examples match CONDUIT.md; protocol tests pass without I/O.

## Phase 1 — conduit + persist (no Magic)

| File | Does |
|---|---|
| `src/conduit.ts` | mint, GET, POST snapshot, DELETE; load mint key like Python |
| `src/watch.ts` | WSS prefix decode (same 13-byte layout as `liveConduit.ts`); reconnect + backoff |
| `src/session.ts` | read/write `table-games/<slug>.runner.json` + pid/log paths |
| `src/log.ts` | append-only lines |

Done when: tests for prefix, invite round-trip (no host.write on seat invite),
session save/load, resume skips mint if `.conduit.json` exists.

## Phase 2 — CLI + background

`cli.ts`: `host` | `seat` | `resume` | `stop`. `--fg` vs daemon (nohup recipe
in IMPLEMENTATION.md). `package.json`: `table:run`, `table:run:bg`.

Done when: `stop` with stale pid exits 0; `resume` with live pid prints
already running.

## Phase 3 — host lobby (the product)

Host loop only. Empty/lobby snapshots still `v2.` with talk + `waiting`;
hands empty until deal.

```
gathering → seated → (dice) → pregame → ready → play
                 ↑_________________|
                 seating talk/swap clears ready
```

| Phase | Host prompt (`waiting`) | Inbox that advances |
|---|---|---|
| gathering | `Waiting for players (n/4)` | `join` (name, deck) → bind mailbox → `pN` |
| seated | `Seats: p1 … p4. Swap or stay?` | `swap` / `talk`; all four agree → people trade pipes; bins stay `p1`–`p4` |
| (dice) | `Rolling turn order` | host rolls; write first player into snapshot `a` and talk |
| pregame | `pN: pregame?` (turn order, starting player first) | `pregame` `{cards}` or skip; host applies, next seat |
| ready | `Can we start?` | four `ready`; seating talk/`swap` → seated |
| play | from simulate-table pause policy | `plan` / `confirm` / `pass` / `replace` / `talk` / `rules` |

Host always posts talk after a step. `rules` and `talk` never skip a lobby
step; they append to `k`. Host answers rules in talk (no engine).

Deal only after four `ready`. Then existing encode path: public `host` +
per-seat `pN`.

Done when: mock test walks join → swap-agree → dice → two pregames → ready
cleared by seating talk → four ready → `play`.

## Phase 4 — seat runner

Parse `read|mailbox` or JSON file. POST `join`. Watch `readKey`. Persist
`lastGen`. Never mint.

Done when: second terminal `seat --invite` shows in host log.

## Phase 5 — Pages + encoder (same invite)

1. `liveCodec.ts`: parse `k` (split on first `|`). `you` from snapshot after
   decode. Keep reading legacy `host`/`you`/`seat`/`inbox` so old links work
   until they rot.
2. Copy public link = `?k=<hostRead>` only.
3. Send: `plan` | `confirm` | `pass` | `replace` plus lobby types the human needs
   (`join`, `ready`, `swap`, `pregame`, `talk`). Keep the form small: type
   dropdown or one JSON box is enough for v1.
4. `encode_live.py` prints pipe URLs (`?k=`), not `host=&you=&seat=&inbox=`.
5. Tests: `liveCodec.test.ts`, `tests/test_live_table.py`.

Done when: `bun run test:site` + live-table unittests; empty state copy uses
`?k=`.

## Phase 6 — play pause (host only, still no brain)

On `play`: watch inboxes; on `plan` encode + `waiting`; on `confirm` call
existing simulate-table apply (Python subprocess is fine); append snapshots;
on `replace` treat as new plan. `talk`/`rules` update `k` without advancing
the stack.

Done when: one scripted confirm round-trip with a fixture replay (no live
LLM).

---

## Out of scope (do not start)

Ollama / Cursor SDK seat brains, mint-auth Portainer deploy, replacing
GitHub Pages, server-side deltas, Oracle engine, committed runner session
files, printing mint keys.

## Order

0 → 1 → 2 → 3 → 4 in `live-runner/`. Phase 5 can start after 0 (Pages is
independent of Bun). Phase 6 last.

Ship on `agent/live-hotseat-conduit` (PR already open). One PR is enough
unless Pages needs to land before the runner.
