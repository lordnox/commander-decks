# Design-deck lessons

Oracle and Scryfall win over memory. These are failure modes this skill exists to catch.

## Copy, mill, identity

- Independent `Tasha's Hideous Laughter` copies each exile until mana value 20. Lands are 0. Six copies do not empty a 99.
- `Bruvac, Grand Loquacious` doubles mill, not exile.
- `Goblin Anarchomancer` is Gruul; illegal in Izzet.
- A sequence that strips libraries is not a win without a damage or other finishing card.

## Game Changers

Default is **zero** Game Changers. Read the cached list in root `BRACKET-DEFINITIONS.md`; do not recite an old list from memory and do not re-query Scryfall for it. Cards that have been GCs include `Necropotence`, `Bolas's Citadel`, `Ad Nauseam`, `Demonic Tutor`, `Vampiric Tutor`, `Imperial Seal`, `Mystical Tutor`, `Enlightened Tutor`, `Rhystic Study`, `Smothering Tithe`, `Cyclonic Rift`, `Teferi's Protection`, `Fierce Guardianship`, `Ancient Tomb`, `Mana Vault`, `Grim Monolith`. `Mana Drain` has not always been on that list — check.

Card tutors and land search are separate locks. "No tutors" often still allows `Wayfarer's Bauble`, `Expedition Map`, and fetchlands. Staples still need an argument; prefer Ice Age / Alliances-era and other overlooked cards. Root `DECISIONS.md` is the taste lock.

## Life totals

- Count **player** life-movers. Cut lookalikes: `Evra` (life vs power), `Arbiter of Knollridge` (everyone to the **highest**), `Psychic Transfer` (only if the gap is ≤5), `Sway of the Stars` (reset to 7 and wipe).
- At 1 life, prefer **abilities** (`Soul Conduit`, Axis trigger, Magus/Mirror) over sorceries. `Counterspell` stops the cast, not the activation (except Stifle-class cards).
- `Mister Negative` draws only if you **lost** life in the exchange (you were higher). Blink replays the ETB. Magus/Mirror/Conduit do not.
- `Repay in Kind` sets every total to the **lowest**. `Reverse the Sands` redistributes. They are not interchangeable.
- `Hatred` pumps a creature; it does not grant lifelink. `Selenia` pays 2 life in even steps from 40 (2, then 0).
- Effects that say your life total can't change (`Teferi's Protection`, `Flare of Fortitude`) make an exchange involving you do nothing useful.

## Mana loops

`Cabal Coffers` / Magus tap: mana abilities, Rings ignores them.

`Deserted Temple` `{1}, {T}:` untap target land: not a mana ability. Rings copies it for `{2}`.

One Coffers + Temple + Rings lap costs 5, produces `N` black (`N` = Swamps, usually via `Urborg` / `Blanket of Night`). Net `N − 5`. `N = 5` loops with no extra mana; `N ≥ 6` is infinite black.

Without Rings, the same pair is **fat X** (Coffers twice in a turn), not a loop.

`Blood Celebrant` and Coffers taps are mana abilities. Evangela fog, Conduit, Magus exchange, Mother of Runes, Arcanis tap-draw are copyable.

## Build politics

- Enchantment tax (`Ghostly Prison`) is harder to kill than the same text on a creature (`Baird`, `Archangel of Tithes`). Ask which they want.
- Draw-go is not Silence / Grand Abolisher. Instant fogs and counters hold the stack; locks empty it on your turn.
- Finding wins without card tutors means density plus draw (including pay-life draw that also dumps life) and cheap instant/sorcery recursion. `Queza` turns extra draws into a clock.
- `Blue Sun's Zenith` shuffles back. `Peer into the Abyss` draws, then you lose half your life, **then** draw triggers (Queza) go on the stack — lethal at 1.
- Maybeboard cards the user likes but that fail a constraint (loud draw, Game Changer, sticky enchantment) belong in `DECISIONS.md`, not forced into the 99.
