# Rule DSL Part 13 — static modifiers (minus replacement integration)

**Status:** implemented on `agent/rule-dsl-part13-statics`; replacement/prevention static nodes remain Part 11/12.

## Delivered

- Compile canonical `keyword`, `static` (`prohibitActivation`, `modifyStats`), and runtime `printedStaticModifiers` / `printedStatic` continuous-effect durations with fixed rules timestamps and source incarnations.
- `dslStaticModifiers` plugin plus boot sync in `createServerGame`; shared `activationRestrictionMessage` for activation permission, offers, and mana planning.
- Schema/builder support for `modifyStats` (layer 7b set via `set: true`, layer 7c pump otherwise).

## Evidence

- `rules-engine/src/cardPlugins/dsl/part13.test.ts` — Stony Silence, stack vs restriction, phasing, timestamps, Duskdale/Wall keywords, layer ordering, temporary vs printed lifetimes.

## Gaps (intentional)

- Static replacement/prevention integration (Part 11/12).
- CARD_RULES migration (Part 16).
