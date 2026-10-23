import type { Plugin, StackItem } from '../types'
import { loadDefinitionSnapshot } from './dsl/compiler'
import { activateEffect, type CardEffect } from './effects'

export const isCyclingAbility = (effects: CardEffect[], abilityId: string) =>
  Boolean(activateEffect(effects, abilityId)?.cycling)

/** CR 702.29c/f — emitted once payment commits, before the cycling ability resolves. */
export const canonicalCyclingEvent = (item: Pick<StackItem, 'execution' | 'controller' | 'objectId'>) => {
  const snapshot = item.execution?.definitionSnapshot
  const index = item.execution?.abilityIndex
  if (!snapshot || typeof index !== 'number') return
  const ability = loadDefinitionSnapshot(snapshot).definition.abilities[index]
  if (ability?.kind !== 'activated' || ability.cycling !== true) return
  return { type: 'cycle' as const, seat: item.controller, objectId: item.objectId }
}

export const cycling: Plugin = {
  id: 'cycling',
}
