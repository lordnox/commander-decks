# Sygg vs The Twelfth Doctor vs Osgir vs Bartolomé — seed 1729

Four-player game recorded with `simulate-table`, then rendered separately with
`render-table-replay`. Turn order is clockwise from p1.

**Result:** Graveyard Shift wins on turn 5. [Corpse Dance](https://scryfall.com/card/wc99/js116/corpse-dance)
returns [Sun Titan](https://scryfall.com/card/soc/178/sun-titan), then
[Changing Loyalty](https://scryfall.com/card/soc/23/changing-loyalty) turns
the Titan into a repeatable death loop for Bartolomé and Sephiroth.

## Seats

| Seat | Deck | Commander | Mulligans | Final life | Outcome |
|---|---|---|---|---|---|
| p1 | [Thousand Cuts](../decks/2+_sygg-thousand-cuts/README.md) | [Sygg, River Cutthroat](https://scryfall.com/card/znc/103/sygg-river-cutthroat) | 1 | 0 | Drained by loop |
| p2 | [Borrowed Time](../decks/3+_twelfth-doctor-borrowed-time/README.md) | [The Twelfth Doctor](https://scryfall.com/card/who/164/the-twelfth-doctor) + [Vislor Turlough](https://scryfall.com/card/who/74/vislor-turlough) | 0 | 0 | Drained by loop |
| p3 | [Captain of the Dawnsire](../decks/3-_osgir-captain-of-the-dawnsire/README.md) | [Osgir, the Reconstructor](https://scryfall.com/card/c21/8/osgir-the-reconstructor) | 0 | 0 | Drained by loop |
| p4 | [Graveyard Shift](../decks/3+_bartolome-graveyard-shift/README.md) | [Bartolomé del Presidio](https://scryfall.com/card/lci/224/bartolom%C3%A9-del-presidio) | 0 | 138 | Winner |

Sygg mulliganed a one-land seven holding two two-mana rocks and bottomed
[Bloodthirsty Conqueror](https://scryfall.com/card/vow/104/bloodthirsty-conqueror).
Everyone else kept seven.

## Turning points

**Turn 3 — the engine assembles.** [Bartolomé del Presidio](https://scryfall.com/card/lci/224/bartolom%C3%A9-del-presidio)
is already the free sacrifice outlet; [Sephiroth, Fabled SOLDIER](https://scryfall.com/card/fin/115/sephiroth-fabled-soldier-sephiroth-one-winged-angel)
resolves as the death payoff.

**Turn 4 — Syphon Mind helps the wrong graveyard.**
[Syphon Mind](https://scryfall.com/card/cm2/78/syphon-mind) makes p4 discard Sun
Titan. Graveyard Shift then spends all four mana on Arcane Signet and Talisman
of Hierarchy, reaching six available mana for turn 5.

**Turn 5 — the table taps out.** [Painful Quandary](https://scryfall.com/card/fdn/179/painful-quandary)
uses Sygg's five mana; The Twelfth Doctor uses p2's five; Osgir uses p3's mana
on RMS Titanic. Nobody can answer p4's main phase.

**Turn 5 — deterministic win.** Corpse Dance is cast **without buyback** for
three mana, returning Sun Titan. Changing Loyalty enchants the Titan for two.
Bartolomé sacrifices it; the Aura returns it; its ETB returns the Aura attached
to itself. Sephiroth drains once per death, then transforms on death four and
leaves an emblem that continues the drain. Repeating the loop eliminates all
three opponents.

## Review notes

The turn-2 Arcane Signet and turn-3 Talisman lines are reasonable ramp
alternatives, but combining them delays Bartolomé and Sephiroth. The corrected
turn-5 win keeps the recorded turn-2 outlet and turn-3 payoff, lands both rocks
on turn 4, then fixes the missed Corpse Dance line.

Casting Isolation Cell instead of Syphon Mind is also defensible and avoids
putting Sun Titan into p4's graveyard. That is a different branch, however,
and it prevents this exact turn-5 line; this replay corrects the recorded
branch rather than replacing it with the hypothetical one.

The old note calling discarded Mind Stone “Osgir fuel” was technically correct
but unclear: Osgir's second ability can exile that artifact card from the
graveyard to make two copies. Atsushi was never the fuel. The old replay also
correctly did not charge 3 life for Eye of Nidhogg under Breathstealer's Crypt,
because Eye is an enchantment rather than a creature.

## Watch it

`seed1729-sygg-doctor-osgir-bartolome.html` is self-contained: open it in a
browser for the felt table, life totals, the current event in the centre, the
stack, a 101-step slider, fixed transport controls, a collapsible event log,
and card art on hover. From turn 4 the Borrowed Time seat also shows a Top of
library zone, because [Fblthp, Lost on the Range](https://scryfall.com/card/otj/183/fblthp-lost-on-the-range)
makes that card public. GitHub will not render it inline, so download the file
or clone.

Regenerate it from the log with:

```bash
python3 .agents/skills/render-table-replay/scripts/render_replay.py \
  table-games/seed1729-sygg-doctor-osgir-bartolome.json
```

## Limits

One seed is a matchup sketch rather than evidence about win rates. This pod
also spans Bracket 2+ through 3+, so it is not a fair power comparison. No deck
was changed as a result.
