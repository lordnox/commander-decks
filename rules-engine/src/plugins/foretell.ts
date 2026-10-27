import { zoneMechanic } from '../cardPlugins/dsl/alternateMechanics'
import { payCost } from './spells'
import type { AlternateCastEffect } from '../cardPlugins/alternateCosts'
import { isKnownTo, markKnownToAll } from '../knowledge'
import type { GameObject, GameState, PlayerId, Plugin } from '../types'

export const FORETELL_CAST_ID = 'foretell'
export const FORETELL_ACTION_COST = '{2}'

export const foretellCostOf = (object: GameObject) => zoneMechanic(object, 'foretell')?.manaCost

export const hasForetell = (object: GameObject) => foretellCostOf(object) !== undefined

export const foretellAlternateCast = (object: GameObject): AlternateCastEffect => {
  const manaCost = foretellCostOf(object) ?? ''
  return {
    op: 'alternateCast',
    id: FORETELL_CAST_ID,
    label: `Foretell ${manaCost}`,
    manaCost,
    fromZone: 'exile',
  }
}

export const isHiddenForetold = (
  object: GameObject,
  viewer: PlayerId | null,
  playerOrder: PlayerId[],
) =>
  Boolean(object.foretold)
  && object.zone === 'exile'
  && !isKnownTo(object, viewer, playerOrder)

const foretellActionWindow = (state: GameState, seat: PlayerId) =>
  state.priority === seat
  && state.active === seat


export const canForetellFromHand = (state: GameState, seat: PlayerId, object: GameObject) =>
  foretellActionWindow(state, seat)
  && object.zone === 'hand'
  && object.owner === seat
  && object.controller === seat
  && hasForetell(object)
  && Boolean(payCost(state.players[seat].mana, FORETELL_ACTION_COST))

export const canCastForetold = (state: GameState, object: GameObject) =>
  Boolean(object.foretold)
  && object.zone === 'exile'
  && Boolean(foretellCostOf(object))
  && state.turn !== object.foretoldTurn
  && (object.foretoldIncarnation === undefined || object.foretoldIncarnation === object.incarnation)

const revealForetold = (draft: { objects: Record<string, GameObject>; playerOrder: PlayerId[] }, object: GameObject) => {
  if (!object.foretold) return
  delete object.foretold
  delete object.foretoldTurn
  markKnownToAll(draft, [object.id])
}

export const foretell: Plugin = {
  id: 'foretell',
  legal: ({ state, event }) => {
    if (event.type === 'foretell') {
      const object = state.objects[event.objectId]
      if (!object) return 'card does not exist'
      if (!canForetellFromHand(state, event.seat, object)) {
        return 'foretell is not available for that card now'
      }
      return
    }

    if (event.type !== 'castSpell' || event.castOption !== FORETELL_CAST_ID) return
    const object = state.objects[event.objectId]
    if (!object) return 'spell object does not exist'
    if (!canCastForetold(state, object)) {
      return 'that foretold card cannot be cast for its foretell cost now'
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'foretell') {
      const object = draft.object(event.objectId)
      if (!object || !canForetellFromHand(state, event.seat, object)) return
      const paid = payCost(draft.players[event.seat].mana, FORETELL_ACTION_COST)
      if (!paid) return
      draft.players[event.seat].mana = paid
      object.foretold = true
      object.foretoldTurn = state.turn
      object.knownTo = [event.seat]
      draft.move(object.id, 'exile')
      object.foretoldIncarnation = object.incarnation
      draft.passedInRow = []
      draft.priority = event.seat
      draft.note(`${event.seat} foretells a card face down`)
      return
    }

    if (event.type === 'castSpell' && event.castOption === FORETELL_CAST_ID) {
      const object = draft.object(event.objectId)
      if (object) revealForetold(draft, object)
      return
    }

    if (event.type === 'move') {
      const object = draft.object(event.objectId)
      if (!object?.foretold) return
      if (event.to === 'exile') return
      delete object.foretold
      delete object.foretoldTurn
      delete object.foretoldIncarnation
    }
  },
}

export const foretellCastOptions = (
  _state: GameState,
  _seat: PlayerId,
  object: GameObject,
): AlternateCastEffect[] =>
  object.foretold && foretellCostOf(object) ? [foretellAlternateCast(object)] : []
