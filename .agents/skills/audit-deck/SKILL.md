---
name: audit-deck
description: >-
  Slot-by-slot Scryfall audit of a stored Commander 99. Challenges every unique
  card against current Oracle searches, prefers strange multifunctional cards
  and two-card packages over slightly better rate, then reports each replacement
  and why. Use when the user asks if the agent is happy with a deck, to go
  through it one more time, to check Scryfall for interesting cards for each
  slot, to find a strange card that handles multiple things, or to slot-audit /
  review every card. Skip for a new brew with no list (design-deck) and for
  parking (deck-ideas).
---

# Audit Deck

Go through a **stored** 99 once more. Every unique card is a slot. Search Scryfall for interesting challengers, including cards that do two jobs and weird two-card packages. Replace only when the challenger keeps the slot's job **and** adds a deck-specific interaction. Then show each replacement and why.

If the user already posted a list that is not imported, follow `deck-workspace` first. Do not write a 99 from a theme (`design-deck`) or park a brew (`deck-ideas`).

## 1. Lock the deck

1. Identify the folder with `deck-workspace`. Ask if several decks match.
2. Read `decklist.txt`, `cards.json`, and that deck's `DECISIONS.md` (`## Cards in`, `## Cards out`, `## Rules`).
3. Stop if cards are unresolved or validation fails.
4. Read root `DECISIONS.md`: esoteric old cards, avoid staples, zero Game Changers unless this deck is excepted.
5. Derive each slot's job from **Cards in**, not from a generic archetype.

Do not edit the 99 until the audit is finished, unless the user already said to apply as you go.

## 2. Slot map

A slot is one unique card's job. Group basic lands as one slot. The commander stays unless the user asked to rethink it.

For each slot, name:

- the incumbent and its job
- what a replacement must still do
- the Scryfall query shape (identity, legality, Oracle verbs for that job)

Skip a new search only when `## Cards out` already rejected the obvious challengers **and** nothing in the 99 has changed that argument.

## 3. Search

Follow `scryfall-lookup`. Query `api.scryfall.com`; do not invent Oracle text. Send `User-Agent: commander-decks/1.0` and `Accept: application/json`. Prefer cache hits for known names.

Default filters: `f:commander`, the commander's color identity (`id<=…` or `commander:`), `-is:gamechanger` unless this deck is excepted.

Search **per job**, not one dump of Dimir. Typical axes:

- the incumbent's verbs (`o:exile`, `o:"gain control"`, `o:"you may cast"`)
- creature types the commander cares about
- protection, evasion, ramp, graveyard conversion
- cards that combine two of those verbs

Look for **multifunctional** cards: one card that covers two or more of this deck's jobs. Also look for **packages**: two cards that together do something neither does well, in the manner of Vanish into Memory + Wall of Blood (instant-speed life-for-cards). That pair is an example of the *kind* of interaction, not a card to add unless this deck actually wants it. Details: [lessons.md](lessons.md).

Verify every shortlist name with collection or exact named lookup. Query live `is:gamechanger` before recommending.

## 4. Decide

Keep the incumbent unless the challenger:

1. still does the slot's job, and
2. adds another job this 99 already needs, a commander trigger, or a package with a card already in the list, and
3. is not a generic staple without a specific argument, and
4. is not already rejected in `## Cards out` without new evidence.

A slightly cheaper or more conventional version of the same effect is not enough. Two-card packages must have a useful floor when only one half is drawn. Do not force a replacement for every slot.

## 5. Report, then apply

Chat (not the primer) uses small Scryfall images for featured swaps only; keep names as links. After a sentence that groups several cards, add a Scryfall grid search (`.cursor/rules/card-chat-images.mdc`). Do not image the whole 99.

Lead with the swaps. For **each replacement**, show the in card (and the out card), the Oracle interaction, and why the incumbent lost. Then a short list of slots that kept the incumbent, with the strongest challenger and why it lost. Record rejected packages under that kept list, not as fake swaps.

If the user asked only for suggestions, stop here.

If they asked to apply, or accepted the package:

1. Edit `decklist.txt`.
2. Follow `deck-workspace` (resolve, categories, primer, tags, validate).
3. Update `## Cards in`, `## Cards out`, `## Rules`, and a dated `## Talks` note. Primer stays present-tense; swap history stays in the decision log.
4. Use `assess-deck` only if they asked for bracket or win-turn after the new 99.
5. Use `rank-deck` if they asked whether the new 99 is still on-goal, fun, oppressive, or janky.

## Queries

Keep queries narrow. Broaden once, and say so, if a job returns nothing useful.

```text
f:commander id<=ub -is:gamechanger o:exile o:opponent
f:commander id<=ub -is:gamechanger (o:"you may cast" or o:"you may play")
f:commander id<=ub -is:gamechanger (t:horror or t:nightmare)
is:gamechanger
```
