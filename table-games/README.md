# Table games

`simulate-table` plays a game and writes `<slug>.json`. Start with
`bun run table:deal`; extend a truncated log with `bun run table:continue --
<table>.json --turns 3`, which prepares `<slug>.working.json` for the agent to
play and leaves the recorded replay alone. The separate `render-table-replay` skill validates
that log and writes `<slug>.html`: a self-contained viewer with a felt table,
life totals, a centre panel naming the current event, the stack, fixed
transport controls, a collapsible event log, a step slider, and card art on
hover. Seats that may look at the top of their library — Fblthp, Bolas's
Citadel — show that card in its own zone. Open the HTML in a browser; GitHub
will not render it inline.

Both are gitignored so ordinary runs stay scratch. To keep a game, `git add -f`
the two files and add a `<slug>.md` recap, since neither JSON nor HTML is
readable in a pull request.

## Recorded games

- [Homer vs Sin vs Osgir vs Hazel](seed1729-homer-sin-osgir-hazel.md)
  — seed 1729, truncated at turn 12; Sin-fall leads after commander-killing Homer.
- [Sygg vs The Twelfth Doctor vs Osgir vs Bartolomé](seed1729-sygg-doctor-osgir-bartolome.md)
  — seed 1729, Bartolomé combo win on turn 5.
- [Jalira vs Jon vs Evangela vs Sygg](seed1729-jalira-jon-eva-sygg.md)
  — seed 1729, truncated at turn 12; The Polyfisher leads after trampling out Thousand Cuts.
