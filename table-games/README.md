# Table games

`simulate-table` plays a game and writes `<slug>.json`. Fetch exact token
printings with `bun run deck:tokens -- <deck names>`, then start with
`bun run table:deal`. Extend a truncated log with `bun run table:continue --
<table>.json --turns 3`, which prepares `<slug>.working.json` for the agent to
play and leaves the recorded replay alone.

Rebuild every stored replay with the current HTML viewer:

```bash
bun run table:render
```

Pass one JSON path to refresh a single game. The `render-table-replay` skill
validates the log and writes `../pages/<slug>.html`: a self-contained viewer with a
felt table, life totals, exact token art, current power and toughness in the
corner of each creature in play, counter and status chips, a centre panel
naming the current event, the stack,
fixed transport controls, a collapsible event log, a step slider, and a hover
preview that shows the large card with its counters and notes spelled out. Seats
that may look at the top of their library — Fblthp, Bolas's Citadel — show that
card in its own zone. Open the HTML in a browser; GitHub will not render it
inline.

Rendered games live in the tracked [`pages/`](../pages) directory, which is
what GitHub Pages serves. Rebuild its listing after rendering:

```bash
bun run table:pages
```

That regenerates `pages/index.html` from the replay JSON. After GitHub Pages is
enabled, the live index is
[lordnox.github.io/commander-decks](https://lordnox.github.io/commander-decks/),
deployed on push to `main`. This repository is private, so Pages needs a public
repo or a plan that includes private Pages.

Replay logs are gitignored so ordinary runs stay scratch. To keep a game,
`git add -f` its JSON, commit `pages/<slug>.html`, and add a `<slug>.md` recap,
since neither JSON nor HTML is readable in a pull request.

To ask what went wrong in those logs — missing lands, ramp, or interaction in
a 99, versus a seat playing the cards it had in the wrong order — follow
`review-table`. Start with `bun run table:review -- --list` so the agent never
loads a full snapshot JSON into chat.

## Recorded games

- [Homer vs Sin vs Osgir vs Hazel](seed1729-homer-sin-osgir-hazel.md)
  ([watch](https://lordnox.github.io/commander-decks/seed1729-homer-sin-osgir-hazel.html))
  — seed 1729, truncated at turn 12; Sin-fall leads after commander-killing Homer.
- [Sygg vs The Twelfth Doctor vs Osgir vs Bartolomé](seed1729-sygg-doctor-osgir-bartolome.md)
  ([watch](https://lordnox.github.io/commander-decks/seed1729-sygg-doctor-osgir-bartolome.html))
  — seed 1729, Bartolomé combo win on turn 5.
- [Jalira vs Jon vs Evangela vs Sygg](seed1729-jalira-jon-eva-sygg.md)
  ([watch](https://lordnox.github.io/commander-decks/seed1729-jalira-jon-eva-sygg.html))
  — seed 1729, truncated at turn 12; The Polyfisher leads after trampling out Thousand Cuts.
