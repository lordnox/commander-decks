# Commander Bracket definitions

This file is the repository baseline for Commander Brackets. Read it whenever
bracket, power, expected win turn, Game Changer caps, or pod matchmaking comes
up. Do not reconstruct brackets from memory.

Live Wizards pages can change. On an assessment, also fetch:

- https://magic.wizards.com/en/formats/commander
- the latest official Commander Brackets announcement on magic.wizards.com

If those pages disagree with the official text copied below, the live pages
win for **printed intent** and **Game Changer caps**. Then apply this table's
reading (win texture, Incremental Core, Parley) for kitchen-table talk and for
how this repo labels decks.

Official sources for the copied intent text:

- [Commander format page](https://magic.wizards.com/en/formats/commander)
- [October 21, 2025 bracket update](https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025)
- [February 9, 2026 update](https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026)

Query current Game Changers with Scryfall `is:gamechanger`. Cite the Wizards
page, not a third-party list.

## How to use these brackets

Brackets are optional matchmaking. Intent and **win texture** classify a deck
before card checklists. Turn floors are satisfaction bars, not stopwatches: "at
least six turns" means the table would be fine if the game ended on someone's
seventh turn, not that every game lasts that long. Score the deck's **normal,
repeatable** pace. A rare nut draw does not promote it.

Do not classify a deck by counting Game Changers alone. Do not promote a slow
deck for an expensive mana base. Do not demote a compact, consistent kill
because it has zero Game Changers.

This table mostly plays Brackets 2 and 3. Bracket 1 is theme-over-power when
someone wants that. Brackets 4 and 5 are out of scope for brewing here unless
the user asks.

## Official intent

Copied from the October 21, 2025 update. Official names are Exhibition, Core,
Upgraded, Optimized, and cEDH.

### Bracket 1: Exhibition

Players expect:

- Decks to prioritize a goal, theme, or idea over power
- Rules around card legality or viable commanders to have some flexibility depending on the pod
- Win conditions to be highly thematic or substandard
- Gameplay to be an opportunity to show off your creations

Generally, you should expect to be able to play at least nine turns before you
win or lose. Most importantly, given this bracket's emphasis on theme, players
should feel like they have the time to showcase their decks.

### Bracket 2: Core (Incremental)

Players expect:

- Decks to be unoptimized and straightforward, with some cards chosen to maximize creativity and/or entertainment
- Win conditions to be incremental, telegraphed on the board, and disruptable
- Gameplay to be low pressure with an emphasis on social interaction
- Gameplay to be proactive and considerate, letting each deck showcase its plan

Generally, you should expect to be able to play at least eight turns before you
win or lose.

Wizards' name is **Core**. This repo's job name is **Incremental**: each step
builds on the board, the table can see the win coming, and there is no
oops-I-win card. [Test of Endurance](https://scryfall.com/card/dmr/32/test-of-endurance)
is the shape (must survive a turn cycle, dies to damage, needs 50 life).
[Torment of Hailfire](https://scryfall.com/card/hou/77/torment-of-hailfire) on
turn 8 or 9 can still meet the turn floor and still be Upgraded texture: a
from-hand dump after accrued mana.

### Bracket 3: Upgraded

Players expect:

- Decks to be powered up with strong synergy and high card quality; they can effectively disrupt opponents
- Game Changers that are likely to be value engines and game-ending spells
- Win conditions that can be deployed in one big turn from hand, usually because of steadily accrued resources
- Gameplay to feature many proactive and reactive plays

Generally, you should expect to be able to play at least six turns before you
win or lose.

Upgraded may still win incrementally. The difference is a stronger engine,
faster and more optimized cards, and the *option* to dump a game from hand.
Incremental lines are allowed; oops-I-win from hand is the extra permission,
not a requirement.

### Bracket 4: Optimized

Players expect:

- Decks not to adhere to the cEDH metagame reserved for Bracket 5
- Decks to be lethal, consistent, and fast, designed to take people down as fast as possible
- Game Changers that are likely to be fast mana, snowballing resource engines, free disruption, and tutors
- Win conditions to vary but be efficient and instantaneous
- Gameplay to be explosive and powerful, featuring huge threats and efficient disruption to match

Generally, you should expect to be able to play at least four turns before you
win or lose.

### Bracket 5: cEDH

Players expect:

- Decks that are meticulously designed to battle in the cEDH metagame, with the ability to win quickly or generate overwhelming resources; often built using existing cEDH knowledge, tools, and/or decklists
- Win conditions to be optimized for efficiency and consistency
- Gameplay to be intricate and advanced, with razor-thin margins for error; players prioritize victory over all else

These games could end on any turn.

## Printed caps and barometers

Live-page baseline unless Wizards changes it:

| Bracket | Game Changers | Typical barometers (not a fixed checklist) |
| --- | --- | --- |
| 1–2 | 0 | No early two-card infinites, extra turns, or mass land denial as the plan |
| 3 | up to 3 | Extra turns in low quantities, not chained; Game Changers as value or finishers |
| 4–5 | unlimited | Fast mana, snowballing engines, free disruption, tutors among Game Changers |

Two-card infinites, extra turns, and mass land denial are **barometers**, not a
ban list. A combo that *often* comes up before the turn floor does not belong
in that bracket even if the pilot waits to fire it.

## This table's reading (Parley)

The printed caps are guidelines for a kitchen-table pod, closer to "Parley"
than to a DCI infraction. Theme and texture can outweigh a listed Game Changer
**when that is said out loud**.

Examples:

- [Gamble](https://scryfall.com/card/dmr/121/gamble) in a deck that is *about*
  gambling can still play as Exhibition. It is still a one-mana tutor. Footnote
  it; do not silently file the deck as Bracket 1.
- [Coalition Victory](https://scryfall.com/card/tsb/91/coalition-victory) in a
  Weatherlight Sisay brew can have Core-shaped setup (creatures of each color
  sitting on the board). The spell is still "you win the game." Speed and
  consistency of assembling the crew choose 2 vs 3 for the *pod*. Official
  Bracket 2 still excludes Game Changers on a form.

A default advertised bracket without a footnote follows the printed caps.
"Thematic" does not cancel a Game Changer unless the pod agreed.

## Position within a bracket

When this repo rates a stored deck, write `N−`, `N`, or `N+`:

- `N−`: lower edge
- `N`: middle
- `N+`: upper edge

Directory prefixes use ASCII `-` / none / `+` (`3-_`, `3_`, `3+_`). Use normal
pace, consistency, resilience, tutors, fast mana, interaction, and compactness.
Record a materially faster exceptional line separately. A deck that usually
threatens on turn six with an unlikely turn-four line can be `3+`; that line
alone is not Bracket 4.
