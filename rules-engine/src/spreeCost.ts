import type { GameObject } from './types'
import type { SpreeMode } from './cardPlugins/effectDefinitions'
import { effectsOf } from './cardPlugins/cardRules'

export const spreeModesOf = (object: GameObject): SpreeMode[] | undefined =>
  effectsOf(object).flatMap((effect) =>
    effect.op === 'castCost' && effect.spree ? [effect.spree] : [])[0]

export const spreeExtraCost = (modes: SpreeMode[], selected: string[]) =>
  selected.flatMap((id) => {
    const mode = modes.find((entry) => entry.id === id)
    return mode ? [mode.extraCost] : []
  }).join('')

export const spreeSubsetActions = (modes: SpreeMode[]) => {
  const ids = modes.map((mode) => mode.id)
  const subsets: string[][] = []
  const total = 1 << ids.length
  for (let mask = 1; mask < total; mask += 1) {
    subsets.push(ids.filter((_, index) => (mask >> index) & 1))
  }
  return subsets
}
