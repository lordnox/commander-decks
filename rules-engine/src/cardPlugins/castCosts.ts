import type { Plugin } from '../types'
import { effectsOf } from './cardRules'

const castCostEffects = (object: Parameters<typeof effectsOf>[0]) =>
  effectsOf(object).filter((effect) => effect.op === 'castCost')

export const castCosts: Plugin = {
  id: 'castCosts',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    if (!object) return
    const effects = castCostEffects(object)
    if (effects.some((effect) => effect.timing === 'yourEndStep')
      && (state.active !== event.seat || state.step !== 'end')) {
      return `${object.name} can be cast only during your end step`
    }
    if (effects.some((effect) => effect.lifeX)) {
      if (!Number.isSafeInteger(event.x) || (event.x ?? -1) < 0) {
        return `${object.name} requires a nonnegative X`
      }
      if ((event.x ?? 0) >= state.players[event.seat].life) {
        return `${event.seat} cannot pay ${event.x ?? 0} life`
      }
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'castSpell') return
    const object = draft.object(event.objectId)
    if (!object || !castCostEffects(object).some((effect) => effect.lifeX)) return
    draft.enqueue({
      type: 'payLife',
      seat: event.seat,
      amount: event.x ?? 0,
      source: object.name,
    })
  },
}
