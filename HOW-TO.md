# How to

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
$audit-deck go through this stored 99 slot by slot
$assess-deck assess Mishra's bracket and expected win turn
$rank-deck score this deck's fun, oppressiveness, jank, and identity goals
$deck-ideas park this brew as currently not viable
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

## Start with Cursor

1. Clone or open this repository as the working folder.
2. Start a new Cursor agent chat from the repository root.
3. Paste a deck list or name an existing deck.

Cursor reads `AGENTS.md` automatically and discovers the skills in `.agents/skills/`. You do not need to copy them into `.cursor/skills/`.

## What the agent should do

When a deck list is submitted, the agent must:

1. Check the existing directories under `decks/`.
2. Ask whether a likely existing deck is the intended deck.
3. Otherwise lock commander slug plus brew title (see AGENTS.md Directory names), asking when unclear.
4. Save the original list as `decks/<rating>_<commander>-<name>/decklist.txt`.
5. Resolve every card using Scryfall.
6. Assign one or more categories to every card.
7. Write the deck manifest to `decks/<rating>_<commander>-<name>/cards.json`.
8. Cache shared card data and universal categories under `cards/`.
9. Create the deck primer at `decks/<rating>_<commander>-<name>/README.md`.
10. Score official Archidekt tags into `tags.json` and show cutoff badges on the primer and the root README.
11. Regenerate the `Deck primers` index in the root README, which is grouped by bracket and built from every deck's `tags.json`.
12. Add a decision log with a How to use section, inclusion reasons for every unique card, a primer link to that file, plus cuts, primer notes, rules checks, and talks when those come up.
13. Validate deck size, released-card Commander legality, categories, cache coverage, primer contract, tag badges, and decision-log coverage. Unreleased cards are allowed; see [DECISIONS.md](DECISIONS.md).
14. Report unresolved names before analyzing the deck.

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

When a card serves a different purpose in one deck, add it to `decks/<rating>_<commander>-<name>/category-overrides.json`:

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
4. For a slot-by-slot Scryfall review of a stored 99, read .agents/skills/audit-deck/SKILL.md.
5. For a deck README or play guide, read .agents/skills/deck-primer/SKILL.md.
6. For Archidekt deck tags and README badges, read .agents/skills/tag-deck/SKILL.md.
7. For bracket, power, or win-turn analysis, read .agents/skills/assess-deck/SKILL.md.
8. For fun, oppressiveness, jankiness, and per-deck identity scores, read .agents/skills/rank-deck/SKILL.md.
9. For parking an unbuilt brew in DECK-IDEAS.md, read .agents/skills/deck-ideas/SKILL.md.
10. Follow those workflows exactly.
11. Preserve submitted deck lists and never overwrite a likely existing deck
   without confirmation.
12. Ensure every resolved card has one or more categories.
13. Ensure every deck has a primer linked near the top of the root README.
```

To resolve a saved list manually:

```bash
python3 .agents/skills/deck-workspace/scripts/cache_deck.py \
  decks/<rating>_<commander>-<name>/decklist.txt
```

Use `--refresh` to retrieve fresh data for cards already present in the cache. Rerun the command after editing categories or deck overrides to regenerate effective categories.

Validate the completed workspace before review:

```bash
python3 .agents/skills/deck-workspace/scripts/validate_deck.py \
  decks/<rating>_<commander>-<name>
```

Decision logs are required by default; pass `--no-require-decisions` only for a temporary import. The validator also checks that the generated deck index is current, plus assessment placement, Archidekt currency, tag badges, and category-table placement. Run the test suite for workflow changes with `python3 -m unittest discover -s tests -v`.

When a change swaps cards in an existing deck, generate the Scryfall-linked table for the pull request body:

```bash
python3 .agents/skills/deck-workspace/scripts/deck_change_table.py \
  decks/<rating>_<commander>-<name> --base origin/main
```

## Repository layout

```text
AGENTS.md
HOW-TO.md
SKILLS.md
DECK-IDEAS.md
DECISIONS.md
decks/
  <rating>_<commander>-<name>/
    decklist.txt
    cards.json
    tags.json
    rankings.json
    category-overrides.json
    printing-overrides.json
    README.md
    DECISIONS.md
cards/
  index.json
  categories.json
  <oracle-id>.json
.agents/
  skills/
    assess-deck/
    rank-deck/
    audit-deck/
    deck-ideas/
    deck-workspace/
    design-deck/
    scryfall-lookup/
    deck-primer/
    tag-deck/
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
Assess Mishra's Commander bracket and expected win turn.
```

```text
Compare this new list with the stored version of my Mishra deck.
```

```text
Go through Umbris slot by slot and check Scryfall for interesting cards. Show each replacement and why.
```

```text
Park the Unbound/Mirror proliferate idea as currently not viable.
```
