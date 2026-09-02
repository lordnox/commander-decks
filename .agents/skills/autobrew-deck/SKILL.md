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
6. mana and curve budget;
7. individual cards and the first 99;
8. trace, diagnose, revise.

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

## 4. Set the mana and curve budget

Set the mana base before spending all 99 slots. Count these separately:

- true lands;
- modal cards with a land back;
- one-mana dorks and auras;
- two-plus-mana ramp;
- temporary or conditional mana.

Never report their sum as "lands" or treat them as interchangeable. Modal land
backs enter tapped and cost the spell face. Creature ramp dies to creature
wipes and cannot make the land drop needed to cast it.

Start at 37 true lands unless the user declares another baseline. Go below 37
only with deck-specific evidence recorded in `DECISIONS.md`: curve, coloured
source requirements, reliable early draw or selection, ramp that can be cast
from the proposed opening hands, and hypergeometric access to the required
land drops. "The deck has ten ramp cards" is not sufficient.

Before version 1, record:

- true-land count and modal land backs;
- coloured sources needed by turns two, three, and the commander turn;
- counts at mana value 1, 2, 3, 4, and 5+;
- probability of the required opening lands and of seeing the required land
  count by the commander turn;
- how many tapped or conditional lands the early sequence can tolerate.

Prefer lands with a deck role when they do not break colour or tempo
requirements, but do not call an animated land a token or assume it can be
devoured without paying its activation cost.

## 5. Build version 1

Follow `deck-workspace` to create the named deck, resolve every card, categorize
it, write its primer and decision log, score tags and declared identity goals,
and validate it. The game plan, target bracket, full commander comparison,
package map, and rules checks belong under `## Talks` or `## Rules` in the
deck's `DECISIONS.md`.

Do not evaluate unresolved cards. Do not call version 1 finished.

## 6. Decide whether to simulate

Use `simulate-deck` as a separate diagnostic skill when early sequencing,
mulligans, mana, interaction, protection, or commander recovery could change
the list. A complete autonomous 99 must be simulated. It may be skipped only
when the user asks for a conceptual list rather than a finished deck, or when
the relevant question cannot be tested by goldfishing; record the reason.

Pass the simulator:

- the game-plan sentence and backup route;
- target bracket and expected pace;
- turn-five milestone;
- commander-dependency and known pressure points;
- any package or branch that needs evidence.

Use its default eight regression hands plus four fresh confirmation hands.
Keep simulation read-only: the brew loop, not the simulator, decides whether
its findings justify card changes.

### Simulation evidence gate

Running `goldfish.py` only deals reproducible hands. Reading its output is not
a simulation. Before claiming the loop ran, the autobrew must:

1. choose and justify a keep for all 12 runs;
2. name every bottomed card;
3. trace every turn with lands, tapped-land timing, colours, mana spent,
   spells, and battlefield;
4. score the declared milestone and exact failure cause;
5. run bracket-required stress branches from representative traced hands;
6. produce the complete `simulate-deck` metric table.

Do not revise from opening hands alone. Do not write estimates such as "about
6/12" when exact traces are required. If context or time prevents all traces,
state that simulation is incomplete and stop before making simulation-driven
changes.

The turn horizon limits the claim. A turn-five setup test cannot establish an
expected turn-eight win without tracing the relevant games through turn eight.

## 7. Diagnose and revise

Review the `simulate-deck` report when simulation was selected. Treat the
sample as diagnostic evidence, not a probability proof. A repeated failure in
at least three runs is systemic; one outlier is evidence to note, not
permission to replace a package.

Revise in this order:

1. true-land count, coloured production, tapped-land timing, and curve;
2. draw, selection, and mulligan quality;
3. bracket-appropriate removal and stack interaction;
4. protection, recursion, and commander independence;
5. density of direct game-plan tools;
6. redundant or win-more synergy.

Make explicit cards-in/cards-out pairs and reasons in `DECISIONS.md`. Resolve,
recategorize, regenerate the primer, and validate after every version. Then
invoke `simulate-deck` again whenever the revision is meant to fix a simulated
failure or changes three or more lands, ramp pieces, draw pieces, or curve
slots. Reuse its regression seed and add fresh confirmation hands.

Changing cards changes the library order, so the same seed preserves the
method, not identical hands. Compare scored outcomes and failure shapes; do
not present it as an A/B test of the same draws.

Before selecting cuts, check what happened in the traces:

- Was the card actually drawn?
- Could its colours and mana value be paid on time?
- Was it dead because its prerequisite was absent?
- Is the repeated failure in this card, its package density, or the mana base?
- Does the proposed replacement preserve any role the cut was covering?

Do not cut expensive payoff cards merely because early boards were thin; that
is usually evidence about enablers or mana until the traces prove otherwise.
Do not add more enablers to fix mana failure.

Stop when the declared milestone and stress obligations pass without a
systemic failure, or when the non-simulated evidence is sufficient for the
declared scope. Do not optimize away the chosen experience merely to improve
the numbers.

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

## 8. Finish

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

Before calling the brew complete:

- validate with zero errors;
- confirm every card in the list has a current inclusion reason;
- remove stale primer and decision-log references to cut cards;
- distinguish measured results from estimates and untested claims;
- ensure the PR's Cards in / Cards out tables include every revision stage;
- state any incomplete simulation or untested stress branch plainly.
