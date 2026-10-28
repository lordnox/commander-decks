# Retire legacy trigger registration routes

Parent: [#487](https://github.com/lordnox/commander-decks/issues/487)

Child: [#648](https://github.com/lordnox/commander-decks/issues/648)

Base: #668 checkpoint `292aa20e`

This migration removes card-authored trigger, Saga, and draw-replacement
registration paths after their behavior is owned by the canonical Rule DSL.
Generic trigger collection, APNAP ordering, identity/LKI snapshots, occurrence
matching, multiplier behavior, trigger resolution, and typed player/card
selection remain engine infrastructure.

## Finite source and evidence inventory

| Route | Legacy source / registration | Canonical owner and evidence | Status / sequence |
| --- | --- | --- | --- |
| Granted triggered abilities | `staticEffects.ts`, `effectDefinitions.ts`, `grantCreatureTrigger.ts`, `continuousEffects.ts` trigger-grant payload, `types.ts`, optional plugin registration in `formats.ts` and `plugins/index.ts`, and `mayFightGrantSource` instruction handler | `dsl/grantedAbilities.test.ts` static grant tests; catalog Grothama and `dsl/combatDamage.test.ts` | Removed in first slice. Preserved source/controller/subtype matching, grant-to-source at entry, source-leaves cleanup, entering-after cleanup, typed choice privacy, controller-attributed fight damage, and journal restore through canonical behavior. Generic `GeneratedAbility`/`canonicalGrantedAbilities` remains. |
| Ordinary occurrence triggers | `cardPlugins/triggers.ts`, `cardPlugins/triggerFrequency.ts`, `cardPlugins/triggers/matching.ts`, `rules/triggers.ts`, plus readers of `CardEffect.op === 'trigger'` | `dsl/triggeredAbilities.test.ts`, `dsl/triggerMultiplication.test.ts`, `dsl/combatDamage.test.ts`, and existing mechanic suites owning each occurrence | Pending; migrate remaining producers and tests by behavior owner before removing legacy collector. Keep generic occurrence, ordering, LKI, target-choice, frequency, and multiplier contracts. |
| Cast triggers | `cardPlugins/castTriggers.ts` and `op:'trigger'` cast registration | Canonical `whenever` cast patterns and relevant cast mechanic suite | Pending; migrate test producers first, then remove cast adapter. Preserve cast timing, controller, target announcement, and stack order. |
| Spell resolve callbacks | `cardPlugins/onResolve.ts`, `abilities.ts:onResolve`, and `op:'trigger', on:'resolve'` reader path | Canonical spell instruction programs; `runInstructions.test.ts` and owning mechanic suites | Pending; migrate callback fixtures before removing resolve adapter. Preserve resolution ordering and continuation/restore behavior. |
| Saga registration fallback | `plugins/saga.ts` legacy `op:'saga'` and printed-oracle chapter/read-ahead fallback; `effectDefinitions.ts` Saga effect type; `abilities.ts:sagaChapters`; legacy fixtures in `plugins/saga.test.ts`, `cardPlugins/sagaPlayerTarget.test.ts`, and `cardPlugins/targetingMana.test.ts` | `plugins/saga.test.ts` covers entry lore, precombat-main/controller timing, shared/crossed chapter timing, Read Ahead, pending triggers, partial resolution and final sacrifice; `cardPlugins/dsl/saga.test.ts` and canonical Kiora/Awaken/Summon catalog fixtures cover targets, restore, chapter effects and lifecycle | Removed. All three test fixtures now compile canonical definitions or reuse registered templates. Generic Saga rules, Read Ahead handling, lore counters, chapter pending checks, and final-chapter SBA remain. `romanNumber` remains shared with mana parsing. |
| Draw replacement by type | `replacements.ts:replaceDrawByType`, `CardEffect.op:'drawReplacementByType'`, and `dsl/drawReplacementByType.test.ts` | Canonical replacement definitions, `dsl/drawReplacementByType.test.ts`, `dsl/drawReplacement.integration.test.ts`, Abundance catalog template | Removed. Repository search found no producer or runtime reader; the four existing DSL tests remain unchanged in behavior and own privacy, multi-draw sequencing, normal draw continuation, fail-to-find, and library ordering. |
| Room unlock test route | `plugins/rooms.ts` and legacy `op:'trigger', on:'unlock'` fixtures in `plugins/rooms.test.ts` | Canonical room / door state and generated ability behavior tests | Pending; preserve unlock ordering, multiple rooms, controller identity, and private choice assertions before removing legacy test fixture route. |
| Generic plugin id from generated programs | `staticEffects.ts`, `effectRuntime.ts`, `newGame.ts`, `plugins/index.ts`, token/generated-program resolution | Canonical generated program/runtime registration; issue #651 handoff | Pending #651. Keep generic runtime `pluginId` plumbing until generated programs stop consuming it; this is not a card-authored trigger exception. |

The first slice removed the legacy grant-trigger stamping bridge. Before
removal, `grantCreatureTrigger` copied `CardEffect.op:'trigger'` into each
recipient and removed it through a reversible `triggerGrant` effect. Canonical
`grantAbilityTo` already stores version-pinned `GeneratedAbility` records and
`rules/triggers.ts` already collects them as triggered abilities. The mechanic
suite now covers a controlled subtype grant, no grant to an opponent's matching
creature, a grant to a matching source as it enters, and removal before later
matching entries. Catalog Grothama integration retains the other-controller
recipient, exclusion of the granter, controller-attributed damage, private
choice, source-leaves behavior, and journal restore assertions. These tests
exercise the canonical route; the bespoke legacy-only fight instruction and
stamping-shape assertions were removed with their adapter.

The #647 inventory row for `grantCreatureTrigger` is complete. The separate
`pluginId` row remains pending #651. No generic trigger collector or canonical
generated ability path is removed in this checkpoint.
