/**
 * CR 603.1 — triggered abilities are put on the stack when their trigger event occurs.
 * CR 603.2 — a trigger watches for a game event matching its `on` binding.
 * CR 603.3b — APNAP: active player first, then turn order; within a player, ETB order.
 */
import { effectsOf } from '../cardPlugins/cardRules'
import { syncGrantControlledSubtypeTriggers } from '../cardPlugins/grantControlledSubtypeTrigger'
import { enteringObjectId } from '../cardPlugins/entersTapped'
import {
  conditionHolds,
  extraTriggerCount,
  runInstructions,
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
  TargetRef,
  TriggerBindingIf,
} from '../types'
import { asRoomDoor } from '../plugins/rooms'
import {
  markTriggeredOnceEachTurn,
  mayTriggerOnceEachTurn,
  triggerEffectKey,
} from '../cardPlugins/triggerFrequency'
import { cardsDrawnThisTurn } from './draw'

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
  source: GameObject
  effect: PendingTriggerEffect
  triggerEffectKey?: string
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
  if (condition.fromSpell && event.type !== 'resolveTop') return false
  if (condition.duringActiveTurn) {
    if (!('seat' in event) || typeof event.seat !== 'string' || event.seat !== state.active) {
      return false
    }
  }
  if (condition.opponentControlsSameName) {
    if (!('seat' in event) || typeof event.seat !== 'string' || event.seat === source.controller) {
      return false
    }
    const named = Object.values(state.objects).some((candidate) =>
      candidate.zone === 'battlefield'
      && candidate.controller === event.seat
      && candidate.name === source.name)
    if (!named) return false
  }
  if (!('seat' in event) || typeof event.seat !== 'string') return true
  if (condition.seat === 'opponent' && event.seat === source.controller) return false
  if (condition.seat === 'controller' && event.seat !== source.controller) return false
  if (typeof condition.cardsDrawnThisTurn === 'number') {
    const drawer = state.players[event.seat]
    if (!drawer || cardsDrawnThisTurn(drawer) !== condition.cardsDrawnThisTurn) return false
  }
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
  effect: Pick<TriggerEffect, 'if'>,
  key?: string,
  extras: Record<string, unknown> = {},
) => ({
  ...(key ? { triggerEffectKey: key } : {}),
  ...(effect.if && !isTriggerBindingIf(effect.if) ? { interveningIf: effect.if } : {}),
  ...extras,
})

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
  event?: GameEvent,
) => {
  if (source.phasedOut) return
  const catalog = effectsOf(source)
  for (const effect of triggerEffects(catalog, on)) {
    if (effect.if && isTriggerBindingIf(effect.if)) {
      if (!event || !triggerIfPasses(state, source, event, effect.if)) continue
    } else if (effect.if && !conditionHolds(effect.if, state, source)) continue
    if (!passesOnceEachTurn(source, effect, catalog, state.turn)) continue
    const stackCopies = effect.onceEachTurn ? 1 : copies
    pushCopies(matches, source, effect, stackCopies, {
      ...meta,
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
  syncGrantControlledSubtypeTriggers(draft)
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
    {},
    event,
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
    collectEffects(attacker, 'attacks', state, matches, 1, {}, event)
  }
}

const defendingPlayer = (state: GameState, target: TargetRef | PlayerId) => {
  if (typeof target === 'string') return target
  return target.kind === 'player'
    ? target.player
    : state.objects[target.objectId]?.controller
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

const STEP_TRIGGERS = ['upkeep', 'precombatMain', 'end'] as const

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

    const catalog = effectsOf(live)
    for (const effect of catalog) {
      if (effect.op !== 'trigger' || effect.on !== event.type) continue
      if (!EVENT_TRIGGER_ON.has(effect.on)) continue
      if (!triggerIfPasses(draft, live, event, effect.if)) continue
      if (!passesOnceEachTurn(live, effect, catalog, draft.turn)) continue
      pushCopies(matches, live, effect, 1, {
        triggerEffectKey: triggerEffectKey(catalog, effect),
        triggeringPlayer: 'seat' in event && typeof event.seat === 'string' ? event.seat : undefined,
        triggerAmount: event.type === 'gainLife' ? event.amount : undefined,
      })
    }
  }
}

const delayedTriggerMatches = (
  trigger: GameState['delayedTriggers'][number],
  draft: Draft,
  event: GameEvent,
) => {
  if (trigger.condition.kind === 'event') return event.type === trigger.condition.type
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
  collectBecomesMonstrous(state, event, matches)
  collectAttacks(state, event, matches)
  collectPlayerAttacks(state, draft, event, matches)
  collectTapped(state, event, matches)
  for (const on of STEP_TRIGGERS) collectStep(on, state, draft, event, matches)
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
      triggerEffectKey: effectKey,
      triggeringObjectId,
      triggeringPlayer: matchedPlayer,
      triggerAmount,
      payload,
    } of ordered) {
      if (effect.targets && effect.targets !== 'opponent' && effect.targets !== 'player') {
        const targetSpec = effect.targets
        const candidates = Object.values(draft.objects)
          .filter((object) =>
            validTarget(
              draft,
              object,
              targetSpec.filter,
              source.controller,
              undefined,
              source.id,
            ))
          .map((object) => object.id)
        if (candidates.length === 0 && targetSpec.min !== 0) continue
        openCardSelection(draft, {
          seat: source.controller,
          kind: 'choose',
          count: 1,
          min: targetSpec.min ?? 1,
          candidates,
          sourceId: source.id,
          source: source.name,
          prompt: `Choose target for ${source.name}.`,
          destinations: ['target'],
          triggerInstructions: effect.do,
          triggerPayload: triggerPayloadExtras(effect, effectKey, {
            targetFilter: targetSpec.filter,
            triggeringPlayer: matchedPlayer ?? triggeringPlayer ?? source.controller,
            ...(triggeringObjectId ? { triggeringObjectId } : {}),
            ...(triggerAmount !== undefined ? { triggerAmount } : {}),
            ...payload,
          }),
        })
        noteOnceEachTurnIfNeeded(draft, source, effect, effectKey)
        choosingSeat ??= source.controller
        continue
      }
      if (effect.targets === 'opponent' || effect.targets === 'player') {
        const candidates = draft.playerOrder.filter(
          (seat) =>
            !draft.players[seat].lost
            && (effect.targets !== 'opponent' || seat !== source.controller),
        )
        if (candidates.length === 0) continue
        openPlayerSelection(draft, {
          seat: source.controller,
          sourceId: source.id,
          source: source.name,
          prompt: effect.targets === 'player'
            ? `Choose target player for ${source.name}.`
            : `Choose target opponent for ${source.name}.`,
          min: 1,
          max: 1,
          candidates,
          action: {
            kind: 'putTriggeredAbility',
            instructions: effect.do,
            triggeringPlayer: matchedPlayer ?? triggeringPlayer ?? source.controller,
            ...(effectKey ? { triggerEffectKey: effectKey } : {}),
            ...(effect.if && !isTriggerBindingIf(effect.if)
              ? { interveningIf: effect.if }
              : {}),
          },
        })
        noteOnceEachTurnIfNeeded(draft, source, effect, effectKey)
        choosingSeat ??= source.controller
        continue
      }
      if (effect.do.length === 1 && effect.do[0].kind === 'devour') {
        runInstructions(draft, source, effect.do, {
          id: 'devour-enter',
          kind: 'ability',
          objectId: source.id,
          controller: source.controller,
          name: source.name,
          targets: [],
        })
        choosingSeat ??= source.controller
        continue
      }
      draft.addTriggeredAbility(source, effect.do, {
        payload: {
          instructions: effect.do,
          triggeringPlayer: matchedPlayer ?? triggeringPlayer ?? source.controller,
          ...triggerPayloadExtras(effect, effectKey, {
            ...(triggeringObjectId ? { triggeringObjectId } : {}),
            ...(triggerAmount !== undefined ? { triggerAmount } : {}),
            ...payload,
          }),
        },
        name: `${source.name}`,
      })
      noteOnceEachTurnIfNeeded(draft, source, effect, effectKey)
    }

    draft.passedInRow = []
    draft.priority = choosingSeat ?? draft.active
  },
}
