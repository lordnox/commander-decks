# The Polyfisher vs Unwanted Presents vs Foggy Blood Transfusion vs Thousand Cuts — seed 1729

Four-player Bracket 2+ game recorded with `simulate-table`. Turn order is
clockwise from p1. The React player reads its validated public replay data.

**Result:** truncated at turn 12. [The Polyfisher](../decks/2+_jalira-the-polyfisher/README.md)
leads after [Ancient Stone Idol](https://scryfall.com/card/mkc/222/ancient-stone-idol)
trampling out Thousand Cuts on turn 10. Final life: Polyfisher 22, Unwanted
Presents 37, Foggy Blood Transfusion 24, Thousand Cuts 0.

## Seats

| Seat | Deck | Commander | Mulligans | Final life | Outcome |
|---|---|---|---|---|---|
| p1 | [The Polyfisher](../decks/2+_jalira-the-polyfisher/README.md) | [Jalira, Master Polymorphist](https://scryfall.com/card/a25/63/jalira-master-polymorphist) | 1 | 22 | Leader |
| p2 | [Unwanted Presents](../decks/2+_jon-irenicus-unwanted-presents/README.md) | [Jon Irenicus, Shattered One](https://scryfall.com/card/clb/278/jon-irenicus-shattered-one) | 0 | 37 | Alive |
| p3 | [Foggy Blood Transfusion](../decks/2+_lady-evangela-foggy-blood-transfusion/README.md) | [Lady Evangela](https://scryfall.com/card/leg/240/lady-evangela) | 1 | 24 | Alive |
| p4 | [Thousand Cuts](../decks/2+_sygg-thousand-cuts/README.md) | [Sygg, River Cutthroat](https://scryfall.com/card/znc/103/sygg-river-cutthroat) | 2 | 0 | Eliminated turn 10 |

Jalira mulliganed a two-giant seven and kept five Islands plus
[Hard Evidence](https://scryfall.com/card/mh2/46/hard-evidence), bottoming an
Island. Evangela mulliganed a zero-land pile of finishers and bottomed
[Mister Negative](https://scryfall.com/card/spm/135/mister-negative). Sygg's
first six had only an Island because
[Foulmire Knight](https://scryfall.com/card/mid/100/foulmire-knight) is an
Adventure, not a land; the two-land keep is four lands and
[Dimir Signet](https://scryfall.com/card/clu/221/dimir-signet). Jon kept seven.

## Turning points

**Turn 1–2 — Remora tax.** Jon lands [Mystic Remora](https://scryfall.com/card/dmr/59/mystic-remora)
on turn one. Eva's [Expedition Map](https://scryfall.com/card/fdn/724/expedition-map),
Jalira's [Sky Diamond](https://scryfall.com/card/c21/264/sky-diamond), and Sygg's
Signet all feed it.

**Turn 3 — engines on curve.** Jalira makes a Crab. Eva cracks Map for
[Urborg, Tomb of Yawgmoth](https://scryfall.com/card/tsr/287/urborg-tomb-of-yawgmoth).
Sygg hits the battlefield.

**Turn 4 — commanders and a gift.** Jalira and Irenicus resolve. Irenicus
donates tapped, goaded [Drinker of Sorrow](https://scryfall.com/card/lgn/66/drinker-of-sorrow)
to Evangela. Sygg deploys [Rug of Smothering](https://scryfall.com/card/clb/336/rug-of-smothering).

**Turn 5 — first fish.** Jalira sacrifices the Crab and hits
[Faerie Artisans](https://scryfall.com/card/cmm/92/faerie-artisans). Jon hands
Jalira a [Sleeper Agent](https://scryfall.com/card/10e/178/sleeper-agent). Eva's
[Crypt Ghast](https://scryfall.com/card/rvr/70/crypt-ghast) is copied, then
Drinker connects for 4.

**Turn 6 — the golem.** Jalira sacrifices the Ghast copy, skips
[Ancient Silver Dragon](https://scryfall.com/card/clb/56/ancient-silver-dragon)
(legendary) and [Summon: Bahamut](https://scryfall.com/card/fin/1/summon:-bahamut),
and puts [Ancient Stone Idol](https://scryfall.com/card/mkc/222/ancient-stone-idol)
into play. Jon goads it with [Psychic Impetus](https://scryfall.com/card/clu/92/psychic-impetus).
Eva's Drinker attacks; Jalira blocks with the 12/12 and the present dies.

**Turns 7–10 — the clock.** The goaded Idol has to attack someone other than
Jon and tramples Sygg: 28, 16, 4, then 0 on turn 10. Jon's
[Vona's Hunger](https://scryfall.com/card/rix/90/vonas-hunger) on turn 8 eats
Artisans, Blood Celebrant, and Sygg; Jalira keeps the Idol and Sygg recasts.

**Turn 11–12 — the cap.** The Idol has to attack Evangela.
[Darkness](https://scryfall.com/card/tsb/40/darkness) fogs the first swing.
Jon does not Negate: Jalira is the clock. The second swing connects for 12.
The horizon stops with Jalira ahead and no lethal on the remaining seats.

## Watch it

[Watch on GitHub Pages](https://lordnox.github.io/commander-decks/?game=seed1729-jalira-jon-eva-sygg).

```bash
bun run table:render -- table-games/seed1729-jalira-jon-eva-sygg.json
```

This is one seed, not a metagame. Judging is imperfect: Remora draws were not
paid at {4}, and the compact catalog omits "Legendary" on Ancient Silver Dragon,
which was still skipped from Oracle.
