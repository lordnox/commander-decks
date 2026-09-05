# Interaction

Kitchen-table reference for what an interaction slot is *for*, not a count of "removal." Read it when brewing, auditing, or arguing whether a 99 has too much or too little interaction.

Source: [What BIG Removal Is Hiding From You](https://www.youtube.com/watch?v=Hwp-tnoToCI) (Wise Hoopoe MTG). This file is a working summary, not a transcript. Hoopoe's card examples stay as illustrations; this table still prefers esoteric cards over staples when filling a slot (`DECISIONS.md`).

## How to use

- Categorize a card by **why it is in the 99**, not by every line of Oracle it could theoretically cover. One `Deflecting Swat` is not a full protection package.
- "Run eight more interaction" is useless until the bucket is named (wipe, targeted removal, fog, board protection, stacks, discard).
- A card can sit in more than one bucket. When building, pick a **floor** purpose and count that slot there.

## Definition

**Interaction** is a card included with the express purpose of reducing the effectiveness of opponents' cards.

Incidental defense does not count. A large creature that happens to block well is not interaction if it is in the deck to attack. A card run *because* it blocks, phases, or otherwise answers is.

## Tree

Everything in a child category is also in its parents. Siblings are not interchangeable.

```text
interaction
├── protection          (stop their answers / stop their kill)
│   ├── board protection
│   └── life-total protection (fogs)
└── disruption          (hinder their plan)
    ├── proactive disruption  (answer cards before they are played)
    └── reactive disruption   (answer cards after they are played)
        ├── board wipes
        └── targeted removal
```

Counters and similar stack spells move between disruption and protection depending on density and intent: a high count held to stop their plays is disruption; two or three held to seal a win is protection.

## Cross-cutting trade-off: in hand vs on board

This comparison runs through every bucket.

| | In hand (instant) | On board (permanent / deployed) |
| --- | --- | --- |
| Strength | Surprise; they line up a play that then fails | Always available; no need to hold mana |
| Cost | Mana left up, and the card can rot in hand | Everyone can see it and play around it |

Example: one fat creature, two spare mana, opponent is tapped out and secretly has `Swords to Plowshares` or `Vanquish the Horde`. Equipping `Lightning Greaves` tells them Plowshares is dead, so they wipe. Holding `Blossoming Defense` lets them think Plowshares is enough, then the pump eats the exile and the attack still happens.

On-board protection says "bring two answers." On-board removal (the **gun on the table**) says "the first real threat you play dies," which can freeze a table even before the ability is used.

## Protection

Preserve the current position. Split by what is being saved.

### Board protection

Reduce the effectiveness of their interaction: hexproof, shroud, indestructible, phasing, bounce-home, recast, uncounterable.

Choose against the table you actually see: counters, exile, wipes, or pinpoint removal. Wide decks fear wipes; Voltron and secret commanders fear targeted answers.

### Life-total protection (fogs)

Stop them from changing life totals. Instant fogs bait overextension ("player removal is removal") and leave them without blockers. On-board or looping fogs (`Solitary Confinement` and cousins) shut off combat as a primary win; they lose the surprise.

## Disruption

Slow other players so this deck can catch up or stay ahead. Games are a race; disruption is the brake on everyone else.

### Proactive disruption

Answer cards **before** they are played: stax that strand hands, discard that deletes options. Lets an early board stay ahead.

**Symmetrical effects are never symmetrical.** The caster chose when to impose the lock and built to break parity (`Blood Moon` from a mono-red list; casting noncreature spells the turn before `Ruric Thar, the Unbowed`). Build the 99 so the "equal" effect was already rigged.

### Reactive disruption

Answer cards **after** they are played. Most of what people mean by "removal."

#### Board wipes

Intended to answer **all** problems at once, not one high-value target. They halt momentum, including this deck's, unless parity is broken:

1. Printed one-sided wipes (usually a mana premium).
2. Carve-outs (hit only creatures, only artifacts, only non-tokens, only big, only tapped).
3. Timing: cheap wipes (three mana or less) so the same turn can rebuild; stop deploying creatures once a wipe is the plan; or pair a wipe with board protection so it is one-sided in play.

If this deck is casting a wipe, it is behind. The wipe should be exploitable.

#### Targeted removal

Eliminate **specific** threats as they appear. It does not need to use the word target.

The job is not card advantage. Commander power is uneven: most of a 99 is filler, a few cards are the engine. Targeted removal is a cheap, flexible exchange that knocks off the current power outlier. A less optimized list can still punch up by keeping opponents' *best* cards off the table.

Value, in order:

1. Kill the best card they have **right now** (threat assessment is timing: `Rhystic Study` is usually the answer; `Kiki-Jiki, Mirror Breaker` with `Zealous Conscripts` on the stack is the answer instead).
2. Do it at the lowest cost to this deck.
3. Prefer cheap instants so unused mana is small and the spell can fire at peak leverage.
4. If extra mana is spent, the spell should still work through their protection.

An instant one-for-one beats a sorcery three-for-one for this job. Exception: **removal engines** (repeatable or blinkable, e.g. `Eldrazi Displacer` plus `Ravenous Chupacabra`). Drawing enough one-shot kill spells to match that rate is unrealistic, and the gun-on-the-table effect scales with repetition.

Aggro that only needs blockers gone can accept sorcery-speed removal.

## Package by plan

Counts are Hoopoe's worked examples, not templates. Slant the mix at what this deck actually fears. "Aggro should cut interaction" and "aggro should only run protection" are both incomplete.

| Plan | What the mix is for | Hoopoe's sketch (Bracket 3 examples) |
| --- | --- | --- |
| Aggro | Open lanes (blockers) and punish the decks that control combat (artifacts, enchantments, attrition) | ~15: 2 board protection, 2 proactive, 5 targeted, 6 wipes. Haste/indestructible in the command zone can replace some protection. Consider fogs after a swing-out instead of spare heroic-intervention style cards. |
| Midrange | Buy time. Generalist cards that fill two roles (blink as protection *and* removal) are expected, but they still need one primary purpose | ~17: heavy board protection, a couple of fogs, more targeted than wipes, maybe one stax piece that is also combo. The list wins through combo or evasion, so opponent boards matter less than their ability to stop the combo turn (`Tidal Barracuda` class). |
| Control | Answers that feel endless against three players' worth of cards, usually via an engine rather than three discrete spells a turn | Hoopoe's `Avacyn, Angel of Hope` sketch: ~35 interaction, almost all wipes, some board protection, almost no proactive pieces, few pinpoint spells. The engine is Avacyn plus protection; wipes are the card-advantage plan. |

Control that has angered the table is answering three decks alone. Either draw enough discrete answers or build a repeatable engine so a 3:1 card deficit does not matter.

## Open corners

The tree is a deckbuilding tool, not a complete map. Land denial like `Sundering Eruption`, and the difference between destroy, bounce, and exile-for-a-turn, are real interaction and still sit awkwardly in the buckets. Classify them by purpose in *this* 99.
