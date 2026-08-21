# Commander Deck Repository

This repository stores Commander deck workspaces and a shared Scryfall card cache.

## Pull request workflow

Always create pull requests as ready for review, never as drafts. When the pull-request API has a `draft` option, set `draft: false` explicitly.

## Required deck workflow

Whenever the user posts a deck list or asks to begin work on a deck:

1. Inspect the directories directly under `decks/`.
2. Compare the request, commander, and deck contents with existing deck names and manifests.
3. If a likely deck exists, ask whether that is the deck being worked on before changing it.
4. If no deck matches, infer a concise kebab-case name from the commander or theme. Ask for a name only when the identity is ambiguous.
5. Create `decks/<deck-name>/` and save the submitted list unchanged as `decklist.txt`.
6. Resolve every card through Scryfall and update the repository cache and deck manifest.
7. Assign one or more useful categories to every resolved card. Use universal categories unless the card has a deck-specific role.
8. Create or refresh `decks/<deck-name>/README.md` by following the `deck-primer` skill.
9. Add or update the deck's primer link in the `Deck primers` section immediately below the root README title.
10. Do not analyze or recommend changes until resolution errors are reported or fixed.

A newly created deck is incomplete until its primer exists and is linked from the root README.

Use the repository's `deck-workspace` skill for this workflow, `scryfall-lookup` for card searches, and `deck-primer` when creating or updating a deck README or play guide.

## Repository structure

- `decks/<deck-name>/decklist.txt`: original user-supplied deck list
- `decks/<deck-name>/cards.json`: resolved quantities, effective categories, and compact embedded Oracle details
- `decks/<deck-name>/README.md`: deck primer
- `cards/<oracle-id>.json`: shared Scryfall card object, one per Oracle card
- `cards/index.json`: normalized card-name aliases mapped to Oracle IDs
- `cards/categories.json`: universal categories keyed by Oracle ID
- `decks/<deck-name>/category-overrides.json`: optional deck-specific category replacements

Every card must have at least one category. Deck-specific categories replace, rather than merge with, universal categories for that deck.

Do not duplicate card JSON inside deck directories. Preserve the user's deck-list formatting unless they ask for normalization.
