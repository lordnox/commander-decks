import type { Plugin } from '../types'
import { effectsOf } from './cardRules'

const paysLifeX = (object: Parameters<typeof effectsOf>[0]) =>
  effectsOf(object).some((effect) => effect.op === 'castCost' && effect.lifeX)

export const castCosts: Plugin = {
  id: 'castCosts',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    if (!object || !paysLifeX(object)) return
    if (!Number.isInteger(event.x) || (event.x ?? -1) < 0) {
      return `${object.name} requires a nonnegative X`
    }
    if ((event.x ?? 0) >= state.players[event.seat].life) {
      return `${event.seat} cannot pay ${event.x ?? 0} life`
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'castSpell') return
    const object = draft.object(event.objectId)
    if (!object || !paysLifeX(object)) return
    draft.players[event.seat].life -= event.x ?? 0
  },
}
