# Command Zone ep. 658 — working notes

Original: The Command Zone, *Commander Deckbuilding Template for the New Era*
(ep. 658, published 2025-02-18). Episode page:
https://edhrec.com/articles/the-command-zone-commander-deckbuilding-template-for-the-new-era-the-command-zone-658-mtg-edh-magic-gathering

This is a working summary for local lookup, not a transcript. Card examples in
the show stay illustrations; this table still prefers esoteric cards over
staples.

Secondary writeups used to fill numbers the episode page does not print:
[Farseek analysis checklist](https://farseek.ai/blog/how-to-analyze-your-commander-deck)
(updated 2026-06-26) and [Commander Deck Maker's 658 notes](https://commanderdeckmaker.com/learn/deckbuilding/command-zone-template)
(plan-card split; that page's 379 table is the *older* template and must not
be mixed with 658's mass-disruption count).

Snapshot **2026-09-14**.

## What the episode is for

A comparison skeleton so a brew can see accidental holes. Not a recipe that
makes every deck legal or good. Karsten land math and Salubrious Snail
calculators are cited in the show notes; land count in *this repo* still
starts from [`MANABASE.md`](../MANABASE.md).

Episode timestamps (from the EDHREC page): lands, card advantage, ramp,
targeted disruption, mass disruption, using categories, the template, plan
cards, mana curve, commander-curve template.

## 658 comparison point (typical midrange 99)

Counts describe **roles**. They overlap; the raw sum is allowed to exceed 99.

| Role | About | Counting notes from secondary writeups |
| --- | --- | --- |
| Lands | ~38 | True lands, not rocks. Storm/landfall deviate on purpose. |
| Ramp | ~10 | Primary job is extra mana. Conditional-on-commander mana is synergy. |
| Card advantage | ~12 | Dedicated draw. Skip tutors, ETB cantrips, impulse, combat-draw as "12." |
| Targeted disruption | ~12 | Spot answers, counters, hate, targeted stax. Instant vs sorcery matters. |
| Mass disruption | ~6 | True wipes and board-scale taxes. A modal wipe used as pinpoint is targeted. |
| Plan cards | ~30 | Identity and wins. Then split enablers / payoffs / enhancers. |

Older episode 379 (still widely copied) was roughly 36–38 lands, 10–12 ramp,
10 draw, 10–12 targeted, 3–4 wipes. 658 moved mass disruption up and named
plan cards as their own remainder.

## Plan-card split

Of the remainder, a rough **40% enablers / 35% payoffs / 25% enhancers**:

- Enablers: without them the verb does not happen.
- Payoffs: the verb becomes damage, cards, or a win.
- Enhancers: nicer, not required. First cuts.

A commander that is the enabler still needs payoffs in the 99. A pile of
payoffs with three enablers is a miss, not a theme.

## Curve

Build around when the commander realistically lands, not only its printed
cost. Dense 2–4 is the usual midrange shape. Average MV much above ~3.5 is a
smell that early turns do nothing.

## How this repo uses it

Compare, do not enforce. Interaction density still has to name
[`INTERACTION.md`](../INTERACTION.md) buckets. Lands still follow Karsten
hints, not a frozen 38.
