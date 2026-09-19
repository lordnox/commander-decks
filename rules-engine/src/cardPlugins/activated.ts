import { payCost } from '../plugins/spells'
import type Draft from '../draft'
import { hasKeyword } from '../keywords'
import { hasUntaxedTapMana } from '../plugins/mana'
import type { GameObject, PlayerId, TargetRef } from '../types'
import type { Plugin } from '../types'
import {
  activateEffect,
  conditionHolds,
  millLibrary,
  runInstructions,
  type ActivateCost,
} from './effects'
import { effectsOf } from './cardRules'

const legalActivateTarget = (
  state: { objects: Record<string, GameObject | undefined>; players: Record<string, { lost?: boolean } | undefined> },
  target: TargetRef | undefined,
  kind: 'creature' | 'land',
) => {
  if (target?.kind !== 'object') return false
  const object = state.objects[target.objectId]
  return Boolean(
    object
    && object.zone === 'battlefield'
    && object.types.includes(kind === 'creature' ? 'Creature' : 'Land'),
  )
}

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
      type: 'payLife',
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
        // Older journals embedded Firdoch's choice as an activate effect.
        // The generic tapForMana event now carries that choice directly.
        if (millMana.do.some((instruction) => instruction.kind === 'addChosenColorMana')) {
          return
        }
        if ((millMana.costs.mill ?? 0) > 0) {
          return `${source.name} mana must mill a card as an activation cost`
        }
        if (hasUntaxedTapMana(source)) return
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
      if (
        source.types.includes('Creature')
        && source.summoningSickness
        && !hasKeyword(source, 'haste', state)
      ) {
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
    if (effect.targets === 'creature' || effect.targets === 'land') {
      const targets = event.targets ?? []
      if (targets.length !== 1 || !legalActivateTarget(state, targets[0], effect.targets)) {
        return `${source.name} needs one ${effect.targets} target`
      }
    }
    if (effect.targets === 'opponent') {
      const targets = event.targets ?? []
      const target = targets[0]
      if (
        targets.length !== 1
        || target?.kind !== 'player'
        || target.player === event.seat
        || !state.players[target.player]
        || state.players[target.player].lost
      ) {
        return `${source.name} needs one opponent target`
      }
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
    if (effect.manaAbility || event.manaAbility) {
      runInstructions(draft, source, effect.do, {
        id: event.objectId,
        kind: 'ability',
        objectId: event.objectId,
        controller: event.seat,
        name: source.name,
        targets: event.targets ?? [],
        abilityId: event.abilityId,
        ...(event.choices ? { choices: event.choices } : {}),
      })
    } else {
      draft.addToStack({
        kind: 'ability',
        objectId: source.id,
        controller: event.seat,
        name: source.name,
        targets: event.targets ?? [],
        abilityId: event.abilityId,
        ...(event.x !== undefined ? { x: event.x } : {}),
        ...(event.choices ? { choices: event.choices } : {}),
      })
      draft.passedInRow = []
      draft.priority = event.seat
    }
    draft.note(`${event.seat} activates ${source.name}`)
  },
}
