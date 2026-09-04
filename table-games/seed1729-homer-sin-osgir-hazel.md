# Homer vs Sin vs Osgir vs Hazel — seed 1729

Four-player game recorded with `simulate-table`, then rendered separately with
`render-table-replay`. Turn order is clockwise from p1.

**Result:** Truncated at turn 12. Sin-fall is the leader at 40 life after
[Sin, Spira's Punishment](https://scryfall.com/card/fin/242/sin-spiras-punishment)
commander-kills Dumpster-Diver Crab on turn 11. Nobody eliminates the rest of
the table before the cap.

## Seats

| Seat | Deck | Commander | Mulligans | Final life | Outcome |
|---|---|---|---|---|---|
| p1 | [Dumpster-Diver Crab](../decks/3-_homer-dumpster-diver-crab/README.md) | [Homer, the Hermit](https://scryfall.com/card/mbc/40/homer-the-hermit) | 1 | 0 | Commander damage (Sin, turn 11) |
| p2 | [Sin-fall](../decks/3_sin-fall/README.md) | [Sin, Spira's Punishment](https://scryfall.com/card/fin/242/sin-spiras-punishment) | 0 | 40 | Leader |
| p3 | [Captain of the Dawnsire](../decks/3-_osgir-captain-of-the-dawnsire/README.md) | [Osgir, the Reconstructor](https://scryfall.com/card/c21/8/osgir-the-reconstructor) | 0 | 37 | Ship eaten by Portal |
| p4 | [Misty Critters](../decks/3-_hazel-misty-critters/README.md) | [Hazel of the Rootbloom](https://scryfall.com/card/blc/2/hazel-of-the-rootbloom) | 2 | 15 | Swarm rebuilt, no closer |

Homer mulliganed a one-land seven and kept three lands plus Throne, Maskwood, and
World Shaper, bottoming Fortune's Favor. Sin and Osgir kept seven. Hazel
mulliganed twice to Forest, Three Tree City, Deep Forest Hermit, Skullclamp, and
Tear Asunder.

## Turning points

**Turn 3 — both engines appear.** Homer hits the battlefield on three colors.
Osgir [Gamble](https://scryfall.com/card/dmr/121/gamble)s
[Dawnsire, Sunstar Dreadnought](https://scryfall.com/card/eoe/238/dawnsire-sunstar-dreadnought)
and randomly discards Reroute Systems, keeping the ship. Hazel clamps the
opening Squirrel for two cards.

**Turn 4 — Tear Asunder.** Hazel kicks
[Tear Asunder](https://scryfall.com/card/eoc/109/tear-asunder) to exile Homer
after [Roaming Throne](https://scryfall.com/card/lci/258/roaming-throne) has
already resolved.

**Turn 5 — the lottery is rigged.** Sin
[Crop Rotation](https://scryfall.com/card/dmr/154/crop-rotation)s for
[Yavimaya, Cradle of Growth](https://scryfall.com/card/mh2/261/yavimaya-cradle-of-growth),
then [Entomb](https://scryfall.com/card/dmr/82/entomb)s
[Portal to Phyrexia](https://scryfall.com/card/bro/240/portal-to-phyrexia).
Osgir hardcasts Dawnsire.

**Turn 7 — Portal.** [Animist's Awakening](https://scryfall.com/card/soc/261/animists-awakening)
the turn before makes seven mana. Sin's enter trigger copies Portal (the only
permanent in the graveyard). Homer, Throne, and Osgir are sacrificed; Hazel
loses three Squirrels.

**Turn 9 — 100 damage.** Dawnsire is at 12 charge. Osgir attacks and the 10+
trigger kills Sin. Portal's upkeep then eats Wellspring, Shadowspear, and on
turn 10 the ship itself.

**Turn 11 — commander kill.** Recast Sin connects for the third 7, and Homer
dies at 21 commander damage. Turn 12 Sin swings at Hazel instead. The cap
hits with Sin at 40, Osgir at 37, Hazel at 15.

## Watch it

`seed1729-homer-sin-osgir-hazel.html` is self-contained: open it in a browser.
GitHub will not render it inline.

Regenerate it from the log with:

```bash
python3 .agents/skills/render-table-replay/scripts/render_replay.py \
  table-games/seed1729-homer-sin-osgir-hazel.json
```

## Limits

One seed is a matchup sketch rather than a metagame. Fetchland shuffles after
the deal used `random.Random(1729)` in play order. Judging is imperfect: early
turns were played from primers, and the turn-12 horizon stops a long Portal
grinder that had not yet found Exsanguinate or Triumph of the Hordes.
