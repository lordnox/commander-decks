# Rule DSL Part 13 — static modifiers

**Status:** implemented on `agent/rule-dsl-part13-replacement-integration` (includes Part 11/12 static replacement and prevention lifecycle).

## Delivered

- Compile canonical `keyword`, `static` (`prohibitActivation`, `modifyStats`, `replacement`, `prevention`), and runtime `printedStaticModifiers` / `printedStatic` continuous-effect durations with fixed rules timestamps and source incarnations.
- `dslStaticModifiers` plugin plus boot sync in `createServerGame`; shared `activationRestrictionMessage` for activation permission, offers, and mana planning; static prevention instance registration via the same sync pass.
- Schema/builder support for `modifyStats` (layer 7b set via `set: true`, layer 7c pump otherwise).
- Canonical replacement discovery reads active `printedStaticModifiers` entries (Part 11 processor unchanged).

## Evidence

- `rules-engine/src/cardPlugins/dsl/part13.test.ts` — Stony Silence, stack vs restriction, phasing, timestamps, Duskdale/Wall keywords, layer ordering, temporary vs printed lifetimes.
- `rules-engine/src/cardPlugins/dsl/part13.replacements.test.ts` — static replacement/prevention phasing, ability loss, timestamps, multi-copy draw suppression, prevention capacity while phased out.

## Gaps (intentional)

- CARD_RULES migration (Part 16).
