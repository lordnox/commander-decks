# Dumpster-Diver Crab vs Tea Party vs Sin-fall vs Graveyard Shift — seed 1729

Four-player hot-seat game recorded with `live-table`, then converted into a
schema-2 replay with complete combat records.

**Result:** Dumpster-Diver Crab wins on turn 12 by milling all three opponents.
[Quantum Misalignment](https://scryfall.com/card/pip/30/quantum-misalignment)
copies [Homer, the Hermit](https://scryfall.com/search?q=%21%22Homer%2C+the+Hermit%22),
then [Undercity Sewers](https://scryfall.com/card/mkm/270/undercity-sewers)
and [Entish Restoration](https://scryfall.com/card/ltr/163/entish-restoration)
produce four land entries. Two Homers and
[Roaming Throne](https://scryfall.com/card/lci/258/roaming-throne) mill each
opponent for 96; each loses on their next draw.

## Seats

| Seat | Deck | Commander | Final life | Outcome |
|---|---|---|---:|---|
| p1 | [Dumpster-Diver Crab](../decks/3-_homer-dumpster-diver-crab/README.md) | Homer, the Hermit | 8 | Winner |
| p2 | [Tea Party](../decks/3_bumbleflower-tea-party/README.md) | [Ms. Bumbleflower](https://scryfall.com/card/blc/3/ms-bumbleflower) | 2 | Milled |
| p3 | [Sin-fall](../decks/3_sin-fall/README.md) | [Sin, Spira's Punishment](https://scryfall.com/card/fin/242/sin-spiras-punishment) | 54 | Milled |
| p4 | [Graveyard Shift](../decks/3+_bartolome-graveyard-shift/README.md) | [Bartolomé del Presidio](https://scryfall.com/card/lci/224/bartolome-del-presidio) | 25 | Milled |

## Turning points

**Turn 7 — infect breaks Valgavoth.** Tea Party's
[Triumph of the Hordes](https://scryfall.com/card/nph/123/triumph-of-the-hordes)
attack leaves Sin-fall at eight poison and kills
[Valgavoth, Terror Eater](https://scryfall.com/card/dsc/6/valgavoth-terror-eater),
restoring everyone else's graveyards.

**Turns 8–10 — Bunny pressure.** Tea Party repeatedly attacks Dumpster-Diver
Crab, reducing it to two life. A carefully sequenced
[Tamiyo's Safekeeping](https://scryfall.com/card/neo/211/tamiyos-safekeeping)
and Graveyard Shift's
[Fungal Fortitude](https://scryfall.com/card/lci/106/fungal-fortitude) let
[Yarok, the Desecrated](https://scryfall.com/card/m20/220/yarok-the-desecrated)
survive combat, gain five life, and trade off two attackers.

**Turn 10 — zombie counterattack.** Sin-fall sends thirteen Zombies at Tea
Party. Six blocks leave Tea Party at twelve life and strip away three creatures.
Graveyard Shift follows with Angel of Indemnity for five, putting Tea Party at
seven.

**Turns 11–12 — the Crab closes.** Yarok attacks Tea Party for five lifelink.
[Victimize](https://scryfall.com/card/cmm/197/victimize) restores Homer and
Roaming Throne, while Raise the Palisade clears opposing creatures. The next
turn, Quantum Misalignment and Entish Restoration empty every opposing library.

## Watch it

[Watch on GitHub Pages](https://lordnox.github.io/commander-decks/?game=seed1729-dumpster-tea-sin-graveyard).

Regenerate it with:

```bash
bun run table:render -- table-games/seed1729-dumpster-tea-sin-graveyard.json
```

## Limits

The source was a conversational hot-seat game, so some historical events were
normalized to the current replay schema without changing game decisions.
Private hands are revealed in the completed replay, as they are in other
finished table recordings.
