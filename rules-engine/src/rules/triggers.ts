/**
 * CR 603.1 — a matching actual occurrence creates a pending ability instance;
 * placement waits for the next explicit priority checkpoint.
 * CR 603.2 — a trigger watches for a game event matching its `on` binding.
 * CR 603.3b — APNAP placement has separate non-ability and ability-triggering passes.
 */
import { effectsOf } from '../cardPlugins/cardRules'
import { syncGrantCreatureTriggers } from '../cardPlugins/grantCreatureTrigger'
import { enteringObjectId } from '../cardPlugins/entersTapped'
import {
  conditionHolds,
  extraTriggerCount,
  runInstructions,
  triggerEffects,
  type CardEffect,
  type TargetFilter,
} from '../cardPlugins/effects'
import { gameObjectFieldDefaults } from '../definitions'
import type Draft from '../draft'
import { validTarget } from '../cardPlugins/targetedResolve'
import { openCardSelection, targetDestinations } from './selectCards'
import { openPlayerSelection } from './selectPlayers'
import { apnapSeats } from '../turnOrder'
import type {
  GameEvent,
  GameObject,
  GameState,
  PlayerId,
  PendingTrigger as CapturedPendingTrigger,
  Plugin,
  TargetRef,
} from '../types'
import { asRoomDoor } from '../plugins/rooms'
import {
  markTriggeredOnceEachTurn,
  mayTriggerOnceEachTurn,
  triggerEffectKey,
} from '../cardPlugins/triggerFrequency'
import { cardsDrawnThisTurn } from './draw'
import { isTriggerBindingIf, matchesTriggerEvent } from '../cardPlugins/triggers/matching'
import { captureObject, isSameObject, objectIdentity, snapshotObject } from '../objectIdentity'
import type { OccurrenceSnapshot, StackExecutionContext } from '../types'
import { evaluateTargetBounds, loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
import { amountEvaluationContext, evaluateCondition, evaluateObjectReference, evaluatePlayerReference, evaluatePlayerSelector } from '../cardPlugins/dsl/compiler/runtime'
import { canonicalTargetBindings, canonicalTargetCandidates } from '../cardPlugins/dsl/compiler/targeting'
import type { ObjectFilter, ObjectOccurrenceFilter, OccurrencePattern, TriggeredAbilityDefinition } from '../cardPlugins/dsl/schema/v1'

const EVENT_TRIGGER_ON = new Set(['discard', 'cycle', 'draw', 'playLand', 'gainLife'])

/**
 * CR 603.2 — "for the first time each turn" is part of the trigger event, so it
 * reads the turn's game history for that player rather than what any one source
 * has already done. A source entering later in the turn has still missed it.
 */
const LAND_TO_GRAVEYARD_TURN = 'triggers.firstTimeEachTurn.landToGraveyard'

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
    definitionSnapshot: import('../cardPlugins/dsl/schema/v1').CardRuleDefinitionSnapshotV1
    abilityIndex: number
  }
  triggeredByAbility?: boolean
}

const capturedOccurrence = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  triggeringObjectId?: string,
  triggeringPlayer?: PlayerId,
  amount?: number,
): OccurrenceSnapshot => {
  const objectId = triggeringObjectId ?? eventObjectId(event)
  const before = objectId ? state.objects[objectId] : undefined
  const after = objectId ? draft.objects[objectId] : undefined
  const sourceId = 'sourceId' in event && typeof event.sourceId === 'string'
    ? event.sourceId
    : 'source' in event && typeof event.source === 'string'
      ? event.source
      : undefined
  const eventSource = sourceId
    ? state.objects[sourceId] ?? draft.objects[sourceId]
    : undefined
  return {
    kind: 'event',
    eventType: event.type === 'custom' ? event.name : event.type,
    ...(triggeringPlayer ? { player: triggeringPlayer } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(before || after
      ? {
          object: {
            ...(before ? { before: snapshotObject(before) } : {}),
            ...(after ? { after: snapshotObject(after) } : {}),
          },
        }
      : {}),
    ...(eventSource ? { source: captureObject(eventSource) } : {}),
  }
}

const triggerExecution = (
  source: GameObject,
  occurrence: OccurrenceSnapshot,
  state: GameState,
): StackExecutionContext => ({
  controller: source.controller,
  source: captureObject(
    source,
    isSameObject(state.objects[source.id], objectIdentity(source)) ? 'current' : 'lastKnown',
  ),
  occurrence,
})

const canonicalFilterMatch = (
  state: GameState,
  source: GameObject,
  object: GameObject,
  filter: ObjectOccurrenceFilter,
  occurrence: OccurrenceSnapshot,
) => {
  if ('kind' in filter) {
    if (filter.kind === 'contextRef') {
      const referenced = evaluateObjectReference(filter, {
        state,
        controller: source.controller,
        source: captureObject(source),
        occurrence,
      }, 'currentOrLastKnown')
      return referenced.some((candidate) => candidate.id === object.id && candidate.incarnation === object.incarnation)
    }
    return false
  }
  if ('all' in filter && filter.all && !filter.all.every((part) =>
    canonicalFilterMatch(state, source, object, part, occurrence))) return false
  if ('any' in filter && filter.any && !filter.any.some((part) =>
    canonicalFilterMatch(state, source, object, part, occurrence))) return false
  if ('not' in filter && filter.not && canonicalFilterMatch(state, source, object, filter.not, occurrence)) return false
  const plain = filter as ObjectFilter
  if (plain.zone !== undefined && object.zone !== plain.zone) return false
  if (plain.type !== undefined && !object.types.includes(plain.type)) return false
  if (plain.subtypes !== undefined && !plain.subtypes.every((subtype) => object.subtypes.includes(subtype))) return false
  if (plain.token !== undefined && object.token !== plain.token) return false
  if (plain.name !== undefined && object.name !== plain.name) return false
  if (plain.controller !== undefined) {
    const controller = plain.controller === 'you'
      ? source.controller
      : evaluatePlayerReference(plain.controller, {
        state,
        controller: source.controller,
        source: captureObject(source),
        occurrence,
      })[0]
    if (controller !== undefined && object.controller !== controller) return false
  }
  if (plain.owner !== undefined) {
    const owner = plain.owner === 'you'
      ? source.controller
      : evaluatePlayerReference(plain.owner, {
        state,
        controller: source.controller,
        source: captureObject(source),
        occurrence,
      })[0]
    if (owner !== undefined && object.owner !== owner) return false
  }
  return true
}

const canonicalPatternMatches = (
  state: GameState,
  source: GameObject,
  ability: TriggeredAbilityDefinition,
  pattern: OccurrencePattern,
  occurrence: OccurrenceSnapshot,
  event: GameEvent,
) => {
  if (pattern.kind === 'draw') {
    if (event.type !== 'draw' || !occurrence.player) return false
    const player = occurrence.player
    if (pattern.filter.firstDrawInOwnDrawStep
      && (state.step !== 'draw'
        || state.active !== player
        || cardsDrawnThisTurn(state.players[player]) !== 0)) return false
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
  if (event.type !== 'move') return false
  if (pattern.kind === 'enters' && event.to !== 'battlefield') return false
  if (pattern.kind === 'dies' && (event.to !== 'graveyard' || occurrence.object?.before?.types.includes('Creature') !== true)) return false
  const object = pattern.kind === 'dies'
    ? occurrence.object?.before
    : occurrence.object?.after
  return Boolean(object && canonicalFilterMatch(state, source, object, pattern.filter, occurrence))
}

const canonicalTriggersForOccurrence = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  const sources = event.type === 'move' && state.objects[event.objectId]?.zone === 'battlefield'
    ? Object.values(state.objects).filter((object) => object.zone === 'battlefield')
    : draft.zoneOf('battlefield')
  const seen = new Set<string>()
  for (const source of sources) {
    const definitionSnapshot = source.ruleDefinition
    if (source.phasedOut || !definitionSnapshot) continue
    const compiled = loadDefinitionSnapshot(definitionSnapshot)
    compiled.definition.abilities.forEach((candidate, abilityIndex) => {
      if (candidate.kind !== 'triggered' || !candidate.activeIn.includes(source.zone)) return
      const occurrence = capturedOccurrence(
        state,
        draft,
        event,
        eventObjectId(event),
        'seat' in event && typeof event.seat === 'string' ? event.seat : undefined,
        event.type === 'gainLife' ? event.amount : undefined,
      )
      if (!canonicalPatternMatches(state, source, candidate, candidate.on, occurrence, event)) return
      const context = {
        state,
        controller: source.controller,
        source: captureObject(source),
        occurrence,
      }
      if (candidate.triggerOnlyIf && !evaluateCondition(candidate.triggerOnlyIf, context)) return
      const key = `${source.id}:${source.incarnation}:${abilityIndex}:${occurrence.eventType}:${eventObjectId(event) ?? ''}:${occurrence.player ?? ''}:${occurrence.amount ?? ''}`
      if (seen.has(key)) return
      seen.add(key)
      const frequencyKey = `dsl@${abilityIndex}`
      if (candidate.frequency && !mayTriggerOnceEachTurn(source, frequencyKey, state.turn)) return
      matches.push({
        source,
        effect: { do: [], ...(candidate.interveningIf ? { if: candidate.interveningIf } : {}) },
        canonical: {
          definitionSnapshot: structuredClone(definitionSnapshot),
          abilityIndex,
        },
        execution: triggerExecution(source, occurrence, draft),
        triggerEffectKey: frequencyKey,
        triggeringPlayer: occurrence.player ?? source.controller,
        triggeringObjectId: eventObjectId(event),
        triggerAmount: occurrence.amount,
        triggeredByAbility: Boolean(state.resolution),
      })
      if (candidate.frequency) {
        markTriggeredOnceEachTurn(draft.object(source.id) ?? source, frequencyKey, state.turn)
      }
    })
  }
}

/** Landfall listens to land drops and zone moves, not ability resolution. */
const landEnteringObjectId = (event: GameEvent, state: GameState) => {
  if (event.type === 'resolveTop') return null
  return enteringObjectId(event, state)
}

/**
 * Enters listens to the same entry paths as `entersTapped`, but ability
 * `resolveTop` must not reuse the source permanent as an entering object.
 */
const permanentEnteringObjectId = (event: GameEvent, state: GameState) => {
  if (event.type === 'resolveTop') {
    const item = state.stack[0]
    if (!item || item.kind !== 'spell') return null
  }
  return enteringObjectId(event, state)
}

const pushCopies = (
  matches: PendingTrigger[],
  source: GameObject,
  effect: PendingTriggerEffect,
  copies: number,
  meta: Pick<
    PendingTrigger,
    'triggerEffectKey' | 'triggeringObjectId' | 'triggeringPlayer' | 'triggerAmount' | 'payload'
  > = {},
) => {
  for (let index = 0; index < copies; index += 1) {
    matches.push({ source, effect, ...meta })
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
  effect: Pick<TriggerEffect, 'if' | 'do' | 'onceEachTurn' | 'whenResolvedNth'>,
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
    if (on === 'cast' && effect.modal) continue
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

const collectLandfall = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  const objectId = landEnteringObjectId(event, state)
  if (!objectId) return
  const land = draft.object(objectId)
  if (!land || land.zone !== 'battlefield' || !land.types.includes('Land')) return

  for (const source of draft.zoneOf('battlefield', land.controller)) {
    collectEffects(
      source,
      'landfall',
      draft,
      matches,
      1 + extraTriggerCount(draft, land.controller, 'landfall', source),
    )
  }
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
  syncGrantCreatureTriggers(draft)
  const objectId = permanentEnteringObjectId(event, state)
  if (!objectId) return
  const object = draft.object(objectId)
  if (!object || object.zone !== 'battlefield') return

  collectEffects(
    object,
    'enters',
    draft,
    matches,
    1 + extraTriggerCount(draft, object.controller, 'enters', object),
    { triggeringObjectId: object.id, triggeringPlayer: object.controller, watched: object },
    event,
  )
  for (const watcher of draft.zoneOf('battlefield')) {
    const meta = { triggeringObjectId: object.id, triggeringPlayer: object.controller, watched: object }
    collectEffects(watcher, 'permanentEnters', draft, matches, 1, meta)
    // CR 111.13: a resolving permanent spell copy enters as a token but is not created.
    if (event.type === 'custom' && event.name === 'cardPlugins.permanentEntered'
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

const STEP_TRIGGERS = ['upkeep', 'precombatMain', 'beginCombat', 'end'] as const

const collectStep = (
  on: (typeof STEP_TRIGGERS)[number],
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'custom' || event.name !== 'advanceStep' || draft.step !== on) return
  for (const object of draft.zoneOf('battlefield')) collectEffects(object, on, state, matches)
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

  if (event.to === 'graveyard' && before.types.includes('Land')) {
    const fromLibrary = before.zone === 'library'
    const owner = draft.players[before.owner]
    const firstThisTurn = owner.data[LAND_TO_GRAVEYARD_TURN] !== draft.turn
    owner.data[LAND_TO_GRAVEYARD_TURN] = draft.turn
    for (const source of draft.zoneOf('battlefield', before.owner)) {
      const catalog = effectsOf(source)
      for (const effect of triggerEffects(catalog, 'landToGraveyard')) {
        if (
          effect.if
          && !isTriggerBindingIf(effect.if)
          && !conditionHolds(effect.if, state, source)
        ) continue
        const milledLand = effect.do.some((instruction) => instruction.kind === 'putMilledLandTapped')
        if (milledLand && !fromLibrary) continue
        if (effect.firstTimeEachTurn && !firstThisTurn) continue
        if (!passesOnceEachTurn(source, effect, catalog, draft.turn)) continue
        pushCopies(matches, source, effect, 1, {
          triggeringObjectId: event.objectId,
          triggerEffectKey: triggerEffectKey(catalog, effect),
        })
      }
    }
  }

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

const collectDiscardDraw = (
  state: GameState,
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (!EVENT_TRIGGER_ON.has(event.type)) return
  const player = 'seat' in event && typeof event.seat === 'string' ? event.seat : undefined
  let watched: GameObject | undefined
  if (event.type === 'draw') {
    if (!player || cardsDrawnThisTurn(draft.players[player]) <= cardsDrawnThisTurn(state.players[player])) return
    const drawnId = state.zoneOrder[player].library[0]
    watched = drawnId ? state.objects[drawnId] : undefined
  } else if (event.type === 'discard') {
    watched = state.objects[event.objectId]
    if (!watched || watched.zone !== 'hand' || watched.controller !== event.seat) return
  }
  for (const source of draft.zoneOf('battlefield')) {
    collectEffects(source, event.type as TriggerEffect['on'], draft, matches, 1, {
      triggeringPlayer: player,
      ...(watched ? { triggeringObjectId: watched.id, watched } : {}),
      ...(event.type === 'gainLife' ? { triggerAmount: event.amount } : {}),
    }, event)
  }
}

const collectCasts = (
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'castSpell') return
  const spell = draft.object(event.objectId)
  if (!spell || spell.zone !== 'stack') return
  for (const source of draft.zoneOf('battlefield')) {
    // Modal cast triggers retain their existing mode picker, which queues the chosen ability.
    collectEffects(source, 'cast', draft, matches, 1, {
      triggeringObjectId: spell.id, triggeringPlayer: event.seat, watched: spell,
    }, event)
  }
}

const eventObjectId = (event: GameEvent) =>
  'objectId' in event && typeof event.objectId === 'string' ? event.objectId : undefined

const delayedTriggerMatches = (
  trigger: GameState['delayedTriggers'][number],
  state: GameState,
  draft: Draft,
  event: GameEvent,
) => {
  if (trigger.condition.kind === 'event') {
    if (event.type !== trigger.condition.type) return false
    if (
      trigger.condition.objectId !== undefined
      && eventObjectId(event) !== trigger.condition.objectId
    ) {
      return false
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
    const source: GameObject = live
      ? { ...live, controller: delayed.controller }
      : {
        ...gameObjectFieldDefaults(),
        id: delayed.sourceId,
        name: delayed.sourceName,
        owner: delayed.controller,
        controller: delayed.controller,
        zone: 'graveyard',
      }
    const filter = delayed.payload?.targetFilter
    pushCopies(matches, source, {
      do: delayed.instructions,
      ...(filter && typeof filter === 'object'
        ? { targets: { filter: filter as TargetFilter } }
        : {}),
    }, 1, {
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
  collectLandfall(state, draft, event, matches)
  collectEnters(state, draft, event, matches)
  collectBecomesMonstrous(state, event, matches)
  collectAttacks(state, event, matches)
  collectSacrifices(state, event, matches)
  collectPlayerAttacks(state, draft, event, matches)
  collectTapped(state, event, matches)
  for (const on of STEP_TRIGGERS) collectStep(on, state, draft, event, matches)
  collectCombatDamage(state, draft, event, matches)
  collectMoveTriggers(state, draft, event, matches)
  collectDiscardDraw(state, draft, event, matches)
  collectCasts(draft, event, matches)
  collectDelayedTriggers(state, draft, event, matches)
  collectRoomUnlock(state, draft, event, matches)
  collectVotesFinished(state, draft, event, matches)
  canonicalTriggersForOccurrence(state, draft, event, matches)
  return matches
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

    const ordered = apnapOrder(draft, ordinary)
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
    }) => {
      const occurrence = capturedOccurrence(
        state,
        draft,
        event,
        triggeringObjectId,
        matchedPlayer ?? triggeringPlayer,
        triggerAmount,
      )
      const execution = triggerExecution(source, occurrence, draft)
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

const placeCanonicalTrigger = (draft: Draft, trigger: CapturedPendingTrigger) => {
  const canonical = trigger.canonical
  if (!canonical) return true
  const source = draft.object(trigger.execution.source.ref.objectId) ?? trigger.source
  const definition = loadDefinitionSnapshot(canonical.definitionSnapshot).definition
  const ability = definition.abilities[canonical.abilityIndex]
  if (!ability || ability.kind !== 'triggered') return true
  const place = (targets: TargetRef[]) => {
    const targetBindings = canonicalTargetBindings(
      draft,
      source,
      definition,
      canonical.abilityIndex,
      targets,
      undefined,
      ability.decisions.targets.length === 0 ? [] : [targets],
      trigger.execution.controller,
    )
    draft.addToStack({
      kind: 'ability', objectId: source.id, controller: trigger.execution.controller,
      name: source.name, targets,
      execution: {
        ...trigger.execution,
        definitionSnapshot: canonical.definitionSnapshot,
        abilityIndex: canonical.abilityIndex,
        targetBindings,
      },
    })
  }
  if (ability.decisions.targets.length === 0) {
    place([])
    return true
  }
  // Target-clause grouping is introduced by the later target-offer slice. Keep
  // the trigger pending when that contract is not representable by this picker.
  if (ability.decisions.targets.length !== 1) return true
  const clause = ability.decisions.targets[0]
  const candidates = canonicalTargetCandidates(
    draft,
    source,
    ability,
    trigger.execution.controller,
    trigger.execution.occurrence,
  )[0] ?? []
  const bounds = evaluateTargetBounds(clause, {
    ...amountEvaluationContext({
      state: draft,
      controller: trigger.execution.controller,
      source: trigger.execution.source,
      occurrence: trigger.execution.occurrence,
    }),
  })
  if (candidates.length < bounds.min) return true
  if (bounds.max === 0 || candidates.length === 0) {
    place([])
    return true
  }
  if (candidates.every((candidate) => candidate.kind === 'player')) {
    openPlayerSelection(draft, {
      seat: trigger.execution.controller,
      sourceId: source.id,
      source: source.name,
      prompt: bounds.max === 1 ? `Choose target player for ${source.name}.` : `Choose up to ${bounds.max} target players for ${source.name}.`,
      min: bounds.min,
      max: Math.min(bounds.max, candidates.length),
      candidates: candidates.map((candidate) => candidate.player),
      action: {
        kind: 'putCanonicalTriggeredAbility',
        definitionSnapshot: canonical.definitionSnapshot,
        abilityIndex: canonical.abilityIndex,
        execution: trigger.execution,
        sourceId: source.id,
      },
    })
    return false
  }
  if (candidates.some((candidate) => candidate.kind !== 'object')) return true
  const objects = candidates as Array<Extract<TargetRef, { kind: 'object' }>>
  const max = Math.min(bounds.max, objects.length)
  openCardSelection(draft, {
    seat: trigger.execution.controller,
    kind: 'choose', count: max, min: bounds.min,
    candidates: objects.map((candidate) => candidate.objectId),
    targetIdentities: Object.fromEntries(objects.map((candidate) => [
      candidate.objectId,
      objectIdentity(draft.objects[candidate.objectId]),
    ])),
    sourceId: source.id, source: source.name,
    prompt: max === 1 ? `Choose target for ${source.name}.` : `Choose up to ${max} targets for ${source.name}.`,
    destinations: targetDestinations(objects.length, bounds.min),
    canonicalTrigger: {
        definitionSnapshot: canonical.definitionSnapshot,
        abilityIndex: canonical.abilityIndex,
      execution: trigger.execution,
      sourceId: source.id,
    },
  })
  return false
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
    // Existing effect triggers have historically been emitted in the stable
    // event order.  The typed ordering request is needed for canonical DSL
    // abilities, whose placement is now governed by CR 603.3b.
    if (orderIds.length > 1 && group.triggers.some((trigger) => Boolean(trigger.canonical))) {
      draft.triggerPlacement = { version: 1, pass: frame.pass, controller: group.seat, orderIds }
      openCardSelection(draft, {
        seat: group.seat, kind: 'choose', count: orderIds.length, min: orderIds.length,
        candidates: orderIds, triggerOrder: { ids: orderIds, pass: frame.pass },
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
  if (trigger.canonical) return !placeCanonicalTrigger(draft, trigger)
  // Legacy triggers retain their existing target semantics, but a missing
  // mandatory candidate removes the trigger instead of lowering its minimum.
  const source = draft.object(trigger.execution.source.ref.objectId) ?? trigger.source
  const { effect, instructions, execution } = trigger
  if (effect.targets && effect.targets !== 'opponent' && effect.targets !== 'player') {
    const targetSpec = effect.targets
    const candidates = Object.values(draft.objects)
      .filter((object) => validTarget(draft, object, targetSpec.filter, source.controller, undefined, source.id))
      .map((object) => object.id)
    const required = targetSpec.min ?? 1
    if (candidates.length < required) return false
    const maxTargets = Math.min(effect.targets.max ?? 1, candidates.length)
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
