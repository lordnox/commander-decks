# live-runner

Bun host/seat for conduit live tables. Chat starts it and exits; this process
holds WebSockets.

```bash
bun run table:run host --slug my-pod --fg
bun run table:run seat --slug my-pod --invite '<read>|<mailbox>' --name 'Brew' --deck decks/x --fg
bun run table:run stop --slug my-pod
bun run table:run resume --slug my-pod
```

Without `--fg` the process daemonizes (pid + log under `table-games/`).

Invites are `seatRead|inboxWrite`. Spectator is the host read key. Pages:
`/live/?k=<token>`.

Lobby: gather joins → seating/swap → d20 → pregame in turn order → four ready
→ play. See `PLAN.md` and `.agents/skills/live-table/CONDUIT.md`.
