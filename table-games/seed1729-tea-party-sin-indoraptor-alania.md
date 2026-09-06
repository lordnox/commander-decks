# Tea Party vs Sin-fall vs Hybrid Theory vs Divergent Laughter — seed 1729

Four-player game recorded with `simulate-table`, then rendered separately with
`render-table-replay`. Turn order is clockwise from p1.

**Result:** Truncated at turn 12. Hybrid Theory leads at 71 life after
[Indoraptor, the Perfect Hybrid](https://scryfall.com/card/rex/15/indoraptor-the-perfect-hybrid)
commander-kills Divergent Laughter on turn 10 (24 commander damage). Nobody
eliminates the rest of the table before the cap.

## Seats

| Seat | Deck | Commander | Mulligans | Final life | Outcome |
|---|---|---|---|---|---|
| p1 | [Tea Party](../decks/3_bumbleflower-tea-party/README.md) | [Ms. Bumbleflower](https://scryfall.com/card/blc/3/ms-bumbleflower) | 2 | 33 | Donate engine ran; no Triumph |
| p2 | [Sin-fall](../decks/3_sin-fall/README.md) | [Sin, Spira's Punishment](https://scryfall.com/card/fin/242/sin-spiras-punishment) | 0 | 22 | Yard set; Sin countered |
| p3 | [Hybrid Theory](../decks/3_indoraptor-hybrid-theory/README.md) | [Indoraptor, the Perfect Hybrid](https://scryfall.com/card/rex/15/indoraptor-the-perfect-hybrid) | 0 | 71 | Leader; commander kill |
| p4 | [Divergent Laughter](../decks/3_alania-divergent-laughter/README.md) | [Alania, Divergent Storm](https://scryfall.com/card/blb/204/alania-divergent-storm) | 0 | 0 | Commander damage (Indoraptor, turn 10) |

Tea Party mulliganed a zero-land seven, then a two-land six that missed turn-four
Bumbleflower, and kept five: [Wizard Class](https://scryfall.com/card/afr/81/wizard-class),
[Chasm Skulker](https://scryfall.com/card/moc/218/chasm-skulker), Brushland, Temple
of Plenty, and Plains, bottoming Mental Misstep and Whitemane Lion. The others
kept seven.

## Turning points

**Turn 4 — both commanders.** Tea Party shocks
[Temple Garden](https://scryfall.com/card/trk/301/temple-garden) and casts
[Ms. Bumbleflower](https://scryfall.com/card/blc/3/ms-bumbleflower); the extra
cards go to Hybrid Theory and +1/+1 counters land on Skulker. Hybrid Theory
attacks with [Drover of the Mighty](https://scryfall.com/card/lcc/239/drover-of-the-mighty)
for bloodthirst and casts Indoraptor.

**Turn 5 — yard and thirst.** [Freestrider Lookout](https://scryfall.com/card/otj/163/freestrider-lookout)
crimes [Sunpetal Grove](https://scryfall.com/card/msc/272/sunpetal-grove). Sin-fall
keeps Ugin off [Malevolent Rumble](https://scryfall.com/card/mh3/161/malevolent-rumble)
and [Buried Alive](https://scryfall.com/card/mh3/273/buried-alive)s Worldsire,
Valgavoth, and Leviathan. Hybrid Theory [Boltwave](https://scryfall.com/card/fdn/79/boltwave)s,
then auras Indoraptor with [Eternal Thirst](https://scryfall.com/card/jmp/229/eternal-thirst)
and starts swinging at Alania.

**Turn 6 — Denial.** Sin-fall casts Sin. Divergent Laughter counters with
[Overwhelming Denial](https://scryfall.com/card/ogw/61/overwhelming-denial);
Sin returns to the command zone at tax 2. Alania finally hits the table, tapped
out, with no copy line.

**Turns 7–10 — commander clock.** Indoraptor (menace) connects for 4 commander
damage a turn. Divergent Laughter dies on turn 10 at 24 commander damage.

**Turns 11–12 — leftover table.** Indoraptor turns to Sin-fall. The cap hits
with Hybrid Theory at 71, Tea Party at 33, Sin-fall at 22, and Divergent
Laughter dead.

## Watch it

[Watch on GitHub Pages](https://lordnox.github.io/commander-decks/?game=seed1729-tea-party-sin-indoraptor-alania).
The React player reads the validated public replay data.

Regenerate it from the log with:

```bash
bun run table:render -- table-games/seed1729-tea-party-sin-indoraptor-alania.json
```

## Limits

One seed is a matchup sketch rather than a metagame. Fetchland shuffles after
the deal used `random.Random(1729)` in play order. Judging is imperfect: early
turns were played from primers, and the turn-12 horizon stops a recast-Sin
rebuild that never found nine mana after Denial.
