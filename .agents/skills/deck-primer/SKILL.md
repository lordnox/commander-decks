---
name: deck-primer
description: Analyze a resolved Commander deck and create or update its deck-specific README primer. Use when the user asks how a stored deck works, requests a primer or play guide, or wants the deck's game plan, engines, combos, mulligans, tutors, sequencing, win conditions, category draw probabilities, or direct Archidekt deck-creation link documented.
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

Use concise Markdown. Write every card mention as a bold link to its manifest `scryfall_uri`, for example `[**Hedge Shredder**](https://scryfall.com/card/...)`. Include only sections supported by the deck:

1. Title and short identity
2. Archidekt deck-creation link
3. Deck summary
4. Key-card image gallery
5. Category access by turn three
6. How the deck works
7. Core engine or role table
8. Main combo or synergy patterns
9. Win conditions
10. Early, mid, and late game
11. Mulligan guide
12. Tutor priorities
13. Important sequencing and rules notes
14. Weaknesses and what to protect

Prefer a table for interchangeable roles and tutor decisions. Explain representative cards rather than listing every card. Make the primer useful during actual play.

### Archidekt deck-creation link

Every primer must contain an `Open this deck in Archidekt` link near the top. The link must open Archidekt's sandbox with the full resolved deck preloaded, including quantities and the commander designation. Exclude cards marked `{noDeck}`, such as maybeboard entries.

After resolving the deck, create or refresh the link with:

```bash
python3 .agents/skills/deck-primer/scripts/update_archidekt_link.py decks/<slug>
```

The script uses the exact Scryfall printing IDs in the cache. Archidekt does not accept digital-only printings. If the script identifies one, use the Scryfall lookup workflow to select a paper printing and rerun with one or more overrides:

```bash
python3 .agents/skills/deck-primer/scripts/update_archidekt_link.py decks/<slug> \
  --printing-override "Card Name=paper-scryfall-printing-uuid"
```

Rerun this script whenever the deck list or resolved manifest changes. Never copy an Archidekt URL from an older deck revision.

### Category access by turn three

Every primer must contain a hypergeometric probability table calculated from the resolved manifest. Use a 99-card library and 10 cards seen by turn three: the opening seven plus three normal draw steps, with no mulligans or additional draw. Exclude commanders and cards marked `{noDeck}`. Categories overlap, so present each category's probability independently.

Require at least one card from each category except `Land`, which requires at least three. Create or refresh the section with:

```bash
python3 .agents/skills/deck-primer/scripts/update_category_probabilities.py decks/<slug>
```

Rerun this script whenever the deck list, quantities, categories, or resolved manifest changes. Do not multiply the individual category probabilities to claim a combined opening-hand probability.

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
- run `python3 .agents/skills/deck-primer/scripts/link_card_mentions.py decks/<slug>` after drafting so plain or bold card mentions become Scryfall links;
- rerun the linker after every primer edit; it preserves existing links, images, HTML, URLs, and code;
- run `python3 .agents/skills/deck-primer/scripts/update_archidekt_link.py decks/<slug> --check`, including the same printing overrides used to generate the link;
- confirm the Archidekt payload contains every resolved card, the deck's total quantity, and exactly one commander entry;
- run `python3 .agents/skills/deck-primer/scripts/update_category_probabilities.py decks/<slug> --check`;
- confirm the category table uses 10 cards seen, excludes commanders and `{noDeck}` extras, and requires three Lands but one card from other categories;
- recheck each described line against Oracle text;
- ensure the primary plan reflects the deck as built rather than a generic archetype;
- ensure delayed or finite interactions are described accurately;
- confirm no source deck files changed unintentionally.

Report the deck name, total and unique cards, unresolved count, README path, and that the Archidekt link and category probability table are current.
