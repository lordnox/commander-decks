import type { CardEffect } from './effectDefinitions'

type TriggerEffect = Extract<CardEffect, { op: 'trigger' }>

export type TriggerFrequencySlot = {
  /** Turn this ability last triggered (stacked), for `onceEachTurn`. */
  triggeredTurn?: number
  /** Turn we are counting resolutions on, for `whenResolvedNth`. */
  resolveCountTurn?: number
  /** Resolutions of this ability on `resolveCountTurn`. */
  resolveCount?: number
}

export type TriggerFrequencyState = Record<string, TriggerFrequencySlot>

const slot = (object: { triggerFrequency?: TriggerFrequencyState }, key: string): TriggerFrequencySlot => {
  if (!object.triggerFrequency) object.triggerFrequency = {}
  const existing = object.triggerFrequency[key]
  if (existing) return existing
  const created: TriggerFrequencySlot = {}
  object.triggerFrequency[key] = created
  return created
}

/** Stable per-source key for one trigger effect among same-`on` siblings. */
export const triggerEffectKey = (effects: CardEffect[], effect: TriggerEffect): string => {
  let index = 0
  for (const entry of effects) {
    if (entry.op !== 'trigger' || entry.on !== effect.on) continue
    if (entry === effect) return `${effect.on}@${index}`
    index += 1
  }
  return `${effect.on}@0`
}

const parseTriggerEffectKey = (key: string) => {
  const at = key.lastIndexOf('@')
  return { on: key.slice(0, at) as TriggerEffect['on'], index: Number(key.slice(at + 1)) }
}

export const triggerEffectByKey = (
  effects: CardEffect[],
  key: string,
): TriggerEffect | undefined => {
  const { on, index } = parseTriggerEffectKey(key)
  let seen = 0
  for (const entry of effects) {
    if (entry.op !== 'trigger' || entry.on !== on) continue
    if (seen === index) return entry
    seen += 1
  }
  return undefined
}

export const mayTriggerOnceEachTurn = (
  object: { triggerFrequency?: TriggerFrequencyState },
  key: string,
  turn: number,
) => slot(object, key).triggeredTurn !== turn

export const markTriggeredOnceEachTurn = (
  object: { triggerFrequency?: TriggerFrequencyState },
  key: string,
  turn: number,
) => {
  slot(object, key).triggeredTurn = turn
}

/** Increments and returns how many times this ability has resolved this turn on this object. */
export const bumpResolveCountThisTurn = (
  object: { triggerFrequency?: TriggerFrequencyState },
  key: string,
  turn: number,
) => {
  const entry = slot(object, key)
  if (entry.resolveCountTurn !== turn) {
    entry.resolveCountTurn = turn
    entry.resolveCount = 0
  }
  entry.resolveCount = (entry.resolveCount ?? 0) + 1
  return entry.resolveCount
}
