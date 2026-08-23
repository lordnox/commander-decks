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

When the task is done, inspect the full diff, exclude unrelated shared-cache or registry changes, push the branch, and open a ready-for-review pull request (`draft: false`) summarizing what changed. Return the PR URL.

## Required deck workflow

Whenever the user posts a deck list or asks to begin work on a deck:

1. Inspect the directories directly under `decks/`.
2. Compare the request, commander, and deck contents with existing deck names and manifests.
3. If a likely deck exists, ask whether that is the deck being worked on before changing it.
4. If no deck matches, infer a concise kebab-case name from the commander or theme and prefix it with `unrated_`. Ask for a name only when the identity is ambiguous.
5. Create `decks/unrated_<deck-name>/` and save the submitted list unchanged as `decklist.txt`.
6. Run one resolver process to resolve every card through Scryfall and update the repository cache and deck manifest. Wait for a running resolver instead of starting it again.
7. Assign one or more useful categories to every resolved card. Use universal categories unless the card has a deck-specific role.
8. Create or refresh the deck's `README.md` by following the `deck-primer` skill.
9. Add or update the deck's primer link in the `Deck primers` section immediately below the root README title. Prefix the label with its bracket and sort by numeric bracket, then `−` / plain / `+`, then deck name; keep unrated last.
10. If a card-by-card decision log was requested, add `DECISIONS.md` or `decisions.json` with one entry per unique deck card.
11. Run `python3 .agents/skills/deck-workspace/scripts/validate_deck.py decks/<deck-name>`; add `--require-decisions` when a decision log is required.
12. Do not analyze or recommend changes until resolution or validation errors are reported or fixed.

A newly created deck is incomplete until its primer exists and is linked from the root README. Use `decks/<N><modifier>_<deck-name>/` for assessed decks, where `<modifier>` is ASCII `-`, empty, or `+` for positions `N−`, `N`, or `N+`; for example, Bracket 3− uses `3-_`, Bracket 3 uses `3_`, and Bracket 3+ uses `3+_`. Use `unrated_` until assessment.

Use the repository's `deck-workspace` skill for this workflow, `scryfall-lookup` for card searches, `deck-primer` when creating or updating a deck README or play guide, and `assess-deck` for bracket, power, or expected-win-turn analysis.

## Repository structure

- `decks/<bracket>_<deck-name>/decklist.txt`: original user-supplied deck list
- `decks/<bracket>_<deck-name>/cards.json`: resolved quantities, effective categories, and compact embedded Oracle details
- `decks/<bracket>_<deck-name>/README.md`: deck primer
- `cards/<oracle-id>.json`: shared Scryfall card object, one per Oracle card
- `cards/index.json`: normalized card-name aliases mapped to Oracle IDs
- `cards/categories.json`: universal categories keyed by Oracle ID
- `decks/<bracket>_<deck-name>/category-overrides.json`: optional deck-specific category replacements

Every card must have at least one category. Deck-specific categories replace, rather than merge with, universal categories for that deck.

Do not duplicate card JSON inside deck directories. Preserve the user's deck-list formatting unless they ask for normalization.
