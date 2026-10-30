import { battlefieldPrintedStatics, sourceStaticAbilitiesActive } from '../cardPlugins/dsl/staticModifierCore'
import { withReferencedObjects } from './canonicalReferences'
import { MANA_ABILITY_RESOLVED } from '../cardPlugins/dsl/manaConstants'
/**
 * CR 603.1 — a matching actual occurrence creates a pending ability instance;
 * placement waits for the next explicit priority checkpoint.
 * CR 603.2 — a trigger watches for a game event matching its `on` binding.
 * CR 603.3b — APNAP placement has separate non-ability and ability-triggering passes.
 */
import { effectsOf } from '../cardPlugins/cardRules'
import { enteringObjectId, PERMANENT_ENTERED } from '../cardPlugins/permanentEntry'
import {
  runInstructions,
  triggerEffects,
  type CardEffect,
  type TargetFilter,
} from '../cardPlugins/effects'
import { gameObjectFieldDefaults } from '../definitions'
import type Draft from '../draft'
import { validTarget } from '../cardPlugins/targetedResolve'
import { openCardSelection, targetDestinations } from './selectCards'
import { startCanonicalAnnouncement } from './canonicalAnnouncement'
import { openPlayerSelection } from './selectPlayers'
import { apnapSeats } from '../turnOrder'
import type {
  GameEvent,
  GameObject,
  GameState,
  StackItem,
  PlayerId,
  PendingTrigger as CapturedPendingTrigger,
  Plugin,
  TargetRef,
} from '../types'
import { asRoomDoor } from '../plugins/rooms'
import {
  markFirstMatchingEachTurn,
  markTriggeredOnceEachTurn,
  mayTriggerFirstMatchingEachTurn,
  mayTriggerOnceEachTurn,
  triggerEffectKey,
} from '../cardPlugins/triggerFrequency'
import { cardsDrawnThisTurn } from './draw'
import { spellsCastThisTurn } from './spellsCast'
import { isProtectedFirstDrawInOwnDrawStep } from './drawStepHistory'
import { isTriggerBindingIf, matchesTriggerEvent } from '../cardPlugins/triggers/matching'
import { captureObject, isSameObject, objectIdentity, snapshotObject } from '../objectIdentity'
import type { OccurrenceSnapshot, StackExecutionContext } from '../types'
import { loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
import type { RuleDslRuntimeContext } from '../cardPlugins/dsl/compiler/runtime'
import { objectMatchesSelector, evaluateRuntimeAmount, evaluateObjectSelector, evaluateCondition, evaluateObjectReference, evaluatePlayerReference, evaluatePlayerSelector, mismatchesController, mismatchesOwner } from '../cardPlugins/dsl/compiler/runtime'
import { SOURCE_CONTEXT_BINDING, type CardRuleDefinitionSnapshotV2, type ObjectFilter, type ObjectOccurrenceFilter, type ObjectReference, type OccurrencePattern, type PlayerOccurrenceFilter, type PlayerReference, type PlayerSelector, type TriggeredAbilityDefinition } from '../cardPlugins/dsl/schema/v2'
import { classifyManaAbility } from '../cardPlugins/dsl/compiler/announcement'
import { startCanonicalResolution } from '../driver'
import { canonicalManaClassification, instructionAddsMana } from '../cardPlugins/dsl/manaPrograms'
import { generatedAbilitySnapshot } from '../cardPlugins/dsl/generatedPrograms'
import type { GeneratedAbility } from '../cardPlugins/dsl/schema/v2'

const canonicalManaActivationEvent = (state: GameState, event: GameEvent) => {
  if (event.type !== 'activateAbility') return false
  const source = state.objects[event.objectId]
  const index = /^\$\.abilities\[(\d+)\]$/.exec(event.abilityId)?.[1]
  if (!source?.ruleDefinition || index === undefined) return false
  const definition = loadDefinitionSnapshot(source.ruleDefinition).definition
  const ability = definition.abilities[Number(index)]
  return ability?.kind === 'activated' && canonicalManaClassification(ability).isManaAbility
}

const canonicalManaSourceEvent = (state: GameState, event: GameEvent) => {
  if (event.type !== 'custom' || event.name !== MANA_ABILITY_RESOLVED) return false
  const sourceId = event.payload?.sourceId
  const definitionSnapshot = event.payload?.definitionSnapshot
  const abilityIndex = event.payload?.abilityIndex
  if (typeof sourceId !== 'string' || typeof abilityIndex !== 'number' || !definitionSnapshot) return false
  const definition = loadDefinitionSnapshot(definitionSnapshot).definition
  const ability = definition.abilities[abilityIndex]
  return ability?.kind === 'activated' && canonicalManaClassification(ability).isManaAbility
}

const tappedManaSource = (before: GameState, after: GameState, event: GameEvent) => {
  if (event.type !== 'tap' && event.type !== 'tapForMana') return undefined
  if (before.objects[event.objectId]?.tapped || !after.objects[event.objectId]?.tapped) return undefined
  if (event.type === 'tapForMana') return event.objectId
  const payment = before.provisionalAnnouncement
  const activation = payment?.nestedManaPayment?.pendingActivation ?? (payment?.inlineManaAbility ? payment.pendingActivation : undefined)
  if (activation?.objectId === event.objectId) return event.objectId
  const resolution = before.resolution
  if (resolution?.kind !== 'canonicalSpell' || resolution.inlineItem?.objectId !== event.objectId) return undefined
  const ability = resolution.definitionSnapshot.definition.abilities[resolution.inlineItem.execution?.abilityIndex ?? -1]
  return ability?.kind === 'activated' && ability.costs.some(cost => cost.kind === 'tapSource') ? event.objectId : undefined
}

const matchesTapOccurrence = (before: GameState, after: GameState, source: GameObject, pattern: Extract<OccurrencePattern, { kind: 'becomesTapped' | 'tappedForMana' }>, occurrence: OccurrenceSnapshot, event: GameEvent, execution?: StackExecutionContext) => {
  const object = occurrence.object?.after
  if (!object || object.zone !== 'battlefield') return false
  const matches = pattern.kind === 'tappedForMana' ? tappedManaSource(before, after, event) === object.id
    : occurrence.object?.before?.zone === 'battlefield' && !occurrence.object.before.tapped && object.tapped
  return Boolean(matches && canonicalFilterMatch(after, source, object, pattern.filter, occurrence, execution))
}

/**
 * CR 603.2 — "for the first time each turn" is part of the trigger event, so it
 * reads the turn's game history for that player rather than what any one source
 * has already done. A source entering later in the turn has still missed it.
 */
const LAND_TO_GRAVEYARD_TURN = 'triggers.firstTimeEachTurn.landToGraveyard'

const recordLandToGraveyardThisTurn = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
) => {
  const objectId = event.type === 'move' && event.to === 'graveyard'
    ? event.objectId
    : event.type === 'mill'
      ? event.objectId
      : undefined
  if (!objectId) return
  const before = state.objects[objectId]
  if (!before?.types.includes('Land')) return
  draft.players[before.owner].data[LAND_TO_GRAVEYARD_TURN] = draft.turn
}

type TriggerEffect = Extract<CardEffect, { op: 'trigger' }>
type PendingTriggerEffect = Pick<TriggerEffect, 'do' | 'if' | 'targets' | 'onceEachTurn'>

type PendingTrigger = {
  id?: string
  source: GameObject
  effect: PendingTriggerEffect
  execution?: StackExecutionContext
  triggerEffectKey?: string
  triggeringObjectId?: string
  triggeringPlayer?: PlayerId
  triggerAmount?: number
  payload?: Record<string, unknown>
  canonical?: {
    definitionSnapshot: CardRuleDefinitionSnapshotV2
    abilityIndex: number
  }
  triggeredByAbility?: boolean
  delayed?: true
}

const capturedOccurrence = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  triggeringObjectId?: string,
  triggeringPlayer?: PlayerId,
  amount?: number,
  defender?: PlayerId,
  groupedObjectIds?: readonly string[],
): OccurrenceSnapshot => {
  const objectId = triggeringObjectId ?? eventObjectId(event)
  const before = objectId ? state.objects[objectId] : undefined
  const after = event.type === 'tokenCreated' ? event.object : objectId ? draft.objects[objectId] : undefined
  const sourceId = event.type === 'abilityActivated' ? event.objectId : 'sourceId' in event && typeof event.sourceId === 'string'
    ? event.sourceId
    : 'source' in event && typeof event.source === 'string'
      ? event.source
      : undefined
  const eventSource = (event.type === 'abilityActivated' || event.type === 'dealDamage' || event.type === 'combatDamage') && event.sourceSnapshot && event.sourceSnapshot.ref.objectId === sourceId
    ? event.sourceSnapshot.snapshot
    : sourceId ? state.objects[sourceId] ?? draft.objects[sourceId] : undefined
  const grouped = groupedObjectIds?.map(id => ({
    ...(state.objects[id] ? { before: snapshotObject(state.objects[id]!) } : {}),
    ...(draft.objects[id] ? { after: snapshotObject(draft.objects[id]!) } : {}),
  }))
  return {
    kind: 'event',
    ...(event.type === 'abilityActivated' ? { stackItemId: event.stackId } : {}),
    ...(event.type === 'votesFinished' ? { vote: structuredClone(event.result) } : {}),
    eventType: event.type === 'custom' ? event.name : event.type,
    ...(triggeringPlayer ? { player: triggeringPlayer } : {}),
    ...(defender ? { defender } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(before || after
      ? {
          object: {
            ...(before ? { before: snapshotObject(before) } : {}),
            ...(after ? { after: snapshotObject(after) } : {}),
          },
        }
      : {}),
    ...(grouped && grouped.length > 0 ? { objects: grouped } : {}),
    ...(eventSource ? { source: captureObject(eventSource) } : {}),
  }
}

const occurrencePlayerForEvent = (event: GameEvent, draft: Draft) =>
  'seat' in event && typeof event.seat === 'string'
    ? event.seat
    : event.type === 'custom' && event.name === 'advanceStep'
      ? draft.active
      : undefined

const triggerExecution = (
  source: GameObject,
  occurrence: OccurrenceSnapshot,
  state: GameState,
): StackExecutionContext => ({
  controller: source.controller,
  ...(state.monarchRevision !== undefined ? { monarchRevision: state.monarchRevision } : {}),
  source: captureObject(
    source,
    isSameObject(state.objects[source.id], objectIdentity(source)) ? 'current' : 'lastKnown',
  ),
  occurrence,
})

export const movedSourceReferenceMatchesOccurrence = (
  filter: ObjectReference,
  source: Pick<GameObject, 'id' | 'incarnation'>,
  object: Pick<GameObject, 'id' | 'incarnation'>,
  occurrence: Pick<OccurrenceSnapshot, 'eventType' | 'object'>,
) => filter.kind === 'contextRef'
  && filter.name === SOURCE_CONTEXT_BINDING
  && occurrence.eventType === 'move'
  && source.id === object.id
  && occurrence.object?.before?.id === source.id
  && occurrence.object.before.incarnation === source.incarnation
  && occurrence.object.after?.id === object.id
  && occurrence.object.after.incarnation === object.incarnation

const canonicalFilterMatch = (
  state: GameState,
  source: GameObject,
  object: GameObject,
  filter: ObjectOccurrenceFilter,
  occurrence: OccurrenceSnapshot,
  execution?: StackExecutionContext,
) => {
  const lexicalChoices = execution?.choices
    ? {
        ...execution.choices,
        ...Object.fromEntries(Object.entries(execution.capturedChoiceAliases ?? {}).flatMap(([original, alias]) => {
          const value = execution.choices?.[original]
          return value === undefined ? [] : [[alias, value]]
        })),
      }
    : undefined
  const lexicalContext = {
    ...(lexicalChoices ? { choices: lexicalChoices } : {}),
    ...(execution?.results ? { results: execution.results } : {}),
    ...(execution?.variables ? { variables: execution.variables } : {}),
    ...(execution?.capturedOccurrence ? { capturedOccurrence: execution.capturedOccurrence } : {}),
    ...(execution?.capturedOccurrenceBindings ? { capturedOccurrenceBindings: execution.capturedOccurrenceBindings } : {}),
  }
  const context = { state, controller: source.controller, source: captureObject(source), occurrence, ...lexicalContext }
  if ('kind' in filter) {
    const referenced = evaluateObjectReference(filter, context, 'currentOrLastKnown')
    const isMovedSourceReference = movedSourceReferenceMatchesOccurrence(filter, source, object, occurrence)
    return referenced.some((candidate) => candidate.id === object.id
      && (candidate.incarnation === object.incarnation || isMovedSourceReference))
  }
  if ('all' in filter && filter.all && !filter.all.every((part) =>
    canonicalFilterMatch(state, source, object, part, occurrence, execution))) return false
  if ('any' in filter && filter.any && !filter.any.some((part) =>
    canonicalFilterMatch(state, source, object, part, occurrence, execution))) return false
  if ('not' in filter && filter.not && canonicalFilterMatch(state, source, object, filter.not, occurrence, execution)) return false
  const plain = filter as ObjectFilter
  if (!objectMatchesSelector(object, { kind: 'objects', filter: {
    ...(plain.commander !== undefined ? { commander: plain.commander } : {}),
    ...(plain.color !== undefined ? { color: plain.color } : {}),
    ...(plain.manaAbility !== undefined ? { manaAbility: plain.manaAbility } : {}),
    ...(plain.enchantedBy ? { enchantedBy: plain.enchantedBy } : {}),
    ...(plain.subtypes ? { subtypes: plain.subtypes } : {}),
    ...(plain.sameNameAs ? { sameNameAs: plain.sameNameAs } : {}),
  } }, context)) return false
  if (plain.other && isSameObject(object, context.source.ref)) return false
  if (plain.zone !== undefined && object.zone !== plain.zone) return false
  if (plain.type !== undefined && !object.types.includes(plain.type)) return false
  if (plain.tapped !== undefined && object.tapped !== plain.tapped) return false
  if (plain.token !== undefined && object.token !== plain.token) return false
  if (plain.name !== undefined && object.name !== plain.name) return false
  if (plain.powerAtLeast !== undefined && (typeof object.power !== 'number' || object.power < plain.powerAtLeast)) return false
  if (mismatchesController(object, plain, context)) return false
  if (mismatchesOwner(object, plain, context)) return false
  return true
}

// CR 603.2b: match the committed transition, never a snapshot already in the step.
const matchesBeginningStep = (
  before: GameState,
  after: GameState,
  source: GameObject,
  pattern: Extract<OccurrencePattern, { kind: 'stepBegins' }>,
  occurrence: OccurrenceSnapshot,
  event: GameEvent,
  lexicalContext: Pick<RuleDslRuntimeContext, 'choices' | 'results' | 'variables'> = {},
) => {
  if (event.type !== 'custom' || event.name !== 'advanceStep' || after.step !== pattern.step
    || (before.step === after.step && before.turn === after.turn && before.active === after.active)) return false
  if (!pattern.player) return true
  const context = { state: after, controller: source.controller, source: captureObject(source), occurrence, ...lexicalContext }
  return pattern.player.kind === 'players'
    ? evaluatePlayerSelector(pattern.player, context).includes(after.active)
    : evaluatePlayerReference(pattern.player, context).includes(after.active)
}

const unlockingDoor = (event: GameEvent, beforeState: GameState) => {
  if (event.type === 'unlockDoor') return { objectId: event.objectId, door: event.door, player: event.seat }
  if (event.type === 'resolveTop') {
    const item = beforeState.stack[0]
    if (item?.kind === 'spell' && item.door) {
      return { objectId: item.objectId, door: item.door, player: item.controller }
    }
  }
}

const matchesRoomUnlock = (
  state: GameState,
  beforeState: GameState,
  source: GameObject,
  pattern: Extract<OccurrencePattern, { kind: 'unlockDoor' | 'fullyUnlock' }>,
  occurrence: OccurrenceSnapshot,
  event: GameEvent,
) => {
  const unlocking = unlockingDoor(event, beforeState)
  if (!unlocking) return false
  if (pattern.kind === 'unlockDoor' && pattern.door !== undefined && pattern.door !== unlocking.door) return false
  const object = occurrence.object?.after
  if (!object || object.zone !== 'battlefield') return false
  if (pattern.kind === 'fullyUnlock') {
    const beforeCount = beforeState.objects[object.id]?.unlockedDoors?.length ?? 0
    const afterCount = state.objects[object.id]?.unlockedDoors?.length ?? 0
    if (afterCount !== 2 || beforeCount >= 2) return false
  }
  if (pattern.filter) return canonicalFilterMatch(state, source, object, pattern.filter, occurrence)
  return object.id === source.id
}

const matchesTokenAction = (state: GameState, source: GameObject, pattern: Extract<OccurrencePattern, { kind: 'tokenCreated' | 'sacrificed' }>, occurrence: OccurrenceSnapshot, event: GameEvent, execution?: StackExecutionContext) => {
  const object = pattern.kind === 'sacrificed' ? occurrence.object?.before : occurrence.object?.after
  const matches = pattern.kind === 'sacrificed'
    ? event.type === 'move' && event.sacrifice === true && object?.zone === 'battlefield' && occurrence.object?.after?.zone !== 'battlefield'
    : event.type === 'tokenCreated' && object?.token === true
  return Boolean(matches && object && canonicalFilterMatch(state, source, object, pattern.filter, occurrence, execution))
}

const matchesCountersRemoved = (state: GameState, source: GameObject, pattern: Extract<OccurrencePattern, { kind: 'countersRemoved' }>, occurrence: OccurrenceSnapshot, event: GameEvent, execution?: StackExecutionContext) => {
  if (event.type !== 'removeCounters' || event.counter !== pattern.counter) return false
  const before = occurrence.object?.before, after = occurrence.object?.after
  return Boolean(before && after && (before.counters[pattern.counter] ?? 0) > (after.counters[pattern.counter] ?? 0)
    && (!pattern.last || (after.counters[pattern.counter] ?? 0) === 0)
    && canonicalFilterMatch(state, source, after, pattern.filter, occurrence, execution))
}

const canonicalPatternMatches = (
  state: GameState,
  beforeState: GameState,
  source: GameObject,
  ability: TriggeredAbilityDefinition,
  pattern: OccurrencePattern,
  occurrence: OccurrenceSnapshot,
  event: GameEvent,
) => {
  if (pattern.kind === 'countersRemoved') return matchesCountersRemoved(state, source, pattern, occurrence, event)
  if (pattern.kind === 'votesFinished') return event.type === 'votesFinished'
  if (pattern.kind === 'abilityActivated') return event.type === 'abilityActivated' && evaluatePlayerSelector(pattern.filter, { state, controller: source.controller, source: captureObject(source), occurrence }).includes(event.seat)
  if (pattern.kind === 'tokenCreated' || pattern.kind === 'sacrificed') return matchesTokenAction(state, source, pattern, occurrence, event)
  if (pattern.kind === 'becomesTapped' || pattern.kind === 'tappedForMana') return matchesTapOccurrence(beforeState, state, source, pattern, occurrence, event)
  if (pattern.kind === 'stepBegins') return matchesBeginningStep(beforeState, state, source, pattern, occurrence, event)
  if (pattern.kind === 'manaAdded') {
    return event.type === 'addMana' && event.sourceId !== source.id
  }
  if (pattern.kind === 'manaAbilityActivated' || pattern.kind === 'manaAbilityResolved') {
    if (pattern.kind === 'manaAbilityActivated') return canonicalManaActivationEvent(state, event)
    return canonicalManaSourceEvent(state, event)
  }
  if (pattern.kind === 'gainedLife') {
    if (event.type !== 'gainLife' || (occurrence.amount ?? 0) <= 0) return false
    return matchesPlayerOccurrenceFilter(pattern.filter, occurrence.player, occurrenceContext(state, source, occurrence))
  }
  if (pattern.kind === 'moved') {
    if (!isMovedEvent(event, pattern)) return false
    const matching = matchingMovedIds(pattern, beforeState, state, source, occurrence)
    const eventId = eventObjectId(event)
    if (!eventId || matching.length === 0 || !matching.includes(eventId)) return false
    return !pattern.group || matching[0] === eventId
  }
  if (pattern.kind === 'draw' || pattern.kind === 'discard' || pattern.kind === 'playLand' || pattern.kind === 'cycle') {
    if (event.type !== pattern.kind || !occurrence.player) return false
    if (pattern.kind === 'discard' && (occurrence.object?.before?.zone !== 'hand'
      || occurrence.object.before.controller !== occurrence.player)) return false
    if (pattern.kind === 'discard' && pattern.filter.object) {
      const discarded = occurrence.object?.before
      if (!discarded || !canonicalFilterMatch(beforeState, source, discarded, pattern.filter.object, occurrence)) return false
    }
    if (pattern.kind === 'draw' && pattern.filter.object) {
      const drawn = occurrence.object?.after
      if (!drawn || !canonicalFilterMatch(state, source, drawn, pattern.filter.object, occurrence)) return false
    }
    if (pattern.kind === 'cycle' && pattern.filter.object) {
      const object = occurrence.object?.after
      if (!object || !canonicalFilterMatch(state, source, object, pattern.filter.object, occurrence)) return false
    }
    const player = occurrence.player
    if (pattern.kind === 'draw' && pattern.filter.firstDrawInOwnDrawStep === true
      && !isProtectedFirstDrawInOwnDrawStep(beforeState, player)) return false
    if (pattern.kind === 'draw' && pattern.filter.firstDrawInOwnDrawStep === false
      && isProtectedFirstDrawInOwnDrawStep(beforeState, player)) return false
    if (pattern.kind === 'draw') {
      return matchesPlayerOccurrenceFilter(
        pattern.filter,
        player,
        occurrenceContext(state, source, occurrence),
        cardsDrawnThisTurn(state.players[player]!),
      )
    }
    if (!pattern.filter.player) return true
    if (pattern.filter.player.kind === 'players') {
      return evaluatePlayerSelector(pattern.filter.player, {
        state,
        controller: source.controller,
        source: captureObject(source),
        occurrence,
      }).includes(player)
    }
    return evaluatePlayerReference(pattern.filter.player, {
      state,
      controller: source.controller,
      source: captureObject(source),
      occurrence,
    }).includes(player)
  }
  if (pattern.kind === 'dealtDamage') {
    return matchesDealtDamage(state, source, pattern, occurrence, event)
  }
  if (pattern.kind === 'playerAttacks') {
    return matchesPlayerAttacks(state, source, pattern, occurrence, event)
  }
  if (pattern.kind === 'unlockDoor' || pattern.kind === 'fullyUnlock') {
    return matchesRoomUnlock(state, beforeState, source, pattern, occurrence, event)
  }
  switch (pattern.kind) {
    case 'attacks':
      if (event.type !== 'declareAttackers' || !occurrence.object?.after) return false
      break
    case 'cast':
      if (event.type !== 'castSpell' || occurrence.object?.after?.zone !== 'stack') return false
      if (pattern.nthThisTurn !== undefined) {
        const caster = occurrence.player ?? occurrence.object.after?.controller
        if (!caster || spellsCastThisTurn(state.players[caster]!) !== pattern.nthThisTurn) return false
      }
      break
    case 'enters': {
      const enteringId = permanentEnteringObjectId(event, state)
      if (!enteringId || (!isPermanentEntrySignal(event) && occurrence.object?.before?.zone === 'battlefield')) return false
      if (pattern.fromSpell === true && occurrence.object?.before?.zone !== 'stack') return false
      if (pattern.fromSpell === false && occurrence.object?.before?.zone === 'stack') return false
      break
    }
    case 'dies':
      if (event.type !== 'move' || event.to !== 'graveyard'
        || occurrence.object?.before?.zone !== 'battlefield'
        || occurrence.object?.before?.types.includes('Creature') !== true) return false
      break
    case 'leaves':
      if (event.type !== 'move' || event.to === 'battlefield'
        || occurrence.object?.before?.zone !== 'battlefield') return false
      break
  }
  const object = pattern.kind === 'dies' || pattern.kind === 'leaves'
    ? occurrence.object?.before
    : occurrence.object?.after
  return Boolean(object && canonicalFilterMatch(state, source, object, pattern.filter, occurrence))
}

const generatedPatternMatches = (
  state: GameState,
  beforeState: GameState,
  afterState: GameState,
  source: GameObject,
  pattern: GeneratedAbility['on'],
  occurrence: OccurrenceSnapshot,
  event: GameEvent,
  execution?: StackExecutionContext,
) => {
  const lexicalChoices = execution?.choices
    ? {
        ...execution.choices,
        ...Object.fromEntries(Object.entries(execution.capturedChoiceAliases ?? {}).flatMap(([original, alias]) => {
          const value = execution.choices?.[original]
          return value === undefined ? [] : [[alias, value]]
        })),
      }
    : undefined
  const lexicalContext = {
    ...(lexicalChoices ? { choices: lexicalChoices } : {}),
    ...(execution?.results ? { results: execution.results } : {}),
    ...(execution?.variables ? { variables: execution.variables } : {}),
  }
  switch (pattern.kind) {
    case 'countersRemoved': return matchesCountersRemoved(state, source, pattern, occurrence, event, execution)
    case 'votesFinished': return event.type === 'votesFinished'
    case 'abilityActivated': return event.type === 'abilityActivated' && evaluatePlayerSelector(pattern.filter, { state, controller: source.controller, source: captureObject(source), occurrence }).includes(event.seat)
    case 'tokenCreated':
    case 'sacrificed': return matchesTokenAction(state, source, pattern, occurrence, event, execution)
    case 'becomesTapped':
    case 'tappedForMana': return matchesTapOccurrence(beforeState, afterState, source, pattern, occurrence, event, execution)
    case 'stepBegins': return matchesBeginningStep(beforeState, afterState, source, pattern, occurrence, event, lexicalContext)
    case 'gainedLife':
      if (event.type !== 'gainLife' || (occurrence.amount ?? 0) <= 0) return false
      return matchesPlayerOccurrenceFilter(
        pattern.filter,
        occurrence.player,
        { ...occurrenceContext(state, source, occurrence, execution), ...lexicalContext },
      )
    case 'moved': {
      if (!isMovedEvent(event, pattern)) return false
      const matching = matchingMovedIds(pattern, beforeState, afterState, source, occurrence, execution)
      const eventId = eventObjectId(event)
      if (!eventId || matching.length === 0 || !matching.includes(eventId)) return false
      return !pattern.group || matching[0] === eventId
    }
    case 'playLand':
    case 'discard':
    case 'cycle':
    case 'draw': {
      if (event.type !== pattern.kind || !occurrence.player) return false
      if (pattern.kind === 'discard' && (occurrence.object?.before?.zone !== 'hand'
        || occurrence.object.before.controller !== occurrence.player)) return false
      if (pattern.kind === 'discard' && pattern.filter.object) {
        const discarded = occurrence.object?.before
        if (!discarded || !canonicalFilterMatch(beforeState, source, discarded, pattern.filter.object, occurrence, execution)) return false
      }
      if (pattern.kind === 'draw' && pattern.filter.object) {
        const drawn = occurrence.object?.after
        if (!drawn || !canonicalFilterMatch(state, source, drawn, pattern.filter.object, occurrence, execution)) return false
      }
      if (pattern.kind === 'cycle' && pattern.filter.object) {
        const object = occurrence.object?.after
        if (!object || !canonicalFilterMatch(state, source, object, pattern.filter.object, occurrence, execution)) return false
      }
      if (pattern.kind === 'draw' && pattern.filter.firstDrawInOwnDrawStep === true
        && !isProtectedFirstDrawInOwnDrawStep(beforeState, occurrence.player)) return false
      if (pattern.kind === 'draw' && pattern.filter.firstDrawInOwnDrawStep === false
        && isProtectedFirstDrawInOwnDrawStep(beforeState, occurrence.player)) return false
      if (pattern.kind === 'draw') {
        return matchesPlayerOccurrenceFilter(
          pattern.filter,
          occurrence.player,
          { ...occurrenceContext(state, source, occurrence, execution), ...lexicalContext },
          cardsDrawnThisTurn(afterState.players[occurrence.player]!),
        )
      }
      if (!pattern.filter.player) return true
      return pattern.filter.player.kind === 'players'
        ? evaluatePlayerSelector(pattern.filter.player, {
          state,
          controller: source.controller,
          source: captureObject(source),
          occurrence,
          ...lexicalContext,
        }).includes(occurrence.player)
        : evaluatePlayerReference(pattern.filter.player, {
          state,
          controller: source.controller,
          source: captureObject(source),
          occurrence,
          ...lexicalContext,
        }).includes(occurrence.player)
    }
    case 'manaAdded': return event.type === 'addMana' && event.sourceId !== source.id
    case 'manaAbilityActivated': return canonicalManaActivationEvent(state, event)
    case 'manaAbilityResolved': return canonicalManaSourceEvent(state, event)
    case 'dealtDamage':
      return matchesDealtDamage(state, source, pattern, occurrence, event, execution)
    case 'playerAttacks':
      return matchesPlayerAttacks(state, source, pattern, occurrence, event, execution)
    case 'attacks': {
      const object = occurrence.object?.after
      return event.type === 'declareAttackers' && Boolean(object
        && canonicalFilterMatch(state, source, object, pattern.filter, occurrence, execution))
    }
    case 'cast': {
      const object = occurrence.object?.after
      if (event.type !== 'castSpell' || object?.zone !== 'stack'
        || !canonicalFilterMatch(state, source, object, pattern.filter, occurrence, execution)) return false
      if (pattern.nthThisTurn === undefined) return true
      const caster = occurrence.player ?? object.controller
      return spellsCastThisTurn(afterState.players[caster]!) === pattern.nthThisTurn
    }
    case 'enters':
    case 'dies':
    case 'leaves': {
      const enteringId = permanentEnteringObjectId(event, state)
      if (pattern.kind === 'enters' && (
        !enteringId || (!isPermanentEntrySignal(event) && occurrence.object?.before?.zone === 'battlefield'))) return false
      if (pattern.kind === 'enters' && pattern.fromSpell === true && occurrence.object?.before?.zone !== 'stack') return false
      if (pattern.kind === 'enters' && pattern.fromSpell === false && occurrence.object?.before?.zone === 'stack') return false
      if (pattern.kind === 'dies' && (
        event.type !== 'move'
        || event.to !== 'graveyard'
        || occurrence.object?.before?.zone !== 'battlefield'
        || occurrence.object?.before?.types.includes('Creature') !== true
      )) return false
      if (pattern.kind === 'leaves' && (
        event.type !== 'move'
        || event.to === 'battlefield'
        || occurrence.object?.before?.zone !== 'battlefield'
      )) return false
      const object = pattern.kind === 'dies' || pattern.kind === 'leaves'
        ? occurrence.object?.before
        : occurrence.object?.after
      return Boolean(object && canonicalFilterMatch(state, source, object, pattern.filter, occurrence, execution))
    }
    case 'event': {
      if (event.type !== pattern.type) return false
      if (pattern.from !== undefined && (event.type !== 'move' || beforeState.objects[event.objectId]?.zone !== pattern.from)) return false
      if (pattern.to !== undefined && (event.type !== 'move' || event.to !== pattern.to)) return false
      if (pattern.objectId) {
        const expected = evaluateObjectReference(pattern.objectId, {
          state: beforeState,
          controller: source.controller,
          source: captureObject(source),
          occurrence,
          ...lexicalContext,
        }, 'currentOrLastKnown')
        return expected.some((object) => object.id === eventObjectId(event))
      }
      return true
    }
    case 'step': {
      if (event.type !== 'custom' || event.name !== 'advanceStep' || afterState.step !== pattern.step) return false
      if (!pattern.active) return true
      return evaluatePlayerReference(pattern.active, {
        state: beforeState,
        controller: source.controller,
        source: captureObject(source),
        occurrence,
        ...lexicalContext,
      }).includes(afterState.active)
    }
  }
}

const occurrenceContext = (
  state: GameState,
  source: GameObject,
  occurrence: OccurrenceSnapshot,
  execution?: StackExecutionContext,
): RuleDslRuntimeContext => ({
  state,
  controller: source.controller,
  source: captureObject(source),
  occurrence,
  ...(execution?.choices ? { choices: execution.choices } : {}),
  ...(execution?.results ? { results: execution.results } : {}),
  ...(execution?.variables ? { variables: execution.variables } : {}),
})

const matchesPlayerRecipient = (
  player: PlayerId | undefined,
  recipient: PlayerReference | PlayerSelector | undefined,
  context: RuleDslRuntimeContext,
) => {
  if (!recipient) return true
  if (!player) return false
  return recipient.kind === 'players'
    ? evaluatePlayerSelector(recipient, context).includes(player)
    : evaluatePlayerReference(recipient, context).includes(player)
}

const matchesPlayerOccurrenceFilter = (
  filter: PlayerOccurrenceFilter | undefined,
  player: PlayerId | undefined,
  context: RuleDslRuntimeContext,
  countThisTurn?: number,
) => {
  if (!player) return false
  if (filter?.duringOwnTurn === true && player !== context.state.active) return false
  if (filter?.duringOwnTurn === false && player === context.state.active) return false
  if (filter?.nthThisTurn !== undefined && countThisTurn !== filter.nthThisTurn) return false
  return matchesPlayerRecipient(player, filter?.player, context)
}

const matchingMovedIds = (
  pattern: Extract<OccurrencePattern, { kind: 'moved' }>,
  beforeState: GameState,
  afterState: GameState,
  source: GameObject,
  occurrence: OccurrenceSnapshot,
  execution?: StackExecutionContext,
) => {
  const ids: string[] = []
  for (const before of Object.values(beforeState.objects)) {
    const after = afterState.objects[before.id]
    if (!after || after.zone === before.zone || after.zone !== pattern.to) continue
    if (pattern.from && before.zone !== pattern.from) continue
    if (!canonicalFilterMatch(afterState, source, after, pattern.filter, occurrence, execution)) continue
    ids.push(before.id)
  }
  return ids.sort()
}

const isMovedEvent = (event: GameEvent, pattern: Extract<OccurrencePattern, { kind: 'moved' }>) => {
  if (event.type === 'mill') return pattern.to === 'graveyard' && (pattern.from === undefined || pattern.from === 'library')
  return event.type === 'move' && event.to === pattern.to
}

const matchesDealtDamage = (
  state: GameState,
  source: GameObject,
  pattern: Extract<OccurrencePattern, { kind: 'dealtDamage' }>,
  occurrence: OccurrenceSnapshot,
  event: GameEvent,
  execution?: StackExecutionContext,
) => {
  if (event.type !== 'dealDamage' || (occurrence.amount ?? 0) <= 0) return false
  if (pattern.filter.combat === true && event.combat !== true) return false
  if (pattern.filter.combat === false && event.combat === true) return false
  if (pattern.filter.player === true && event.target.kind !== 'player') return false
  if (pattern.filter.player === false && event.target.kind === 'player') return false
  const recipient = occurrence.object?.after ?? occurrence.object?.before
  if (pattern.filter.recipient) {
    if (!recipient) return false
    if (!canonicalFilterMatch(state, source, recipient, pattern.filter.recipient, occurrence, execution)) return false
  }
  if (pattern.filter.source) {
    const damageSource = occurrence.source?.snapshot
    if (!damageSource) return false
    if (!canonicalFilterMatch(state, source, damageSource, pattern.filter.source, occurrence, execution)) return false
  }
  return true
}

const matchesPlayerAttacks = (
  state: GameState,
  source: GameObject,
  pattern: Extract<OccurrencePattern, { kind: 'playerAttacks' }>,
  occurrence: OccurrenceSnapshot,
  event: GameEvent,
  execution?: StackExecutionContext,
) => {
  if (event.type !== 'declareAttackers' || !occurrence.player || !occurrence.defender) return false
  const context = occurrenceContext(state, source, occurrence, execution)
  return matchesPlayerRecipient(occurrence.player, pattern.filter.attacker, context)
    && matchesPlayerRecipient(occurrence.defender, pattern.filter.defender, context)
}

type OccurrenceSpec = {
  objectId?: string
  player?: PlayerId
  defender?: PlayerId
  amount?: number
}

// A declaration contains simultaneous occurrences, one for each attacker (CR 508.3a).
const occurrenceSpecsForPattern = (
  pattern: { kind: string },
  event: GameEvent,
  state: GameState,
  draft: Draft,
): OccurrenceSpec[] => {
  switch (pattern.kind) {
    case 'draw': {
      if (event.type !== 'draw') return []
      const objectId = state.zoneOrder[event.seat]?.library[0]
      return [{ ...(objectId ? { objectId } : {}), player: event.seat }]
    }
    case 'attacks':
      return event.type === 'declareAttackers'
        ? event.attackers.map(attacker => ({
            objectId: attacker.objectId,
            player: event.seat,
            defender: defendingPlayer(state, attacker.defender),
          }))
        : []
    case 'becomesTapped':
      if (event.type === 'declareAttackers') {
        return event.attackers.map(attacker => ({
          objectId: attacker.objectId,
          player: event.seat,
        }))
      }
      return [{
        objectId: eventObjectId(event) ?? permanentEnteringObjectId(event, state) ?? undefined,
        player: occurrencePlayerForEvent(event, draft),
      }]
    case 'playerAttacks': {
      if (event.type !== 'declareAttackers') return []
      const seen = new Set<string>()
      const specs: OccurrenceSpec[] = []
      for (const attacker of event.attackers) {
        const defender = defendingPlayer(state, attacker.defender)
        if (!defender || seen.has(defender)) continue
        seen.add(defender)
        specs.push({ player: event.seat, defender })
      }
      return specs
    }
    case 'dealtDamage': {
      if (event.type !== 'dealDamage' || event.amount <= 0) return []
      const damageSource = state.objects[event.sourceId] ?? draft.objects[event.sourceId]
      return [{
        objectId: event.target.kind === 'object' ? event.target.objectId : undefined,
        player: damageSource?.controller,
        amount: event.amount,
      }]
    }
    case 'unlockDoor':
    case 'fullyUnlock': {
      const unlocking = unlockingDoor(event, state)
      return unlocking ? [{ objectId: unlocking.objectId, player: unlocking.player }] : []
    }
    default:
      return [{
        objectId: eventObjectId(event) ?? permanentEnteringObjectId(event, state) ?? undefined,
        player: occurrencePlayerForEvent(event, draft),
        amount: event.type === 'gainLife' || event.type === 'dealDamage' ? event.amount : undefined,
      }]
  }
}

const canonicalGrantedTriggersForOccurrence = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  const sourcesById = new Map<string, GameObject>()
  for (const object of Object.values(draft.objects)) {
    if (object.zone === 'battlefield' && !object.phasedOut && (object.canonicalGrantedAbilities?.length ?? 0) > 0) {
      sourcesById.set(object.id, object)
    }
  }
  if (event.type === 'move') {
    const before = state.objects[event.objectId]
    if (before?.zone === 'battlefield' && (before.canonicalGrantedAbilities?.length ?? 0) > 0) {
      sourcesById.set(before.id, before)
    }
  }
  const sources = [...sourcesById.values()]
  for (const source of sources) {
    source.canonicalGrantedAbilities?.forEach((grant, grantIndex) => {
      occurrenceSpecsForPattern(grant.ability.on, event, state, draft).forEach(spec => {
        const occurrence = capturedOccurrence(
          state,
          draft,
          event,
          spec.objectId,
          spec.player,
          spec.amount,
          spec.defender,
        )
        if (!generatedPatternMatches(state, state, draft, source, grant.ability.on, occurrence, event, grant.execution)) return
        matches.push({
          source,
          effect: { do: [] },
          canonical: {
            definitionSnapshot: generatedAbilitySnapshot(grant.ability, grant.ability.decisions, grant.ability.capturedBindings),
            abilityIndex: 0,
          },
          execution: {
            ...triggerExecution(source, occurrence, draft),
            grantSource: { objectId: grant.sourceId, incarnation: grant.sourceIncarnation },
            ...(grant.execution?.targetBindings ? { targetBindings: structuredClone(grant.execution.targetBindings) } : {}),
            ...(grant.execution?.choices ? { choices: structuredClone(grant.execution.choices) } : {}),
            ...(grant.execution?.results ? { results: structuredClone(grant.execution.results) } : {}),
            ...(grant.execution?.capturedChoiceAliases ? { capturedChoiceAliases: structuredClone(grant.execution.capturedChoiceAliases) } : {}),
            ...(grant.execution?.capturedResultAliases ? { capturedResultAliases: structuredClone(grant.execution.capturedResultAliases) } : {}),
            ...(grant.execution?.capturedOccurrence ? { capturedOccurrence: structuredClone(grant.execution.capturedOccurrence) } : {}),
            ...(grant.execution?.capturedOccurrenceBindings ? { capturedOccurrenceBindings: structuredClone(grant.execution.capturedOccurrenceBindings) } : {}),
            ...(grant.execution?.variables ? { variables: structuredClone(grant.execution.variables) } : {}),
            ...(grant.execution?.scopeId ? { scopeId: grant.execution.scopeId } : {}),
          },
          triggeringPlayer: occurrence.player ?? source.controller,
          triggeringObjectId: spec.objectId,
          triggerAmount: occurrence.amount,
          payload: { grantIndex, sourceId: grant.sourceId, sourceIncarnation: grant.sourceIncarnation },
        })
      })
    })
  }
}

const canonicalTriggersForOccurrence = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  const sources = event.type === 'move' && state.objects[event.objectId]?.zone === 'battlefield'
    ? Object.values(state.objects)
    : Object.values(draft.objects)
  const seen = new Set<string>()
  for (const source of sources) {
    const definitionSnapshot = source.ruleDefinition
    if (!sourceStaticAbilitiesActive(source) || !definitionSnapshot) continue
    const compiled = loadDefinitionSnapshot(definitionSnapshot)
    compiled.definition.abilities.forEach((candidate, abilityIndex) => {
      if (candidate.kind !== 'triggered') return
      const sourceAfterEvent = draft.objects[source.id]
      const sourceMoved = event.type === 'move' && (!sourceAfterEvent || sourceAfterEvent.zone !== source.zone)
      const usesLastKnownSource = sourceMoved && (candidate.on.kind === 'dies'
        || candidate.on.kind === 'leaves'
        || candidate.on.kind === 'sacrificed'
        || (candidate.on.kind === 'moved' && sourceMovedUsesLastKnownInformation(
          candidate.on, state.objects[source.id], sourceAfterEvent,
        )))
      const activeZones = usesLastKnownSource
        ? [source.zone]
        : sourceAfterEvent ? [sourceAfterEvent.zone] : []
      if (!activeZones.some(zone => candidate.activeIn.includes(zone))) return
      occurrenceSpecsForPattern(candidate.on, event, state, draft).forEach(spec => {
        let occurrence = capturedOccurrence(
          state,
          draft,
          event,
          spec.objectId,
          spec.player,
          spec.amount,
          spec.defender,
        )
        const predicateState = candidate.on.kind === 'dies' || candidate.on.kind === 'leaves' || candidate.on.kind === 'sacrificed' ? state : draft
        if (!canonicalPatternMatches(predicateState, state, source, candidate, candidate.on, occurrence, event)) return
        const groupedIds = candidate.on.kind === 'moved' && candidate.on.group
          ? matchingMovedIds(candidate.on, state, draft, source, occurrence)
          : undefined
        if (groupedIds && groupedIds.length > 0) {
          occurrence = capturedOccurrence(
            state,
            draft,
            event,
            groupedIds[0],
            spec.player,
            spec.amount,
            spec.defender,
            groupedIds,
          )
        }
        const context = {
          state: predicateState,
          controller: source.controller,
          source: captureObject(source),
          occurrence,
        }
        const occurrenceKey = `${source.id}:${source.incarnation}:${abilityIndex}:${occurrence.eventType}:${groupedIds?.join(',') ?? spec.objectId ?? ''}:${occurrence.player ?? ''}:${occurrence.defender ?? ''}:${occurrence.amount ?? ''}`
        if (seen.has(occurrenceKey)) return
        seen.add(occurrenceKey)
        const frequencyKey = `dsl:${definitionSnapshot.definitionRevision}@${abilityIndex}`
        const frequencySource = draft.object(source.id) ?? source
        if (candidate.frequency?.kind === 'firstMatchingEachTurn') {
          if (candidate.on.kind === 'moved' && candidate.on.to === 'graveyard') {
            const owners = [...new Set((groupedIds ?? matchingMovedIds(candidate.on, state, draft, source, occurrence))
              .flatMap((id) => {
                const owner = state.objects[id]?.owner ?? draft.objects[id]?.owner
                return owner ? [owner] : []
              }))]
            if (owners.some((owner) => draft.players[owner]!.data[LAND_TO_GRAVEYARD_TURN] === draft.turn)) return
          } else if (!mayTriggerFirstMatchingEachTurn(frequencySource, frequencyKey, state.turn)) return
          markFirstMatchingEachTurn(frequencySource, frequencyKey, state.turn)
        }
        if (candidate.triggerOnlyIf && !evaluateCondition(candidate.triggerOnlyIf, context)) return
        // An intervening-if condition gates both trigger creation and resolution.
        // Capture evaluates it against the actual occurrence while the stack gate
        // evaluates the same definition again when the ability resolves.
        if (candidate.interveningIf && !evaluateCondition(candidate.interveningIf, context)) return
        if (candidate.frequency?.kind === 'onceEachTurn'
          && !mayTriggerOnceEachTurn(frequencySource, frequencyKey, state.turn)) return
        const pendingTrigger = {
          source,
          effect: { do: [], ...(candidate.interveningIf ? { if: candidate.interveningIf } : {}) },
          canonical: {
            definitionSnapshot: structuredClone(definitionSnapshot),
            abilityIndex,
          },
          execution: triggerExecution(source, occurrence, draft),
          triggerEffectKey: frequencyKey,
          triggeringPlayer: occurrence.player ?? source.controller,
          triggeringObjectId: spec.objectId,
          triggerAmount: occurrence.amount,
          triggeredByAbility: false,
        }
        matches.push(pendingTrigger)
        if (candidate.frequency?.kind === 'onceEachTurn') {
          markTriggeredOnceEachTurn(frequencySource, frequencyKey, state.turn)
        }
      })
    })
  }
  canonicalGrantedTriggersForOccurrence(state, draft, event, matches)
}

const sourceMovedUsesLastKnownInformation = (
  pattern: Extract<OccurrencePattern, { kind: 'moved' }>,
  before: GameObject | undefined,
  after: GameObject | undefined,
) => {
  if (!before || (after && after.zone === before.zone)) return false
  if (before.zone === 'graveyard' && pattern.from?.includes('graveyard')) return true
  if ((pattern.to === 'hand' || pattern.to === 'library')
    && ['battlefield', 'stack', 'graveyard', 'exile', 'command'].includes(before.zone)) return true
  return before.zone === 'battlefield' && pattern.from?.includes('battlefield')
}

/**
 * Enters listens to the same entry paths as the permanent-entry helper, but
 * `resolveTop` must not reuse the source permanent as an entering object.
 */
const permanentEnteringObjectId = (event: GameEvent, state: GameState) => {
  if (event.type === 'playLand') return null
  if (event.type === 'resolveTop') {
    const item = state.stack[0]
    if (!item || item.kind !== 'spell') return null
  }
  return enteringObjectId(event, state)
}

/** The signal itself marks entry when a caller already placed the object on the battlefield. */
const isPermanentEntrySignal = (event: GameEvent): event is Extract<GameEvent, { type: 'custom' }> =>
  event.type === 'custom' && event.name === PERMANENT_ENTERED

const pushCopies = (
  matches: PendingTrigger[],
  source: GameObject,
  effect: PendingTriggerEffect,
  copies: number,
  meta: Pick<
    PendingTrigger,
    'triggerEffectKey' | 'triggeringObjectId' | 'triggeringPlayer' | 'triggerAmount' | 'payload' | 'delayed'
  > = {},
) => {
  const pending = { source, effect, ...meta }
  for (let index = 0; index < copies; index += 1) {
    matches.push(pending)
  }
}

const passesOnceEachTurn = (
  source: GameObject,
  effect: TriggerEffect,
  catalog: CardEffect[],
  turn: number,
) => !effect.onceEachTurn || mayTriggerOnceEachTurn(source, triggerEffectKey(catalog, effect), turn)

const noteOnceEachTurnIfNeeded = (
  draft: Draft,
  source: GameObject,
  effect: Pick<TriggerEffect, 'onceEachTurn'>,
  key?: string,
) => {
  if (!effect.onceEachTurn || !key) return
  const live = draft.object(source.id)
  if (!live) return
  markTriggeredOnceEachTurn(live, key, draft.turn)
}

const triggerPayloadExtras = (
  effect: Pick<TriggerEffect, 'if' | 'do' | 'onceEachTurn'>,
  key?: string,
  extras: Record<string, unknown> = {},
) => ({
  ...(key ? { triggerEffectKey: key } : {}),
  triggerEffect: effect,
  ...(effect.if && !isTriggerBindingIf(effect.if) ? { interveningIf: effect.if } : {}),
  ...extras,
})

type TriggerMeta = Pick<
  PendingTrigger,
  'triggeringObjectId' | 'triggeringPlayer' | 'triggerAmount' | 'payload'
>

/**
 * `watched` is the permanent a `tokenCreated` / `permanentEnters` / `permanentSacrificed` trigger
 * is about. Such an effect only triggers when `watched` matches its `watch`
 * filter, and its intervening if can read `watched` as well.
 */
const collectEffects = (
  source: GameObject,
  on: TriggerEffect['on'],
  state: GameState,
  matches: PendingTrigger[],
  copies = 1,
  meta: TriggerMeta & { watched?: GameObject; fromZone?: GameObject['zone'] } = {},
  event?: GameEvent,
  accepts: (effect: TriggerEffect) => boolean = () => true,
) => {
  if (source.phasedOut) return
  const { watched, fromZone, ...pending } = meta
  const catalog = effectsOf(source)
  for (const effect of triggerEffects(catalog, on)) {
    if (!accepts(effect)) continue
    if (on === 'exiled' && !effect.watch && source.id !== watched?.id) continue
    if (!matchesTriggerEvent(state, source, effect, {
      watched, player: meta.triggeringPlayer, fromZone, event,
    })) continue
    if (!passesOnceEachTurn(source, effect, catalog, state.turn)) continue
    const stackCopies = effect.onceEachTurn ? 1 : copies
    pushCopies(matches, source, effect, stackCopies, {
      ...pending,
      triggerEffectKey: triggerEffectKey(catalog, effect),
    })
  }
}

const battlefieldIndex = (draft: Draft, objectId: string, controller: PlayerId) => {
  const order = draft.zoneOrder[controller]?.battlefield ?? []
  const index = order.indexOf(objectId)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

/** CR 603.3b — active player, then turn order; same-player ties by battlefield ETB index. */
const apnapOrder = (draft: Draft, matches: PendingTrigger[]): PendingTrigger[] => {
  const playerOrder = apnapSeats(draft)

  const buckets = new Map<PlayerId, PendingTrigger[]>()
  for (const match of matches) {
    const controller = match.source.controller
    const bucket = buckets.get(controller) ?? []
    bucket.push(match)
    buckets.set(controller, bucket)
  }

  for (const [controller, bucket] of buckets) {
    bucket.sort((a, b) =>
      battlefieldIndex(draft, a.source.id, controller)
      - battlefieldIndex(draft, b.source.id, controller))
  }

  const ordered: PendingTrigger[] = []
  for (const seat of playerOrder) {
    const bucket = buckets.get(seat)
    if (bucket) ordered.push(...bucket)
  }
  return ordered
}

const collectBecomesMonstrous = (
  state: GameState,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'becomesMonstrous') return
  const object = state.objects[event.objectId]
  if (!object || object.zone !== 'battlefield') return
  collectEffects(object, 'becomesMonstrous', state, matches)
}

const collectEnters = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  const objectId = permanentEnteringObjectId(event, state)
  if (!objectId) return
  const object = draft.object(objectId)
  if (!object || object.zone !== 'battlefield') return

  collectEffects(
    object,
    'enters',
    draft,
    matches,
    1,
    { triggeringObjectId: object.id, triggeringPlayer: object.controller, watched: object },
    event,
  )
  for (const watcher of draft.zoneOf('battlefield')) {
    const meta = { triggeringObjectId: object.id, triggeringPlayer: object.controller, watched: object }
    collectEffects(watcher, 'permanentEnters', draft, matches, 1, meta)
    // CR 111.13: a resolving permanent spell copy enters as a token but is not created.
    if (isPermanentEntrySignal(event)
      && event.payload?.createdToken === true && object.token) {
      collectEffects(watcher, 'tokenCreated', draft, matches, 1, meta)
    }
  }
}

/**
 * The `sacrifice` event is the one place a sacrifice is visible before the
 * permanent has left, so watchers read its controller and tokenhood from the
 * pre-event state. Whatever the card does afterwards (a replacement may send it
 * to a library) is for the ability's resolution to find out.
 */
const collectSacrifices = (
  state: GameState,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'sacrifice') return
  const sacrificed = state.objects[event.objectId]
  if (!sacrificed || sacrificed.zone !== 'battlefield') return
  for (const watcher of Object.values(state.objects)) {
    if (watcher.zone !== 'battlefield') continue
    collectEffects(watcher, 'permanentSacrificed', state, matches, 1, {
      triggeringObjectId: sacrificed.id,
      triggeringPlayer: sacrificed.controller,
      watched: sacrificed,
    })
  }
}

const defendingPlayer = (state: GameState, target: TargetRef | PlayerId) => {
  if (typeof target === 'string') return target
  if (target.kind === 'player') return target.player
  if (target.kind !== 'object') return undefined
  const attacked = state.objects[target.objectId]
  return attacked?.protector ?? attacked?.controller
}

/** An attack trigger carries the defending player of the attacker it belongs to. */
const collectAttacks = (
  state: GameState,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'declareAttackers') return
  for (const declaration of event.attackers) {
    const attacker = state.objects[declaration.objectId]
    if (!attacker) continue
    const defender = defendingPlayer(state, declaration.defender)
    const meta = defender ? { payload: { defendingPlayer: defender } } : {}
    collectEffects(attacker, 'attacks', state, matches, 1, meta, event)
  }
}

const collectPlayerAttacks = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'declareAttackers') return
  for (const source of draft.zoneOf('battlefield')) {
    const live = draft.object(source.id)
    if (!live || live.zone !== 'battlefield') continue
    const qualifying = event.attackers.some((declaration) => {
      const defender = defendingPlayer(state, declaration.defender)
      if (!defender || defender === live.controller || state.players[defender]?.lost) return false
      return state.playerOrder.some((seat) =>
        seat !== live.controller
        && seat !== defender
        && !state.players[seat].lost
        && state.players[defender].life > state.players[seat].life)
    })
    if (!qualifying) continue
    collectEffects(live, 'playerAttacks', state, matches, 1, {
      triggeringPlayer: event.seat,
    }, event)
  }
}

const collectTapped = (
  state: GameState,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'tap' && event.type !== 'tapForMana') return
  const object = state.objects[event.objectId]
  if (!object) return
  collectEffects(object, 'tapped', state, matches, 1, {}, event)
}

/** Any permanent hears any vote finishing, secret or public, whoever cast it. */
const collectVotesFinished = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'votesFinished') return
  for (const source of draft.zoneOf('battlefield')) {
    collectEffects(source, 'votesFinished', state, matches, 1, {
      triggeringPlayer: event.owner,
      payload: { vote: event.result },
    }, event)
  }
}

const collectCombatDamage = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'combatDamage') return
  const attacker = draft.object(event.sourceId) ?? state.objects[event.sourceId]
  if (!attacker) return
  const meta = {
    triggeringPlayer: attacker.controller,
    triggerAmount: event.amount,
  }
  if (event.target.kind === 'player') {
    if (attacker.zone === 'battlefield') {
      collectEffects(attacker, 'combatDamage', state, matches, 1, meta)
    }
    return
  }
  if (event.target.kind !== 'object') return
  const recipient = draft.object(event.target.objectId) ?? state.objects[event.target.objectId]
  if (!recipient || recipient.zone !== 'battlefield') return
  collectEffects(recipient, 'dealtCombatDamage', state, matches, 1, meta)
}

const collectMoveTriggers = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'move') return
  const before = state.objects[event.objectId]
  if (!before) return

  const after = draft.object(before.id)
  if (!after || after.zone === before.zone) return
  const meta = {
    triggeringObjectId: before.id,
    triggeringPlayer: before.controller,
    watched: before,
  }
  const departed = before.zone === 'battlefield' && after.zone !== 'battlefield'
  const died = departed && after.zone === 'graveyard' && before.types.includes('Creature')
  // CR 603.10: departure watchers use the battlefield and characteristics before the move.
  const watchers = departed ? Object.values(state.objects) : draft.zoneOf('battlefield')
  for (const watcher of watchers) {
    if (watcher.zone !== 'battlefield') continue
    if (departed) collectEffects(watcher, 'permanentLeaves', state, matches, 1, meta, event)
    if (died) collectEffects(watcher, 'permanentDies', state, matches, 1, meta, event)

  }

  if (after.zone === 'exile') {
    // From-anywhere exile triggers use the resulting state; explicit departures look back (CR 603.10).
    for (const source of Object.values(state.objects)) {
      if (source.zone !== 'battlefield') continue
      collectEffects(source, 'exiled', state, matches, 1, {
        ...meta, fromZone: before.zone,
      }, event, (effect) => !effect.watch || effect.from !== undefined)
    }
    for (const source of draft.zoneOf('battlefield')) {
      collectEffects(source, 'exiled', draft, matches, 1, {
        ...meta, watched: after, fromZone: before.zone,
      }, event, (effect) => Boolean(effect.watch) && effect.from === undefined)
    }
  }

  if (departed) {
    // The leaving object stops existing for the ledger, so the ability keeps what it knew.
    collectEffects(before, 'leaves', state, matches, 1, before.damageDealtBy
      ? { payload: { lastKnownDamage: before.damageDealtBy } }
      : {})
  }

  if (died) {
    collectEffects(before, 'dies', state, matches, 1, {
      triggeringObjectId: before.id,
      triggeringPlayer: before.controller,
      watched: before,
    })
  }
}

const eventObjectId = (event: GameEvent) => {
  if (event.type === 'tokenCreated') return event.object.id
  if ('objectId' in event && typeof event.objectId === 'string') return event.objectId
  if (event.type === 'custom' && event.name === MANA_ABILITY_RESOLVED && typeof event.payload?.sourceId === 'string') return event.payload.sourceId
  if (event.type === 'dealDamage' && event.target.kind === 'object') return event.target.objectId
  if (event.type === 'custom' && typeof event.payload?.objectId === 'string') return event.payload.objectId
  return undefined
}

const delayedTriggerMatches = (
  trigger: GameState['delayedTriggers'][number],
  state: GameState,
  draft: Draft,
  event: GameEvent,
) => {
  if (trigger.notBeforeTurn !== undefined && draft.turn < trigger.notBeforeTurn) return false
  if (trigger.condition.kind === 'tappedForMana') {
    const source = trigger.execution?.source.snapshot
    return Boolean(source && matchesTapOccurrence(state, draft, source, trigger.condition, capturedOccurrence(state, draft, event, eventObjectId(event)), event, trigger.execution))
  }
  if (trigger.condition.kind === 'event') {
    if (event.type !== trigger.condition.type) return false
    if (
      trigger.condition.objectId !== undefined
      && eventObjectId(event) !== trigger.condition.objectId
    ) {
      return false
    }
    if (trigger.objectRef) {
      const object = state.objects[trigger.objectRef.objectId] ?? draft.objects[trigger.objectRef.objectId]
      if (!object || object.incarnation !== trigger.objectRef.incarnation) return false
    }
    if (trigger.condition.to !== undefined) {
      if (event.type !== 'move' || event.to !== trigger.condition.to) return false
    }
    if (trigger.condition.from !== undefined) {
      const objectId = eventObjectId(event)
      if (!objectId || state.objects[objectId]?.zone !== trigger.condition.from) return false
    }
    return true
  }
  const steps = Array.isArray(trigger.condition.step)
    ? trigger.condition.step
    : [trigger.condition.step]
  return (
    event.type === 'custom'
    && event.name === 'advanceStep'
    && steps.includes(draft.step)
    && (
      trigger.condition.active === undefined
      || trigger.condition.active === draft.active
    )
  )
}

const collectDelayedTriggers = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  const remaining: GameState['delayedTriggers'] = []
  for (const delayed of draft.delayedTriggers) {
    if (!delayedTriggerMatches(delayed, state, draft, event)) {
      remaining.push(delayed)
      continue
    }
    if (delayed.recurring) remaining.push(delayed)
    const live = draft.object(delayed.sourceId)
    const sameSource = live && (delayed.sourceIncarnation === undefined || live.incarnation === delayed.sourceIncarnation)
    const source: GameObject = live
      && sameSource
      ? { ...live, controller: delayed.controller }
      : {
        ...(delayed.execution?.source.snapshot ?? gameObjectFieldDefaults()),
        id: delayed.sourceId,
        name: delayed.sourceName,
        owner: delayed.controller,
        controller: delayed.controller,
        zone: 'graveyard',
      }
    if (delayed.canonical && delayed.execution) {
      matches.push({
        source,
        effect: { do: [] },
        delayed: true,
        canonical: structuredClone(delayed.canonical),
        execution: {
          ...structuredClone(delayed.execution),
          occurrence: capturedOccurrence(state, draft, event, eventObjectId(event),
            occurrencePlayerForEvent(event, draft),
            event.type === 'gainLife' ? event.amount : undefined),
        },
        triggeringPlayer: delayed.controller,
      })
      continue
    }
    const filter = delayed.payload?.targetFilter
    pushCopies(matches, source, {
      do: delayed.instructions,
      ...(filter && typeof filter === 'object'
        ? { targets: { filter: filter as TargetFilter } }
        : {}),
    }, 1, {
      delayed: true,
      payload: delayed.payload,
    })
  }
  draft.delayedTriggers = remaining
}

const collectRoomUnlock = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  const doorId = event.type === 'unlockDoor'
    ? event.door
    : event.type === 'resolveTop'
      ? state.stack[0]?.door
      : undefined
  if (!doorId) return
  const objectId = event.type === 'unlockDoor'
    ? event.objectId
    : state.stack[0]?.objectId
  if (!objectId) return
  const source = draft.object(objectId)
  const doorSource = source && asRoomDoor(source, doorId)
  if (!source?.roomDoors || !doorSource || source.zone !== 'battlefield') return
  collectEffects(doorSource, 'unlock', draft, matches)

  const beforeCount = state.objects[objectId]?.unlockedDoors?.length ?? 0
  if ((source.unlockedDoors?.length ?? 0) === 2 && beforeCount < 2) {
    collectEffects(source, 'fullyUnlock', draft, matches)
  }
}

const collectEventTriggers = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
): PendingTrigger[] => {
  const matches: PendingTrigger[] = []
  collectEnters(state, draft, event, matches)
  collectBecomesMonstrous(state, event, matches)
  collectAttacks(state, event, matches)
  collectSacrifices(state, event, matches)
  collectPlayerAttacks(state, draft, event, matches)
  collectTapped(state, event, matches)
  collectCombatDamage(state, draft, event, matches)
  collectMoveTriggers(state, draft, event, matches)
  collectDelayedTriggers(state, draft, event, matches)
  collectRoomUnlock(state, draft, event, matches)
  collectVotesFinished(state, draft, event, matches)
  canonicalTriggersForOccurrence(state, draft, event, matches)
  recordLandToGraveyardThisTurn(state, draft, event)
  return matches
}

// CR 603.2d: modifiers add instances of the original trigger; they do not
// multiply each other's additional instances or delayed triggered abilities.
const multiplyPendingTriggers = (state: GameState, draft: Draft, event: GameEvent, matches: PendingTrigger[]) => {
  const seen = new Set<PendingTrigger>()
  const enteringId = event.type === 'playLand' ? event.objectId : permanentEnteringObjectId(event, state)
  const entrant = enteringId ? draft.objects[enteringId] : undefined
  const entered = entrant?.zone === 'battlefield'
    && (event.type !== 'move' || state.objects[event.objectId]?.zone !== 'battlefield')
  return matches.flatMap(pending => {
    if (seen.has(pending) || pending.delayed || pending.effect.onceEachTurn) return [pending]
    seen.add(pending)
    const ability = pending.canonical?.definitionSnapshot.definition.abilities[pending.canonical.abilityIndex]
    if (ability?.kind === 'triggered' && ability.frequency?.kind === 'onceEachTurn') return [pending]
    const lookBack = ability?.kind === 'triggered'
      && ['dies', 'leaves', 'sacrificed'].includes(ability.on.kind)
    const lookup = lookBack || (event.type === 'move' && state.objects[event.objectId]?.zone === 'battlefield') ? state : draft
    const triggerSource = lookup.objects[pending.source.id]
    if (triggerSource?.zone !== 'battlefield') return [pending]
    let additional = 0
    for (const { object, effect } of battlefieldPrintedStatics(lookup, 'multiplyTriggers')) {
      const context = { state: lookup, controller: object.controller, source: captureObject(object) }
      if (!evaluateObjectSelector(effect.sources, context).some(source => source.id === triggerSource.id)) continue
      if (effect.cause && (!entered || !objectMatchesSelector(entrant!, { kind: 'objects', filter: effect.cause.enters }, context))) continue
      additional += Math.max(0, Math.floor(evaluateRuntimeAmount(effect.additional, context)))
    }
    return Array.from({ length: 1 + additional }, () => pending)
  })
}

export const captureEventTriggers = (
  state: GameState,
  event: GameEvent,
  draft: Draft,
) => {
    const matches = collectEventTriggers(state, draft, event)
    if (matches.length === 0) return

    // Devour is an enters-the-battlefield replacement choice (CR 702.82), even
    // though the legacy card data stores it in an `enters` trigger-shaped node.
    // Open that choice during the resolving permanent's frame so an otherwise
    // 0/0 creature cannot be put into its owner's graveyard before it devours.
    const replacements = matches.filter(({ effect }) =>
      effect.do.length === 1 && effect.do[0].kind === 'devour')
    for (const { source, effect } of replacements) {
      runInstructions(draft, source, effect.do, {
        id: 'devour-enter',
        kind: 'ability',
        objectId: source.id,
        controller: source.controller,
        name: source.name,
        targets: [],
      })
    }
    const ordinary = matches.filter(({ effect }) =>
      effect.do.length !== 1 || effect.do[0].kind !== 'devour')
    if (ordinary.length === 0) return

    const ordered = apnapOrder(draft, multiplyPendingTriggers(state, draft, event, ordinary))
    const triggeringPlayer = 'seat' in event && typeof event.seat === 'string'
      ? event.seat
      : undefined
    const captured: CapturedPendingTrigger[] = ordered.map(({
      id: pendingId,
      source,
      effect,
      canonical,
      triggeredByAbility,
      triggerEffectKey: effectKey,
      triggeringObjectId,
      triggeringPlayer: matchedPlayer,
      triggerAmount,
      payload,
      execution: matchedExecution,
    }) => {
      const occurrence = capturedOccurrence(
        state,
        draft,
        event,
        triggeringObjectId,
        matchedPlayer ?? triggeringPlayer ?? occurrencePlayerForEvent(event, draft),
        triggerAmount,
      )
      const baseExecution = matchedExecution ?? triggerExecution(source, occurrence, draft)
      const execution = canonical ? withReferencedObjects(draft, { ...baseExecution, ...(draft.monarchRevision !== undefined ? { monarchRevision: draft.monarchRevision } : {}) }, canonical.definitionSnapshot) : baseExecution
      noteOnceEachTurnIfNeeded(draft, source, effect, effectKey)
      return {
        id: pendingId ?? draft.allocId('trigger'),
        source: snapshotObject(source),
        instructions: structuredClone(effect.do),
        effect: structuredClone(effect),
        execution,
        ...(canonical ? { canonical: structuredClone(canonical) } : {}),
        ...(triggeredByAbility ? { triggeredByAbility: true } : {}),
        triggeringPlayer: matchedPlayer ?? triggeringPlayer ?? source.controller,
        ...(effectKey ? { triggerEffectKey: effectKey } : {}),
        ...(triggeringObjectId ? { triggeringObjectId } : {}),
        ...(triggerAmount !== undefined ? { triggerAmount } : {}),
        ...(payload ? { payload: structuredClone(payload) } : {}),
      }
    })
    draft.pendingTriggers = [...(draft.pendingTriggers ?? []), ...captured]
}

export const triggers: Plugin = {
  id: 'triggers',
  apply: ({ state, event, draft }) => {
    captureEventTriggers(state, event, draft)
  },
}

const removePendingTrigger = (draft: Draft, id: string) => {
  draft.pendingTriggers = (draft.pendingTriggers ?? []).filter((trigger) => trigger.id !== id)
  if (draft.pendingTriggers.length === 0) delete draft.pendingTriggers
}

const canonicalManaTrigger = (trigger: CapturedPendingTrigger) => {
  if (!trigger.canonical) return false
  const definition = loadDefinitionSnapshot(trigger.canonical.definitionSnapshot).definition
  const ability = definition.abilities[trigger.canonical.abilityIndex]
  if (!ability || ability.kind !== 'triggered'
    || !['tappedForMana', 'manaAdded', 'manaAbilityActivated', 'manaAbilityResolved'].includes(ability.on.kind)) return false
  const instructions = 'instructions' in ability
    ? ability.instructions ?? []
    : ability.modes.flatMap((mode) => mode.instructions)
  return classifyManaAbility({ addsMana: instructionAddsMana(instructions), abilityKind: 'triggered', triggered: true, triggeredManaEligible: true, hasTargets: ability.decisions.targets.length > 0 }).isManaAbility
}

/** CR 605.4a: resolve mana triggers immediately after the producing mana event. */
export const placePendingManaTriggers = (draft: Draft) => {
  const trigger = (draft.pendingTriggers ?? []).find(canonicalManaTrigger)
  if (!trigger) return false
  removePendingTrigger(draft, trigger.id)
  return placeCanonicalTrigger(draft, trigger)
}

const placementGroups = (
  draft: Draft,
  pending: CapturedPendingTrigger[],
  pass: 1 | 2,
) => {
  const buckets = new Map<PlayerId, CapturedPendingTrigger[]>()
  for (const trigger of pending) {
    if (Boolean(trigger.triggeredByAbility) !== (pass === 2)) continue
    const bucket = buckets.get(trigger.execution.controller) ?? []
    bucket.push(trigger)
    buckets.set(trigger.execution.controller, bucket)
  }
  return apnapSeats(draft).flatMap((seat) => {
    const groupTriggers = buckets.get(seat)
    return groupTriggers && groupTriggers.length > 0 ? [{ seat, triggers: groupTriggers }] : []
  })
}

const legacyTriggerSignature = (trigger: CapturedPendingTrigger) => JSON.stringify({
  key: trigger.triggerEffectKey,
  effect: trigger.effect,
})

const placeCanonicalTrigger = (draft: Draft, trigger: CapturedPendingTrigger) => {
  const canonical = trigger.canonical
  if (!canonical) return true
  const liveSource = draft.object(trigger.execution.source.ref.objectId)
  const source = liveSource && liveSource.incarnation === trigger.execution.source.ref.incarnation
    ? liveSource
    : trigger.source
  const definition = loadDefinitionSnapshot(canonical.definitionSnapshot).definition
  const ability = definition.abilities[canonical.abilityIndex]
  if (!ability || ability.kind !== 'triggered') return true
  const manaInstructions = 'instructions' in ability
    ? ability.instructions ?? []
    : ability.modes.flatMap((mode) => mode.instructions)
  const isMana = ['tappedForMana', 'manaAdded', 'manaAbilityActivated', 'manaAbilityResolved'].includes(ability.on.kind)
    && classifyManaAbility({
    addsMana: instructionAddsMana(manaInstructions),
    abilityKind: 'triggered',
    triggered: true,
    triggeredManaEligible: true,
    hasTargets: ability.decisions.targets.length > 0,
  }).isManaAbility
  if (isMana) {
    const item = {
      id: draft.allocId('inline'),
      kind: 'ability' as const,
      objectId: source.id,
      controller: trigger.execution.controller,
      name: source.name,
      targets: [],
      payload: { instructions: manaInstructions },
      execution: {
        ...trigger.execution,
        definitionSnapshot: canonical.definitionSnapshot,
        abilityIndex: canonical.abilityIndex,
      },
    }
    startCanonicalResolution(draft, item, { inline: true })
    return true
  }
  return startCanonicalAnnouncement(draft, {
    definitionSnapshot: canonical.definitionSnapshot,
    abilityIndex: canonical.abilityIndex,
    execution: trigger.execution,
    source,
    sourceId: source.id,
    clauses: canonical.inheritedTargets ? [] : ability.decisions.targets,
  })
}

/** CR 603.3b: two APNAP passes with a durable ordering/target cursor. */
export const placePendingTriggers = (draft: Draft) => {
  const pending = draft.pendingTriggers ?? []
  if (pending.length === 0) {
    delete draft.triggerPlacement
    return false
  }
  const frame = draft.triggerPlacement ?? { version: 1 as const, pass: 1 as const }
  const groups = placementGroups(draft, pending, frame.pass)
  if (groups.length === 0) {
    if (frame.pass === 1) {
      draft.triggerPlacement = { version: 1, pass: 2 }
      return false
    }
    delete draft.pendingTriggers
    delete draft.triggerPlacement
    return false
  }
  const group = frame.controller
    ? groups.find(({ seat }) => seat === frame.controller)
    : groups[0]
  if (!group) {
    draft.triggerPlacement = { version: 1, pass: frame.pass }
    return false
  }
  let orderIds = frame.orderIds?.filter((id) => group.triggers.some((trigger) => trigger.id === id))
  if (!orderIds || orderIds.length !== group.triggers.length) {
    orderIds = group.triggers.map((trigger) => trigger.id)
    const legacyEntriesDiffer = new Set(group.triggers.map(legacyTriggerSignature)).size > 1
    const skipCanonicalOrdering = group.triggers.length > 1
      && group.triggers.every((trigger) => Boolean(trigger.canonical))
      && group.triggers.every((trigger) => trigger.triggeringObjectId !== undefined)
      && new Set(group.triggers.map((trigger) => trigger.triggeringObjectId)).size === 1
    if (orderIds.length > 1 && (
      (group.triggers.some((trigger) => Boolean(trigger.canonical)) && !skipCanonicalOrdering)
      || groups.length > 1
      || legacyEntriesDiffer
    )) {
      const entries = group.triggers.map((trigger) => ({
        id: trigger.id,
        label: trigger.canonical
          ? `${trigger.source.name} ability ${trigger.canonical.abilityIndex + 1}`
          : `${trigger.source.name} trigger ${trigger.triggerEffectKey ?? trigger.id}`,
      }))
      draft.triggerPlacement = { version: 1, pass: frame.pass, controller: group.seat, orderIds }
      openCardSelection(draft, {
        seat: group.seat, kind: 'choose', count: orderIds.length, min: orderIds.length,
        candidates: orderIds, triggerOrder: { ids: orderIds, pass: frame.pass, entries },
        source: 'Triggered abilities', prompt: 'Choose the order of your triggered abilities.',
        destinations: ['target'],
      })
      return true
    }
  }
  const [nextId, ...remaining] = orderIds
  const trigger = group.triggers.find((candidate) => candidate.id === nextId)
  if (!trigger) return false
  draft.triggerPlacement = {
    version: 1, pass: frame.pass, controller: group.seat,
    ...(remaining.length > 0 ? { orderIds: remaining } : {}),
  }
  removePendingTrigger(draft, trigger.id)
  if (trigger.canonical) {
    placeCanonicalTrigger(draft, trigger)
    return false
  }
  // Legacy triggers retain their existing target semantics, but a missing
  // mandatory candidate removes the trigger instead of lowering its minimum.
  const liveSource = draft.object(trigger.execution.source.ref.objectId)
  const source = liveSource && liveSource.incarnation === trigger.execution.source.ref.incarnation
    ? liveSource
    : trigger.source
  const { effect, instructions, execution } = trigger
  if (effect.targets && effect.targets !== 'opponent' && effect.targets !== 'player') {
    const targetSpec = effect.targets
    const candidates = Object.values(draft.objects)
      .filter((object) => validTarget(draft, object, targetSpec.filter, source.controller, undefined, source.id))
      .map((object) => object.id)
    const required = targetSpec.min ?? 1
    if (candidates.length < required) return false
    const maxTargets = effect.targets.max ?? 1
    openCardSelection(draft, {
      seat: source.controller, kind: 'choose', count: maxTargets, min: required, candidates,
      targetIdentities: Object.fromEntries(candidates.map((id) => [id, objectIdentity(draft.objects[id])])),
      sourceId: source.id, source: source.name,
      prompt: maxTargets === 1 ? `Choose target for ${source.name}.` : `Choose up to ${maxTargets} targets for ${source.name}.`,
      destinations: targetDestinations(candidates.length, required),
      triggerInstructions: instructions,
      triggerPayload: triggerPayloadExtras(effect, trigger.triggerEffectKey, {
        targetFilter: targetSpec.filter, triggeringPlayer: trigger.triggeringPlayer,
        ...(trigger.triggeringObjectId ? { triggeringObjectId: trigger.triggeringObjectId } : {}),
        ...(trigger.triggerAmount !== undefined ? { triggerAmount: trigger.triggerAmount } : {}), ...trigger.payload,
      }),
      triggerExecution: execution,
    })
    return true
  }
  if (effect.targets === 'opponent' || effect.targets === 'player') {
    const candidates = draft.playerOrder.filter((seat) => !draft.players[seat].lost
      && (effect.targets !== 'opponent' || draft.opponents[source.controller].includes(seat)))
    if (candidates.length === 0) return false
    openPlayerSelection(draft, {
      seat: source.controller, sourceId: source.id, source: source.name,
      prompt: effect.targets === 'player' ? `Choose target player for ${source.name}.` : `Choose target opponent for ${source.name}.`,
      min: 1, max: 1, candidates,
      action: { kind: 'putTriggeredAbility', instructions, triggeringPlayer: trigger.triggeringPlayer,
        ...(trigger.triggerEffectKey ? { triggerEffectKey: trigger.triggerEffectKey } : {}),
        ...(effect.if && !isTriggerBindingIf(effect.if) ? { interveningIf: effect.if } : {}), execution },
    })
    return true
  }
  if (instructions.length === 1 && instructions[0].kind === 'devour') {
    runInstructions(draft, source, instructions, {
      id: 'devour-enter', kind: 'ability', objectId: source.id,
      controller: source.controller, name: source.name, targets: [],
    })
    return true
  }
  draft.addTriggeredAbility(source, instructions, {
    execution,
    payload: { instructions, triggeringPlayer: trigger.triggeringPlayer,
      ...triggerPayloadExtras(effect, trigger.triggerEffectKey, {
        ...(trigger.triggeringObjectId ? { triggeringObjectId: trigger.triggeringObjectId } : {}),
        ...(trigger.triggerAmount !== undefined ? { triggerAmount: trigger.triggerAmount } : {}), ...trigger.payload,
      }) },
    name: source.name,
  })
  return false
}


/** CR 602.2: captured once after a nonmana activation commits to the stack. */
export const captureAbilityActivation = (state: GameState, draft: Draft, item: StackItem) => {
  if (item.kind !== 'ability' || item.copy) return
  const source = item.execution?.source ?? (state.objects[item.objectId] ? captureObject(state.objects[item.objectId]!) : undefined)
  if (!source) return
  captureEventTriggers(state, { type: 'abilityActivated', stackId: item.id, objectId: item.objectId, seat: item.controller, sourceSnapshot: structuredClone(source) }, draft)
}
