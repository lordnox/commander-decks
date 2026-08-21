---
name: deck-workspace
description: Create, identify, import, categorize, and update Commander deck workspaces in this repository. Use whenever the user posts a Magic deck list, names a deck they want to work on, asks to import or save a deck, or begins deck analysis that requires resolving the submitted list. Check existing decks first, preserve the original list, resolve every card with Scryfall, assign card categories, and maintain the shared card cache.
---

# Deck Workspace

Follow this workflow before analyzing a submitted deck.

## 1. Identify the deck

Inspect the immediate subdirectories of `decks/` and their `cards.json` manifests when present.

- If one existing deck plausibly matches the named commander, deck name, or submitted list, ask: “Are we working on `<deck-name>`?”
- If several decks plausibly match, present the short list and ask the user to select one.
- If none matches, infer a short name from the commander first, otherwise from the deck theme.
- Use a lowercase kebab-case directory slug.
- Ask for the name only if no clear commander or theme can be inferred.

Do not overwrite an existing deck until its identity is confirmed.

## 2. Save the source list

Create `decks/<slug>/decklist.txt` and preserve the submitted text exactly, including headings and quantities. When updating an existing list, replace it only if the user supplied a replacement list or explicitly requested the edit.

## 3. Resolve and cache cards

Run:

```bash
python3 .agents/skills/deck-workspace/scripts/cache_deck.py decks/<slug>/decklist.txt
```

The script writes:

- `decks/<slug>/cards.json`
- `cards/<oracle-id>.json`
- `cards/index.json`
- `cards/categories.json`

It performs exact Scryfall name lookups and retries unambiguous misses with the fuzzy endpoint. Shared cached cards are reused by Oracle ID.

If any line cannot be resolved:

- Keep the submitted `decklist.txt`.
- Report every unresolved line.
- Ask for clarification when the correct card is ambiguous.
- Rerun resolution after correcting the source list.
- Do not claim the deck is fully imported while errors remain.

## 4. Categorize every card

Every card must have one or more categories.

- Universal defaults live in `cards/categories.json`, keyed by Oracle ID.
- Review generated defaults and replace vague categories such as `other` with useful functional roles.
- Multiple categories are allowed, such as `["ramp", "artifact-synergy"]`.
- Reuse concise kebab-case category names.
- Categories may describe universal functions such as `ramp`, `card-draw`, `removal`, `board-wipe`, `protection`, `recursion`, `tutor`, `counterspell`, `token-production`, `land`, or `win-condition`.
- Do not force a global taxonomy when a clearer functional label is useful.

When a card has a different role in one deck, create or edit `decks/<slug>/category-overrides.json`:

```json
{
  "schema_version": 1,
  "cards": {
    "<oracle-id>": {
      "name": "Card Name",
      "categories": ["deck-specific-role", "combo-piece"]
    }
  }
}
```

A deck override replaces the universal category list for that card in that deck. Rerun the cache script after editing categories or overrides so `cards.json` contains the effective categories and `category_source`.

## 5. Continue deck work

Use `cards.json` as the deck inventory and load detailed card data from the referenced cache files. Use the `scryfall-lookup` skill for searches or to refresh current card information.

When reporting completion, state the deck name, total cards, unique cards, category coverage, and any unresolved entries.
