# Sygg vs The Twelfth Doctor vs Osgir vs Bartolomé — seed 1729

Four-player game recorded with the `simulate-table` skill. Turn order is
clockwise from p1. Both eliminations were real; the game stopped at the
turn-12 cap rather than manufacturing a win.

**Result:** truncated on turn 12. The Twelfth Doctor was eliminated on turn 8
and Osgir on turn 10. Bartolomé finished at 40 life behind a lifelink army,
Sygg at 16 and losing the race.

## Seats

| Seat | Deck | Commander | Mulligans | Final life | Outcome |
|---|---|---|---|---|---|
| p1 | [Thousand Cuts](../decks/2+_sygg-thousand-cuts/README.md) | [Sygg, River Cutthroat](https://scryfall.com/card/znc/103/sygg-river-cutthroat) | 1 | 16 | Alive, behind |
| p2 | [Borrowed Time](../decks/3+_twelfth-doctor-borrowed-time/README.md) | [The Twelfth Doctor](https://scryfall.com/card/who/164/the-twelfth-doctor) + [Vislor Turlough](https://scryfall.com/card/who/74/vislor-turlough) | 0 | 0 | Eliminated turn 8 |
| p3 | [Captain of the Dawnsire](../decks/3-_osgir-captain-of-the-dawnsire/README.md) | [Osgir, the Reconstructor](https://scryfall.com/card/c21/8/osgir-the-reconstructor) | 0 | 0 | Eliminated turn 10 |
| p4 | [Graveyard Shift](../decks/3+_bartolome-graveyard-shift/README.md) | [Bartolomé del Presidio](https://scryfall.com/card/lci/224/bartolomé-del-presidio) | 0 | 40 | Leader, lethal on turn 13 |

Sygg mulliganed a one-land seven holding two two-mana rocks and bottomed
[Bloodthirsty Conqueror](https://scryfall.com/card/vow/104/bloodthirsty-conqueror).
Everyone else kept seven.

## Turning points

**Turn 3 — [Ghoulish Impetus](https://scryfall.com/card/soc/214/ghoulish-impetus) on Bartolomé.**
Goad names the goader, so p4's deathtouch commander could never attack Sygg.
It hit Osgir three turns running and did most of Sygg's early damage for it.

**Turn 5 — [Painful Quandary](https://scryfall.com/card/fdn/179/painful-quandary).**
Every opponent spell cost 5 life or a card for two turn cycles. It also
backfired: p4 pitched [Sun Titan](https://scryfall.com/card/soc/178/sun-titan)
and p3 pitched artifacts, feeding exactly the graveyards those decks wanted.

**Turns 6–7 — the Titanic engine.** Osgir crewed
[RMS Titanic](https://scryfall.com/card/who/93/rms-titanic), sacrificed it for
seven Treasures on damage, then exiled it from the graveyard to create two
token copies. That is 21 flying damage from one four-drop, nearly all of it
into p2.

**Turn 7 — fused [Wear // Tear](https://scryfall.com/card/moc/343/wear-tear).**
One spell means one Quandary trigger, and it destroyed the Quandary itself
plus Isolation Cell. Osgir paid the last 5 life on an empty hand.

**Turn 8 — [Discontinuity](https://scryfall.com/card/m21/48/discontinuity) on
exactly six lands.** At 3 life facing 11 flying damage, p2 ended the turn and
survived. p4 killed them one turn later anyway.

**Turn 9 — [Rise of the Dark Realms](https://scryfall.com/card/fdn/183/rise-of-the-dark-realms).**
Sygg took Sun Titan and Sephiroth off p4 plus three creatures from its own
yard. From there Sygg owned the drain trigger and every death on the table
pinged its opponents.

**Turn 10 — [Changing Loyalty](https://scryfall.com/card/soc/23/changing-loyalty)
plus [Corpse Dance](https://scryfall.com/card/wc99/js116/corpse-dance).** p4's
real engine: rebuy a creature with buyback, sacrifice it to Bartolomé ahead of
the exile clause, and let the aura return it permanently. That plus lifelink
from [Danitha](https://scryfall.com/card/dmu/15/danitha-benalias-hope) and
[Angel of Indemnity](https://scryfall.com/card/soc/133/angel-of-indemnity)
outran Sygg's drains.

## Watch it

`seed1729-sygg-doctor-osgir-bartolome.html` is self-contained: open it in a
browser for the felt table, life totals, stack, 142-step slider, and card art
on hover. GitHub will not render it inline, so download the file or clone.

Regenerate it from the log with:

```bash
python3 .agents/skills/simulate-table/scripts/render_replay.py \
  table-games/seed1729-sygg-doctor-osgir-bartolome.json
```

## Limits

One seed, and the agent judged every block and threat assessment for all four
seats, so this is a matchup sketch rather than evidence about win rates. No
deck was changed as a result.
