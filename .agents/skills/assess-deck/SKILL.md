---
name: assess-deck
description: Assess a resolved Commander deck's current Commander Bracket and expected win turn. Use when the user asks about power level, bracket, speed, likely or fastest win turn, optimization level, or whether a deck fits a pod. Verify current official bracket and Game Changer guidance, analyze the stored deck rather than its theme alone, and give an evidence-based pregame description.
---

# Assess Deck

Assess the deck as built. Do not modify it unless the user separately asks for changes.

## 1. Load and validate the deck

1. Read `AGENTS.md`, `decks/<slug>/decklist.txt`, and `decks/<slug>/cards.json`.
2. Confirm the requested deck matches the directory.
3. Stop and report unresolved cards, a non-Commander deck size, or missing commander data.
4. Use embedded Oracle details in `cards.json`. Read shared cache files only when required data is absent.
5. Use `.agents/skills/scryfall-lookup/SKILL.md` when card text or legality needs refreshing.

## 2. Refresh the bracket rules

Commander Brackets and the Game Changers list can change.

1. Check the current official Wizards Commander bracket page and the latest official bracket update.
2. Prefer current official guidance over remembered thresholds.
3. Record the current restrictions and intent for each relevant bracket:
   - permitted Game Changers;
   - game-ending two-card combos;
   - extra turns;
   - mass land denial;
   - expected game pace and turn window.
4. Count the deck's current Game Changers by exact card name.
5. Cite the official source in the assessment.

Do not classify a deck solely by counting Game Changers. Use restrictions as hard boundaries and bracket intent as the primary classification.

## 3. Analyze construction and play pattern

Inspect:

- commander mana value, dependency, and setup needed before it produces value;
- lands, color reliability, fast mana, ordinary ramp, and the earliest realistic commander turn;
- tutors, card selection, draw engines, recursion, and redundancy;
- efficient and free interaction, protection, board wipes, and stack interaction;
- compact combos, deterministic loops, extra turns, mass land denial, and alternate wins;
- primary and backup win conditions;
- how many cards and turns each win condition needs;
- vulnerability to removal, sweepers, graveyard hate, and commander tax;
- high-roll hands versus the deck's repeatable normal game.

Verify claimed combos and win lines against Oracle text. Do not treat synergy, accumulated value, or a delayed alternate win as an infinite combo.

## 4. Estimate the win turn

Give separate estimates for:

| Estimate | Meaning |
|---|---|
| Credible high roll | Strong plausible hand and little resistance; do not assume an implausible exact stack of cards |
| Normal goldfish | Representative draw with no opposing disruption |
| Interactive game | Commander is answered or key engines are disrupted |

For each estimate, trace enough mana and setup to show the turn is achievable. For an exceptional fastest line, show a legal turn-by-turn sequence, count the required cards, and distinguish "possible" from "likely" or "reasonable." Do not use a rare nut draw as the deck's expected pace. Distinguish:

- presenting lethal or a deterministic win;
- beginning to generate value;
- becoming favored to win without yet ending the game.

Use a range when draw variance is material. State uncertainty when the deck has not been playtested or simulated.

## 5. Assign the bracket

1. Apply current hard restrictions first.
2. Compare the deck's repeatable pace and intent with the official bracket descriptions.
3. Choose one default bracket for matchmaking.
4. State where it sits within that bracket: low, middle, or high.
5. Explain why it does not belong one bracket lower and one bracket higher.
6. Do not promote a slow deck merely for an expensive mana base or isolated powerful card.
7. Do not downgrade a tuned, consistent deck merely because it contains no Game Changers.

Bracket 5 requires genuine cEDH construction and metagame intent, not merely a powerful casual deck.

## 6. Report

Keep the result concise and include:

1. **Verdict:** bracket and position within it.
2. **Win-turn table:** credible high roll, normal goldfish, and interactive game.
3. **Evidence table:** Game Changers, combos, tutors, fast mana, interaction, consistency, and win conditions.
4. **Boundary argument:** why not the adjacent brackets.
5. **Pregame description:** one sentence the player can use at the table.

Use this sentence pattern, adjusted to the evidence:

> High Bracket 3 combo deck. Usually threatens a win around turn six, but has an unlikely turn-four line.

The sentence must state the bracket position and deck style, the usual threat or win turn, and any verified exceptional line that is materially faster. Keep "usually," "reasonably," and "unlikely" precise; never present the fastest possible line as the expected pace.

Whenever an assessment is performed or refreshed:

1. Write this pregame sentence as a Markdown blockquote directly below the deck README's H1 title, before every other paragraph or section. Replace an existing assessment sentence instead of adding another.
2. Rename the deck directory to `decks/<bracket>_<slug>/`. Use `1_`, `2_`, `3_`, `3+_`, `4_`, or `5_`; map High Bracket 3 to `3+_` and other positions to their bracket number.
3. Preserve the slug after removing any existing bracket or `unrated_` prefix.
4. Update the root README link, the `source` path in `cards.json`, and every other repository reference to the old directory.
5. Keep the sentence and prefix current when the deck changes.

Mention the specific cards or packages that materially determine the result. Avoid generic numerical power scales unless the user asks for one.
