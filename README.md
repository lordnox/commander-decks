# Commander Decks

A conversation-driven workspace for importing, resolving, and improving Magic: The Gathering Commander decks.

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
6. Write the deck manifest to `decks/<deck-name>/cards.json`.
7. Cache shared card data under `cards/`.
8. Report unresolved names before analyzing the deck.

## Instructions for other agents

Agents that do not automatically support `AGENTS.md` or repository skills should be given this prompt:

```text
Work in the lordnox/commander-decks repository.

Before making changes:
1. Read AGENTS.md.
2. Read .agents/skills/deck-workspace/SKILL.md.
3. For card searches, read .agents/skills/scryfall-lookup/SKILL.md.
4. Follow those workflows exactly.
5. Preserve submitted deck lists and never overwrite a likely existing deck
   without confirmation.
```

To resolve a saved list manually:

```bash
python3 .agents/skills/deck-workspace/scripts/cache_deck.py \
  decks/<deck-name>/decklist.txt
```

Use `--refresh` to retrieve fresh data for cards already present in the cache.

## Repository layout

```text
AGENTS.md
decks/
  <deck-name>/
    decklist.txt
    cards.json
cards/
  index.json
  <oracle-id>.json
.agents/
  skills/
    deck-workspace/
    scryfall-lookup/
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
