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
import type Draft from '../draft'
import { apnapSeats } from '../turnOrder'
import type { GameEvent, GameObject, GameState, PlayerId, Plugin, TriggerBindingIf } from '../types'

const EVENT_TRIGGER_ON = new Set(['discard', 'draw', 'playLand'])

type TriggerEffect = Extract<CardEffect, { op: 'trigger' }>

type PendingTrigger = {
  source: GameObject
  effect: TriggerEffect
  triggeringObjectId?: string
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
  effect: TriggerEffect,
  copies: number,
  meta: Pick<PendingTrigger, 'triggeringObjectId'> = {},
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
) => {
  for (const effect of triggerEffects(effectsOf(source), on)) {
    if (
      effect.if
      && !isTriggerBindingIf(effect.if)
      && !conditionHolds(effect.if, state, source)
    ) continue
    pushCopies(matches, source, effect, copies)
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
  if (event.type !== 'combatDamage' || event.target.kind !== 'player') return
  const source = draft.object(event.sourceId) ?? state.objects[event.sourceId]
  if (!source || source.zone !== 'battlefield') return
  collectEffects(source, 'combatDamage', state, matches)
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
    for (const source of draft.zoneOf('battlefield', before.owner)) {
      for (const effect of triggerEffects(effectsOf(source), 'landToGraveyard')) {
        if (
          effect.if
          && !isTriggerBindingIf(effect.if)
          && !conditionHolds(effect.if, state, source)
        ) continue
        const milledLand = effect.do.some((instruction) => instruction.kind === 'putMilledLandTapped')
        if (milledLand && !fromLibrary) continue
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

    for (const { source, effect, triggeringObjectId } of ordered) {
      draft.addTriggeredAbility(source, effect.do, {
        payload: {
          instructions: effect.do,
          triggeringPlayer: triggeringPlayer ?? source.controller,
          ...(effect.if && !isTriggerBindingIf(effect.if)
            ? { interveningIf: effect.if }
            : {}),
          ...(triggeringObjectId ? { triggeringObjectId } : {}),
        },
        name: `${source.name}`,
      })
    }

    draft.passedInRow = []
    draft.priority = draft.active
  },
}
