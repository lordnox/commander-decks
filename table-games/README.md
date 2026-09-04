# Table games

`simulate-table` plays a game and writes `<slug>.json`. The separate
`render-table-replay` skill validates that log and writes `<slug>.html`: a
self-contained viewer with a felt table, life totals, a centre panel naming the
current event, the stack, fixed transport controls, a collapsible event log, a
step slider, and card art on hover. Seats that may look at the top of their
library — Fblthp, Bolas's Citadel — show that card in its own zone. Open the
HTML in a browser; GitHub will not render it inline.

Both are gitignored so ordinary runs stay scratch. To keep a game, `git add -f`
the two files and add a `<slug>.md` recap, since neither JSON nor HTML is
readable in a pull request.

## Recorded games

- [Homer vs Sin vs Osgir vs Hazel](seed1729-homer-sin-osgir-hazel.md)
  — seed 1729, truncated at turn 12; Sin-fall leads after commander-killing Homer.
- [Sygg vs The Twelfth Doctor vs Osgir vs Bartolomé](seed1729-sygg-doctor-osgir-bartolome.md)
  — seed 1729, Bartolomé combo win on turn 5.
