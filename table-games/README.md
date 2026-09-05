# Table games

`simulate-table` plays a game and writes `<slug>.json`. Fetch exact token
printings with `bun run deck:tokens -- <deck names>`, then start with
`bun run table:deal`. Extend a truncated log with `bun run table:continue --
<table>.json --turns 3`, which prepares `<slug>.working.json` for the agent to
play and leaves the recorded replay alone.

Validate and publish every stored replay for the React player:

```bash
bun run table:render
```

Pass one JSON path to refresh a single game. The `render-table-replay` skill
validates the log and writes sanitized
`../site/public/replays/<slug>.json`. The React player reads that payload and
shows the four seats, life and library totals, zones and card art, current
event, stack, decisions and deals, autoplay controls, a navigable event log,
and a card inspector. Seats that may look at the top of their library —
Fblthp, Bolas's Citadel — show that card in its own zone.

The React and Tailwind index and player live in [`site/`](../site). Rebuild
their generated data, then create the production site:

```bash
bun run site:prepare
bun run build
```

The first command writes public replay JSON and `games.json` under ignored
`site/public/`; Vite writes the complete static site to ignored `dist/`.
GitHub Actions performs the same build and deploys `dist/`. Once Pages uses
**GitHub Actions** as its source, the live index is
[lordnox.github.io/commander-decks](https://lordnox.github.io/commander-decks/).
This repository is private, so Pages needs a public repo or a plan that
includes private Pages.

Replay logs are gitignored so ordinary runs stay scratch. To keep a game,
`git add -f` its JSON and add a `<slug>.md` recap. Generated site files are
rebuilt in Actions.

To ask what went wrong in those logs — missing lands, ramp, or interaction in
a 99, versus a seat playing the cards it had in the wrong order — follow
`review-table`. Start with `bun run table:review -- --list` so the agent never
loads a full snapshot JSON into chat.

## Recorded games

- [Homer vs Hazel vs Alania vs Eva](seed1729-homer-hazel-alania-eva.md)
  ([watch](https://lordnox.github.io/commander-decks/?game=seed1729-homer-hazel-alania-eva))
  — seed 1729, truncated at turn 12; Misty Critters leads after commander-killing Alania.
- [Homer vs Sin vs Osgir vs Hazel](seed1729-homer-sin-osgir-hazel.md)
  ([watch](https://lordnox.github.io/commander-decks/?game=seed1729-homer-sin-osgir-hazel))
  — seed 1729, truncated at turn 12; Sin-fall leads after commander-killing Homer.
- [Sygg vs The Twelfth Doctor vs Osgir vs Bartolomé](seed1729-sygg-doctor-osgir-bartolome.md)
  ([watch](https://lordnox.github.io/commander-decks/?game=seed1729-sygg-doctor-osgir-bartolome))
  — seed 1729, Bartolomé combo win on turn 5.
- [Jalira vs Jon vs Evangela vs Sygg](seed1729-jalira-jon-eva-sygg.md)
  ([watch](https://lordnox.github.io/commander-decks/?game=seed1729-jalira-jon-eva-sygg))
  — seed 1729, truncated at turn 12; only Thousand Cuts dies, after Jon's Yukora copy wipes Jalira's board and Aetherize undoes her comeback.
