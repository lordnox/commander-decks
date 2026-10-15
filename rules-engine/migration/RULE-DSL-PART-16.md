# Rule DSL Part 16 — existing-card migration (families 1–7 catalog; adapters removed)

**Status:** family catalog on main. `legacy.ts` gone. `CARD_RULES` remains for unmigrated names. Part 16 **not** complete.

## This slice (adapter consolidation)

- Rewrote catalog Wall of Omens (ETB draw) and Night's Whisper (draw + loseLife) off `adaptLegacyTrigger` / `adaptLegacyPlayerInstruction` onto canonical builders (`whenever(self.enters, …)`, `draw`, `loseLife`). Family 1 tests still pass.
- Deleted `rules-engine/src/cardPlugins/dsl/builders/legacy.ts` and dropped `export * from '../builders/legacy'` in `v1/index.ts`.
- Rewrote `v1/index.test.ts` adapter-only cases against the canonical API; retired adapter-only rejection checks. No compatibility shim remains.
- Families 1–7 stay a **representative catalog**, not a full `CARD_RULES` migration. Mixed catalog + `CARD_RULES` games must keep working.

## Families 1–7 (already on main)

- Name-keyed catalog of compiled `CardRuleDefinitionSnapshotV1` values under `src/cardPlugins/dsl/cardRuleCatalog.ts`. Lookup is exact card name; snapshots compile at module load.
- `newGame` `put()` attaches the catalog snapshot when the template did not already set `ruleDefinition`. A stamped canonical object does not also receive `CARD_RULES` `effects` unless the template passed `effects` explicitly.
- Family 1 names: **Duskdale Wurm** (trample), **Wall of Omens** (defender + ETB draw), **Night's Whisper** (draw 2, lose 2 life). `CARD_RULES` had no fully representable family-1 card (every registered name has at least one non-adapter effect). Keyword-only / stored-deck names fill that gap. Thunderfoot Baloth is not this family.
- Family 2 names: **Flame Rift** (4 damage to each player), **Thragtusk** (self ETB gain 5, self leaves-the-battlefield 3/3 Beast), **Fate Unraveler** (whenever an opponent draws, this creature deals 1 damage to that player). `CARD_RULES` still has no fully representable family-2 card (every registered name has targeting, an activation, search, a replacement, modes, a handler, or another non-adapter effect). Stored-deck / real names fill that gap.
- Family 3 names: **Murder** (destroy target creature), **Sign in Blood** (target player draws 2 and loses 2 life), **Vampire Hounds** (discard a creature card: +2/+2 until end of turn). `CARD_RULES` Lightning Bolt is targeting-only, but Oracle is any target and `Selector` has no player-or-permanent union; do not encode it as creature-only. Remaining CARD_RULES activations still mix tap, flying, specialized ledgers, or Eva `missingCardPlugins` ability ids. Real Oracle names whose filters and Cost kinds already exist fill that gap.
- Family 4 names: **Esper Charm** (choose one: destroy target enchantment / draw two / target player discards two) and **Reverberate** (copy target instant or sorcery; may choose new targets). CARD_RULES Charms/Commands still mix fight, tap-all, X, or search-in-mode. Twincast stays on `CARD_RULES` so the legacy object-on-stack `stackCopy` path keeps its evidence; Reverberate is the same Oracle on the canonical `copySpell` + `StackItemFilter.type` stack.
- Family 5 names: **Diabolic Tutor** (search library for a card, put it into your hand, then shuffle). Cultivate / Kodama's Reach remain CARD_RULES because split battlefield-tapped + hand destinations are not a reusable search node. Added reusable `shuffle` plus `searchLibrary` sugar over typed `selectCards` (`chooseCards` + `move` + `shuffle`). Player picks are `selectCards`, never `custom`.
- Family 6 names: **Glorious Anthem** (creatures you control get +1/+1), **Rest in Peace** (ETB exile all graveyards; if a card or token would be put into a graveyard from anywhere, exile it instead). `CARD_RULES` replacement/static names still mix tap-unless, ward, overlay grants, or specialized plugins, so stored-deck / real Oracle names whose `whenever` + `move`, `staticAbility` + `modifyStats`, and `replacement` + `redirectEvent` already exist fill that gap.
- Family 7 names: **Foil** (you may discard an Island card and another card rather than pay this spell's mana cost; counter target spell). Votes, linked exile, faces/Rooms, Sagas, and other specialized handlers that still need new reusable nodes are omitted; this catalog is not “migrate every specialized handler”.

## Evidence

`rules-engine/src/cardPlugins/dsl/part16.family1.test.ts` — catalog pin, empty effects, keyword/ETB/spell gameplay, mixed catalog Wall of Omens + CARD_RULES Mulldrifter, no double-fire, journal/JSON `definitionRevision`.

`rules-engine/src/cardPlugins/dsl/part16.family2.test.ts` — catalog pin, empty effects, untargeted Flame Rift damage, Thragtusk ETB/leaves (graveyard, hand, exile) without double-fire, pending-leave journal restore, Fate Unraveler opponent-draw damage, mixed catalog Thragtusk + CARD_RULES Mulldrifter, journal/JSON `definitionRevision`.

`rules-engine/src/cardPlugins/dsl/part16.family3.test.ts` — catalog pin, empty effects, Murder creature targeting, Sign in Blood player targeting, Vampire Hounds discard-cost activation without double-fire, mixed catalog Murder + CARD_RULES Mulldrifter, journal/JSON `definitionRevision`.

`rules-engine/src/cardPlugins/dsl/part16.family4and5.test.ts` — catalog pin, empty effects, Esper Charm mode pick (destroy / draw / discard), Reverberate copy with keep-targets and creature-spell rejection, Diabolic Tutor hidden-zone `selectCards` plus shuffle, mixed catalog Diabolic Tutor + CARD_RULES Mulldrifter, no double-fire, journal/JSON `definitionRevision`.

`rules-engine/src/cardPlugins/dsl/part16.family6and7.test.ts` — catalog pin, empty effects, Glorious Anthem board pump, Rest in Peace ETB exile of existing graveyards plus graveyard-to-exile redirect, Foil Island-discard alternative plus counter without double-fire, mixed catalog Glorious Anthem + CARD_RULES Mulldrifter, journal/JSON `definitionRevision`, family 1 catalog spell still charges printed mana.

## Remaining

Unmigrated `CARD_RULES` names (Mulldrifter, Lightning Bolt, votes, linked exile, Rooms, Sagas, and other specialized handlers that still need nodes). Do not delete `CARD_RULES` / `cardRules.ts` or the CARD_RULES executor / `effectsFor` path. Mixed games must keep working. Part 16 is **not** complete in the plan-exit sense (“every previously supported registration has a canonical result”).
