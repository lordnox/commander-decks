# Decisions

Kitchen-table house rules for this repository. Each deck still has its own `DECISIONS.md` for list, primer, and assessment notes. This file is why the tools behave the way they do across every deck.

## How to use

- **Play** — these decks are for friends, not tournaments.
- **Cards** — avoid identity-diluting staples (lands and two-mana rocks exempt), esoteric on-theme cards, discussable Game Changers, kitchen-table fast mana.
- **Per-deck logs** — why a card is in a 99 lives under `decks/<deck>/DECISIONS.md`.
- **[Deck ideas](DECK-IDEAS.md)** — grilled brews that are queued or parked, not a folder yet.
- **This file** — repo-wide rules that should not be rediscovered in chat.

## Play

- **No tournament legality.** Official Commander legality dates and event rules do not constrain these lists. Unreleased cards are allowed as soon as Oracle text exists.
- **Still reject construction bugs.** Color identity, singleton (except basics and cards that allow copies), and already-released banned or not-legal cards stay validator errors so a bad cache or a banned reprint cannot slip in unnoticed.

## Cards

Default for new brews and swaps. A deck can override in its own log; do not assume an override.

- **Esoteric and old.** Prefer overlooked cards when they still do the job, especially Ice Age, Alliances, and that era (Homelands, Fallen Empires, Mirage block, early Legends reprints). A weird on-theme effect beats a modern reprint of the same idea. This is a tiebreaker among cards that already fit the plan, not a ban on popular cards.
- **Staples are flour.** Flour thickens a sauce that needs thickening; flour the sauce did not need makes it taste worse. A [Commander staple](https://mtgdecks.net/Commander/staples) is the same: it fills a function, and every slot spent on a generic function is a slot not spent on the deck's identity. So the default is still **avoid staples**, and the reason is dilution, not popularity. Popularity alone is never the argument for cutting a card.
  - **Infrastructure needs no argument.** Lands, including duals and untapped fixing, and two-mana rocks (Arcane Signet, Signets, Talismans, Fellwar Stone). These do not change what the deck is; they let it cast its commander.
  - **On theme is allowed, however strong the card.** Chaos Warp, Dark Ritual, and even free spells belong when the deck is *about* that. Dark Ritual in a deck built to spend a black burst; Chaos Warp when random transformation is the point or it answers what the deck's plan specifically fears; the pacts in Borrowed Time, where the pay-or-lose bill is demonstrated onto opponents as the kill. Name the line in one sentence.
  - **Out when the reason is "strongest generic option."** Rhystic Study or Smothering Tithe as a tax value engine, Force of Will / Fierce Guardianship / Deflecting Swat held as free protection, best-in-color removal picked because the color happens to be open. The card is not the test, the reason is: Chaos Warp as the theme is fine, Chaos Warp because red needs an answer is flour.
  - **A drawback used on purpose is not power.** A feared card run for its cost, or for its lose-the-game clause, can make a deck weaker rather than stronger. Borrowed Time buys a win condition with its free spells and pays consistency for it. Score what a card does in *that* list, not its reputation.
  - Sol Ring stays out as permanent fast mana (kitchen-table 4+), which is a power rule, not a staple rule.
- **Untapped fixing over filler tap lands.** Dual lands are welcome and are not excluded for price unless a deck has a budget. Tap lands are disliked unless they bring something beyond incidental life gain; otherwise an untapped basic or dual is usually better. [MANABASE.md](MANABASE.md) collects the mana-base hints.
- **Game Changers are discussable.** Read the cached list in [BRACKET-DEFINITIONS.md](BRACKET-DEFINITIONS.md) and still report official status in assessments. Official listing is a conversation starter, not an automatic veto. Include the card only when the usage can be named in one sentence and still sounds like the joke, the theme, or the secret commander. Leave it out when it is just the best generic tool: more speed, more consistency, or a free answer. Examples that can be fine: Gamble fetching Dawnsire as a secret commander; Biorhythm or Coalition Victory as the win; Crop Rotation as a weird land toolbox. Examples that are not: Gamble into a free counterspell; Crop Rotation into a Maze lock. A per-deck tutor ban still wins over this paragraph until that deck reopens it.
- **Ramp is not fast mana.** Fast mana is extra mana you can spend on the turn you use the card. Ramp spends a turn to be richer later (Arcane Signet, Mind Stone, Fellwar Stone, Cultivate-style land fetch).
- **One-shot fast mana** (Dark Ritual, Cabal Ritual, Seething Song, Burnt Offering) is acceptable in Bracket 3+ lists when the argument is deck-specific, not "this is efficient."
- **Permanent fast mana** (Sol Ring, Moxes, Mana Vault, Grim Monolith, Ancient Tomb) is kitchen-table **4+**. Sol Ring counts even though Wizards left it off Game Changers.
- **Convince-me still applies.** If the usage is the engine or the joke, argue for the card. Do not sneak it in because it is good.

## Tools

- **Primer action buttons** — Archidekt and Decisions are shields.io `for-the-badge` pills, not a prose link. `update_archidekt_link.py` writes the row.

## Talks

- **2026-09-14 — Construction numbers are comparison points.** `CONSTRUCTION.md` collects Command Zone 658, Rebell / commandertemplate.com (operational threshold, ramp+draw budget), and 8×8 package density. Use them to notice holes; do not fail a brew for missing "12/12/12." Lands stay in `MANABASE.md`; interaction still names buckets in `INTERACTION.md`.
- **2026-09-13 — Mana bases are deck slots.** Sort fixing and source counts out first, skip tap lands that bring nothing, then let spare land slots carry synergy. `MANABASE.md` is hints for brewing, not a checklist a deck has to pass. Dual lands are allowed by default; budget is a per-deck constraint, not a repository assumption.
- **2026-09-03 — Game Changers are cached.** The official list is snapshotted in `BRACKET-DEFINITIONS.md` alongside bracket intent and caps, refreshed by `update_game_changers.py`. Assessments read that file instead of fetching Wizards pages or querying Scryfall every time; a refresh is a deliberate step.
- **2026-09-01 — Game Changers and fast mana.** Official `is:gamechanger` stays the assessment source of truth (now via the cached snapshot). Construction uses usage: a Game Changer is fine when the table can hear why it is in *this* deck (Gamble for Dawnsire, Biorhythm, Coalition Victory, Crop Rotation as a land toy) and not fine when it only finds a free counter, a lock, or generic consistency. Fast mana means extra mana this turn. Signets and similar rocks are ramp. One-shot rituals can live in 3+; Sol Ring and other permanent fast mana are 4+ here even though Wizards treats Sol Ring as a format default.
- **2026-08-26 — Unreleased cards.** Homer, the Hermit and similar prerelease commanders were producing a validator warning. That warning is removed: kitchen-table play does not care about the release date.
- **2026-09-14 — Staples are flour.** Avoiding staples stays the default, but the reason is **identity dilution**, not popularity: flour the sauce did not need makes it taste worse. Popularity alone is never a reason to cut. Lands and two-mana rocks are infrastructure and need no argument. No card is blacklisted by name — the reason for the slot is the test. Chaos Warp and Dark Ritual are welcome when they are on theme, and so are free spells: Borrowed Time's pacts are the win condition, which costs that deck consistency rather than adding power. What stays out is the card taken because it is the strongest generic option: Rhystic Study, Smothering Tithe, free counterspells as protection, best-in-color removal because the color is open. Sol Ring is still 4+ for power. Reference list: https://mtgdecks.net/Commander/staples (Cloudflare-gated, so it is not cached here).
- **2026-08-26 — Card taste.** Prefer esoteric old cards (Ice Age, Alliances, that era) when they still do the job. Game Changers are not a blanket ban; see 2026-09-01. Staple policy: 2026-09-14.
