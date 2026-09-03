---
name: assess-deck
description: Assess a resolved Commander deck's current Commander Bracket and expected win turn. Use when the user asks about power level, bracket, speed, likely or fastest win turn, optimization level, or whether a deck fits a pod. Take bracket intent, caps, and the cached Game Changers list from BRACKET-DEFINITIONS.md, analyze the stored deck rather than its theme alone, and give an evidence-based pregame description.
---

# Assess Deck

Assess the deck as built. Do not modify it unless the user separately asks for changes. Run this skill only when the user asks for an assessment; do not assess a newly imported deck automatically.

## 1. Load and validate the deck

1. Read `AGENTS.md`, root `BRACKET-DEFINITIONS.md`, `decks/<prefix><slug>/decklist.txt`, and `decks/<prefix><slug>/cards.json`.
2. Confirm the requested deck matches the directory.
3. Stop and report unresolved cards, a non-Commander deck size, or missing commander data.
4. Use embedded Oracle details in `cards.json`. Read shared cache files only when required data is absent.
5. Use `.agents/skills/scryfall-lookup/SKILL.md` when card text or legality needs refreshing.

## 2. Load the bracket rules

Root [`BRACKET-DEFINITIONS.md`](../../../BRACKET-DEFINITIONS.md) is the only bracket source this skill uses. It holds official intent, turn floors, printed Game Changer caps, the cached Game Changers list, and this table's reading (win texture, Incremental Core, Parley).

1. Read that file before classifying.
2. Take hard limits versus expected barometers from its `Printed caps and barometers` table. Do not treat two-card combos, extra turns, or mass land denial as a fixed restriction checklist.
3. Match the deck manifest against its `Cached Game Changers` block. Do not query Scryfall or fetch Wizards pages as routine work.
4. Cite `BRACKET-DEFINITIONS.md` and the snapshot date in the assessment.

Refresh that file only when the user asks, when Wizards announces a change, or when a specific card's status is genuinely in doubt. It documents `update_game_changers.py` and `--check`; a refresh is its own step, not part of every assessment.

Do not classify a deck solely by counting Game Changers. Use printed caps as the default advertised boundary; a thematic Game Changer can stay in a lower-feeling game only with an explicit footnote, as in `BRACKET-DEFINITIONS.md`.

Treat the turn expectation as the deck's normal, repeatable pace, not its fastest theoretical line. A rare line that wins earlier does not automatically promote the deck when its typical pace and construction still fit the lower bracket.

### Position within a bracket

Write the final position as `N−`, `N`, or `N+`:

- `N−`: lower edge of the bracket;
- `N`: middle of the bracket;
- `N+`: upper edge of the bracket.

Use the deck's normal pace, consistency, resilience, tutors, fast mana, interaction, and compactness to choose the position. Record a materially faster exceptional line separately. For example, a deck that normally threatens a win on turn six but has an unlikely turn-four line can be `Bracket 3+`; the rare turn-four line alone does not make it Bracket 4.

## 3. Analyze construction and play pattern

Inspect:

- commander mana value, dependency, and setup needed before it produces value;
- lands, color reliability, fast mana versus ordinary ramp, and the earliest realistic commander turn (root `DECISIONS.md`: extra mana this turn is fast mana; Signets are ramp; one-shot rituals vs Sol Ring-class permanents);
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
2. Compare the deck's repeatable pace and **win texture** with `BRACKET-DEFINITIONS.md` (and live official text if it changed).
3. Choose one default bracket for matchmaking.
4. State where it sits within that bracket using `N−`, `N`, or `N+`.
5. Explain why it does not belong one bracket lower and one bracket higher.
6. Do not promote a slow deck merely for an expensive mana base or isolated powerful card.
7. Do not downgrade a tuned, consistent deck merely because it contains no Game Changers.

Bracket 5 requires genuine cEDH construction and metagame intent, not merely a powerful casual deck.

## 6. Report

Keep the result concise and include:

1. **Verdict:** bracket and position within it.
2. **Win-turn table:** credible high roll, normal goldfish, and interactive game.
3. **Evidence table:** Game Changers, combos, tutors, fast mana, interaction, consistency, and win conditions. Count Game Changers from the cached block in `BRACKET-DEFINITIONS.md` for bracket caps. In the fast-mana row, do not call Signets fast mana; split one-shot rituals from permanent rocks, and note that this table's Sol Ring is kitchen-table 4+ even when Wizards does not list it.
4. **Boundary argument:** why not the adjacent brackets.
5. **Pregame description:** one sentence the player can use at the table.

Use this sentence pattern, adjusted to the evidence:

> Bracket 3+ combo deck. Usually threatens a win around turn six, but has an unlikely turn-four line.

The sentence must state the bracket position using `N−`, `N`, or `N+`, the deck style, the usual threat or win turn, and any verified exceptional line that is materially faster. Keep "usually," "reasonably," and "unlikely" precise; never present the fastest possible line as the expected pace.

Whenever an assessment is performed or refreshed:

1. Write this pregame sentence as a Markdown blockquote directly below the deck README's H1 title, before the Archidekt link and every other paragraph or section. Replace an existing assessment sentence instead of adding another.
2. Rename the deck directory to `decks/<N><modifier>_<commander>-<name>/`. Keep the commander-name slug; only the rating prefix changes. Use ASCII `-`, no modifier, or `+` for positions `N−`, `N`, or `N+`; for example, Bracket 3− maps to `3-_`, Bracket 3 to `3_`, and Bracket 3+ to `3+_`.
3. Preserve the slug after removing any existing bracket or `unrated_` prefix.
4. Update the root README link, the `source` path in `cards.json`, and every other repository reference to the old directory.
5. Keep the sentence and prefix current when the deck changes.
6. Run `python3 .agents/skills/deck-workspace/scripts/validate_deck.py decks/<N><modifier>_<slug>` and fix path, README, and `source` errors before reporting.
7. Record the assessment argument in `DECISIONS.md` under `## Talks` or `## Primer`: why this bracket, which lines set the exceptional turn, and which Oracle readings were checked.

Mention the specific cards or packages that materially determine the result. Avoid generic numerical power scales unless the user asks for one.
