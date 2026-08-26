# Decisions

Kitchen-table house rules for this repository. Each deck still has its own `DECISIONS.md` for list, primer, and assessment notes. This file is why the tools behave the way they do across every deck.

## How to use

- **Play** — these decks are for friends, not tournaments.
- **Cards** — esoteric old cards, avoid staples, no Game Changers.
- **Per-deck logs** — why a card is in a 99 lives under `decks/<deck>/DECISIONS.md`.
- **This file** — repo-wide rules that should not be rediscovered in chat.

## Play

- **No tournament legality.** Official Commander legality dates and event rules do not constrain these lists. Unreleased cards are allowed as soon as Oracle text exists.
- **Still reject construction bugs.** Color identity, singleton (except basics and cards that allow copies), and already-released banned or not-legal cards stay validator errors so a bad cache or a banned reprint cannot slip in unnoticed.

## Cards

Default for new brews and swaps. A deck can override in its own log; do not assume an override.

- **Esoteric and old.** Prefer overlooked cards, especially Ice Age, Alliances, and the rest of that era (Homelands, Fallen Empires, Mirage block, early Legends reprints). A weird old effect that does the job beats a modern reprint of the same idea.
- **Avoid staples.** Do not reach for the usual Commander auto-includes (Sol Ring, Arcane Signet, Rhystic Study, Swords to Plowshares, Cyclonic Rift, and their cousins) when an on-theme or older card exists. Staples need a specific argument, not "everyone runs this."
- **No Game Changers.** Query live `is:gamechanger`. Zero in the 99 unless the user names an exception for that deck.

## Tools

- **Primer action buttons** — Archidekt and Decisions are shields.io `for-the-badge` pills, not a prose link. `update_archidekt_link.py` writes the row.

## Talks

- **2026-08-26 — Unreleased cards.** Homer, the Hermit and similar prerelease commanders were producing a validator warning. That warning is removed: kitchen-table play does not care about the release date.
- **2026-08-26 — Card taste.** Prefer esoteric old cards (Ice Age, Alliances, that era). Avoid staples. No Game Changers unless a deck is explicitly excepted.
