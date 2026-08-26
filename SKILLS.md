# Skills

Agent skills live in `.agents/skills/`. Codex and Cursor discover them automatically. Each skill has a `SKILL.md` that agents must follow when that work comes up.

## `design-deck`

Grill a Commander brew before writing a 99. Use this when the request is a theme, commander, or constraint rather than a complete list.

The skill is a discussion: ask only open questions, verify Oracle and current Game Changers, and do not fill in guesses. It challenges commander choice, named finishers, loop math (including what Rings can copy), how finishers are found (draw vs tutors), constraints (root `DECISIONS.md`: old esoteric cards, avoid staples, no Game Changers), and the brew title. It does not write `decklist.txt` until that plan is locked. If the user already posted a complete list, skip this skill and use `deck-workspace`.

After lock-in, it hands off to `deck-workspace` for save, resolve, categorize, primer, tags, and validation. Parked brews use `deck-ideas`.

See [`.agents/skills/design-deck/SKILL.md`](.agents/skills/design-deck/SKILL.md).

## `deck-ideas`

Park grilled Commander brews in root [DECK-IDEAS.md](DECK-IDEAS.md) under **Queued** or **Currently not viable**. Use this when the user parks an idea, calls it not viable, or does not want a 99 yet.

It does not write `decklist.txt`. Create the file and README link if they are missing, update an existing entry instead of duplicating, and delete the entry when the brew becomes a stored deck.

See [`.agents/skills/deck-ideas/SKILL.md`](.agents/skills/deck-ideas/SKILL.md).

## `deck-workspace`

Import, identify, categorize, and update stored Commander decks. Use this whenever a list is posted, an existing deck is named, or analysis needs a resolved workspace.

It checks `decks/` first so an existing folder is not overwritten by accident, saves the submitted list unchanged, resolves every card through Scryfall into the shared cache, assigns categories, writes `cards.json`, and then drives primer, tags, decision log, and validation.

See [`.agents/skills/deck-workspace/SKILL.md`](.agents/skills/deck-workspace/SKILL.md).

## `scryfall-lookup`

Look up cards and search Scryfall. Use this for Oracle text, rulings-relevant details, or candidate lists by color, type, mechanic, format, price, or other Scryfall syntax.

It prefers the local `cards/` cache for known names, then queries `api.scryfall.com`. Do not use it to evaluate a whole deck unless card data must first be fetched.

See [`.agents/skills/scryfall-lookup/SKILL.md`](.agents/skills/scryfall-lookup/SKILL.md).

## `deck-primer`

Write the play guide at `decks/<deck>/README.md`. Use this when importing a deck or when the user asks how a stored deck works.

The primer covers the game plan, engines, combos, mulligans, tutors, sequencing, win conditions, category draw odds, mana stats, and an Archidekt sandbox link. Card mentions link to Scryfall. A newly created deck is incomplete until this primer exists.

See [`.agents/skills/deck-primer/SKILL.md`](.agents/skills/deck-primer/SKILL.md).

## `tag-deck`

Score official Archidekt deck tags into `tags.json` and render badges. Use this on import, primer refresh, or when the user asks for archetypes or README badges.

Tags are deck-level (for example `graveyard` or `tokens`), not card categories such as `ramp`. Scores are 1–5 against the catalog in `.agents/skills/tag-deck/archidekt-tags.json`. Badges at or above the cutoff appear on the primer and in the generated root README index.

See [`.agents/skills/tag-deck/SKILL.md`](.agents/skills/tag-deck/SKILL.md).

## `assess-deck`

Assess Commander Bracket and expected win turn. Use this only when the user asks about power, speed, bracket, or whether a deck fits a pod.

It reads the stored list rather than the theme, refreshes official bracket and Game Changer guidance, and writes an evidence-based pregame description. It does not change the 99 unless the user separately asks.

See [`.agents/skills/assess-deck/SKILL.md`](.agents/skills/assess-deck/SKILL.md).
