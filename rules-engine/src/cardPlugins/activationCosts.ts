import type Draft from '../draft'
import { hasKeyword } from '../keywords'
import { payCost } from '../plugins/spells'
import type { GameObject, GameState, PlayerId } from '../types'
import type { ActivateCost } from './effectDefinitions'
import { millLibrary } from './effectRuntime'

type CanPayMana = (cost: string) => boolean

const MANA_CHOICES = new Set(['W', 'U', 'B', 'R', 'G', 'C'])

export type ActivationCostPicks = {
  discardId?: string
  sacrificeId?: string
  crewIds?: string[]
}

const canPayFromPool = (state: GameState, seat: PlayerId): CanPayMana =>
  (cost) => Boolean(payCost(state.players[seat]?.mana, cost))

const discardTypeName = (kind: NonNullable<ActivateCost['discard']>) =>
  kind === 'land' ? 'land card' : 'card'

const sacrificeTypeName = (kind: NonNullable<ActivateCost['sacrificeTarget']>) =>
  kind === 'land' ? 'Land' : 'Creature'

const handCards = (state: GameState, seat: PlayerId) =>
  (state.zoneOrder[seat]?.hand ?? [])
    .map((objectId) => state.objects[objectId])
    .filter((object): object is GameObject => Boolean(object))

export const discardCostCandidates = (
  state: GameState,
  seat: PlayerId,
  kind: NonNullable<ActivateCost['discard']>,
) => {
  if (kind === 'self') return []
  return handCards(state, seat).filter((object) =>
    kind === 'any' || object.types.includes('Land'))
}

export const sacrificeCostCandidates = (
  state: GameState,
  source: GameObject,
  seat: PlayerId,
  kind: NonNullable<ActivateCost['sacrificeTarget']>,
  other = false,
) =>
  Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield'
    && object.controller === seat
    && (!other || object.id !== source.id)
    && object.types.includes(sacrificeTypeName(kind)))

export const crewCostCandidates = (
  state: GameState,
  seat: PlayerId,
) =>
  Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield'
    && object.controller === seat
    && object.types.includes('Creature')
    && !object.tapped)

export const needsActivationCostPicks = (costs: ActivateCost) =>
  Boolean(
    (costs.discard && costs.discard !== 'self')
    || costs.sacrificeTarget
    || costs.crew !== undefined,
  )

export const costPicksFromChoices = (
  costs: ActivateCost,
  choices: string[] | undefined,
): ActivationCostPicks => {
  const ids = (choices ?? []).filter((entry) => !MANA_CHOICES.has(entry))
  let index = 0
  const picks: ActivationCostPicks = {}
  if (costs.discard && costs.discard !== 'self') picks.discardId = ids[index++]
  if (costs.sacrificeTarget) picks.sacrificeId = ids[index++]
  if (costs.crew !== undefined) picks.crewIds = ids.slice(index)
  return picks
}

const chosenAmong = (
  objectId: string | undefined,
  candidates: GameObject[],
) => candidates.some((object) => object.id === objectId)

export const activationCostError = (
  state: GameState,
  source: GameObject,
  seat: PlayerId,
  costs: ActivateCost,
  options: {
    canPayMana?: CanPayMana
    picks?: ActivationCostPicks
    requirePicks?: boolean
  } = {},
) => {
  const canPayMana = options.canPayMana ?? canPayFromPool(state, seat)
  const picks = options.picks ?? {}
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
  if (costs.crew !== undefined) {
    const candidates = crewCostCandidates(state, seat)
    const availablePower = candidates.reduce(
      (total, object) => total + Math.max(0, object.power ?? 0),
      0,
    )
    if (availablePower < costs.crew) {
      return `${seat} has insufficient untapped creature power to crew ${source.name}`
    }
    if (options.requirePicks) {
      const ids = picks.crewIds ?? []
      const uniqueIds = new Set(ids)
      const chosen = ids.map((id) => candidates.find((object) => object.id === id))
      if (uniqueIds.size !== ids.length || chosen.some((object) => !object)) {
        return `${source.name} must be crewed by untapped creatures ${seat} controls`
      }
      const power = chosen.reduce((total, object) => total + (object?.power ?? 0), 0)
      if (power < costs.crew) {
        return `${source.name} needs ${costs.crew} total creature power to crew`
      }
    }
  }
  if (costs.mana && !canPayMana(costs.mana)) {
    return `not enough mana to activate ${source.name}`
  }
  if ((costs.life ?? 0) > state.players[seat].life) {
    return `${seat} cannot pay ${costs.life} life`
  }
  if ((costs.energy ?? 0) > state.players[seat].energy) {
    return `${seat} cannot pay ${costs.energy} energy`
  }
  if (costs.discard === 'self') {
    if (source.zone !== 'hand' || source.controller !== seat) {
      return `${source.name} is not in ${seat}'s hand`
    }
  } else if (costs.discard) {
    const candidates = discardCostCandidates(state, seat, costs.discard)
    if (candidates.length === 0) {
      return `${seat} has no ${discardTypeName(costs.discard)} to discard`
    }
    if (options.requirePicks && !chosenAmong(picks.discardId, candidates)) {
      return `${source.name} needs one ${discardTypeName(costs.discard)} to discard`
    }
  }
  if (costs.exileSelf && (source.zone !== 'graveyard' || source.controller !== seat)) {
    return `${source.name} must be in ${seat}'s graveyard to exile`
  }
  if (costs.exileFromGraveyard) {
    if (source.zone !== 'graveyard' || source.owner !== seat || source.controller !== seat) {
      return `${source.name} must be exiled from your graveyard`
    }
  }
  if (costs.sacrificeTarget) {
    const candidates = sacrificeCostCandidates(
      state,
      source,
      seat,
      costs.sacrificeTarget,
      costs.sacrificeOther,
    )
    if (candidates.length === 0) {
      return `${seat} has no ${costs.sacrificeTarget} to sacrifice`
    }
    if (options.requirePicks && !chosenAmong(picks.sacrificeId, candidates)) {
      return `${source.name} needs one ${costs.sacrificeTarget} to sacrifice`
    }
  }
}

export const canPayActivationCosts = (
  state: GameState,
  source: GameObject,
  seat: PlayerId,
  costs: ActivateCost,
  canPayMana?: CanPayMana,
) => !activationCostError(state, source, seat, costs, { canPayMana })

export const payActivationCosts = (
  draft: Draft,
  source: GameObject,
  seat: PlayerId,
  costs: ActivateCost,
  picks: ActivationCostPicks = {},
) => {
  if (costs.mana) draft.enqueue({ type: 'payMana', seat, cost: costs.mana })
  if (costs.energy) {
    draft.enqueue({
      type: 'payEnergy',
      seat,
      amount: costs.energy,
      source: source.name,
    })
  }
  if (costs.life) {
    draft.enqueue({
      type: 'payLife',
      seat,
      amount: costs.life,
      source: source.name,
    })
  }
  if (costs.tap) draft.enqueue({ type: 'tap', objectId: source.id })
  for (const objectId of picks.crewIds ?? []) {
    draft.enqueue({ type: 'tap', objectId })
  }
  if (costs.mill) millLibrary(draft, seat, costs.mill)
  if (costs.exileSelf) draft.enqueue({ type: 'move', objectId: source.id, to: 'exile' })
  if (costs.sacrifice) draft.enqueue({ type: 'sacrifice', objectId: source.id })
  if (costs.exileFromGraveyard) {
    draft.enqueue({ type: 'move', objectId: source.id, to: 'exile' })
  }
  if (costs.sacrificeTarget && picks.sacrificeId) {
    draft.enqueue({ type: 'sacrifice', objectId: picks.sacrificeId })
  }
  if (costs.discard === 'self') {
    draft.enqueue({ type: 'discard', seat, objectId: source.id })
  } else if (costs.discard && picks.discardId) {
    draft.enqueue({ type: 'discard', seat, objectId: picks.discardId })
  }
}
