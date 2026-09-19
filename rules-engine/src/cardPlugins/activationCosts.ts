import type Draft from '../draft'
import { hasKeyword } from '../keywords'
import { payCost } from '../plugins/spells'
import type { GameObject, GameState, PlayerId } from '../types'
import type { ActivateCost } from './effectDefinitions'
import { millLibrary } from './effectRuntime'

type CanPayMana = (cost: string) => boolean

const canPayFromPool = (state: GameState, seat: PlayerId): CanPayMana =>
  (cost) => Boolean(payCost(state.players[seat]?.mana, cost))

export const activationCostError = (
  state: GameState,
  source: GameObject,
  seat: PlayerId,
  costs: ActivateCost,
  canPayMana: CanPayMana = canPayFromPool(state, seat),
) => {
  if (costs.tap) {
    if (source.tapped) return `${source.name} is already tapped`
    if (
      source.types.includes('Creature')
      && source.summoningSickness
      && !hasKeyword(source, 'haste', state)
    ) {
      return `${source.name} has summoning sickness`
    }
  }
  if (costs.mana && !canPayMana(costs.mana)) {
    return `not enough mana to activate ${source.name}`
  }
  if ((costs.life ?? 0) > state.players[seat].life) {
    return `${seat} cannot pay ${costs.life} life`
  }
}

export const canPayActivationCosts = (
  state: GameState,
  source: GameObject,
  seat: PlayerId,
  costs: ActivateCost,
  canPayMana?: CanPayMana,
) => !activationCostError(state, source, seat, costs, canPayMana)

export const payActivationCosts = (
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
  if (costs.sacrifice) draft.enqueue({ type: 'sacrifice', objectId: source.id })
  if (costs.discard) draft.enqueue({ type: 'move', objectId: source.id, to: 'graveyard' })
}
