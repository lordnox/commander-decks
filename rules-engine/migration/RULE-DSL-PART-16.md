# Rule DSL Part 16 — existing-card migration (family 1+2+3 in progress)

**Status:** family 1 (simple keywords / player effects), family 2 (ordinary spells and triggers), and family 3 (targeting / activation / costs) in progress. Not complete. Do not remove `legacy.ts` or close Part 16.

## This slice

- Name-keyed catalog of compiled `CardRuleDefinitionSnapshotV1` values under `src/cardPlugins/dsl/cardRuleCatalog.ts`. Lookup is exact card name; snapshots compile at module load.
- `newGame` `put()` attaches the catalog snapshot when the template did not already set `ruleDefinition`. A stamped canonical object does not also receive `CARD_RULES` `effects` unless the template passed `effects` explicitly.
- Family 1 names in this slice: **Duskdale Wurm** (trample), **Wall of Omens** (defender + ETB draw), **Night's Whisper** (draw 2, lose 2 life). `CARD_RULES` had no fully representable family-1 card (every registered name has at least one non-adapter effect). Keyword-only / stored-deck names fill that gap. Thunderfoot Baloth is not this family.
- Family 2 names in this slice: **Flame Rift** (4 damage to each player), **Thragtusk** (self ETB gain 5, self leaves-the-battlefield 3/3 Beast), **Fate Unraveler** (whenever an opponent draws, this creature deals 1 damage to that player). `CARD_RULES` still has no fully representable family-2 card (every registered name has targeting, an activation, search, a replacement, modes, a handler, or another non-adapter effect). Stored-deck / real names fill that gap. Do not redo Duskdale Wurm, Wall of Omens, or Night's Whisper.
- Family 3 names in this slice: **Murder** (destroy target creature), **Sign in Blood** (target player draws 2 and loses 2 life), **Vampire Hounds** (discard a creature card: +2/+2 until end of turn). `CARD_RULES` Lightning Bolt is targeting-only, but Oracle is any target and `Selector` has no player-or-permanent union; do not encode it as creature-only. Remaining CARD_RULES activations still mix tap, flying, specialized ledgers, or Eva `missingCardPlugins` ability ids. Real Oracle names whose filters and Cost kinds already exist fill that gap. Do not redo Duskdale Wurm, Wall of Omens, Night's Whisper, Flame Rift, Thragtusk, or Fate Unraveler.

## Evidence

`rules-engine/src/cardPlugins/dsl/part16.family1.test.ts` — catalog pin, empty effects, keyword/ETB/spell gameplay, mixed catalog Wall of Omens + CARD_RULES Mulldrifter, no double-fire, journal/JSON `definitionRevision`.

`rules-engine/src/cardPlugins/dsl/part16.family2.test.ts` — catalog pin, empty effects, untargeted Flame Rift damage, Thragtusk ETB/leaves (graveyard, hand, exile) without double-fire, pending-leave journal restore, Fate Unraveler opponent-draw damage, mixed catalog Thragtusk + CARD_RULES Mulldrifter, journal/JSON `definitionRevision`.

`rules-engine/src/cardPlugins/dsl/part16.family3.test.ts` — catalog pin, empty effects, Murder creature targeting, Sign in Blood player targeting, Vampire Hounds discard-cost activation without double-fire, mixed catalog Murder + CARD_RULES Mulldrifter, journal/JSON `definitionRevision`.

## Not this slice

Final consolidation, deleting `legacy.ts` / `CARD_RULES`, modes, copies, hidden-zone search, replacements, static board pumps, CI, live wire codecs.
