# live-runner

Bun host/seat for conduit live tables. Chat starts it and exits; this process
holds WebSockets.

```bash
bun run table:run host --slug my-pod --fg
bun run table:run host --slug my-pod --agent --fg
bun run table:run seat --slug my-pod --invite '<read>|<mailbox>' --name 'Brew' --deck decks/x --fg
bun run table:run stop --slug my-pod
bun run table:run resume --slug my-pod
```

Without `--fg` the process daemonizes (pid + log under `table-games/`).

Invites are `seatRead|inboxWrite`. Spectator is the host read key. Pages:
`/live/?k=<token>`.

Lobby: gather joins → seating/swap → d20 → pregame in turn order → four ready
→ play. See `PLAN.md` and `.agents/skills/live-table/CONDUIT.md`.

## Agent host

`--agent` invokes the installed Cursor `agent` command for each inbox message
after the game reaches `play`. Calls are serialized, so a second message waits
for the current ruling.

Player messages are untrusted. The runner creates a temporary detached git
worktree, copies in only the replay and inbox journal, and runs the agent there
with sandboxing. Conduit credentials never enter that worktree. The runner
accepts only a parseable replay with the same number of seats and no removed
events, copies it back, then publishes through the real host process.

The host machine must be logged in (`agent status`). Override the default Auto
model with `LIVE_RUNNER_AGENT_MODEL`.
