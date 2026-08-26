# Decisions

Kitchen-table house rules for this repository. Each deck still has its own `DECISIONS.md` for list, primer, and assessment notes. This file is why the tools behave the way they do across every deck.

## How to use

- **Play** — these decks are for friends, not tournaments.
- **Per-deck logs** — why a card is in a 99 lives under `decks/<deck>/DECISIONS.md`.
- **This file** — repo-wide rules that should not be rediscovered in chat.

## Play

- **No tournament legality.** Official Commander legality dates and event rules do not constrain these lists. Unreleased cards are allowed as soon as Oracle text exists.
- **Still reject construction bugs.** Color identity, singleton (except basics and cards that allow copies), and already-released banned or not-legal cards stay validator errors so a bad cache or a banned reprint cannot slip in unnoticed.

## Tools

- **Primer action buttons** — Archidekt and Decisions are shields.io `for-the-badge` pills, not a prose link. `update_archidekt_link.py` writes the row.

## Talks

- **2026-08-26 — Unreleased cards.** Homer, the Hermit and similar prerelease commanders were producing a validator warning. That warning is removed: kitchen-table play does not care about the release date.
