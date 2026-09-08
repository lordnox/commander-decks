# Backyard Trebuchet vs Racecar Driver vs Captain of the Dawnsire vs Dumpster-Diver Crab — seed 1729

Four-player hot-seat game recorded with `live-table` (the human piloted p4),
then converted into a schema-2 replay with complete combat records.

**Result:** Dumpster-Diver Crab wins on turn 10 after two missed land drops.
[Lumra, Bellow of the Woods](https://scryfall.com/card/blb/183/lumra-bellow-of-the-woods)
mills four and returns thirteen lands tapped; twenty-six landfall triggers off
[Homer, the Hermit](https://scryfall.com/search?q=%21%22Homer%2C+the+Hermit%22)
and its [Sakashima of a Thousand Faces](https://scryfall.com/card/cmr/89/sakashima-of-a-thousand-faces)
copy empty all three opposing libraries. Nethroi, Mishra, and Osgir each lose
on their next draw.

## Seats

| Seat | Deck | Commander | Final life | Outcome |
|---|---|---|---:|---|
| p1 | [Backyard Trebuchet](../decks/3-_nethroi-backyard-trebuchet/README.md) | [Nethroi, Apex of Death](https://scryfall.com/card/dmc/163/nethroi-apex-of-death) | 28 | Milled |
| p2 | [Racecar Driver](../decks/3-_mishra-racecar-driver/README.md) | [Mishra, Eminent One](https://scryfall.com/card/brc/1/mishra-eminent-one) | 13 | Milled |
| p3 | [Captain of the Dawnsire](../decks/3-_osgir-captain-of-the-dawnsire/README.md) | [Osgir, the Reconstructor](https://scryfall.com/card/c21/8/osgir-the-reconstructor) | 13 | Milled |
| p4 | [Dumpster-Diver Crab](../decks/3-_homer-dumpster-diver-crab/README.md) | Homer, the Hermit | 23 | Winner |

## Turning points

**Turns 3–5 — the Crab misses twice.** Dumpster-Diver Crab stalls on four
lands, casts [Roaming Throne](https://scryfall.com/card/lci/258/roaming-throne)
as the only castable spell, and spends the stall milling itself with
[Millikin](https://scryfall.com/card/soc/351/millikin). Talking about being
out of the game keeps removal pointed elsewhere all game.

**Turn 4 — Osgir's engine starts.** Captain of the Dawnsire sacrifices
[Mind Stone](https://scryfall.com/card/mbc/76/mind-stone) to Osgir's pump just
to seed the graveyard, attacks the one-loyalty
[Tyvar, Jubilant Brawler](https://scryfall.com/card/one/218/tyvar-jubilant-brawler)
under vigilance, then reconstructs the Stone into two token copies.

**Turn 5 — Bolt Bend saves the rock.** Racecar Driver holds an open Mountain
all turn and casts [Bolt Bend](https://scryfall.com/card/tle/163/bolt-bend) for
{R}, redirecting [Loran of the Third Path](https://scryfall.com/card/mkc/71/loran-of-the-third-path)
onto Osgir's own [Warmaker Gunship](https://scryfall.com/search?q=%21%22Warmaker+Gunship%22).
Osgir then reconstructs the destroyed hull into two Gunships whose enter
triggers kill the 8/8 [Old Stickfingers](https://scryfall.com/card/dsc/227/old-stickfingers).

**Turn 6 — the Technique deal.** Dumpster-Diver Crab offers Backyard Trebuchet
an [Incarnation Technique](https://scryfall.com/card/c21/41/incarnation-technique)
demonstrate copy in exchange for pointing
[Tree of Perdition](https://scryfall.com/card/ecc/49/tree-of-perdition) at
Mishra instead. Nethroi accepts, the copies mill fifteen between them, and the
Crab takes [Satyr Wayfinder](https://scryfall.com/card/eoc/106/satyr-wayfinder)
over the flashier options to fix its land drops without looking threatening.

**Turn 8 — Mishra hits hardest.** A crewed
[Knight Paladin](https://scryfall.com/search?q=%21%22Knight+Paladin%22) copy
plus its Rapid-fire Battle Cannon trigger takes Osgir from 23 to 13; the same
combat has already cost the table four apiece. Osgir declines the chump block:
*"Trample makes a 2/2 chump worth only 2 life; keeping the Artificer and both
answers is worth 10 life."*

**Turn 9 — Osgir spends both answers on Mishra.** Dispatch sends Mishra to the
command zone; [Spellskite](https://scryfall.com/card/clb/873/spellskite)
redirects Swords to Plowshares onto itself. Osgir casts
[Wrathful Red Dragon](https://scryfall.com/card/clb/207/wrathful-red-dragon)
and never gets to use it.

**Turn 10 — Lumra bellows.** An Island entry mills every player 8 equally,
honoring the terms literally. Lumra then returns thirteen lands, and the
resulting landfall triggers mill the Crab 16 and each opponent out. A
[Golgari Rot Farm](https://scryfall.com/card/ecc/151/golgari-rot-farm) bounce
and a [Riveteers Overlook](https://scryfall.com/card/ecc/162/riveteers-overlook)
sacrifice add two more land entries for good measure.

## Watch it

[Watch on GitHub Pages](https://lordnox.github.io/commander-decks/?game=seed1729-nethroi-mishra-osgir-homer).

Regenerate it with:

```bash
bun run table:render -- table-games/seed1729-nethroi-mishra-osgir-homer.json
```

## Limits

The source was a conversational hot-seat game, so historical events were
normalized to the current replay schema — combat records, cast and trigger
stack items, and four missing resolve events — without changing any game
decision. The human seat produced no `plan` events, so the file carries no
`planning` version. Private hands are revealed in the completed replay, as
they are in other finished table recordings.
