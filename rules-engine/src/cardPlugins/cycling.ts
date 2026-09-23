import type Draft from '../draft'
import type { GameObject, PlayerId, Plugin, StackItem } from '../types'
import { effectsOf } from './cardRules'
import { activateEffect, type CardEffect } from './effects'

export const isCyclingAbility = (effects: CardEffect[], abilityId: string) =>
  Boolean(activateEffect(effects, abilityId)?.cycling)

export const typecyclingFromHand = (object: GameObject) =>
  effectsOf(object).some((effect) =>
    effect.op === 'activate'
    && effect.cycling
    && effect.do.some((instruction) => instruction.kind === 'searchLibrary'))

export const emitCycleEvent = (draft: Draft, seat: PlayerId, objectId: string) => {
  draft.enqueue({ type: 'cycle', seat, objectId })
}

/** CR 702.89 — after draw-cycling resolution instructions (draw queued first). */
export const emitCyclingResolved = (draft: Draft, item: StackItem) => {
  if (!item.abilityId) return
  const live = draft.object(item.objectId)
  if (!live || !isCyclingAbility(effectsOf(live), item.abilityId)) return
  emitCycleEvent(draft, item.controller, item.objectId)
}

export const cycling: Plugin = {
  id: 'cycling',
}
