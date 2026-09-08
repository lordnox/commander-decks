# live-runner — implementation plan

Long-running Bun process that hosts or sits at a live table. It is the event
loop: WebSocket to conduit, state on disk, brains only on a frame. Cursor
chat does not poll.

Source of truth for the first cut. Do not invent extra bins, query params, or
inbox types beyond `.agents/skills/live-table/CONDUIT.md`.

Product: live-runner
Entry: `bun live-runner/src/cli.ts`
Mint key: `LIVE_CONDUIT_API_KEY` or `~/.config/commander-decks/live-conduit.env`

---

## How to run several agents at once

Frozen: CLI, persist files, watch client, invite JSON. If `src/protocol.ts`
is missing, the first agent creates it from this document. Nobody else edits it.

| Agent | Owns | Must not touch |
|---|---|---|
| A — scaffold | scripts, `src/cli.ts`, `src/protocol.ts`, gitignore lines | HTTP/WS internals |
| B — conduit | `src/conduit.ts`, `src/watch.ts`, tests | CLI, brains |
| C — persist | `src/session.ts`, tests | brains, Magic |
| D — host | `src/host.ts`, tests | seat play loop |
| E — seat | `src/seat.ts`, tests | mint |
| F — ship | `live-runner/README.md`, `table:run` / `table:run:bg` | feature code |

F after A–E. Optional G — brain later (Ollama / Cursor SDK). First cut: inbox
JSON in, snapshots out via existing `encode_live.py`. No LLM required to ship
lobby + resume.

---

## Target layout

```
live-runner/
  IMPLEMENTATION.md
  README.md
  src/
    protocol.ts
    cli.ts
    conduit.ts
    watch.ts
    session.ts
    host.ts
    seat.ts
    log.ts
  src/*.test.ts
```

Arrow functions, no semicolons, return types only when inference fails.
`bun test live-runner`.

---

## Protocol (`src/protocol.ts`)

Same binary, different subcommand:

```
bun live-runner/src/cli.ts host --slug <slug> --human p1 --decks d1,d2,d3,d4
bun live-runner/src/cli.ts seat --invite <file-or-json>
bun live-runner/src/cli.ts resume --slug <slug>
bun live-runner/src/cli.ts stop --slug <slug>
```

`host` mints (or reuses `table-games/<slug>.conduit.json`), writes session,
prints four invites, watches all four inboxes until start. After start,
watches inboxes and writes `host` plus each `pN` snapshot.

`seat` never mints. Loads one invite (that seat only), posts `join`, watches
`host` read. Agent seats: on `waiting`, post plan/confirm when a brain exists;
until then log and idle.

Human `/live-game` does not use this process. Pages + Cursor chat.

### Invite (seat-safe)

Also written as `table-games/<slug>.invite-p2.json` (gitignored):

```
{
  "v": 1,
  "origin": "https://conduit.app.kopelke.online",
  "slug": "tea-party",
  "you": "p2",
  "hostRead": "...",
  "seatRead": "...",
  "seatWrite": "...",
  "inboxWrite": "...",
  "inboxRead": "..."
}
```

Host prints this and the Pages private URL. Never include other seats' keys or
host write.

### Inbox

Keep `{ "type": "plan"|"confirm"|"replace", "text": "..." }`.

Add:

```
{ "type": "join", "you": "p2", "name": "Mishra brew title", "deck": "decks/..." }
{ "type": "ready", "you": "p2" }
```

`join` is a snapshot on that seat's inbox (replace). Host starts when every
non-human seat has `join`. `--human` may skip join (Pages player).

### Session file

`table-games/<slug>.runner.json` (gitignore): role host|seat, slug, origin,
you?, human?, decks, bins, lastGen per bin label, pid?, phase lobby|play|ended.

Host may store all nine pairs. Seat session stores invite fields plus lastGen
for host and that inbox.

Also: `table-games/<slug>.runner.log`, `table-games/<slug>.runner.pid`.

### Watch

CONDUIT.md prefix. Reconnect with `{ read, from: lastGen, snapshotsOnly: true }`.
Inboxes: snapshotsOnly (latest join/plan wins). Backoff 500ms to 5s. No HTTP
poll loop. HTTP GET only on startup/resume to seed lastGen.

---

## CLI

- `--fg`: stay in foreground, logs to stdout (default in a real TTY).
- Agent start: write log + pid, daemonize (see Background).
- `stop`: SIGTERM pid file; ok if already dead.
- `resume`: load session; if pid alive, print already running and exit 0;
  else start that role again.

---

## Host loop

1. Mint or load conduit keys.
2. Write invite-p1.json … invite-p4.json.
3. Watch four inboxes.
4. On join, record deck/name.
5. When ready: existing `table:deal` into `<slug>.live.json`. Do not reimplement
   deal. Then encode_live.py --conduit (or equivalent appends).
6. Play (v1): on human plan/confirm, log and hook `onHumanPlan`. Agent seats:
   stub `onSeatTurn` logs waiting. Brain is G later.

Host is the only writer of `host` and `pN` bins.

---

## Seat loop

1. Parse invite.
2. Append join to inbox.
3. Watch hostRead.
4. Persist lastGen.
5. SIGTERM exits; resume with role seat.

---

## Background (Cursor agents)

Local IDE/CLI agent: yes, if detached from the agent shell.

```
nohup bun live-runner/src/cli.ts host --slug <slug> --human p2 --decks ... \
  >> table-games/<slug>.runner.log 2>&1 &
echo $! > table-games/<slug>.runner.pid
```

Agent turn:

1. Start with block_until_ms 0, or the nohup recipe.
2. Confirm pid and a `listen` line in the log.
3. Do not AwaitShell the runner. Print pid, log path, invites, Pages URL.
4. stop --slug to halt.

If the sandbox reaps children, nohup + disown. Verify `kill -0 $(cat pid)`.

Cloud / Cursor-hosted VM: no. The VM dies with the agent. Runner must live on
a machine that stays up. Cloud agents may start it over SSH; they must not be
the host.

Foreground bun in the agent terminal dies with that terminal. Always pid+log.

---

## Out of scope (v1)

Rules engine, Ollama, Cursor SDK, replacing Pages, mint-auth deploy, server-side
deltas, four LLM seats in one process (v2: in-process seat modules).

---

## Tests

1. Invite round-trip; seat invite lacks host.write.
2. Session save/load.
3. Watch prefix decode (same 13-byte layout as site/src/liveConduit.ts).
4. Host lobby: four joins -> phase play (mock conduit).
5. Resume does not mint if .conduit.json exists.
6. stop with stale pid is ok.

---

## Acceptance

- host --fg mints, prints four invites, stays on WSS (no HTTP poll loop).
- seat --invite from another terminal posts join; host log shows it.
- kill -9 host; resume --slug reconnects with from= and does not remint.
- Agent recipe: background start, pid file, log, kill -0 after the reply.
- Human still uses /live/?host=&you=&seat=&inbox=.
