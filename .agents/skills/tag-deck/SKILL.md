---
name: tag-deck
description: Score a Commander deck with official Archidekt deck tags, write tags.json, and render badges on the primer and root README. Use when importing a deck, writing or refreshing a primer, or when the user asks for deck tags, archetypes, or README badges.
---

# Tag Deck

Assign **deck-level** Archidekt tags. These are not card categories (`ramp`, `card-draw`).

The allowed vocabulary is the copied catalog at `.agents/skills/tag-deck/archidekt-tags.json`. It is based on [Archidekt's deck tags](https://archidekt.com/tags). Do not invent names, including `life swap` — the catalog tag is `life exchange`.

## 1. Score every tag that applies

No cap. If the deck makes squirrels, has squirrel anthems, or pays off squirrels, it is a squirrel deck. The same rule applies to other tribes and strategies.

Give each applicable official tag a score from 1 to 5:

| Score | Meaning |
| --- | --- |
| 1 | Technically applies: a card or two, not the plan |
| 2 | A real package exists, but the deck is pointed elsewhere |
| 3 | A major axis of the 99. Default display cutoff |
| 4 | Core identity with many payoffs |
| 5 | The primary plan or namesake of the deck |

Raise the number as more cards, anthems, and finishers point that way. Leave score 1 on incidental hits. Skip tags that do not apply at all.

Default **cutoff is 3**. Store every scored tag. Only tags at or above the cutoff become badges. Change `cutoff` in `tags.json` only if the user asks.

Write a one-sentence `summary` of what the deck actually does.

## 2. Write `tags.json`

```json
{
  "schema_version": 1,
  "cutoff": 3,
  "title": "Jon Irenicus — Unwanted Presents",
  "summary": "Donate politics: gift unkeepable creatures and draw when they attack.",
  "tags": [
    {
      "name": "donate",
      "score": 5,
      "reason": "The plan is to give opponents creatures they cannot keep."
    }
  ]
}
```

`name` must match the catalog exactly. Sort tags by score descending, then name.

`title` is optional and only sets the root index label. Leave it out unless the primer's H1 is too long there; the default is the H1 with its card links flattened.

## 3. Render badges

```bash
python3 .agents/skills/tag-deck/scripts/update_deck_tags.py decks/<prefix><slug>
```

This writes the visible badges into the primer (after the Archidekt link) and regenerates the whole root README deck index between the `<!-- deck-index:start -->` and `<!-- deck-index:end -->` markers. `--check` must succeed afterward.

The index is generated, so never edit it by hand. It groups decks under `### Bracket N · Name` headings, sorts them by bracket, then `−` / plain / `+`, then title, and shows each deck's summary plus its top four badges with a `+N more` badge linking to the primer. Badge color darkens with the score. Every deck needs a valid `tags.json`, or it silently drops out of the index.

## 4. When to run

Run this skill as part of `deck-primer`. Re-score after a list change that alters the deck's plan. Do not copy tags from a similarly named deck without reading the current 99.
