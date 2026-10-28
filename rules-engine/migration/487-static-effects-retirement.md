# Retire legacy static CardEffect routes

Parent: [#487](https://github.com/lordnox/commander-decks/issues/487)

Child: [#647](https://github.com/lordnox/commander-decks/issues/647)

Base: #646 checkpoint `cdc193f1`

This migration removes all card-authored `op: 'static'` fields and their
legacy readers. Each field is to be either replaced by its canonical Rule DSL
contract or explicitly retained only as generic runtime plumbing required by
generated programs. Static layer application and identity tracking remain
generic engine infrastructure.

## Finite field and reader inventory

| Legacy field(s) | Current reader / producer | Canonical owner / evidence | Status |
| --- | --- | --- | --- |
| `playLandsFromGraveyard` | `plugins/lands.ts`; `staticEffects.ts` | DSL `playLands`; `dsl/playPermissions.test.ts` | Removed; canonical graveyard permission assertions remain |
| `playLandsFromLibraryTop`, `revealLibraryTop` | `libraryTopKnowledge.ts`; `staticEffects.ts` | DSL `playLands`, `revealLibraryTop`; `dsl/playPermissions.test.ts` | Removed; `libraryTop.test.ts` now uses catalog Courser of Kruphix |
| `extraLandfall`, `extraEnters` | `effectRuntime.ts`; `staticEffects.ts` | DSL trigger event multiplicity / canonical trigger program; `triggerFrequency.test.ts` | Pending |
| `allCreatureTypes` | `actions.ts`, `creatureTypeChoice.ts`, `homer.ts`, `spells.ts`; `staticEffects.ts` | DSL `addTypes` with `allCreatureTypes`; `dsl/typeChanges.test.ts`; catalog Maskwood + restricted mana integration | Removed; canonical objects expose their added subtypes across zones |
| `legendRuleOff` | `plugins/stateBased.ts`; `staticEffects.ts` | DSL `legendRuleOff`; `dsl/legendRuleOff.test.ts` | Removed; canonical suite owns exception behavior |
| `attackTax`, `blockTax` | `cardPlugins/combatTax.ts`; `staticEffects.ts` | DSL combat tax static effects; `dsl/combatTaxes.test.ts` | Removed; canonical payment and qualifier assertions remain |
| `opponentsCantBlock`, `opponentsCantCast` | `plugins/opponentRestrictions.ts`; `staticEffects.ts` | DSL mana-value predicates; `dsl/evenManaValue.test.ts`, `plugins/opponentRestrictions.test.ts`, `plugins/combatKeywords.test.ts` | Removed; canonical parity and range legality assertions remain |
| `grantRetrace` | `alternateCosts.ts`; `staticEffects.ts` | DSL `castSpells(discardLand)`; `dsl/castSpells.test.ts`, Six catalog template | Removed; canonical permission creates Retrace for matching graveyard permanents |
| `linkedExileUntilLeaves` | `linkedExile.ts`; `staticEffects.ts` | DSL `linkExile({ untilSourceLeaves, returnTo })`; `dsl/linkExile.test.ts` | Removed; return-on-leave is an instruction property, not an independent static field |
| `ptEqualsLife`, `ptEqualsCount` | `plugins/cdaLifePt.ts`; `staticEffects.ts` | DSL CDA / static characteristic effects; `plugins/cdaLifePt.test.ts` | Removed; canonical set-P/T definitions own life/count, zone, copy, control, and layer assertions |
| `reduceActivationCost` | `activationCosts.ts`; `staticEffects.ts` | DSL `reduceActivationCost`; `dsl/activationCostReduction.test.ts` | Removed; legacy activation adapter now queries canonical printed reducers |
| `staticBoardPump` | `staticBoardPumpSpec.ts`, `staticBoardPump.ts`; `staticEffects.ts` | DSL `modifyStats` / keyword static effects; `staticBoardPump.test.ts`, `staticKeywordLayer.test.ts` | Removed; canonical layer assertions and registered Thunderfoot Baloth/Colossification templates cover the migrated behaviors |
| `ward` | `ward.ts`; `staticEffects.ts` | DSL ward contract; `dsl/ward.test.ts`, `wardLife.test.ts` | Removed; pinned life payment/privacy/restore assertions now use a canonical Wurm fixture |
| `grantCreatureTrigger` | `grantCreatureTrigger.ts`; `staticEffects.ts` | DSL granted triggered abilities; `grantCreatureTrigger.test.ts` | Pending; coordinate #648/#651 |
| `pumpPerLinkedExile` | `exilePayoffs.ts`, `continuousEffects.ts`; `staticEffects.ts` | DSL linked-object selectors and `modifyStats`; `dsl/persistentExile.test.ts`, `imprintPumpFromLinked.test.ts` | Removed; canonical modifiers recompute from exact linked identities and printed characteristics |
| `exileOpponentGraveyard`, `playExiledWithLife` | `exiledWith.ts`; `staticEffects.ts` | DSL linked `replacement` and `castSpells(lifeEqualManaValue)`; `dsl/castSpells.test.ts`, Valgavoth catalog template | Removed; canonical replacement/link and life-cast permission own the complete behavior |
| `pluginId` | `effectRuntime.ts`, generated/static plugin discovery | Generic plugin plumbing; inspect generated program consumers | Pending; coordinate #651 |

The first review slice removed the three library/land permission fields and
their legacy producers/readers, citing the existing canonical behavior suite
rather than duplicating those semantics. Focused verification passed 19 tests
across `plugins/lands.test.ts`, `cardPlugins/libraryTop.test.ts`, and
`cardPlugins/dsl/playPermissions.test.ts`. The second slice also retired
`allCreatureTypes`, `legendRuleOff`,
`reduceActivationCost`, and `ward`. `activationCostReduction.test.ts` keeps its
legacy activation-cost integration scenarios but uses a canonical static
reducer; the canonical mechanic suite owns reduction semantics. The Ward life
suite keeps its life-seven payment, privacy, restore, and countering assertions
with a canonical Ward source. A new restricted-mana mechanic assertion uses
the catalog Maskwood Nexus to verify that a creature spell in hand acquires
the chosen type before planner/payment eligibility is evaluated.

The third slice also removed `attackTax` and `blockTax`. Combat-tax integration
fixtures use canonical DSL programs. The fourth slice added canonical mana-value
range predicates while preserving parity-only serialization and migrated the
existing cast/block integration fixtures before removing the legacy restriction
fields and readers. The fifth slice replaced the life/count CDA plugin with
canonical characteristic-defining `modifyStats` definitions. Its mechanic
tests retain owner/controller life, changing life totals, all-zone behavior,
counted-land updates, copied definitions, and counter-layer ordering. The sixth
slice replaced `staticBoardPump` with canonical printed stat and keyword
modifiers, preserving its land-creature, commander-condition, three-player
hexproof/targeting, and derived LKI assertions. Its named-card integrations now
reuse the registered Thunderfoot Baloth and Colossification definitions. The
seventh slice retired `linkedExileUntilLeaves` and `pumpPerLinkedExile`: canonical
link instructions now carry the leave condition and return zone, while
`modifyStats` derives bonuses from linked objects. Hand-return behavior remains
covered, and count/characteristic, signed values, exact object identity, source
incarnation, and recomputation assertions remain in the canonical persistent-
exile suites. Clone-shape and sync-event assertions were implementation details
of the removed pump adapter and were removed with it. The spell-permission
slice removes the Retrace and linked-exile static fields and their readers.
Six remains covered by the canonical Retrace mechanic test. Valgavoth's
opposing-graveyard exile, linked-card identity, and life-paid cast integration
uses its catalog template; canonical tests retain the source-leaves, turn,
zone, and payment checks. Remaining rows will be
retired in later checkpoints, with
the granted-trigger and generic plugin adapters retained until programs
generated by #648/#651 no longer depend on them.

No card registration, legacy allowance, or enforcement change is in scope.
Behavioral test ownership stays with reusable mechanic suites; catalog checks
remain structural and reuse registered templates.
