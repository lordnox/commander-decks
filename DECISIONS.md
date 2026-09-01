# Decisions

Kitchen-table house rules for this repository. Each deck still has its own `DECISIONS.md` for list, primer, and assessment notes. This file is why the tools behave the way they do across every deck.

## How to use

- **Play** — these decks are for friends, not tournaments.
- **Cards** — esoteric old cards, avoid staples, discussable Game Changers, kitchen-table fast mana.
- **Per-deck logs** — why a card is in a 99 lives under `decks/<deck>/DECISIONS.md`.
- **[Deck ideas](DECK-IDEAS.md)** — grilled brews that are queued or parked, not a folder yet.
- **This file** — repo-wide rules that should not be rediscovered in chat.

## Play

- **No tournament legality.** Official Commander legality dates and event rules do not constrain these lists. Unreleased cards are allowed as soon as Oracle text exists.
- **Still reject construction bugs.** Color identity, singleton (except basics and cards that allow copies), and already-released banned or not-legal cards stay validator errors so a bad cache or a banned reprint cannot slip in unnoticed.

## Cards

Default for new brews and swaps. A deck can override in its own log; do not assume an override.

- **Esoteric and old.** Prefer overlooked cards, especially Ice Age, Alliances, and the rest of that era (Homelands, Fallen Empires, Mirage block, early Legends reprints). A weird old effect that does the job beats a modern reprint of the same idea.
- **Avoid staples.** Do not reach for the usual Commander auto-includes (Sol Ring, Arcane Signet, Rhystic Study, Swords to Plowshares, Cyclonic Rift, and their cousins) when an on-theme or older card exists. Staples need a specific argument, not "everyone runs this."
- **Game Changers are discussable.** Query live `is:gamechanger` and still report official status in assessments. Official listing is a conversation starter, not an automatic veto. Include the card only when the usage can be named in one sentence and still sounds like the joke, the theme, or the secret commander. Leave it out when it is just the best generic tool: more speed, more consistency, or a free answer. Examples that can be fine: Gamble fetching Dawnsire as a secret commander; Biorhythm or Coalition Victory as the win; Crop Rotation as a weird land toolbox. Examples that are not: Gamble into a free counterspell; Crop Rotation into a Maze lock. A per-deck tutor ban still wins over this paragraph until that deck reopens it.
- **Ramp is not fast mana.** Fast mana is extra mana you can spend on the turn you use the card. Ramp spends a turn to be richer later (Arcane Signet, Mind Stone, Fellwar Stone, Cultivate-style land fetch).
- **One-shot fast mana** (Dark Ritual, Cabal Ritual, Seething Song, Burnt Offering) is acceptable in Bracket 3+ lists when the argument is deck-specific, not "this is efficient."
- **Permanent fast mana** (Sol Ring, Moxes, Mana Vault, Grim Monolith, Ancient Tomb) is kitchen-table **4+**. Sol Ring counts even though Wizards left it off Game Changers.
- **Convince-me still applies.** If the usage is the engine or the joke, argue for the card. Do not sneak it in because it is good.

## Tools

- **Primer action buttons** — Archidekt and Decisions are shields.io `for-the-badge` pills, not a prose link. `update_archidekt_link.py` writes the row.

## Talks

- **2026-09-01 — Game Changers and fast mana.** Official `is:gamechanger` stays the assessment source of truth. Construction uses usage: a Game Changer is fine when the table can hear why it is in *this* deck (Gamble for Dawnsire, Biorhythm, Coalition Victory, Crop Rotation as a land toy) and not fine when it only finds a free counter, a lock, or generic consistency. Fast mana means extra mana this turn. Signets and similar rocks are ramp. One-shot rituals can live in 3+; Sol Ring and other permanent fast mana are 4+ here even though Wizards treats Sol Ring as a format default.
- **2026-08-26 — Unreleased cards.** Homer, the Hermit and similar prerelease commanders were producing a validator warning. That warning is removed: kitchen-table play does not care about the release date.
- **2026-08-26 — Card taste.** Prefer esoteric old cards (Ice Age, Alliances, that era). Avoid staples. Game Changers are not a blanket ban; see 2026-09-01.
