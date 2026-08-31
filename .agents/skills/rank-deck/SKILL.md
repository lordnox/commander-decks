---
name: rank-deck
description: >-
  Score a stored Commander deck on fun, oppressiveness, and jankiness, plus
  one identity score per declared deck goal. Use when the user asks to rank,
  score, or rate a deck, discusses fun versus table feel, jank, oppressiveness,
  or whether a list still hits its own goals (for example Voltron and Theft).
---

# Rank Deck

Score the deck as built. Do not change the 99 unless the user separately asks. Read this skill when ranking, comparing identity, or deciding between build paths that would move a deck's goals.

## House bar for every deck

Use this wording as the kitchen-table bar. It is not a scored axis by itself; it is why the three universal scores exist:

- It should be fun to play
- Do something interesting
- Use magic as a tool to see what it can do
- It should not prevent others of having fun

Each deck might need to get a oppressiveness score, fun to play score and a jankyness score.

## Per-deck goals

Each deck should be ranked by its own goals, for this it is Voltron & Theft.

Lock goals in that deck's `DECISIONS.md` under `## Goals` and in `rankings.json`. Do not reuse another deck's goals. Do not invent a goal the user has not stated. If goals are missing, stop and ask. Typical Umbris goals stay **Voltron** and **Theft**; add further named goals only when the user names them (this deck also wants a lot of exiling, which is a supporting constraint unless they promote it to a scored goal).

A card, package, or build path that raises a universal score while lowering a declared identity score is a miss for that deck.

## Load

1. Confirm the deck directory.
2. Read `decklist.txt`, `cards.json`, `DECISIONS.md`, `README.md`, and `rankings.json` if present.
3. Use embedded Oracle text. Follow `scryfall-lookup` only when a score depends on current text.

## Universal scores (1–10)

| Score | Badge | What it measures | 1 | 10 |
| --- | --- | --- | --- | --- |
| **Jankiness** | `Jank` | Unusual, fragile, or convoluted interactions versus efficient packages | Staple-linear | Esoteric cards, weird rules, two-card packages |
| **Fun to play** | `Fun` | Pilot decisions, replayability, varied game states | Same line every game, few choices | Many meaningful sequencing choices |
| **Oppressiveness** | `Mean` | How much the deck removes opponents' meaningful decisions | Opponents still play their decks | Locks, extra turns, or stax that empty the table |

The JSON keys stay `jankiness`, `fun`, and `oppressiveness`; `Jank`, `Fun`, and `Mean` are only the badge labels, and that is also the display order.

**Fun to play** is the pilot's experience. **Oppressiveness** is the table's. A theft or chaos engine can score high on both. Prefer raising fun and jank without raising oppressiveness.

## Identity scores (1–10)

Give every declared goal its own 1–10. The question is "how strongly does this 99 pursue that goal," not "is the theme mentioned in the primer."

Examples of evidence:

- **Voltron:** commander (or a named attacker) is the main closer; evasion, protection, and combat payoffs stay on that body; the list does not prefer leaving the battlefield during the attack step.
- **Theft:** opponents' cards are played or controlled as a repeating plan, not a single spoiler spell.

If the user named extra goals (mill, blink, enchantress), score those the same way.

## Write the ranking

Write `decks/<deck>/rankings.json`:

```json
{
  "goals": ["Voltron", "Theft"],
  "scores": {
    "jankiness": 8,
    "fun": 8,
    "oppressiveness": 6,
    "identity": {
      "Voltron": 8,
      "Theft": 9
    }
  },
  "notes": "One or two sentences of evidence, not slogans."
}
```

Integer scores only. Copy the same numbers into `DECISIONS.md` under `## Rankings` (date the talk if the scores changed). Do not put swap history in the primer.

Then render the primer badges and refresh the root index:

```bash
python3 .agents/skills/rank-deck/scripts/update_deck_rankings.py decks/<deck>
python3 .agents/skills/tag-deck/scripts/update_deck_tags.py decks/<deck>
```

The primer shows one badge per score, `Jank`, `Fun`, `Mean`, then identity goals in `goals` order, in a row after the Archidekt tag badges. Badge color darkens with the score: teal where a high score is desirable, red for `Mean`, where a high score is the thing to watch.

Ranking badges are SVG files generated into `assets/badges/<label>-<score>.svg` and committed, not shields.io URLs, so the README renders without a third-party request. `update_deck_rankings.py` and `update_deck_tags.py` both call `sync_badges`, which writes the files every deck needs and deletes orphans; never hand-edit or hand-delete them. Each badge carries a `<title>`, `aria-label`, and matching `alt` / `title` on the `<img>`. The root README index is a table instead, with Jank, Fun, and Mean as numbers and identity goals as smaller badges so the extra labels still fit. GitHub strips CSS, so those numbers get their emphasis from inline math: 8 and up take the teal or red end of the axis, 3 and down take the other, 1 and 10 are also bold, and 4–7 stay plain. Primer refresh also runs this skill; if goals are missing, skip scoring rather than inventing them.

## When a ranking should change a list

Only recommend cuts or adds if the user is already editing. Then prefer cards that raise a lagging identity score without a large oppressiveness jump. Reject a path that would replace the declared goals (for example turning a Voltron deck into ETB-blink control).
