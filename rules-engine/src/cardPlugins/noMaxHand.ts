import type { Plugin } from '../types'
import { effectsOf } from './cardRules'
import { enteringObjectId } from './entersTapped'

const refresh = (draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft']) => {
  const granted = new Set(
    Object.values(draft.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && effectsOf(object).some((effect) => effect.op === 'static' && effect.pluginId === 'noMaxHand'))
      .map((object) => object.controller),
  )
  for (const seat of draft.playerOrder) {
    if (granted.has(seat)) draft.players[seat].data.maximumHandSize = null
    else if (draft.players[seat].data.maximumHandSize === null) {
      delete draft.players[seat].data.maximumHandSize
    }
  }
}

export const noMaxHand: Plugin = {
  id: 'noMaxHand',
  apply: ({ state, event, draft }) => {
    if (enteringObjectId(event, state) || event.type === 'move') refresh(draft)
  },
}
