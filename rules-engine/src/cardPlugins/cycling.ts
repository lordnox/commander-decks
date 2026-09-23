import type Draft from '../draft'
import type { Plugin, StackItem } from '../types'
import { effectsOf } from './cardRules'
import { activateEffect, type CardEffect } from './effects'

export const isCyclingAbility = (effects: CardEffect[], abilityId: string) =>
  Boolean(activateEffect(effects, abilityId)?.cycling)

/** CR 702.89 — "when you cycle" triggers use the cycle event at ability resolution. */
export const emitCyclingResolved = (draft: Draft, item: StackItem) => {
  if (!item.abilityId) return
  const live = draft.object(item.objectId)
  if (!live || !isCyclingAbility(effectsOf(live), item.abilityId)) return
  draft.enqueue({
    type: 'cycle',
    seat: item.controller,
    objectId: item.objectId,
  })
}

export const cycling: Plugin = {
  id: 'cycling',
}
