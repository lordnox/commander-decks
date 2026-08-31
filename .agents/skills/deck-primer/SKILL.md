---
name: deck-primer
description: Analyze a resolved Commander deck and create or update its deck-specific README primer. Use when the user asks how a stored deck works, requests a primer or play guide, or wants the deck's game plan, engines, combos, mulligans, tutors, sequencing, win conditions, category draw probabilities, mana curve, color cost and production, Archidekt tags, ranking scores, or direct Archidekt deck-creation link documented.
---

# Deck Primer

Create a practical play guide at `decks/<prefix><slug>/README.md`.

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

Use concise Markdown. Write every card mention as a bold link to its manifest `scryfall_uri`, for example `[**Hedge Shredder**](https://scryfall.com/card/...)`. Keep this top-of-file order, then include only later sections the deck supports:

1. Title (H1): `# [Short commander name](scryfall_uri) — Brew title` (same commander slug and title as the folder).
2. Assessment blockquote (`N−` / `N` / `N+`), when the deck has been assessed
3. Action buttons: Archidekt deck-creation link and `DECISIONS.md`
4. Archidekt tag badges (from `tag-deck`)
5. Ranking badges (from `rank-deck`), when `rankings.json` exists
6. Short identity or summary
7. `## Key cards`
8. Category access by turn three
9. Mana (color cost and production, average and total mana value, mana curve)
10. How the deck works
11. Core engine or role table
12. Main combo or synergy patterns
13. Win conditions
14. Early, mid, and late game
15. Mulligan guide
16. Tutor priorities
17. Important sequencing and rules notes
18. Weaknesses and what to protect

Prefer a table for interchangeable roles and tutor decisions. Explain representative cards rather than listing every card. Make the primer useful during actual play.

### Describe the deck as it stands

The primer documents the current 100 cards for someone about to pilot them. It is not a change log.

- Do not write swap history: no "X replaces Y", "Z left for W", "the Talismans were cut", or land or slot counts as `38 → 37`.
- Do not compare a current card against a card that is no longer in the deck, and do not justify a card by what it beat.
- Do not name a card that is neither in the 100 nor a `{noDeck}` maybeboard entry.
- A maybeboard section, when present, says what each card outside the 99 would do and what currently keeps it out, in the present tense.
- Past tense is fine for rules facts and play narration ("the trigger already resolved"), not for the deck's edit history.

Every rejected candidate, cut, and swap rationale belongs in `DECISIONS.md` under `## Cards out`. When trimming history out of a primer, confirm the reasoning exists there first and add it if it does not.

### Action buttons

Every primer must contain a single row of shields.io badge buttons immediately after the assessment blockquote, or immediately after the H1 when the deck is unrated: `Open in Archidekt`, then `Decisions` linking to the deck's decision log. Do not add a prose sentence pointing at `DECISIONS.md`; the button replaces it. The Archidekt button must open Archidekt's sandbox with the full resolved deck preloaded, including quantities and the commander designation. Exclude cards marked `{noDeck}`, such as maybeboard entries.

After resolving the deck, create or refresh the row with:

```bash
python3 .agents/skills/deck-primer/scripts/update_archidekt_link.py decks/<prefix><slug>
```

The cache script stores playable paper printings when Scryfall has one. Archidekt silently drops digital-only and oversized printings, which is how a 100-card link imports as 99. If a cached object is still one of those, add a paper Scryfall printing UUID to `decks/<prefix><slug>/printing-overrides.json` and rerun:

```json
{
  "schema_version": 1,
  "cards": {
    "Card Name": "paper-scryfall-printing-uuid"
  }
}
```

`--printing-override Card Name=uuid` still works for a one-off run and overrides the file. `update_archidekt_link.py --check` must succeed from the cache and that file alone; do not require a human to rediscover UUIDs. Rerun the script whenever the deck list or resolved manifest changes. Never copy an Archidekt URL from an older deck revision.

### Archidekt deck tags

Follow `.agents/skills/tag-deck/SKILL.md` after the list is resolved. Score every official catalog tag that applies, write `tags.json`, then render badges:

```bash
python3 .agents/skills/tag-deck/scripts/update_deck_tags.py decks/<prefix><slug>
```

Badges sit immediately after the Archidekt sandbox link. The same run regenerates the bracket-grouped deck index in the root README, where the deck shows its bracket, ranking badges when `rankings.json` exists, summary, and top tag badges. `--check` must succeed. Card categories stay separate from these deck tags.

### Rankings

Follow `.agents/skills/rank-deck/SKILL.md` after tags. Score jankiness, fun, oppressiveness, and each declared identity goal, write `rankings.json`, then render the primer badges:

```bash
python3 .agents/skills/rank-deck/scripts/update_deck_rankings.py decks/<prefix><slug>
```

The badge row sits immediately after the Archidekt tag badges, in this order: Jank, Fun, Mean (the display label for oppressiveness), then identity goals in `rankings.json` `goals` order. The same run of `update_deck_tags.py` renders the same badges on the root README index immediately after the bracket badge. `--check` must succeed when `rankings.json` is present. If goals are missing, skip the badges rather than inventing axes; ask once, then continue the primer.

Do not put ranking notes or swap history in the primer. Evidence stays in `rankings.json` `notes` and `DECISIONS.md` under `## Rankings`.

### Category access by turn three

Every primer must contain a hypergeometric probability table calculated from the resolved manifest. Use a 99-card library (98 with two commanders) and 10 cards seen by turn three: the opening seven plus three normal draw steps, with no mulligans or additional draw. Exclude commanders and cards marked `{noDeck}`. Categories overlap, so present each category's probability independently.

Require at least one card from each category except `Land`, which requires at least three. Modal double-faced cards carry the land category as well as their spell role, so the `Land` row counts them while the curve still counts their front face; the land count and the nonland count therefore overlap. Place the table immediately after the Key cards gallery, before the first play-guide heading. Create or refresh the section with:

```bash
python3 .agents/skills/deck-primer/scripts/update_category_probabilities.py decks/<prefix><slug>
```

Rerun this script whenever the deck list, quantities, categories, or resolved manifest changes. `--check` must fail when the table is missing, stale, or later than Key cards. Do not multiply the individual category probabilities to claim a combined opening-hand probability.

### Mana

Every primer must contain a mana-stats block calculated from the resolved manifest and cached Scryfall objects: color cost vs production, average and total mana value, and a 0–8+ mana curve. Place it immediately after the category table, before the first play-guide heading.

- Color cost counts mana symbols in costs. Ignore generic numerals and `{X}`; split hybrid symbols evenly; count explicit `{C}` as colorless. Do not treat generic mana as colorless cost.
- Production counts each color in a card's Scryfall `produced_mana` list, including nonland producers such as mana rocks. Dual and rainbow sources count once per listed color.
- Average and total mana value, and the curve, use nonland cards in the 100-card deck, including the commander. Exclude `{noDeck}` extras. Count MDFCs from their front face, so a spell//land still sits on the curve.
- Show only colors that have cost or production. Keep WUBRG then C order.

Create or refresh the section with:

```bash
python3 .agents/skills/deck-primer/scripts/update_mana_stats.py decks/<prefix><slug>
```

Rerun this script whenever the deck list, quantities, or resolved manifest changes. `--check` must fail when the block is missing, stale, or not after the category table.

### Key cards

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
- run `python3 .agents/skills/deck-primer/scripts/link_card_mentions.py decks/<prefix><slug>` after drafting so card mentions become Scryfall links to each card's manifest `scryfall_uri`;
- rerun the linker after every primer edit; it rewrites incorrect Scryfall hrefs to the manifest URI and preserves code, images, and non-card URLs;
- run `python3 .agents/skills/deck-primer/scripts/update_archidekt_link.py decks/<prefix><slug> --check`;
- confirm the Archidekt payload contains every resolved card, the deck's total quantity, and one or two commander entries (partners or Doctor's companion);
- follow `.agents/skills/tag-deck/SKILL.md`, then run `python3 .agents/skills/tag-deck/scripts/update_deck_tags.py decks/<prefix><slug> --check`;
- follow `.agents/skills/rank-deck/SKILL.md`, then run `python3 .agents/skills/rank-deck/scripts/update_deck_rankings.py decks/<prefix><slug> --check`;
- run `python3 .agents/skills/deck-primer/scripts/update_category_probabilities.py decks/<prefix><slug> --check`;
- confirm the category table uses 10 cards seen, excludes commanders and `{noDeck}` extras, and requires three Lands but one card from other categories;
- run `python3 .agents/skills/deck-primer/scripts/update_mana_stats.py decks/<prefix><slug> --check`;
- confirm mana stats sit after the category table and use nonland cards for the curve;
- recheck each described line against Oracle text;
- confirm the primer contains no swap history, cut rationale, or comparison against cards no longer in the deck, and that any such reasoning lives in `DECISIONS.md`;
- ensure the primary plan reflects the deck as built rather than a generic archetype;
- ensure delayed or finite interactions are described accurately;
- confirm no source deck files changed unintentionally;
- append primer, rules, and talk notes to `DECISIONS.md` when a line, win-turn claim, or Oracle reading was argued rather than obvious from the list;
- run `python3 .agents/skills/deck-workspace/scripts/validate_deck.py decks/<prefix><slug>` after the primer scripts.

Report the deck name, total and unique cards, unresolved count, README path, and that the Archidekt link, tag badges, ranking badges, category probability table, and mana stats are current.
