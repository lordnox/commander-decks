---
name: autobrew-deck
description: >-
  Autonomously choose a Commander game plan and target bracket, search and
  compare commanders, build a resolved deck, and iterate through turn-five
  goldfishes. Use when the user delegates deck concept and construction with
  little or no input, asks the agent to build a deck it likes, or wants the
  agent to choose the plan and commander.
---

# Autobrew Deck

Build the deck with little or no user input. The order is mandatory:

1. game plan;
2. target bracket and operational expectations;
3. commander and colour search;
4. enabling tools;
5. synergy packages;
6. individual cards and the first 99;
7. goldfish, diagnose, revise.

This skill is the autonomous exception to `design-deck`'s requirement to wait
for user lock-in. User-provided constraints remain locks. Make every other
reversible choice yourself and record the reasoning.

## 0. Check the workspace

Read root `DECISIONS.md`, `DECK-IDEAS.md`, and the directories directly under
`decks/`. Do not unknowingly duplicate or reopen a stored or parked idea.

Ask only when:

- a likely existing deck makes the requested target ambiguous;
- two choices are materially different and no evidence or declared preference
  breaks the tie;
- the plan cannot meet its bracket without abandoning its identity;
- a required constraint is contradictory or rules-invalid;
- iteration has stalled as described below.

Otherwise proceed.

## 1. Choose the game plan before the commander

Write one sentence containing:

- the repeatable game action;
- how that action creates an advantage;
- what converts that advantage into a win.

Name a backup route and identify the deck's intended emotional or mechanical
experience. A theme word such as "Aikido", "Scarecrows", or "burn" is not a
game plan.

Choose the target Commander Bracket now. Refresh the official bracket guidance
and current Game Changers as required by `assess-deck`; do not use memory.
Before searching commanders, declare:

- target bracket and expected normal win turn;
- earliest credible high roll;
- expected commander or engine setup turn;
- turn-five milestone;
- interaction and recovery obligations;
- fast-mana, tutor, combo, and Game Changer boundaries.

The target is a design constraint, not a rating assigned after the list exists.
Share the game-plan sentence and bracket target as the first user-visible
checkpoint, but continue without waiting unless the user intervenes.

## 2. Search all commanders and colours

Use `scryfall-lookup` and current Oracle data. Begin with the rules text needed
by the plan, not a favourite colour identity. Search broadly, then narrow by
colour and commander legality. Examples:

```text
f:c is:commander id:bu
f:c is:commander o:"damage" o:"opponent"
f:c is:commander otag:blink
```

Build a shortlist of 3–5 commanders. Include non-obvious candidates when their
side effects serve the plan. A commander need not name the archetype: Osgir can
support an Aikido subplan because artifact recursion serves Dawnsire; Lady
Evangela uses prevention as cover for an Aikido Vampire plan; Extus can put
Aikido itself at the centre while ignoring the back face.

Compare the candidates in one table:

| Candidate | Role in plan | Colours gained/lost | Better than peers | Worse than peers | If removed | Threat profile | Bracket fit |
|---|---|---|---|---|---|---|---|

Also test:

- Does it enable the action from the command zone or merely reward it?
- Is it engine, shield, card flow, finisher, colour access, or incidental
  synergy?
- How much of the 99 does it distort?
- What does the deck do before it resolves and after it is removed twice?
- Does its reputation cause opponents to hold removal for it?

Choose the winner yourself when the evidence is clear. Record why each other
candidate lost and what change in game plan would have made it win.
Share the comparison and selection as the second user-visible checkpoint, then
continue into packages and construction without asking for approval.

## 3. Find tools, then synergies

Search Scryfall for packages in this order:

1. **Direct tools** — cards that perform or enable the repeating action.
2. **Conversion** — finishers that turn the resulting resource or board state
   into a win.
3. **Redundancy** — functional copies and backup routes that work without the
   commander.
4. **Cross-role synergies** — cards that advance the plan while drawing,
   ramping, protecting, interacting, or recurring.
5. **Infrastructure** — lands, ramp, draw, selection, removal, protection, and
   recovery appropriate to the target bracket.

Work in named packages before filling individual slots. For each package,
state its job, minimum useful density, failure mode, and cards that overlap
another role. Prefer strange multifunctional cards over generic rate when the
bracket floor remains intact.

Verify Oracle text and walk every claimed combo or rules interaction. "Fat
once" is not infinite. Separate setup, value, presenting lethal, and actually
winning.

## 4. Build version 1

Follow `deck-workspace` to create the named deck, resolve every card, categorize
it, write its primer and decision log, score tags and declared identity goals,
and validate it. The game plan, target bracket, full commander comparison,
package map, and rules checks belong under `## Talks` or `## Rules` in the
deck's `DECISIONS.md`.

Do not evaluate unresolved cards. Do not call version 1 finished.

## 5. Goldfish through turn five

Generate reproducible test draws from the resolved manifest:

```bash
python3 .agents/skills/autobrew-deck/scripts/goldfish.py \
  decks/<deck> --runs 8 --turns 5 --seed 1729
python3 .agents/skills/autobrew-deck/scripts/goldfish.py \
  decks/<deck> --runs 4 --turns 5 --seed <new-version-seed>
```

The first eight are regression hands; keep their seed across versions. The
last four are fresh confirmation hands. The script presents fresh seven-card
options for zero, one, or two London mulligans. For each run, choose the keep,
name bottomed cards, and play legal turns using the resolved Oracle text.

Record for every run:

- mulligans, opening hand, and turn-by-turn draws;
- land, mana, spells, and resulting battlefield each turn;
- when the turn-five milestone was reached;
- unused interaction or protection and its legal targets;
- whether the game plan succeeded, was delayed, or failed;
- the exact failure cause, not merely "bad draw".

Test these what-ifs in addition to clean goldfishes:

| Target | Required stress tests |
|---|---|
| Brackets 1–2 | Plan develops by turn five; one later key-piece removal; no artificial turn-four policing requirement |
| Bracket 3 | Commander removed after its normal cast; must-answer permanent by turns five or six; one board wipe or engine loss |
| Bracket 4 | Opposing commander or engine must be answered by turn four; own commander removed on curve; protection or stack interaction under pressure |
| Bracket 5 | Use cEDH metagame, mulligan, priority, and interaction assumptions; turn-five solitaire is insufficient |

If the commander is delayed to hold protection, replay the branch both ways.
If removal is needed, identify the actual drawn answer and prove it is legal.
Test commander removal twice when the deck is commander-dependent.

## 6. Diagnose and revise

Summarize each version with:

| Metric | Result |
|---|---|
| Keepable with at most one mulligan | n/12 |
| Turn-five milestone reached | n/12 |
| Mana or colour failure | n/12 |
| Useful draw seen | n/12 |
| Required interaction available | n/12 |
| Commander-removal recovery passed | n/scenarios |
| Game plan successful / delayed / failed | n / n / n |

Treat the sample as a diagnostic, not a probability proof. Use the primer's
hypergeometric category table for density claims. A repeated failure in at
least three runs is systemic; one outlier is evidence to note, not permission
to replace a package.

Revise in this order:

1. mana count, colour production, and curve;
2. draw, selection, and mulligan quality;
3. bracket-appropriate removal and stack interaction;
4. protection, recursion, and commander independence;
5. density of direct game-plan tools;
6. redundant or win-more synergy.

Make explicit cards-in/cards-out pairs and reasons in `DECISIONS.md`. Resolve,
recategorize, regenerate the primer, and validate after every version. Then
rerun the eight regression hands and four fresh hands.

Stop when the declared milestone and stress obligations pass without a
systemic failure, and a fresh confirmation sample does not reveal a new one.
Do not optimize away the chosen experience merely to improve the numbers.

Ask the user with concrete options if two consecutive revisions do not improve
the same systemic failure. Typical options are:

- change the bracket;
- change commander or colours;
- relax a theme, budget, tutor, combo, or card-age constraint;
- accept the limitation;
- park the brew as not viable.

Example: if Reaper King cannot satisfy a Bracket 2 interaction and resilience
floor without becoming an Upgraded deck, report that conflict instead of
silently building Bracket 3.

## 7. Finish

Apply `assess-deck` to the final resolved list and compare the measured result
with the target. Apply `rank-deck` to the declared experience and identity
goals. Update the primer, decision log, root index, and validation.

Report:

1. game plan and target bracket;
2. commander shortlist and why the winner won;
3. package map;
4. version-by-version failures and changes;
5. final goldfish and stress-test results;
6. final bracket, expected win turn, known weaknesses, and any mismatch from
   the original target.
