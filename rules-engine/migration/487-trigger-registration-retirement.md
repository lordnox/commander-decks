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
| Ordinary occurrence triggers | `cardPlugins/triggers.ts`, `cardPlugins/triggerFrequency.ts`, `cardPlugins/triggers/matching.ts`, `rules/triggers.ts`, plus readers of `CardEffect.op === 'trigger'` | `dsl/triggeredAbilities.test.ts`, `dsl/triggerMultiplication.test.ts`, `dsl/combatDamage.test.ts`; `cardPlugins/watchedEnters.test.ts`, `zoneTriggers.test.ts`, `drawHandDifference.test.ts`, `triggerFrequency.test.ts`, and `plugins/monarch.test.ts` now use canonical programs where available | Fixture migration underway. Removed legacy cast, draw/discard/cycle/land-play/life-gain, and step occurrence routes after their callers moved to canonical owners; remaining legacy zone-change, entry, combat, and other occurrence adapters still await fixture migration. Preserve generic occurrence, ordering, LKI, target-choice, once-per-turn frequency, and multiplier contracts. Retired the legacy-only `whenResolvedNth`/`resolveCount` contract: it had no registered card producer or catalog consumer, and no canonical equivalent was introduced. `Rumor Gatherer` remains an explicit unsupported catalog GAP. |
| Landfall and land-to-graveyard occurrences | `collectLandfall`, direct `landToGraveyard` collector, `CardEffect.on` variants, and legacy builders | Canonical land-move patterns in `cardPlugins/landfall.test.ts`, `rules/triggers.test.ts`, `cardPlugins/opponentHasMore.test.ts`, `cardPlugins/triggerFrequency.test.ts`, and the Crawling Sensation catalog fixture | Removed. Landfall timing, controlled-land scope, source-only entry patterns, optional trigger sequencing, and once-per-turn suppression remain covered through canonical patterns. Ordinary occurrence adapters remain pending under the row above. |
| Cast triggers | `cardPlugins/castTriggers.ts`, `castModal`, `op:'trigger'` cast registration and its legacy matching path | Canonical `whenever` cast patterns in `cardPlugins/dsl/castTriggers.test.ts` and existing cast mechanic suites | The unregistered cast-modal adapter and the legacy ordinary cast collector/API were removed; repository search found no remaining legacy cast producer or reader. Source/controller/type filters, source departure, modal ability choice ownership, and stack ordering remain asserted in canonical suites. The `casts()` builder's clone-shape assertion was removed with its legacy API. |
| Spell resolve callbacks | `cardPlugins/onResolve.ts`, `abilities.ts:onResolve`, and `op:'trigger', on:'resolve'` reader path | Canonical spell instruction programs; `runInstructions.test.ts` and owning mechanic suites | Pending; migrate callback fixtures before removing resolve adapter. Preserve resolution ordering and continuation/restore behavior. |
| Saga registration fallback | `plugins/saga.ts` legacy `op:'saga'` and printed-oracle chapter/read-ahead fallback; `effectDefinitions.ts` Saga effect type; `abilities.ts:sagaChapters`; legacy fixtures in `plugins/saga.test.ts`, `cardPlugins/sagaPlayerTarget.test.ts`, and `cardPlugins/targetingMana.test.ts` | `plugins/saga.test.ts` covers entry lore, precombat-main/controller timing, shared/crossed chapter timing, Read Ahead, pending triggers, partial resolution and final sacrifice; `cardPlugins/dsl/saga.test.ts` and canonical Kiora/Awaken/Summon catalog fixtures cover targets, restore, chapter effects and lifecycle | Removed. All three test fixtures now compile canonical definitions or reuse registered templates. Generic Saga rules, Read Ahead handling, lore counters, chapter pending checks, and final-chapter SBA remain. `romanNumber` remains shared with mana parsing. |
| Draw replacement by type | `replacements.ts:replaceDrawByType`, `CardEffect.op:'drawReplacementByType'`, and `dsl/drawReplacementByType.test.ts` | Canonical replacement definitions, `dsl/drawReplacementByType.test.ts`, `dsl/drawReplacement.integration.test.ts`, Abundance catalog template | Removed. Repository search found no producer or runtime reader; the four existing DSL tests remain unchanged in behavior and own privacy, multi-draw sequencing, normal draw continuation, fail-to-find, and library ordering. |
| Room unlock test route | `plugins/rooms.ts` formerly projected `effectsOf` and `RoomDoorCharacteristics.effects` while applying door characteristics; legacy fixture in `cardPlugins/targetingMana.test.ts` | Canonical Room/door state and ability behavior in `cardPlugins/dsl/roomDoors.test.ts`, `plugins/rooms.test.ts`, and `targetingMana.test.ts` | Removed. Door characteristics now carry canonical rule snapshots only; the `effectsOf` projection and Room-specific legacy effects field are gone. Entry/unlock programs, cast action enumeration, mana payment, timing, Starfield characteristics, Marina lock/unlock behavior, and private optional graveyard selection remain covered. |
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

The Room test fixture group now uses canonical door programs instead of
`CardEffect.op:'trigger'`, while retaining the Room action, mana-payment, timing,
Starfield characteristic, Marina lock/unlock, and optional graveyard-choice
assertions in their existing mechanic owners. The Room plugin no longer projects
legacy effects from door characteristics. The cast-action assertion lives in
`cardPlugins/dsl/roomDoors.test.ts`; it exposed base-branch issue
[#670](https://github.com/lordnox/commander-decks/issues/670),
where a canonical Room trigger definition hid the selected door from the generic
spell announcement path. The #648 checkpoint selects the door's canonical
trigger definition and keeps its existing B1/C2 affordability and reducer-event
assertions. Room trigger registration itself remains pending until the remaining
cast/resolve adapters are retired.

This fixture checkpoint replaces legacy cast-trigger fixtures with canonical
cast patterns and migrates once-per-turn landfall, entry watcher, generated
token, hand-difference, Monarch, and linked-exile fixtures to canonical
instructions. Existing mechanic assertions retain controller/type/source-leave
filters, modal choice ownership, stack separation and ordering, target candidates,
private projection, restart, and final results. The `casts()` clone-shape
assertion and legacy-only instruction payload assertion were removed with their
legacy API. The Monarch exile test checks canonical `linkedExileSets` data
instead of the retired `exiledUntilOpponentMonarch` field. The direct
`conditionHolds(triggeringCreatureNameUnique(), state, source)` assertion is
also retired; the catalog Guardian Project integration still verifies that the
intervening unique-name condition observes the triggering creature. The
`landfallResolveNth` builder, resolve-count state, reader, and two fixtures were
also retired. Repository search found no producer outside those tests and no
registered card consumes the behavior; `Rumor Gatherer` remains a named GAP
because its alliance-frequency program is unsupported. This removes an
unregistered legacy-only feature contract rather than adding new canonical DSL
semantics. The canonical once-per-turn tests still verify per-slot/per-turn
trigger suppression and the existing multiplier behavior.

The #648 landfall slice removes the dedicated landfall collector and its
`CardEffect` variants/builders after migrating their fixtures to canonical land
occurrence patterns. Cartographer explicitly watches lands controlled by its
controller; source-only entry patterns explicitly bind `self`. The shared
ordinary occurrence collector remains until its other fixture and resolve
adapters have canonical owners.

This follow-up removes the generic collector's legacy cast, draw, discard,
cycle, land-play, life-gain, upkeep, precombat-main, combat-start, and end-step
branches, along with their `CardEffect` types and builders. Canonical cast,
draw, discard, cycle, land-play, gained-life, and step patterns retain their
occurrence, source snapshot, player, and event-order checks in the owning DSL
mechanic suites. The two object-identity gain-life fixtures now use a canonical
gained-life definition. Other legacy occurrence families remain until their
fixture owners are migrated; this does not retire the generic occurrence,
APNAP, or resolution infrastructure.

The unregistered `diesReturnAsEnchantment` helper and its `returnSelfAsEnchantment`
instruction were retired with their legacy-only fixture. No catalog entry or
other producer consumed this operation. Its assertions for type/P/T rewriting,
owner return, noncreature no-loop behavior, and a second leaves-triggered death
are retired as unsupported helper-specific behavior; existing canonical dies,
leaves, source-LKI, and return tests continue to own their independent mechanics.
`Enduring Innocence` remains an explicit catalog GAP because canonical
type-removal plus return-as-enchantment semantics are not implemented.
