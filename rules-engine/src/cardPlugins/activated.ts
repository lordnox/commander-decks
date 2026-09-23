import { hasUntaxedTapMana } from '../plugins/mana'
import type { GameObject, Plugin, TargetRef } from '../types'
import {
  activateEffect,
  conditionHolds,
  runInstructions,
} from './effects'
import {
  activationCostError,
  costPicksFromChoices,
  payActivationCosts,
} from './activationCosts'
import { effectsOf } from './cardRules'
import { validTargetRef } from './targetedResolve'

const MAIN_STEPS = new Set(['precombatMain', 'postcombatMain'])

const legalActivateTarget = (
  state: { objects: Record<string, GameObject | undefined> },
  target: TargetRef | undefined,
  kind: 'creature' | 'land' | 'room',
  seat: string,
) => {
  if (target?.kind !== 'object') return false
  const object = state.objects[target.objectId]
  if (!object || object.zone !== 'battlefield') return false
  if (kind === 'room') {
    return Boolean(object.roomDoors && object.controller === seat)
  }
  return object.types.includes(kind === 'creature' ? 'Creature' : 'Land')
}

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
    const picks = costPicksFromChoices(effect.costs, event.choices)
    const costError = activationCostError(state, source, event.seat, effect.costs, {
      picks,
      requirePicks: true,
    })
    if (costError) return costError
    if (!conditionHolds(effect.if, state, source)) {
      if (effect.if?.kind === 'notActivePlayer') {
        return `${source.name} can be returned only when it is not your turn`
      }
      return `${source.name} cannot be activated now`
    }
    if (effect.sorcery
      && (
        state.active !== event.seat
        || !MAIN_STEPS.has(state.step)
        || state.stack.length > 0
      )
    ) {
      return `${source.name} can be activated only as a sorcery`
    }
    if (
      effect.targets
      && typeof effect.targets === 'object'
      && 'filter' in effect.targets
    ) {
      const targets = event.targets ?? []
      if (
        targets.length !== 1
        || !validTargetRef(
          state,
          targets[0],
          effect.targets.filter,
          event.seat,
          undefined,
          event.objectId,
        )
      ) {
        return `${source.name} needs one legal target`
      }
    } else if (effect.targets === 'creature' || effect.targets === 'land' || effect.targets === 'room') {
      const targets = event.targets ?? []
      if (targets.length !== 1 || !legalActivateTarget(state, targets[0], effect.targets, event.seat)) {
        return `${source.name} needs one ${effect.targets} target`
      }
    }
    if (effect.targets === 'room' && event.door !== 'left' && event.door !== 'right') {
      return `${source.name} needs a door to lock or unlock`
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
    payActivationCosts(
      draft,
      source,
      event.seat,
      effect.costs,
      costPicksFromChoices(effect.costs, event.choices),
    )
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
        ...(event.door ? { door: event.door } : {}),
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
        ...(event.door ? { door: event.door } : {}),
      })
      draft.passedInRow = []
      draft.priority = event.seat
    }
    draft.note(`${event.seat} activates ${source.name}`)
  },
}
