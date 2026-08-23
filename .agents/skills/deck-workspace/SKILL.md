---
name: deck-workspace
description: Create, identify, import, categorize, and update Commander deck workspaces in this repository. Use whenever the user posts a Magic deck list, names a deck they want to work on, asks to import or save a deck, or begins deck analysis that requires resolving the submitted list. Check existing decks first, preserve the original list, resolve every card with Scryfall, assign card categories, create a deck primer, link it near the top of the root README, and maintain the shared card cache.
---

# Deck Workspace

Follow this workflow before analyzing a submitted deck.

## 1. Identify the deck

Inspect the immediate subdirectories of `decks/` and their `cards.json` manifests when present.

- If one existing deck plausibly matches the named commander, deck name, or submitted list, ask: “Are we working on `<deck-name>`?”
- If several decks plausibly match, present the short list and ask the user to select one.
- If none matches, infer a short name from the commander first, otherwise from the deck theme.
- Use `decks/unrated_<slug>/` for a new deck, where `<slug>` is lowercase kebab-case.
- Assessed decks use `decks/<N><modifier>_<slug>/`, with ASCII `-`, no modifier, or `+` for positions `N−`, `N`, or `N+`. Examples: `3-_homer-dumpster-diver-crab`, `3-_mishra-racecar-driver`, and `3+_bartolome-graveyard-shift`.
- Ignore these prefixes when matching a user's deck name or commander.
- Ask for the name only if no clear commander or theme can be inferred.

Do not overwrite an existing deck until its identity is confirmed.

## 2. Save the source list

Create `decks/<prefix><slug>/decklist.txt` and preserve the submitted text exactly, including headings and quantities. When updating an existing list, replace it only if the user supplied a replacement list or explicitly requested the edit.

## 3. Resolve and cache cards

Run:

```bash
python3 .agents/skills/deck-workspace/scripts/cache_deck.py decks/<prefix><slug>/decklist.txt
```

Add `--refresh` when cached Oracle text, legality, or printings must be refreshed:

```bash
python3 .agents/skills/deck-workspace/scripts/cache_deck.py decks/<prefix><slug>/decklist.txt --refresh
```

The script writes:

- `decks/<prefix><slug>/cards.json` (including compact Oracle text and card characteristics)
- `cards/<oracle-id>.json`
- `cards/index.json`
- `cards/categories.json`

It reuses local cache objects first, resolves remaining exact names through Scryfall's collection endpoint in batches of at most 75, and retries only collection misses with the fuzzy endpoint. Digital-only printings are replaced with a paper printing when Scryfall has one. Its summary reports cache hits, collection requests, fuzzy requests, paper upgrades, and unresolved names. If Archidekt still rejects a digital-only cache object, add a paper Scryfall UUID to `decks/<prefix><slug>/printing-overrides.json`; the primer skill covers the file format and Archidekt script.

- Run one resolver process at a time. If a command is still running, wait for that process; do not start the resolver again. A repository lock rejects concurrent runs.
- In a partial or connector-backed workspace, `cards/index.json` alone is not a cache hit. Hydrate the referenced `cards/<oracle-id>.json` objects before running the resolver, or those names will be fetched again.
- Prefer a complete repository checkout for bulk deck imports so shared cache objects can be reused and reviewed in one diff.

If any line cannot be resolved:

- Keep the submitted `decklist.txt`.
- Report every unresolved line.
- Ask for clarification when the correct card is ambiguous.
- Rerun resolution after correcting the source list.
- Do not claim the deck is fully imported while errors remain.

## 4. Categorize every card

Every card must have one or more categories.

- Preserve categories supplied in bracket notation on imported deck-list lines.
- Keep their spelling, capitalization, spaces, and directives such as `{top}`, `{noDeck}`, and `{noPrice}` exactly as submitted.
- Treat imported categories as deck-specific effective categories with `category_source: "decklist"`; do not replace them with inferred universal defaults.
- The commander is identified by and retains the exact category `Commander{top}`.
- Universal defaults live in `cards/categories.json`, keyed by Oracle ID.
- Review generated defaults and replace vague categories such as `other` with useful functional roles.
- Multiple categories are allowed, such as `["ramp", "artifact-synergy"]`.
- Reuse concise kebab-case category names.
- Categories may describe universal functions such as `ramp`, `card-draw`, `removal`, `board-wipe`, `protection`, `recursion`, `tutor`, `counterspell`, `token-production`, `land`, or `win-condition`.
- Do not force a global taxonomy when a clearer functional label is useful.

When a card has a different role in one deck, create or edit `decks/<prefix><slug>/category-overrides.json`:

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

## 5. Create the primer

After all cards resolve and have useful categories:

1. Read and follow `.agents/skills/deck-primer/SKILL.md`.
2. Create or refresh `decks/<prefix><slug>/README.md` from the resolved manifest.
3. Do not leave a newly created deck without a primer.
4. If the primer cannot be completed, report the blocker and treat deck creation as incomplete.

Create `DECISIONS.md` or `decisions.json` with exactly one substantive entry for every unique deck card. Decision logs are required for every deck. Include the card's submitted or canonical name in each entry. For Markdown, use this machine-checkable form:

```markdown
- **Card Name** — Why this card is included and what role it serves.
```

For JSON, use `{"schema_version": 1, "cards": {"<oracle-id>": {"name": "Card Name", "decision": "Reason"}}}`.

## 6. Link the primer from the root README

Maintain a `## Deck primers` section immediately after the root README title.

- Add a relative Markdown link to `decks/<prefix><slug>/README.md`.
- Prefix the human-readable link label with its assessed bracket, using `<bracket> — <deck name>`, for example `3+ — Bartolomé del Skeleton 🦴`.
- Read the bracket from the primer's assessment blockquote. Prefer `N−`, `N`, or `N+`; when migrating legacy wording, map Low/Mid/High Bracket N to `N−`/`N`/`N+`.
- Use `Unrated — <deck name>` when the deck has no assessment.
- Sort entries by numeric bracket ascending, then `−`, plain, `+`, and finally alphabetically by deck name. Keep unrated decks last, alphabetically. The validator rejects an unsorted primer list.
- Keep one entry per deck and preserve all existing primer links.
- When a deck is renamed, update its link rather than adding a duplicate.
- After `assess-deck` changes a bracket or directory prefix, update the root README label and order, every stored path, and the manifest's `source` field.

## 7. Validate the workspace

Run:

```bash
python3 .agents/skills/deck-workspace/scripts/validate_deck.py decks/<prefix><slug>
```

Decision logs are required by default. Pass `--no-require-decisions` only for a temporary import. Fix every error before review. The validator checks deck size, manifest consistency, categories, commander designation, singleton and color-identity rules, cached Commander legality, primer linkage and sort, assessment placement, Archidekt and category-table currency, card-mention links, and decision-log coverage. A prerelease commander produces a warning until its release date.

Inspect the final diff after validation. Shared registries preserve their existing order, so unrelated global reordering or cache changes indicate a workflow problem and should be removed.

When the change modifies an existing deck list, generate the Scryfall-linked swap table for the pull request body:

```bash
python3 .agents/skills/deck-workspace/scripts/deck_change_table.py decks/<prefix><slug> --base origin/main
```

The script compares the deck list at the base ref with the working tree, prints an `| In | Out |` table, and marks quantity changes such as `Island ×2`. Pass `--head <ref>` to compare two committed revisions. Put the table under a `## Cards in / Cards out` heading in the pull request.

## 8. Continue deck work

Use `cards.json` as the deck inventory and prefer its embedded `card` details for analysis. Load referenced cache files only for fields not embedded in the manifest. Use the `scryfall-lookup` skill for searches or to refresh current card information. Use the `deck-primer` skill when updating how a deck plays.

When reporting completion, state the deck name, total cards, unique cards, category coverage, unresolved entries, primer path, and whether the root README link was added or updated.
