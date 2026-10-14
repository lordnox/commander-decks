# Rule DSL Part 16 — existing-card migration (family 1 in progress)

**Status:** family 1 (simple keywords / player effects) in progress. Not complete. Do not remove `legacy.ts` or close Part 16.

## This slice

- Name-keyed catalog of compiled `CardRuleDefinitionSnapshotV1` values under `src/cardPlugins/dsl/cardRuleCatalog.ts`. Lookup is exact card name; snapshots compile at module load.
- `newGame` `put()` attaches the catalog snapshot when the template did not already set `ruleDefinition`. A stamped canonical object does not also receive `CARD_RULES` `effects` unless the template passed `effects` explicitly.
- Family 1 names in this slice: **Duskdale Wurm** (trample), **Wall of Omens** (defender + ETB draw), **Night's Whisper** (draw 2, lose 2 life). `CARD_RULES` had no fully representable family-1 card (every registered name has at least one non-adapter effect). Keyword-only / stored-deck names fill that gap. Thunderfoot Baloth is not this family.

## Evidence

`rules-engine/src/cardPlugins/dsl/part16.family1.test.ts` — catalog pin, empty effects, keyword/ETB/spell gameplay, mixed catalog Wall of Omens + CARD_RULES Mulldrifter, no double-fire, journal/JSON `definitionRevision`.

## Not this slice

Final consolidation, deleting `legacy.ts` / `CARD_RULES`, targeting, activations, costs, modes, copies, hidden-zone search, replacements, static board pumps, CI, live wire codecs.
