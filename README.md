# Commander Decks

## Deck primers

- [Bartolomé del Presidio](decks/bartolome-del-presidio/README.md)
- [Bartolomé del Skeleton 🦴](decks/bartolome-del-skeleton/README.md)
- [Mishra — Racecar Driver](decks/mishra-racecar-driver/README.md)
- [Ozox — Graveyard Rotation](decks/ozox-graveyard-rotation/README.md)

A conversation-driven workspace for importing, resolving, categorizing, and improving Magic: The Gathering Commander decks.

The repository keeps each submitted deck list unchanged and caches card data from Scryfall for reuse across decks.

## Start with Codex

### Codex desktop app or IDE

1. Clone or open this repository as the working folder.
2. Start a new Codex chat from the repository root.
3. Paste a deck list or name an existing deck.

Example:

```text
I want to work on my Mishra, Eminent One deck.

Commander
1 Mishra, Eminent One

Deck
1 Ichor Wellspring
1 Cursed Mirror
...
```

Codex automatically reads `AGENTS.md` and discovers the skills in `.agents/skills/` when it starts inside this repository.

### Codex CLI

```bash
git clone https://github.com/lordnox/commander-decks.git
cd commander-decks
codex
```

Then use the same kind of opening message:

```text
I want to import a new Commander deck. Here is the list:
...
```

You can explicitly invoke a skill when needed:

```text
$deck-workspace import this deck list
$scryfall-lookup find red cards that blink things
```

### Codex cloud

Connect GitHub, select `lordnox/commander-decks` as the repository environment, and start the task there. The environment needs network access to `api.scryfall.com` to resolve uncached cards.

## Start with ChatGPT

When using ChatGPT Work with the GitHub connection, identify the repository and explicitly ask it to load the repository instructions:

```text
@GitHub use lordnox/commander-decks.

Read AGENTS.md and the relevant skills under .agents/skills before working.
I want to work on this Commander deck:

<paste deck list>
```

If ChatGPT is working from a local folder in the desktop app, open the repository folder and select Codex for full repository-aware behavior.

## What the agent should do

When a deck list is submitted, the agent must:

1. Check the existing directories under `decks/`.
2. Ask whether a likely existing deck is the intended deck.
3. Otherwise infer a deck name, asking only when unclear.
4. Save the original list as `decks/<deck-name>/decklist.txt`.
5. Resolve every card using Scryfall.
6. Assign one or more categories to every card.
7. Write the deck manifest to `decks/<deck-name>/cards.json`.
8. Cache shared card data and universal categories under `cards/`.
9. Create the deck primer at `decks/<deck-name>/README.md`.
10. Add or update its link in the `Deck primers` section at the top of this README.
11. Report unresolved names before analyzing the deck.

## Card categories

Universal categories are stored in `cards/categories.json` and reused in every deck. Each card may have multiple categories.

Example:

```json
{
  "<oracle-id>": {
    "name": "Ichor Wellspring",
    "categories": ["card-draw", "artifact-synergy"]
  }
}
```

When a card serves a different purpose in one deck, add it to `decks/<deck-name>/category-overrides.json`:

```json
{
  "schema_version": 1,
  "cards": {
    "<oracle-id>": {
      "name": "Card Name",
      "categories": ["combo-piece", "sacrifice-fodder"]
    }
  }
}
```

The deck-specific list replaces the universal list for that card in that deck. Effective categories and their source are written into the deck's `cards.json`.

## Instructions for other agents

Agents that do not automatically support `AGENTS.md` or repository skills should be given this prompt:

```text
Work in the lordnox/commander-decks repository.

Before making changes:
1. Read AGENTS.md.
2. Read .agents/skills/deck-workspace/SKILL.md.
3. For card searches, read .agents/skills/scryfall-lookup/SKILL.md.
4. For a deck README or play guide, read .agents/skills/deck-primer/SKILL.md.
5. Follow those workflows exactly.
6. Preserve submitted deck lists and never overwrite a likely existing deck
   without confirmation.
7. Ensure every resolved card has one or more categories.
8. Ensure every deck has a primer linked near the top of the root README.
```

To resolve a saved list manually:

```bash
python3 .agents/skills/deck-workspace/scripts/cache_deck.py \
  decks/<deck-name>/decklist.txt
```

Use `--refresh` to retrieve fresh data for cards already present in the cache. Rerun the command after editing categories or deck overrides to regenerate effective categories.

## Repository layout

```text
AGENTS.md
decks/
  <deck-name>/
    decklist.txt
    cards.json
    category-overrides.json
    README.md
cards/
  index.json
  categories.json
  <oracle-id>.json
.agents/
  skills/
    deck-workspace/
    scryfall-lookup/
    deck-primer/
```

## Example requests

```text
What does Abyssal Persecutor do?
```

```text
Find red cards that blink things.
```

```text
Open my Mishra deck and suggest three cuts.
```

```text
Compare this new list with the stored version of my Mishra deck.
```

