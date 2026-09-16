import { payCost } from '../plugins/spells'
import type { Plugin } from '../types'
import {
  activateEffect,
  conditionHolds,
  millLibrary,
  runInstructions,
} from './effects'
import { effectsOf } from './cardRules'

export const SKULL_PROPHET_MILL = 'selfMill.skullProphet'
export const MILLIKIN_MANA = 'selfMill.millikin'
export const GHOST_TOWN_RETURN = 'selfBounceLand.ghostTown'
export const OBORO_RETURN = 'selfBounceLand.oboro'
export const AFTERMATH_RECLAIM = 'graveyardLands.aftermath'
export const YURLOK_MANA_RAIN = 'yurlok.mana-rain'

export const activated: Plugin = {
  id: 'activated',
  legal: ({ state, event }) => {
    if (event.type === 'tapForMana') {
      const source = state.objects[event.objectId]
      if (!source) return
      const millMana = effectsOf(source).find((effect) =>
        effect.op === 'activate'
        && effect.manaAbility
        && (effect.costs.mill ?? 0) > 0)
      if (millMana) {
        return `${source.name} mana must mill a card as an activation cost`
      }
      return
    }
    if (event.type !== 'activateAbility') return
    const source = state.objects[event.objectId]
    if (!source) return 'no such object'
    const effect = activateEffect(effectsOf(source), event.abilityId)
    if (!effect) return
    if (source.zone !== 'battlefield') return `${source.name} is not on the battlefield`
    if (source.controller !== event.seat) {
      return `${event.seat} does not control ${source.name}`
    }
    if (effect.manaAbility && !event.manaAbility) {
      return `${source.name} is a mana ability`
    }
    if (effect.costs.tap) {
      if (source.tapped) return `${source.name} is already tapped`
      if (source.types.includes('Creature') && source.summoningSickness) {
        return `${source.name} has summoning sickness`
      }
    }
    if (effect.costs.mana && !payCost(state.players[event.seat]?.mana, effect.costs.mana)) {
      return `not enough mana to activate ${source.name}`
    }
    if ((effect.costs.life ?? 0) > 0
      && state.players[event.seat].life <= (effect.costs.life ?? 0)) {
      return `${event.seat} cannot pay ${effect.costs.life} life`
    }
    if (!conditionHolds(effect.if, state, source)) {
      if (effect.if?.kind === 'notActivePlayer') {
        return `${source.name} can be returned only when it is not your turn`
      }
      return `${source.name} cannot be activated now`
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'activateAbility') return
    const source = draft.object(event.objectId)
    if (!source) return
    const effect = activateEffect(effectsOf(source), event.abilityId)
    if (!effect) return
    if (effect.costs.mana) {
      draft.enqueue({ type: 'payMana', seat: event.seat, cost: effect.costs.mana })
    }
    if (effect.costs.life) {
      draft.enqueue({
        type: 'loseLife',
        seat: event.seat,
        amount: effect.costs.life,
        source: source.name,
      })
    }
    if (effect.costs.tap) draft.enqueue({ type: 'tap', objectId: source.id })
    if (effect.costs.mill) millLibrary(draft, event.seat, effect.costs.mill)
    if (effect.costs.sacrifice) {
      draft.enqueue({ type: 'move', objectId: source.id, to: 'graveyard' })
    }
    runInstructions(draft, source, effect.do)
    draft.note(`${event.seat} activates ${source.name}`)
  },
}
