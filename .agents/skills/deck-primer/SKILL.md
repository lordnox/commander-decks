---
name: deck-primer
description: Analyze a resolved Commander deck and create or update its deck-specific README primer. Use when the user asks how a stored deck works, requests a primer or play guide, or wants the deck's game plan, engines, combos, mulligans, tutors, sequencing, or win conditions documented.
---

# Deck Primer

Create a practical play guide at `decks/<slug>/README.md`.

## 1. Load the deck

1. Read `AGENTS.md` and the deck's `decklist.txt` and `cards.json`.
2. Confirm the requested deck matches the existing directory.
3. Stop and report unresolved cards or missing categories before analyzing.
4. Use each manifest entry's embedded `card` data when available. Read its referenced cache file only when required data is absent.
5. Preserve the deck list, manifest, categories, and cache unless the user separately requests changes.

## 2. Infer the plan

Derive the deck's actual roles from categories and Oracle text:

- identify the commander and what resource or action it enables;
- group setup, engines, interaction, protection, recursion, tutors, and finishers;
- identify the primary plan, backup plan, and normal progression from early to late game;
- find repeated mechanical patterns across multiple cards;
- distinguish enablers, payoffs, interchangeable pieces, and cards that merely provide value.

Treat categories as navigation aids, not proof of a rules interaction. Verify every claimed interaction against embedded Oracle text.

## 3. Verify combo lines

For every loop or combo included:

1. List all required pieces and state that must already exist.
2. Walk through one complete cycle in game order.
3. Confirm that the cycle restores its starting state.
4. State what becomes repeatable and how that wins.
5. Identify timing restrictions, delayed triggers, once-per-turn limits, optional choices, and mana requirements.

Do not call a line infinite when it is delayed, resource-limited, fails to restore a piece, or only produces value. Avoid claiming that a tutor finds a card unless its restrictions allow that card.

## 4. Write the README

Use concise Markdown and card names in bold. Include only sections supported by the deck:

1. Title and short identity
2. Deck summary
3. Key-card image gallery
4. How the deck works
5. Core engine or role table
6. Main combo or synergy patterns
7. Win conditions
8. Early, mid, and late game
9. Mulligan guide
10. Tutor priorities
11. Important sequencing and rules notes
12. Weaknesses and what to protect

Prefer a table for interchangeable roles and tutor decisions. Explain representative cards rather than listing every card. Make the primer useful during actual play.

### Key-card images

Add a compact `## Key cards` gallery near the top of every primer:

- show four to six cards that best explain how the deck works;
- include the commander, the central engine pieces, and representative payoff or win-condition cards;
- use the exact `image_uris.normal` URL from each card's cached Scryfall object;
- wrap every image in a link to that printing's `scryfall_uri`;
- use HTML images with `width="160"` and descriptive `alt` text so the gallery stays compact and accessible;
- use the front-face image for double-faced cards;
- do not download or commit card-image files to the repository.

## 5. Check the result

Before saving:

- confirm every named card is present in the manifest;
- recheck each described line against Oracle text;
- ensure the primary plan reflects the deck as built rather than a generic archetype;
- ensure delayed or finite interactions are described accurately;
- confirm no source deck files changed unintentionally.

Report the deck name, total and unique cards, unresolved count, and the README path.
