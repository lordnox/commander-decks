# Skills

Agent skills live in `.agents/skills/`. Codex and Cursor discover them automatically. Each skill has a `SKILL.md` that agents must follow when that work comes up.

## `design-deck`

Grill a Commander brew before writing a 99. Use this when the request is a theme, commander, or constraint rather than a complete list.

The skill is a discussion: ask only open questions, verify Oracle and current Game Changers, and do not fill in guesses. It challenges commander choice, named finishers, loop math (including what Rings can copy), how finishers are found (draw vs tutors), constraints (root `DECISIONS.md`: old esoteric cards, avoid staples, no Game Changers), the [interaction package](INTERACTION.md) by purpose rather than a raw count, and the brew title. It does not write `decklist.txt` until that plan is locked. If the user already posted a complete list, skip this skill and use `deck-workspace`.

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

## `audit-deck`

Slot-by-slot Scryfall review of a stored 99. Use this when asking if the list is finished, to go through it once more, to check interesting cards for each slot, or to find a strange multifunctional card or two-card package.

It challenges every unique card against current Oracle searches, prefers esoteric multifunctional cards over slightly better rate, then reports each replacement and why. Apply changes only after that report unless the user already asked to edit. Skip for a theme with no list (`design-deck`) and for parking (`deck-ideas`).

See [`.agents/skills/audit-deck/SKILL.md`](.agents/skills/audit-deck/SKILL.md).

## `deck-primer`

Write the play guide at `decks/<deck>/README.md`. Use this when importing a deck or when the user asks how a stored deck works.

The primer covers the game plan, engines, combos, mulligans, tutors, sequencing, win conditions, category draw odds, mana stats, ranking scores, and an Archidekt sandbox link. Card mentions link to Scryfall. A newly created deck is incomplete until this primer exists.

See [`.agents/skills/deck-primer/SKILL.md`](.agents/skills/deck-primer/SKILL.md).

## `tag-deck`

Score official Archidekt deck tags into `tags.json` and render badges. Use this on import, primer refresh, or when the user asks for archetypes or README badges.

Tags are deck-level (for example `graveyard` or `tokens`), not card categories such as `ramp`. Scores are 1–5 against the catalog in `.agents/skills/tag-deck/archidekt-tags.json`. Badges at or above the cutoff appear on the primer and in the generated root README index.

See [`.agents/skills/tag-deck/SKILL.md`](.agents/skills/tag-deck/SKILL.md).

## `rank-deck`

Score a stored deck on fun to play, oppressiveness, and jankiness, plus one identity score per declared deck goal. Use this when ranking a list, writing or refreshing a primer, comparing build paths, or checking whether the 99 still hits goals such as Voltron and Theft.

Goals live in that deck's `DECISIONS.md` and `rankings.json`. Universal kitchen-table bars (fun, interesting Magic, do not prevent others from having fun) are scored through the three universal axes; identity axes are never borrowed from another deck. A primer refresh renders the scores as badges (`Jank`, `Fun`, `Mean`, then identity goals) after the tag badges, and repeats them on the root README after the bracket badge.

See [`.agents/skills/rank-deck/SKILL.md`](.agents/skills/rank-deck/SKILL.md).

## `assess-deck`

Assess Commander Bracket and expected win turn. Use this only when the user asks about power, speed, bracket, or whether a deck fits a pod.

It reads [`BRACKET-DEFINITIONS.md`](BRACKET-DEFINITIONS.md) and the stored list rather than the theme, then writes an evidence-based pregame description. Bracket intent, printed caps, and the cached Game Changers snapshot all come from that one file; nothing is fetched per assessment. It does not change the 99 unless the user separately asks.

See [`.agents/skills/assess-deck/SKILL.md`](.agents/skills/assess-deck/SKILL.md).

## `simulate-table`

Play a four-player game among resolved decks and write replay JSON. Use this for a table game, pod sim, or matchup. Publishing the log belongs to `render-table-replay`; a human taking a seat mid-game belongs to `live-table`.

See [`.agents/skills/simulate-table/SKILL.md`](.agents/skills/simulate-table/SKILL.md).

## `render-table-replay`

Validate a recorded replay and publish it for the React step-through player (`?game=`). Live `/live` snapshots are not replays — use `live-table` for those.

See [`.agents/skills/render-table-replay/SKILL.md`](.agents/skills/render-table-replay/SKILL.md).

## `live-table`

Hot-seat Commander: the human pilots one seat; the agent pilots the other three and judges. Use this when the user takes over a seat, wants a live table, or plays via `/live`.

Deal with `simulate-table`, pause on decisions, encode a NOW snapshot, and post the private live URL. Standing plans come from chat paste; continue from the session file.

See [`.agents/skills/live-table/SKILL.md`](.agents/skills/live-table/SKILL.md).
