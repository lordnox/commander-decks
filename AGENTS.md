# Commander Deck Repository

This repository stores Commander deck workspaces and a shared Scryfall card cache.

## Required deck workflow

Whenever the user posts a deck list or asks to begin work on a deck:

1. Inspect the directories directly under `decks/`.
2. Compare the request, commander, and deck contents with existing deck names and manifests.
3. If a likely deck exists, ask whether that is the deck being worked on before changing it.
4. If no deck matches, infer a concise kebab-case name from the commander or theme. Ask for a name only when the identity is ambiguous.
5. Create `decks/<deck-name>/` and save the submitted list unchanged as `decklist.txt`.
6. Resolve every card through Scryfall and update the repository cache and deck manifest.
7. Do not analyze or recommend changes until resolution errors are reported or fixed.

Use the repository's `deck-workspace` skill for this workflow and `scryfall-lookup` for card searches.

## Repository structure

- `decks/<deck-name>/decklist.txt`: original user-supplied deck list
- `decks/<deck-name>/cards.json`: resolved quantities and cache references
- `cards/<oracle-id>.json`: shared Scryfall card object, one per Oracle card
- `cards/index.json`: normalized card-name aliases mapped to Oracle IDs

Do not duplicate card JSON inside deck directories. Preserve the user's deck-list formatting unless they ask for normalization.
