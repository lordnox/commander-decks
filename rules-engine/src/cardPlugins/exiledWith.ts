import type { GameObject, GameState, PlayerId, Plugin } from '../types'
import { effectsOf } from './cardRules'
import { manaValueOf } from './effectRuntime'

export const canPlayExiledWithLife = (
  state: GameState,
  seat: PlayerId,
  card: GameObject,
) => {
  if (card.zone !== 'exile' || !card.exiledWith) return false
  if (state.active !== seat) return false
  const source = state.objects[card.exiledWith]
  if (!source || source.zone !== 'battlefield' || source.controller !== seat) return false
  return effectsOf(source).some((effect) =>
    effect.op === 'static' && effect.playExiledWithLife)
}

export const exiledWith: Plugin = {
  id: 'exiledWith',
  replace: ({ state, event, rule }) => {
    const source = rule.sourceId ? state.objects[rule.sourceId] : undefined
    if (!source || source.zone !== 'battlefield') return
    if (!effectsOf(source).some((effect) =>
      effect.op === 'static' && effect.exileOpponentGraveyard)) return
    if (event.type !== 'move' || event.to !== 'graveyard') return
    const card = state.objects[event.objectId]
    if (!card || card.controller === source.controller) return
    return {
      type: 'move',
      objectId: card.id,
      to: 'exile',
    }
  },
  apply: ({ event, draft, rule }) => {
    if (event.type === 'move' && event.to === 'exile' && rule.sourceId) {
      const card = draft.object(event.objectId)
      const source = draft.object(rule.sourceId)
      if (
        card
        && source
        && source.zone === 'battlefield'
        && card.controller !== source.controller
        && effectsOf(source).some((effect) =>
          effect.op === 'static' && effect.exileOpponentGraveyard)
      ) {
        card.exiledWith = source.id
        source.exiledCards = [...new Set([...(source.exiledCards ?? []), card.id])]
      }
    }
  },
}
