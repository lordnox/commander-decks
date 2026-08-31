# Commander Deck Repository

This repository stores Commander deck workspaces and a shared Scryfall card cache.

## Git workflow

Never edit on `main`. Each agent session uses its own branch and git worktree:

```bash
git fetch origin
git worktree add -b agent/<short-task-slug> ../commander-decks-<short-task-slug> origin/main
```

Reuse that worktree for the rest of the session. Do not share a branch or worktree with another agent.

Commit after each coherent step without waiting to be asked. Use a 1–2 sentence message focused on why. Do not amend published commits.

When the task is done, inspect the full diff, exclude unrelated shared-cache or registry changes, push the branch, and open a ready-for-review pull request (`draft: false`) summarizing what changed. Use `gh pr create --base main --head <branch>`; if `gh` is unavailable, return the `compare/main...<branch>?expand=1` URL instead. Return the PR URL.

A pull request that changes an existing deck list must include a `## Cards in / Cards out` table with every card linked to Scryfall, generated with:

```bash
python3 .agents/skills/deck-workspace/scripts/deck_change_table.py decks/<deck-name> --base origin/main
```

## Required deck workflow

When the user wants to brew a new Commander deck from a theme or commander, follow `.agents/skills/design-deck/SKILL.md` and grill the plan before writing a 99. When they park the brew, call it not viable, or want it on the unbuilt list instead of a folder, follow `.agents/skills/deck-ideas/SKILL.md`.

Whenever the user posts a deck list or asks to begin work on a stored list:

1. Inspect the directories directly under `decks/`.
2. Compare the request, commander, and deck contents with existing deck names and manifests.
3. If a likely deck exists, ask whether that is the deck being worked on before changing it.
4. If no deck matches, lock a **deck name** (the brew title, not the commander card) and a short commander slug. Ask when either is ambiguous.
5. Create `decks/unrated_<commander>-<name>/` (kebab-case) and save the submitted list unchanged as `decklist.txt`.
6. Run one resolver process to resolve every card through Scryfall and update the repository cache and deck manifest. Wait for a running resolver instead of starting it again.
7. Assign one or more useful categories to every resolved card. Use universal categories unless the card has a deck-specific role.
8. Create or refresh the deck's `README.md` by following the `deck-primer` skill.
9. Follow `tag-deck`: score official Archidekt tags into `tags.json` and show cutoff badges on the primer and root README.
10. Follow `rank-deck` when goals are declared: write `rankings.json` and show the score table on the primer; the root index prints the same scores after the bracket badge.
11. Regenerate the `Deck primers` index in the root README with `python3 .agents/skills/tag-deck/scripts/update_deck_tags.py decks/<deck-name>`. The whole block between the `deck-index` markers is generated from every deck's directory prefix, ranking scores, primer title, and `tags.json`; never hand-edit it.
12. Add `DECISIONS.md` with a `## How to use` definition, one inclusion entry per unique deck card under `## Cards in`, and a primer link to that file. After swaps, primer rewrites, assessments, or rules arguments, append `## Cards out`, `## Primer`, `## Rules`, or `## Talks`.
13. Run `python3 .agents/skills/deck-workspace/scripts/validate_deck.py decks/<deck-name>` (decision logs are required by default).
14. Do not analyze or recommend changes until resolution or validation errors are reported or fixed.

A newly created deck is incomplete until its primer exists and is linked from the root README.

### Directory names

Every deck folder is `decks/<rating>_<commander>-<name>/` in kebab-case.

- `<rating>` is `unrated` until assessment, then the bracket prefix: `3-`, `3`, or `3+` (ASCII `-` / none / `+` for `N−` / `N` / `N+`).
- `<commander>` is the short legendary name people say (`lady-evangela`, `jon-irenicus`, `alania`), not the full typeline.
- `<name>` is the brew title (`foggy-blood-transfusion`, `unwanted-presents`). The primer H1 and root index use `Commander — Name`.
- If the title slug already starts with the commander slug, do not double it (`sin` + `sin-fall` stays `sin-fall`).
- Example: Lady Evangela, deck name Foggy Blood Transfusion → `unrated_lady-evangela-foggy-blood-transfusion`.

Use `design-deck` when brewing from a theme, `deck-ideas` when parking a brew that is not a 99, `deck-workspace` for import and validation, `scryfall-lookup` for card searches, `audit-deck` for a slot-by-slot Scryfall review of a stored 99, `deck-primer` when creating or updating a play guide, `tag-deck` for Archidekt deck tags, `assess-deck` for bracket, power, or expected-win-turn analysis, and `rank-deck` for fun, oppressiveness, jankiness, and per-deck identity goals.

## Chat card presentation

In conversation (not primers or `decklist.txt`), featured card lists should show small Scryfall images that link to the card page. Keep names as Scryfall links in the text. After a sentence that groups several cards, append a Scryfall search (`"Name A" or "Name B"`, `unique=cards&as=grid&order=name`). Details: `.cursor/rules/card-chat-images.mdc`.

## Repository structure

- `DECISIONS.md`: kitchen-table house rules that apply to every deck
- `DECK-IDEAS.md`: grilled brews that are queued or parked, not a `decks/` folder yet
- `decks/<rating>_<commander>-<name>/decklist.txt`: original user-supplied deck list
- `decks/<rating>_<commander>-<name>/cards.json`: resolved quantities, effective categories, and compact embedded Oracle details
- `decks/<rating>_<commander>-<name>/README.md`: deck primer (`# [Commander](scryfall) — Deck Name`), describing only the deck as it currently stands
- `decks/<rating>_<commander>-<name>/tags.json`: scored Archidekt deck tags and one-line summary
- `decks/<rating>_<commander>-<name>/rankings.json`: fun, oppressiveness, jankiness, and per-deck identity scores from `rank-deck`
- `decks/<rating>_<commander>-<name>/DECISIONS.md`: how to use the log, required card-by-card inclusion reasons, plus optional cuts, primer notes, rules checks, and session talks
- `cards/<oracle-id>.json`: shared Scryfall card object, one per Oracle card
- `cards/index.json`: normalized card-name aliases mapped to Oracle IDs
- `cards/categories.json`: universal categories keyed by Oracle ID
- `decks/<rating>_<commander>-<name>/category-overrides.json`: optional deck-specific category replacements

Every card must have at least one category. Deck-specific categories replace, rather than merge with, universal categories for that deck.

A primer is a play guide, never a change log: swap history, cut rationale, and comparisons against cards no longer in the deck belong in the deck's `DECISIONS.md`. `validate_deck.py` warns when primer prose reads like an edit history.

Do not duplicate card JSON inside deck directories. Preserve the user's deck-list formatting unless they ask for normalization.
