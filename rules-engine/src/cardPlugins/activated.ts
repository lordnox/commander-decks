import { payCost } from '../plugins/spells'
import type Draft from '../draft'
import type { GameObject, PlayerId } from '../types'
import type { Plugin } from '../types'
import {
  activateEffect,
  conditionHolds,
  millLibrary,
  runInstructions,
  type ActivateCost,
} from './effects'
import { effectsOf } from './cardRules'

export const SKULL_PROPHET_MILL = 'selfMill.skullProphet'
export const MILLIKIN_MANA = 'selfMill.millikin'
export const GHOST_TOWN_RETURN = 'selfBounceLand.ghostTown'
export const OBORO_RETURN = 'selfBounceLand.oboro'
export const AFTERMATH_RECLAIM = 'graveyardLands.aftermath'
export const YURLOK_MANA_RAIN = 'yurlok.mana-rain'

export const payActivateCosts = (
  draft: Draft,
  source: GameObject,
  seat: PlayerId,
  costs: ActivateCost,
) => {
  if (costs.mana) draft.enqueue({ type: 'payMana', seat, cost: costs.mana })
  if (costs.life) {
    draft.enqueue({
      type: 'loseLife',
      seat,
      amount: costs.life,
      source: source.name,
    })
  }
  if (costs.tap) draft.enqueue({ type: 'tap', objectId: source.id })
  if (costs.mill) millLibrary(draft, seat, costs.mill)
  if (costs.sacrifice) {
    draft.enqueue({ type: 'move', objectId: source.id, to: 'graveyard' })
  }
  if (costs.discard) {
    draft.enqueue({ type: 'move', objectId: source.id, to: 'graveyard' })
  }
}

export const activated: Plugin = {
  id: 'activated',
  legal: ({ state, event }) => {
    if (event.type === 'tapForMana') {
      const source = state.objects[event.objectId]
      if (!source) return
      const manaEffect = effectsOf(source).find((effect) => effect.op === 'mana')
      if (manaEffect && !conditionHolds(manaEffect.if, state, source)) {
        return `${source.name} cannot be activated now`
      }
      const millMana = effectsOf(source).find((effect): effect is Extract<typeof effect, { op: 'activate' }> =>
        effect.op === 'activate' && Boolean(effect.manaAbility))
      if (millMana) {
        if ((millMana.costs.mill ?? 0) > 0) {
          return `${source.name} mana must mill a card as an activation cost`
        }
        return `${source.name} mana must use its printed mana ability`
      }
      return
    }
    if (event.type !== 'activateAbility') return
    const source = state.objects[event.objectId]
    if (!source) return 'no such object'
    const effect = activateEffect(effectsOf(source), event.abilityId)
    if (!effect) return
    if (effect.costs.loyalty !== undefined || effect.costs.loyaltyX) return
    const requiredZone = effect.zone ?? 'battlefield'
    if (source.zone !== requiredZone) return `${source.name} is not in ${requiredZone}`
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
    if (effect.costs.loyalty !== undefined || effect.costs.loyaltyX) return
    payActivateCosts(draft, source, event.seat, effect.costs)
    runInstructions(draft, source, effect.do)
    draft.note(`${event.seat} activates ${source.name}`)
  },
}
