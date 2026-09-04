# Table games

`simulate-table` plays a game and writes `<slug>.json`. The separate
`render-table-replay` skill validates that log and writes `<slug>.html`: a
self-contained viewer with a felt table, life totals, stack, fixed transport
controls, collapsible event log, step slider, and card art on hover. Open the
HTML in a browser; GitHub will not render it inline.

Both are gitignored so ordinary runs stay scratch. To keep a game, `git add -f`
the two files and add a `<slug>.md` recap, since neither JSON nor HTML is
readable in a pull request.

## Recorded games

- [Sygg vs The Twelfth Doctor vs Osgir vs Bartolomé](seed1729-sygg-doctor-osgir-bartolome.md)
  — seed 1729, Bartolomé combo win on turn 5.
