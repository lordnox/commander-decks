# Commander Bracket definitions

This file is the repository baseline for Commander Brackets. Read it whenever
bracket, power, expected win turn, Game Changer caps, or pod matchmaking comes
up. It is the **only** source an assessment needs: official intent, printed
caps, the cached Game Changers list, and this table's reading all live here.
Do not reconstruct brackets from memory and do not re-fetch Wizards pages or
Scryfall as routine work.

Official sources for the copied intent text and the cached list:

- [Commander format page](https://magic.wizards.com/en/formats/commander)
- [October 21, 2025 bracket update](https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025)
- [February 9, 2026 update](https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026)

Cite this file in assessments. Cite the Wizards pages above when quoting
official wording, never a third-party list.

## Refreshing this file

Everything here is a snapshot, so it can go stale. Refresh only when the user
asks, when Wizards announces a bracket or Game Changer change, or when a
card's status is genuinely in doubt:

```bash
python3 .agents/skills/assess-deck/scripts/update_game_changers.py            # rewrite the cache
python3 .agents/skills/assess-deck/scripts/update_game_changers.py --check    # is it stale?
```

`--check` compares the cached names against live `is:gamechanger` and prints
what to add or remove. When Wizards changes bracket text or caps, fetch the
pages above and edit the sections below by hand in the same commit.

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

## Cached Game Changers

Match a deck manifest against this list instead of querying Scryfall. Note in
the assessment that the count came from this snapshot, and give its date. Only
re-run the refresh script when the snapshot is suspected stale.

<!-- game-changers:start -->
Snapshot of Scryfall `is:gamechanger` taken 2026-09-03: **53 cards**.

| Group | Cards |
| --- | --- |
| White (7) | [Drannith Magistrate](https://scryfall.com/card/iko/11/drannith-magistrate), [Enlightened Tutor](https://scryfall.com/card/dmr/6/enlightened-tutor), [Farewell](https://scryfall.com/card/mkc/64/farewell), [Humility](https://scryfall.com/card/tpr/16/humility), [Serra's Sanctum](https://scryfall.com/card/usg/325/serras-sanctum), [Smothering Tithe](https://scryfall.com/card/cmm/57/smothering-tithe), [Teferi's Protection](https://scryfall.com/card/2x2/32/teferis-protection) |
| Blue (10) | [Consecrated Sphinx](https://scryfall.com/card/2x2/43/consecrated-sphinx), [Cyclonic Rift](https://scryfall.com/card/rvr/40/cyclonic-rift), [Fierce Guardianship](https://scryfall.com/card/cmm/94/fierce-guardianship), [Force of Will](https://scryfall.com/card/dmr/50/force-of-will), [Gifts Ungiven](https://scryfall.com/card/2x2/51/gifts-ungiven), [Intuition](https://scryfall.com/card/tpr/54/intuition), [Mystical Tutor](https://scryfall.com/card/dmr/60/mystical-tutor), [Narset, Parter of Veils](https://scryfall.com/card/cmm/853/narset-parter-of-veils), [Rhystic Study](https://scryfall.com/card/j22/114/rhystic-study), [Thassa's Oracle](https://scryfall.com/card/thb/73/thassas-oracle) |
| Black (10) | [Ad Nauseam](https://scryfall.com/card/2xm/76/ad-nauseam), [Bolas's Citadel](https://scryfall.com/card/war/79/bolass-citadel), [Braids, Cabal Minion](https://scryfall.com/card/mh2/273/braids-cabal-minion), [Demonic Tutor](https://scryfall.com/card/cmm/150/demonic-tutor), [Imperial Seal](https://scryfall.com/card/2x2/79/imperial-seal), [Necropotence](https://scryfall.com/card/ima/98/necropotence), [Opposition Agent](https://scryfall.com/card/cmr/141/opposition-agent), [Orcish Bowmasters](https://scryfall.com/card/ltr/103/orcish-bowmasters), [Tergrid, God of Fright // Tergrid's Lantern](https://scryfall.com/card/khm/112/tergrid-god-of-fright-tergrids-lantern), [Vampiric Tutor](https://scryfall.com/card/dmr/108/vampiric-tutor) |
| Red (3) | [Gamble](https://scryfall.com/card/dmr/121/gamble), [Jeska's Will](https://scryfall.com/card/mkc/156/jeskas-will), [Underworld Breach](https://scryfall.com/card/thb/161/underworld-breach) |
| Green (7) | [Biorhythm](https://scryfall.com/card/9ed/231/biorhythm), [Crop Rotation](https://scryfall.com/card/dmr/154/crop-rotation), [Gaea's Cradle](https://scryfall.com/card/usg/321/gaeas-cradle), [Natural Order](https://scryfall.com/card/ema/177/natural-order), [Seedborn Muse](https://scryfall.com/card/tdc/268/seedborn-muse), [Survival of the Fittest](https://scryfall.com/card/tpr/199/survival-of-the-fittest), [Worldly Tutor](https://scryfall.com/card/dmr/185/worldly-tutor) |
| Multicolor (4) | [Aura Shards](https://scryfall.com/card/cmd/182/aura-shards), [Coalition Victory](https://scryfall.com/card/tsb/91/coalition-victory), [Grand Arbiter Augustin IV](https://scryfall.com/card/2x2/221/grand-arbiter-augustin-iv), [Notion Thief](https://scryfall.com/card/znc/96/notion-thief) |
| Colorless (12) | [Ancient Tomb](https://scryfall.com/card/uma/236/ancient-tomb), [Chrome Mox](https://scryfall.com/card/2xm/240/chrome-mox), [Field of the Dead](https://scryfall.com/card/m20/247/field-of-the-dead), [Glacial Chasm](https://scryfall.com/card/me2/229/glacial-chasm), [Grim Monolith](https://scryfall.com/card/ulg/126/grim-monolith), [Lion's Eye Diamond](https://scryfall.com/card/vma/271/lions-eye-diamond), [Mana Vault](https://scryfall.com/card/2x2/308/mana-vault), [Mishra's Workshop](https://scryfall.com/card/vma/305/mishras-workshop), [Mox Diamond](https://scryfall.com/card/tpr/228/mox-diamond), [Panoptic Mirror](https://scryfall.com/card/dst/136/panoptic-mirror), [The One Ring](https://scryfall.com/card/ltr/246/the-one-ring), [The Tabernacle at Pendrell Vale](https://scryfall.com/card/me3/212/the-tabernacle-at-pendrell-vale) |

<!-- game-changers:end -->

Sol Ring is deliberately absent: Wizards does not list it, but root
`DECISIONS.md` treats permanent fast mana as kitchen-table 4+. Say so in the
fast-mana row rather than counting it against a cap.

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
