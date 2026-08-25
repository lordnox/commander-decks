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

When the user wants to brew a new Commander deck from a theme or commander, follow `.agents/skills/design-deck/SKILL.md` and grill the plan before writing a 99.

Whenever the user posts a deck list or asks to begin work on a stored list:

1. Inspect the directories directly under `decks/`.
2. Compare the request, commander, and deck contents with existing deck names and manifests.
3. If a likely deck exists, ask whether that is the deck being worked on before changing it.
4. If no deck matches, infer a concise kebab-case name from the commander or theme and prefix it with `unrated_`. Ask for a name only when the identity is ambiguous.
5. Create `decks/unrated_<deck-name>/` and save the submitted list unchanged as `decklist.txt`.
6. Run one resolver process to resolve every card through Scryfall and update the repository cache and deck manifest. Wait for a running resolver instead of starting it again.
7. Assign one or more useful categories to every resolved card. Use universal categories unless the card has a deck-specific role.
8. Create or refresh the deck's `README.md` by following the `deck-primer` skill.
9. Follow `tag-deck`: score official Archidekt tags into `tags.json` and show cutoff badges on the primer and root README.
10. Add or update the deck's primer link in the `Deck primers` section immediately below the root README title. Write each entry as `` - `3+` [Deck name](decks/3+_deck-name/README.md) `` with the bracket badge in a code span (`Unrated` when unassessed), and sort by numeric bracket, then `-` / plain / `+`, then deck name; keep unrated last. Keep the tag-deck overview block under each link.
11. Add `DECISIONS.md` with a `## How to use` definition, one inclusion entry per unique deck card under `## Cards in`, and a primer link to that file. After swaps, primer rewrites, assessments, or rules arguments, append `## Cards out`, `## Primer`, `## Rules`, or `## Talks`.
12. Run `python3 .agents/skills/deck-workspace/scripts/validate_deck.py decks/<deck-name>` (decision logs are required by default).
13. Do not analyze or recommend changes until resolution or validation errors are reported or fixed.

A newly created deck is incomplete until its primer exists and is linked from the root README. Use `decks/<N><modifier>_<deck-name>/` for assessed decks, where `<modifier>` is ASCII `-`, empty, or `+` for positions `N−`, `N`, or `N+`; for example, Bracket 3− uses `3-_`, Bracket 3 uses `3_`, and Bracket 3+ uses `3+_`. Use `unrated_` until assessment.

Use `design-deck` when brewing from a theme, `deck-workspace` for import and validation, `scryfall-lookup` for card searches, `deck-primer` when creating or updating a play guide, `tag-deck` for Archidekt deck tags, and `assess-deck` for bracket, power, or expected-win-turn analysis.

## Repository structure

- `decks/<bracket>_<deck-name>/decklist.txt`: original user-supplied deck list
- `decks/<bracket>_<deck-name>/cards.json`: resolved quantities, effective categories, and compact embedded Oracle details
- `decks/<bracket>_<deck-name>/README.md`: deck primer
- `decks/<bracket>_<deck-name>/tags.json`: scored Archidekt deck tags and one-line summary
- `decks/<bracket>_<deck-name>/DECISIONS.md`: how to use the log, required card-by-card inclusion reasons, plus optional cuts, primer notes, rules checks, and session talks
- `cards/<oracle-id>.json`: shared Scryfall card object, one per Oracle card
- `cards/index.json`: normalized card-name aliases mapped to Oracle IDs
- `cards/categories.json`: universal categories keyed by Oracle ID
- `decks/<bracket>_<deck-name>/category-overrides.json`: optional deck-specific category replacements

Every card must have at least one category. Deck-specific categories replace, rather than merge with, universal categories for that deck.

Do not duplicate card JSON inside deck directories. Preserve the user's deck-list formatting unless they ask for normalization.
