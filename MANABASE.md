# Mana Bases

Repository-wide construction reference. Use it while brewing or rebuilding a
99; use `simulate-deck` to test the resulting draws and sequencing.

Sources:

- [All Underplayed Utility Lands in Commander](https://www.youtube.com/watch?v=xy16QHJU-ls)
  by 3/3 Elk: fixing first, then make lands part of the deck's plan
- Frank Karsten, [How Many Sources Do You Need to Consistently Cast Your Spells?](https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/)
- Frank Karsten, [How Many Lands Do You Need in Your Deck?](https://www.tcgplayer.com/content/article/How-Many-Lands-Do-You-Need-in-Your-Deck-An-Updated-Analysis/cd1c1a24-d439-4a8e-b369-b936edb0b38a/)
- Frank Karsten, [What's an Optimal Mana Curve and Land/Ramp Count for Commander?](https://www.tcgplayer.com/content/article/What-s-an-Optimal-Mana-Curve-and-Land-Ramp-Count-for-Commander/e22caad1-b04b-4f8a-951b-a41e9f08da14/)
- Reid Duke, [Managing Your Mana Base](https://www.tcgplayer.com/content/article/Managing-Your-Mana-Base-Deep-Dive/817630e3-756a-481c-8042-b2bf1e8bbd10/)

The numerical models are baselines, not proof that a particular 99 works. They
assume normal mulligans and simplified card behavior. Record deviations, then
test them.

## House preference

- Dual lands are welcome. Do not reject original duals, shocks, fetches, pains,
  filters, fast lands, or other untapped fixing merely because they cost money.
  A declared budget still wins.
- A land that always enters tapped needs meaningful upside for this deck:
  selection, recursion, removal, a combo or engine role, relevant land types,
  or another effect worth the lost mana. Life gain by itself is not meaningful.
- Conditional untapped lands are not tap lands by label. Check whether this
  exact mana base turns them on for the turns that matter.
- Prefer an untapped basic over a generic Guildgate, gain land, or other
  fixing-only tap land.

## Construction order

### 1. Write the mana obligations

Before choosing lands, record:

- the commander and engine turn;
- every spell that must be cast on curve, grouped by turn and colored pips;
- activated abilities, alternative costs, colorless pips, and snow costs;
- land-type dependencies such as Forest for `Arbor Elf`, Mountain for `Anger`,
  Island count for `Scourge of Fleets`, or basic Swamps for `Cabal Stronghold`;
- the amount of mana the plan wants after setup and where excess mana goes.

Use the intended casting turn, not always printed mana value. Cost reduction,
convoke, delve, or an alternative cost changes the obligation only when the
deck can reliably enable it.

### 2. Set land count and curve together

Keep these counts separate:

- true lands;
- spell/land MDFCs;
- one-mana dorks and auras;
- two-plus-mana ramp;
- temporary or conditional mana.

For an ordinary Commander starting point, calculate Karsten's estimate:

```text
effective lands = 31.42
  + 3.13 × average mana value of spells
  - 0.28 × cheap draw or ramp spells
```

Count only cheap support that can realistically be used before the land drop or
mana milestone it is meant to help. Do not give full credit to a fragile,
conditional, color-strained, or opponent-dependent effect. Count non-mythic
spell/land MDFCs as about 0.4 land and mythic untapped MDFCs as about 0.75 land
for this estimate, while still reporting the true-land count separately.

Round the estimate into a proposed mana package, then justify changes from it
with the curve, commander timing, reliable selection, land synergies, and
simulation. Ramp does not replace the land required to cast that ramp.

Karsten's separate midrange optimization starts around 42 lands for a two- or
three-mana commander, 39 for a four- or five-mana commander with seven or eight
two-mana rocks, and 38 for a six-mana commander with nine. This is a warning
against reflexive `36 lands + 10 rocks`, not a template that overrides the
deck's plan or the repository's fast-mana rules.

### 3. Meet colored-source floors

For a 99-card library, Karsten's on-curve floors are:

| Cost shape | Sources | Cost shape | Sources |
| --- | ---: | --- | ---: |
| `C` | 19 | `1C` | 19 |
| `2C` | 18 | `3C` | 16 |
| `4C` | 15 | `5C` | 14 |
| `CC` | 30 | `1CC` | 28 |
| `2CC` | 26 | `3CC` | 23 |
| `4CC` | 22 | `5CC` | 20 |
| `CCC` | 36 | `1CCC` | 33 |
| `2CCC` | 30 | `3CCC` | 28 |
| `4CCC` | 26 | `CCCC` | 39 |
| `1CCCC` | 36 |  |  |

`C` means one pip of the color being tested, not colorless mana. Treat true
`{C}` and snow as their own source requirements.

For multicolor spells, test each color separately, test the combined pool, and
add one source to each relevant floor as Karsten's conservative gold-card
adjustment. A source can satisfy several separate color counts, but one land
cannot pay two pips at once.

Count conservatively:

- a land counts for every color it can produce on the required turn;
- only turn-one-untapped sources count for a turn-one spell;
- a fetch counts for each color that an available legal target can supply;
- a Pathway or basic-only fetch is a full source of both choices in two colors,
  but about two-thirds of each in a demanding three-plus-color base;
- a non-mythic spell/land MDFC is about 0.8 of its color for source counting; a
  mythic untapped MDFC is one;
- a fragile dork is at most 0.5 source for spells costing two or more, and only
  if the dork itself has enough untapped sources;
- a two-mana rock is at most 0.75 source for spells costing three or more;
- a two-mana land-ramp spell is at most 0.75 of the colors it can find for
  spells costing three or more;
- do not credit Treasure, cost reduction, or opponent-dependent mana at its
  ceiling.

The table assumes roughly 41 lands. For substantially different land counts,
use the required source-to-land ratio as a warning and test the actual list
instead of presenting the table as exact probability.

### 4. Audit tempo

Make a turn-one-through-commander-turn land sequence. For every land that might
enter tapped, name:

1. how often its condition fails;
2. which turn can absorb it without skipping the planned play;
3. what deck-specific upside pays for the tempo loss.

There is no generic tapped-land allowance. An early proactive deck may have no
safe window; a slower deck may have several. Multiple individually defensible
tap lands can still produce an indefensible opening hand.

### 5. Spend the utility budget

Fix colors and tempo first. The remaining land slots are the utility budget.
Search current Oracle data rather than copying a generic package:

```text
t:land id=2
t:land id=rb
otag:rainbow-land
otag:utility-land
```

Add `usd<...` only when the user set a budget. In deck sites that understand
Scryfall syntax, use the commander's identity filter; otherwise substitute the
actual color identity.

Look for lands that overlap a spell slot:

- removal, graveyard hate, protection, sacrifice outlets, recursion, or
  finishers;
- discard, self-mill, artifact, token, counter, blink, or extra-combat synergy;
- relevant basic land types or cycling;
- MDFCs, channel lands, creature lands, and other anti-flooding modes;
- mana sinks that make later land drops useful.

Do not add a famous colorless utility land by habit. It spends both a colored
source and a utility slot. Name the matchup or engine it serves.

Land tutors belong when several targets form a real toolbox or one land is
central to the plan. Count the tutor's mana and card cost; `Expedition Map` is
not a land drop. Verify that each tutor can find each claimed target.

## Required brew record

Before locking the first 99, put this in the deck's `DECISIONS.md`:

- formula estimate, proposed true lands, MDFCs, and ramp by speed;
- average mana value and the cheap-support cards credited by the estimate;
- the strictest colored, colorless, snow, and land-type requirements;
- actual source counts and turn-one-untapped counts;
- each always-tapped land, its safe turn, and its deck-specific upside;
- each utility land and the colored source or basic slot it displaced;
- the mana sink or anti-flood plan;
- uncertainties to test with `simulate-deck`.

Reject version 1 when a hard source floor or planned early sequence fails.
Utility is not compensation for an unreliable mana base.
