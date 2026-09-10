# live-runner — target

Long-running Bun process that hosts or sits at a live table. It is the event
loop: WebSocket to conduit, state on disk, brains only on a frame. Cursor
chat does not poll.

Build order and lobby FSM: [`PLAN.md`](PLAN.md).
Do not invent extra bins, query params, or inbox types beyond
`.agents/skills/live-table/CONDUIT.md`.

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
bun live-runner/src/cli.ts host --slug <slug>
bun live-runner/src/cli.ts seat --invite <file-or-json>
bun live-runner/src/cli.ts resume --slug <slug>
bun live-runner/src/cli.ts stop --slug <slug>
```

**Host does not know or care who pilots a seat** (Cursor, Pages, Ollama, another person). A seat is a capability: valid keys may connect, watch, and write that inbox. Host:

- mints bins and prints four **pipe invites** (`seatRead|inboxWrite`) plus one spectator string (host read only)
- gathers four `join`s, **assigns `pN`**, announces seating in talk, allows **swaps if everyone agrees** (players trade pipe keys; bins do not rename)
- **d20** / turn order after seating is stable
- **pregame in turn order** (starting player first): host asks each seat; seat answers `pregame` or skip
- asks **can we start?**; four `ready`; seating talk clears ready
- always keeps table talk on snapshot `k`

**Seat client** (Pages, skill, or `seat` runner): parse `k` / `read|mailbox`. Watch `readKey`. If mailbox present, POST inbox. `you` is not sent to the host as a query flag.

`seat` never mints. `join` can omit `you`; host maps the inbox to a seat by which bin was written.

### Invite (seat-safe)

Chat string: `<seatRead>|<inboxWrite>`

Spectator: `<hostRead>`

JSON on disk (gitignored) can keep the split fields for the runner; the user-facing token is the pipe form. Never host write. `you` is inferred from which bin the read key belongs to, or from snapshot `y`.

### Inbox

Keep `{ "type": "plan"|"confirm"|"replace", "text": "..." }`.

Add:

```
{ "type": "join", "name": "brew title", "deck": "decks/..." }
{ "type": "ready" }
{ "type": "pass" }
{ "type": "swap", "with": "p3" }
{ "type": "pregame", "cards": ["Leyline of Sanctity"] }
{ "type": "rules", "text": "does this trigger on ETB?" }
{ "type": "talk", "text": "If you leave me alone, I won't attack you next turn." }
```

`pass` means no action in the current priority window. `talk` is social speech
visible to every seat, never a control message.

Host lobby is gather → seat (talk/swap) → dice → pregame (turn order) → four ready → play.
Do not skip to deal on join alone.

### Session file

`table-games/<slug>.runner.json` (gitignore): role host|seat, slug, origin,
you?, decks-from-joins, bins, lastGen per bin label, pid?, phase
gathering | seated | pregame | ready | play | ended.

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
2. Write four pipe invites (optionally shuffled). Spectator = host read.
3. Watch four inboxes.
4. On join, bind mailbox → pN; record deck/name. Announce seating in talk.
5. Seating open: swaps if all agree (trade pipe invites). Then d20 / first player.
6. Pregame in turn order; then "can we start?"; four ready → deal and play.
7. Play: plan/confirm/pass/replace/talk/rules from any seat; host applies or answers.

Host is the only writer of `host` and `pN` bins.

---

## Seat loop

1. Parse `read|mailbox` (or JSON).
2. Append join to mailbox.
3. Watch readKey (that is the view).
4. Persist lastGen.
5. SIGTERM exits; resume with role seat.

---

## Background (Cursor agents)

Local IDE/CLI agent: yes, if detached from the agent shell.

```
nohup bun live-runner/src/cli.ts host --slug <slug> \
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

## Kernel journal

The host opens `table-games/<slug>.kernel.json` on play (append-only journal).
Passes use `passPriority`. Card plugins live in `rules-engine/src/cardPlugins/`
and `cards/rules-plugins.json`. Full Oracle compilation is still out of scope:
unregistered weird cards pause for a plugin + test.

The kernel is the sole authority once its journal exists. Only `confirm` may
replace that file; plan/rules checks are read-only, and failed kernel passes do
not fall back to the replay. Generated `handlerIds` reload in the running host.
Wire snapshots retain 32 history frames and 128 trace events; the journal stays
complete.

## Out of scope (v1)

Compiling every Oracle line, Ollama, replacing Pages, mint-auth deploy,
server-side deltas.

---

## Tests

1. Invite round-trip; seat invite lacks host.write.
2. Session save/load.
3. Watch prefix decode (same 13-byte layout as site/src/liveConduit.ts).
4. Host lobby: join → seating/talk/swap → dice → pregame → four ready → play (mock).
5. Resume does not mint if .conduit.json exists.
6. stop with stale pid is ok.

---

## Acceptance

- host --fg mints, prints four invites, stays on WSS (no HTTP poll loop).
- seat --invite from another terminal posts join; host log shows it.
- kill -9 host; resume --slug reconnects with from= and does not remint.
- Agent recipe: background start, pid file, log, kill -0 after the reply.
- Human still uses /live/?k=<read>%7C<mailbox> (same string as chat).
