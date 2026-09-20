/**
 * CR 603.1 — triggered abilities are put on the stack when their trigger event occurs.
 * CR 603.2 — a trigger watches for a game event matching its `on` binding.
 * CR 603.3b — APNAP: active player first, then turn order; within a player, ETB order.
 */
import { effectsOf } from '../cardPlugins/cardRules'
import { enteringObjectId } from '../cardPlugins/entersTapped'
import {
  conditionHolds,
  extraTriggerCount,
  triggerEffects,
  type CardCondition,
  type CardEffect,
} from '../cardPlugins/effects'
import { gameObjectFieldDefaults } from '../definitions'
import type Draft from '../draft'
import { validTarget } from '../cardPlugins/targetedResolve'
import { openCardSelection } from './selectCards'
import { openPlayerSelection } from './selectPlayers'
import { apnapSeats } from '../turnOrder'
import type {
  GameEvent,
  GameObject,
  GameState,
  PlayerId,
  Plugin,
  TriggerBindingIf,
} from '../types'
import { asRoomDoor } from '../plugins/rooms'

const EVENT_TRIGGER_ON = new Set(['discard', 'draw', 'playLand'])

/**
 * CR 603.2 — "for the first time each turn" is part of the trigger event, so it
 * reads the turn's game history for that player rather than what any one source
 * has already done. A source entering later in the turn has still missed it.
 */
const LAND_TO_GRAVEYARD_TURN = 'triggers.firstTimeEachTurn.landToGraveyard'

type TriggerEffect = Extract<CardEffect, { op: 'trigger' }>
type PendingTriggerEffect = Pick<TriggerEffect, 'do' | 'if' | 'targets'>

type PendingTrigger = {
  source: GameObject
  effect: PendingTriggerEffect
  triggeringObjectId?: string
  triggeringPlayer?: PlayerId
  triggerAmount?: number
  payload?: Record<string, unknown>
}

const isTriggerBindingIf = (
  condition: CardCondition | TriggerBindingIf,
): condition is TriggerBindingIf =>
  !('kind' in condition)

const triggerIfPasses = (
  state: GameState,
  source: GameObject,
  event: GameEvent,
  condition?: CardCondition | TriggerBindingIf,
) => {
  if (!condition) return true
  if (!isTriggerBindingIf(condition)) {
    return conditionHolds(condition, state, source)
  }
  if (!('seat' in event) || typeof event.seat !== 'string') return true
  if (condition.seat === 'opponent') return event.seat !== source.controller
  if (condition.seat === 'controller') return event.seat === source.controller
  return true
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
    'triggeringObjectId' | 'triggeringPlayer' | 'triggerAmount' | 'payload'
  > = {},
) => {
  for (let index = 0; index < copies; index += 1) {
    matches.push({ source, effect, ...meta })
  }
}

const collectEffects = (
  source: GameObject,
  on: TriggerEffect['on'],
  state: GameState,
  matches: PendingTrigger[],
  copies = 1,
  meta: Pick<
    PendingTrigger,
    'triggeringObjectId' | 'triggeringPlayer' | 'triggerAmount'
  > = {},
) => {
  for (const effect of triggerEffects(effectsOf(source), on)) {
    if (
      effect.if
      && !isTriggerBindingIf(effect.if)
      && !conditionHolds(effect.if, state, source)
    ) continue
    pushCopies(matches, source, effect, copies, meta)
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
    1 + extraTriggerCount(draft, object.controller, 'enters', object),
  )
}

const collectAttacks = (
  state: GameState,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (event.type !== 'declareAttackers') return
  for (const declaration of event.attackers) {
    const attacker = state.objects[declaration.objectId]
    if (!attacker) continue
    collectEffects(attacker, 'attacks', state, matches)
  }
}

const collectStep = (
  on: 'upkeep' | 'end',
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
      for (const effect of triggerEffects(effectsOf(source), 'landToGraveyard')) {
        if (
          effect.if
          && !isTriggerBindingIf(effect.if)
          && !conditionHolds(effect.if, state, source)
        ) continue
        const milledLand = effect.do.some((instruction) => instruction.kind === 'putMilledLandTapped')
        if (milledLand && !fromLibrary) continue
        if (effect.firstTimeEachTurn && !firstThisTurn) continue
        pushCopies(matches, source, effect, 1, { triggeringObjectId: event.objectId })
      }
    }
  }

  if (before.zone === 'battlefield' && event.to !== 'battlefield') {
    collectEffects(before, 'leaves', state, matches)
  }

  if (event.to === 'graveyard' && before.types.includes('Creature')) {
    collectEffects(before, 'dies', state, matches)
  }
}

const collectDiscardDraw = (
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  if (!EVENT_TRIGGER_ON.has(event.type)) return

  for (const source of draft.zoneOf('battlefield')) {
    const live = draft.object(source.id)
    if (!live || live.zone !== 'battlefield') continue

    for (const effect of effectsOf(live)) {
      if (effect.op !== 'trigger' || effect.on !== event.type) continue
      if (!EVENT_TRIGGER_ON.has(effect.on)) continue
      if (!triggerIfPasses(draft, live, event, effect.if)) continue
      pushCopies(matches, live, effect, 1)
    }
  }
}

const delayedTriggerMatches = (
  trigger: GameState['delayedTriggers'][number],
  draft: Draft,
  event: GameEvent,
) => {
  if (trigger.condition.kind === 'event') return event.type === trigger.condition.type
  return (
    event.type === 'custom'
    && event.name === 'advanceStep'
    && draft.step === trigger.condition.step
    && (
      trigger.condition.active === undefined
      || trigger.condition.active === draft.active
    )
  )
}

const collectDelayedTriggers = (
  draft: Draft,
  event: GameEvent,
  matches: PendingTrigger[],
) => {
  const remaining: GameState['delayedTriggers'] = []
  for (const delayed of draft.delayedTriggers) {
    if (!delayedTriggerMatches(delayed, draft, event)) {
      remaining.push(delayed)
      continue
    }
    if (delayed.recurring) remaining.push(delayed)
    const source: GameObject = {
      ...gameObjectFieldDefaults(),
      id: delayed.sourceId,
      name: delayed.sourceName,
      owner: delayed.controller,
      controller: delayed.controller,
      zone: 'graveyard',
    }
    pushCopies(matches, source, { do: delayed.instructions }, 1, {
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
  collectAttacks(state, event, matches)
  collectStep('upkeep', state, draft, event, matches)
  collectStep('end', state, draft, event, matches)
  collectCombatDamage(state, draft, event, matches)
  collectMoveTriggers(state, draft, event, matches)
  collectDiscardDraw(draft, event, matches)
  collectDelayedTriggers(draft, event, matches)
  collectRoomUnlock(state, draft, event, matches)
  return matches
}

export const triggers: Plugin = {
  id: 'triggers',
  apply: ({ state, event, draft }) => {
    const matches = collectEventTriggers(state, draft, event)
    if (matches.length === 0) return

    const ordered = apnapOrder(draft, matches)
    const triggeringPlayer = 'seat' in event && typeof event.seat === 'string'
      ? event.seat
      : undefined
    let choosingSeat: PlayerId | undefined

    for (const {
      source,
      effect,
      triggeringObjectId,
      triggeringPlayer: matchedPlayer,
      triggerAmount,
      payload,
    } of ordered) {
      if (effect.targets && effect.targets !== 'opponent') {
        const targetSpec = effect.targets
        const candidates = Object.values(draft.objects)
          .filter((object) =>
            validTarget(
              draft,
              object,
              targetSpec.filter,
              source.controller,
            ))
          .map((object) => object.id)
        if (candidates.length === 0) continue
        openCardSelection(draft, {
          seat: source.controller,
          kind: 'choose',
          count: 1,
          min: targetSpec.optional ? 0 : 1,
          candidates,
          sourceId: source.id,
          source: source.name,
          prompt: `Choose target for ${source.name}.`,
          destinations: ['target'],
          triggerInstructions: effect.do,
          triggerPayload: {
            targetFilter: targetSpec.filter,
            triggeringPlayer: matchedPlayer ?? triggeringPlayer ?? source.controller,
            ...(effect.if && !isTriggerBindingIf(effect.if)
              ? { interveningIf: effect.if }
              : {}),
            ...(triggeringObjectId ? { triggeringObjectId } : {}),
            ...(triggerAmount !== undefined ? { triggerAmount } : {}),
            ...payload,
          },
        })
        choosingSeat ??= source.controller
        continue
      }
      if (effect.targets === 'opponent') {
        const candidates = draft.playerOrder.filter(
          (seat) => seat !== source.controller && !draft.players[seat].lost,
        )
        if (candidates.length === 0) continue
        openPlayerSelection(draft, {
          seat: source.controller,
          sourceId: source.id,
          source: source.name,
          prompt: `Choose target opponent for ${source.name}.`,
          min: 1,
          max: 1,
          candidates,
          action: {
            kind: 'putTriggeredAbility',
            instructions: effect.do,
            triggeringPlayer: matchedPlayer ?? triggeringPlayer ?? source.controller,
            ...(effect.if && !isTriggerBindingIf(effect.if)
              ? { interveningIf: effect.if }
              : {}),
          },
        })
        choosingSeat ??= source.controller
        continue
      }
      draft.addTriggeredAbility(source, effect.do, {
        payload: {
          instructions: effect.do,
          triggeringPlayer: matchedPlayer ?? triggeringPlayer ?? source.controller,
          ...(effect.if && !isTriggerBindingIf(effect.if)
            ? { interveningIf: effect.if }
            : {}),
          ...(triggeringObjectId ? { triggeringObjectId } : {}),
          ...(triggerAmount !== undefined ? { triggerAmount } : {}),
          ...payload,
        },
        name: `${source.name}`,
      })
    }

    draft.passedInRow = []
    draft.priority = choosingSeat ?? draft.active
  },
}
