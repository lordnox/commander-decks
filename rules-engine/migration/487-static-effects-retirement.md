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
| `attackTax`, `blockTax` | `combatTax.ts`; `staticEffects.ts` | DSL combat tax static effects; `dsl/combatTaxes.test.ts` | Pending |
| `opponentsCantBlock`, `opponentsCantCast` | `plugins/opponentRestrictions.ts`; `staticEffects.ts` | DSL parity restrictions; `dsl/evenManaValue.test.ts` | Pending |
| `grantRetrace` | `alternateCosts.ts`; `staticEffects.ts` | DSL alternate-cost / granted ability programs; inspect catalog and behavior tests | Pending |
| `linkedExileUntilLeaves` | `linkedExile.ts`, `exilePayoffs.ts`; `staticEffects.ts` | DSL linked-exile lifecycle; `linkedExile.test.ts`, `exilePayoffs.test.ts` | Pending |
| `ptEqualsLife`, `ptEqualsCount` | `plugins/cdaLifePt.ts`; `staticEffects.ts` | DSL CDA / static characteristic effects; `plugins/cdaLifePt.test.ts` | Pending |
| `reduceActivationCost` | `activationCosts.ts`; `staticEffects.ts` | DSL `reduceActivationCost`; `dsl/activationCostReduction.test.ts` | Removed; legacy activation adapter now queries canonical printed reducers |
| `staticBoardPump` | `staticBoardPumpSpec.ts`, `staticBoardPump.ts`; `staticEffects.ts` | DSL `modifyStats` / keyword static effects; `staticBoardPump.test.ts`, `staticKeywordLayer.test.ts` | Pending |
| `ward` | `ward.ts`; `staticEffects.ts` | DSL ward contract; `dsl/ward.test.ts`, `wardLife.test.ts` | Removed; pinned life payment/privacy/restore assertions now use a canonical Wurm fixture |
| `grantCreatureTrigger` | `grantCreatureTrigger.ts`; `staticEffects.ts` | DSL granted triggered abilities; `grantCreatureTrigger.test.ts` | Pending; coordinate #648/#651 |
| `pumpPerLinkedExile` | `exilePayoffs.ts`; `staticEffects.ts` | DSL linked-exile stats; `exilePayoffs.test.ts` | Pending |
| `exileOpponentGraveyard`, `playExiledWithLife` | `exiledWith.ts`; `staticEffects.ts` | DSL exile/play permissions; inspect catalog and behavior tests | Pending |
| `pluginId` | `effectRuntime.ts`, generated/static plugin discovery | Generic plugin plumbing; inspect generated program consumers | Pending; coordinate #651 |

The first review slice is the three library/land permission fields. It removed
their legacy producers/readers and cites the existing canonical behavior suite
rather than duplicating those semantics. Focused verification passed 19 tests
across `plugins/lands.test.ts`, `cardPlugins/libraryTop.test.ts`, and
`cardPlugins/dsl/playPermissions.test.ts`. Later slices will retire the
The second slice also retired `allCreatureTypes`, `legendRuleOff`,
`reduceActivationCost`, and `ward`. `activationCostReduction.test.ts` keeps its
legacy activation-cost integration scenarios but uses a canonical static
reducer; the canonical mechanic suite owns reduction semantics. The Ward life
suite keeps its life-seven payment, privacy, restore, and countering assertions
with a canonical Ward source. A new restricted-mana mechanic assertion uses
the catalog Maskwood Nexus to verify that a creature spell in hand acquires
the chosen type before planner/payment eligibility is evaluated.

Remaining rows will be retired in later checkpoints, with the granted-trigger and generic plugin adapters retained
until their generated-program consumers in #648/#651 no longer depend on them.

No card registration, legacy allowance, or enforcement change is in scope.
Behavioral test ownership stays with reusable mechanic suites; catalog checks
remain structural and reuse registered templates.
