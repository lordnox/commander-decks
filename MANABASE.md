# Mana Bases

Deck-building **hints** for mana bases: things worth thinking about, numbers
worth sanity-checking against, and a rough order that tends to work. None of it
is a rule. A deck that knowingly ignores every number here can still be the
right deck — the point is to notice the trade, not to pass a checklist.

Use `simulate-deck` when a mana question actually matters enough to test.

Sources:

- [All Underplayed Utility Lands in Commander](https://www.youtube.com/watch?v=xy16QHJU-ls)
  by 3/3 Elk: fixing first, then let lands carry part of the deck's plan
- Frank Karsten, [How Many Sources Do You Need to Consistently Cast Your Spells?](https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/)
- Frank Karsten, [How Many Lands Do You Need in Your Deck?](https://www.tcgplayer.com/content/article/How-Many-Lands-Do-You-Need-in-Your-Deck-An-Updated-Analysis/cd1c1a24-d439-4a8e-b369-b936edb0b38a/)
- Frank Karsten, [What's an Optimal Mana Curve and Land/Ramp Count for Commander?](https://www.tcgplayer.com/content/article/What-s-an-Optimal-Mana-Curve-and-Land-Ramp-Count-for-Commander/e22caad1-b04b-4f8a-951b-a41e9f08da14/)
- Reid Duke, [Managing Your Mana Base](https://www.tcgplayer.com/content/article/Managing-Your-Mana-Base-Deep-Dive/817630e3-756a-481c-8042-b2bf1e8bbd10/)

The models come from 60-card constructed and idealized Commander midrange. They
assume normal mulligans and simplified card behaviour, so treat them as a
starting guess and a way to spot a mana base that drifted far from sane.

## Table preference

- Dual lands are welcome. Price is not a reason to skip original duals, shocks,
  fetches, pains, filters, or fast lands. A declared budget for a deck wins.
- Tap lands are disliked unless they bring something: selection, recursion,
  removal, an engine or combo role, relevant land types, cycling, or another
  effect worth the lost tempo. Incidental life gain does not count for much.
- Conditional lands are not tap lands by label. Check whether *this* mana base
  turns them on when it matters.
- A plain Guildgate or gain land is usually worse than an untapped basic.

## A rough order

### 1. Note what the mana actually has to do

Worth knowing before picking lands:

- the commander and engine turn;
- the spells that really want to be cast on curve, and their coloured pips;
- activated abilities, alternative costs, colourless pips, and snow costs;
- land-type dependencies like Forest for `Arbor Elf`, Mountain for `Anger`,
  Island count for `Scourge of Fleets`, basic Swamps for `Cabal Stronghold`;
- where extra mana goes once the deck is set up.

The turn a spell is realistically cast matters more than its printed mana
value, though cost reduction, convoke, and delve only count when the deck can
reliably turn them on.

### 2. Land count and curve move together

These are different things and collapsing them into one "lands" number hides
problems:

- true lands;
- spell/land MDFCs;
- one-mana dorks and auras;
- two-plus-mana ramp;
- temporary or conditional mana.

Karsten's estimate is a decent first guess for an ordinary deck:

```text
effective lands = 31.42
  + 3.13 × average mana value of spells
  - 0.28 × cheap draw or ramp spells
```

Cheap support only helps if it can be used before the land drop it is meant to
cover, so fragile, colour-strained, or opponent-dependent effects are worth
discounting. Non-mythic spell/land MDFCs count as roughly 0.4 land and mythic
untapped ones roughly 0.75, but the true-land count is still worth stating on
its own.

Karsten's midrange optimisation lands near 42 for a two- or three-mana
commander, 39 for a four- or five-mana commander with seven or eight rocks, and
38 for a six-mana commander with nine. Mostly this is a nudge against
reflexively writing `36 lands + 10 rocks` without thinking. Ramp also does not
replace the land needed to cast the ramp.

### 3. Coloured sources, as a sanity check

Karsten's on-curve numbers for a 99-card library:

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

`C` is one pip of the colour being checked, not colourless. True `{C}` and snow
behave like their own colours.

For gold cards, checking each colour separately plus the combined pool, and
adding one to each number, is Karsten's rough adjustment. One source can serve
several separate colour counts, but a single land still cannot pay two pips.

Counting suggestions:

- a land counts for each colour it can make on the turn in question;
- only untapped sources help a turn-one spell;
- a fetch counts for colours it has a legal target for;
- a Pathway or basic-only fetch is close to a full source of both in two
  colours, nearer two-thirds each in a strained three-plus-colour base;
- a non-mythic spell/land MDFC is about 0.8 of its colour, a mythic untapped
  one about a full source;
- a fragile dork is worth around half a source for two-plus-mana spells, and
  only when the dork itself is castable;
- a two-mana rock is around three-quarters of a source for three-plus-mana
  spells, as is a two-mana land-ramp spell for the colours it finds;
- Treasure, cost reduction, and opponent-dependent mana are usually worth less
  than they look.

The table assumes about 41 lands. At very different land counts the ratio is
more informative than the raw number, and the real list is more informative
than either.

### 4. Look at the early turns

Sketching turns one through the commander turn usually exposes more than any
count. For a land that can enter tapped, the useful questions are how often its
condition fails, which turn could absorb it, and what it gives back.

There is no universal tapped-land allowance: a proactive early deck may have no
comfortable window, a slower one several. Individually reasonable tap lands can
still stack into an awkward opener.

### 5. Then have fun with the rest

Once colours and tempo are in decent shape, the remaining land slots are free
to do work. Searching beats copying a generic package:

```text
t:land id=2
t:land id=rb
otag:rainbow-land
otag:utility-land
```

Add `usd<...` when there is a budget. Deck sites that speak Scryfall syntax
accept the identity filter directly.

Lands that overlap a spell slot are the interesting ones:

- removal, graveyard hate, protection, sacrifice outlets, recursion, finishers;
- discard, self-mill, artifact, token, counter, blink, or extra-combat synergy;
- relevant basic land types or cycling;
- MDFCs, channel lands, creature lands, and other anti-flood modes;
- mana sinks that make a late land drop worth something.

A famous colourless utility land still costs a coloured source and a slot, so
it is worth being able to say what it is there for. `Reliquary Tower` in a deck
that never holds cards is the classic example of a reflex include.

Land tutors get better when several targets form a toolbox or one land is
central to the plan. They cost mana and a card, though, and `Expedition Map` is
not a land drop. Checking that a tutor can actually find the claimed target is
cheap insurance.

## Worth writing down

When a mana base involved real decisions, the deck's `DECISIONS.md` is the
place for them:

- the land, MDFC, and ramp counts, and why they ended where they did;
- the strictest colour, colourless, snow, or land-type needs;
- tap lands that were kept, and what they bring;
- utility lands and what they displaced;
- the anti-flood or mana-sink plan;
- anything uncertain enough to be worth a `simulate-deck` run.

A missed source number or a clunky opening sequence is a flag worth a second
look, not an automatic veto. Utility does not fix an unreliable mana base, but
an unusual deck is allowed to want an unusual mana base.
