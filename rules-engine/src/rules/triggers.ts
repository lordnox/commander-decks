/**
 * CR 603.1 — triggered abilities are put on the stack when their trigger event occurs.
 * CR 603.2 — a trigger watches for a game event matching its `on` binding.
 * CR 603.3b — APNAP: active player first, then turn order; within a player, ETB order.
 */
import { effectsOf } from '../cardPlugins/cardRules'
import { conditionHolds, type CardCondition, type CardEffect } from '../cardPlugins/effects'
import type Draft from '../draft'
import type { GameEvent, GameObject, PlayerId, Plugin, TriggerBindingIf } from '../types'

const EVENT_TRIGGER_ON = new Set(['discard', 'draw'])

const isTriggerBindingIf = (
  condition: CardCondition | TriggerBindingIf,
): condition is TriggerBindingIf =>
  !('kind' in condition)

const triggerIfPasses = (
  draft: Draft,
  source: GameObject,
  event: GameEvent,
  condition?: CardCondition | TriggerBindingIf,
) => {
  if (!condition) return true
  if (!isTriggerBindingIf(condition)) {
    return conditionHolds(condition, draft, source)
  }
  if (!('seat' in event) || typeof event.seat !== 'string') return true
  if (condition.seat === 'opponent') return event.seat !== source.controller
  if (condition.seat === 'controller') return event.seat === source.controller
  return true
}

type PendingTrigger = {
  source: GameObject
  effect: Extract<CardEffect, { op: 'trigger' }>
}

const battlefieldIndex = (draft: Draft, objectId: string, controller: PlayerId) => {
  const order = draft.zoneOrder[controller]?.battlefield ?? []
  const index = order.indexOf(objectId)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

/** CR 603.3b — active player, then turn order; same-player ties by battlefield ETB index. */
const apnapOrder = (draft: Draft, matches: PendingTrigger[]): PendingTrigger[] => {
  const living = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
  const startIdx = living.indexOf(draft.active)
  const playerOrder = startIdx === -1
    ? living
    : [...living.slice(startIdx), ...living.slice(0, startIdx)]

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

const collectEventTriggers = (draft: Draft, event: GameEvent): PendingTrigger[] => {
  if (!EVENT_TRIGGER_ON.has(event.type)) return []

  const matches: PendingTrigger[] = []
  for (const source of draft.zoneOf('battlefield')) {
    const live = draft.object(source.id)
    if (!live || live.zone !== 'battlefield') continue

    for (const effect of effectsOf(live)) {
      if (effect.op !== 'trigger' || effect.on !== event.type) continue
      if (!EVENT_TRIGGER_ON.has(effect.on)) continue
      if (!triggerIfPasses(draft, live, event, effect.if)) continue
      matches.push({ source: live, effect })
    }
  }
  return matches
}

export const triggers: Plugin = {
  id: 'triggers',
  apply: ({ event, draft }) => {
    const matches = collectEventTriggers(draft, event)
    if (matches.length === 0) return

    const ordered = apnapOrder(draft, matches)
    const triggeringPlayer = 'seat' in event && typeof event.seat === 'string'
      ? event.seat
      : undefined

    for (const { source, effect } of ordered) {
      draft.addTriggeredAbility(source, effect.do, {
        payload: {
          instructions: effect.do,
          triggeringPlayer: triggeringPlayer ?? source.controller,
        },
        name: `${source.name}`,
      })
    }

    draft.passedInRow = []
    draft.priority = draft.active
  },
}
