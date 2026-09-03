---
name: simulate-deck
description: >-
  Goldfish a resolved Commander deck with reproducible opening hands,
  turn-by-turn plays, London mulligans, and bracket-specific disruption
  scenarios. Use when testing new or existing decks, checking early turns,
  mana, interaction, protection, commander recovery, or comparing revisions.
  Take bracket-dependent pressure models from BRACKET-DEFINITIONS.md.
---

# Simulate Deck

Test a resolved deck without changing it. A simulation finding is a diagnosis,
not authorization to edit the deck.

`autobrew-deck` may invoke this skill and use its report for an authorized brew
iteration. For a standalone request against an existing deck, report results
and stop unless the user separately asks for changes.

## 1. Load the deck

1. Inspect directories directly under `decks/` and identify the requested deck.
2. Read its `decklist.txt`, `cards.json`, primer, and `DECISIONS.md`.
3. Run `validate_deck.py`. Stop on unresolved cards, invalid deck size, missing
   commander data, or errors that make draws unreliable.
4. Use Oracle details embedded in `cards.json`; use `scryfall-lookup` only for
   missing or current rules data.

Do not simulate from names alone when a resolved manifest exists.

## 2. Declare the test model

Before dealing hands, state:

- primary game plan and backup route;
- stored or intended bracket;
- expected commander or engine setup turn;
- the concrete milestone being tested by turn five;
- the turn horizon, number of runs, seeds, and mulligan policy;
- opposing assumptions and required stress tests.

Infer these from the primer and decisions when possible. If the deck has no
declared milestone, choose one that measures setup rather than pretending every
deck should win by turn five. State uncertain assumptions instead of silently
hard-coding them.

Take bracket-specific expectations from
[`BRACKET-DEFINITIONS.md`](../../../BRACKET-DEFINITIONS.md) rather than live
pages. The bracket controls the pressure model:

| Target | Required stress tests |
|---|---|
| Brackets 1–2 | Plan develops by turn five; one later key-piece removal; no artificial turn-four policing requirement |
| Bracket 3 | Commander removed after its normal cast; must-answer permanent by turns five or six; one board wipe or engine loss |
| Bracket 4 | Opposing commander or engine must be answered by turn four; own commander removed on curve; protection or stack interaction under pressure |
| Bracket 5 | Use cEDH metagame, mulligan, priority, and interaction assumptions; turn-five solitaire is insufficient |

## 3. Deal reproducible hands

For a default 12-run test:

```bash
python3 .agents/skills/simulate-deck/scripts/goldfish.py \
  decks/<deck> --runs 8 --turns 5 --seed 1729
python3 .agents/skills/simulate-deck/scripts/goldfish.py \
  decks/<deck> --runs 4 --turns 5 --seed 2718
```

The first eight are regression hands. Reuse seed 1729 to compare revisions or
decks under the same method. The other four reduce overfitting to that sample.
Use a user-supplied run count, turn horizon, or seed when provided.

The helper presents fresh seven-card options for zero, one, and two London
mulligans. It excludes commanders and `{noDeck}` entries from the library and
supports partner libraries.

For each run:

1. Choose the keep using the deck's actual plan and bracket.
2. Name cards put on the bottom.
3. Play legal turns in order, including the multiplayer turn-one draw.
4. Track coloured sources, mana spent, cards in hand, and battlefield.
5. Do not reorder unknown cards or assume tutors, lands, or answers not drawn.

## 4. Trace every run

Record:

- mulligans, opening hand, and turn-by-turn draws;
- land, mana, spells, and resulting battlefield each turn;
- when the declared milestone was reached;
- unused interaction or protection and its legal targets;
- whether the game plan succeeded, was delayed, or failed;
- the exact failure cause, not merely "bad draw".

If the commander could be cast into open removal or delayed to hold protection,
trace both branches. If interaction is required, identify the drawn answer,
its mana, timing, and legal target. Test commander removal twice when the deck
is commander-dependent.

Treat tapped lands, conditional mana, summoning sickness, commander tax,
timing restrictions, replacement effects, and once-per-turn clauses exactly.
Walk claimed loops; "fat once" is not infinite.

## 5. Run stress branches

Use representative hands rather than inventing an ideal hand for each branch:

1. clean development;
2. commander removed after the expected cast;
3. commander removed twice when dependency warrants it;
4. key engine removed or board wiped;
5. opposing must-answer commander or permanent at the bracket-appropriate
   turn;
6. cast now versus wait for protection;
7. graveyard, artifact, enchantment, or stack pressure when the plan is
   especially vulnerable to it.

Do not model a full opponent unless the user asks for matchup simulation.
Name every opposing action introduced by a branch.

## 6. Report

Summarize:

| Metric | Result |
|---|---|
| Keepable with at most one mulligan | n/12 |
| Turn-five milestone reached | n/12 |
| Mana or colour failure | n/12 |
| Useful draw seen | n/12 |
| Required interaction available | n/12 |
| Commander-removal recovery passed | n/scenarios |
| Game plan successful / delayed / failed | n / n / n |

Then give:

1. the test model and assumptions;
2. concise turn traces for each kept hand;
3. stress-branch outcomes;
4. repeated failure patterns and the cards actually seen;
5. category-level diagnosis for mana, draw, interaction, protection, recovery,
   and direct game-plan density;
6. limitations and recommended next investigation.

Use the primer's hypergeometric category table for density claims. Twelve
draws are diagnostic evidence, not a power rating or proof of exact
probability. A failure repeated in at least three runs is systemic enough to
investigate; a single outlier should be reported without driving a rebuild.

Do not edit, reassess, rename, or recategorize an existing deck during a
standalone simulation. If the user asks to act on the findings, use the
appropriate brew, audit, assessment, or deck-workspace workflow.
