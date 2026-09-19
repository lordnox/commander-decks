import { openCardSelection, pendingSelectionFor } from '../rules/selectCards'
import type { GameObject, GameState, Plugin } from '../types'
import { millLibrary } from './effectRuntime'

const DREDGE_ID = 'dredge'

const dredgeCount = (object: GameObject) => {
  const effect = object.effects?.find((candidate) => candidate.op === 'dredge')
  return effect?.op === 'dredge' ? effect.count : undefined
}

const dredgersFor = (state: GameState, seat: string) => {
  const librarySize = state.zoneOrder[seat]?.library.length ?? 0
  return (state.zoneOrder[seat]?.graveyard ?? [])
    .map((objectId) => state.objects[objectId])
    .filter((object): object is GameObject => {
      const count = object && dredgeCount(object)
      return Boolean(object)
        && Number.isInteger(count)
        && (count ?? 0) > 0
        && (count ?? 0) <= librarySize
    })
}

/**
 * CR 702.51: replace one draw with an optional choice among eligible dredge
 * cards. The persisted card selection is also the live host's restart marker.
 */
export const dredge: Plugin = {
  id: DREDGE_ID,
  replace: ({ state, event }) => {
    if (event.type !== 'draw' || event.replacedBy?.includes(DREDGE_ID)) return
    if (dredgersFor(state, event.seat).length === 0) return
    return {
      type: 'beginDredgeChoice',
      seat: event.seat,
      replacedBy: [...(event.replacedBy ?? []), DREDGE_ID],
      ...(event.remainingAfter ? { remainingAfter: event.remainingAfter } : {}),
    }
  },
  legal: ({ state, event }) => {
    if (event.type !== 'beginDredgeChoice') return
    if (!state.players[event.seat]) return 'player is not in the game'
    if (!event.replacedBy.includes(DREDGE_ID)) return 'dredge choice is missing its draw marker'
    if (dredgersFor(state, event.seat).length === 0) return 'no card can dredge this draw'
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'beginDredgeChoice') {
      const candidates = dredgersFor(state, event.seat)
      openCardSelection(draft, {
        seat: event.seat,
        kind: 'choose',
        count: 1,
        min: 0,
        candidates: candidates.map((object) => object.id),
        source: 'Dredge',
        prompt: 'Choose at most one card to dredge instead of drawing.',
        fromSeat: event.seat,
        fromZone: 'graveyard',
        destinations: ['skip', 'target'],
        action: {
          kind: 'dredge',
          replacedBy: event.replacedBy,
          ...(event.remainingAfter ? { remainingAfter: event.remainingAfter } : {}),
        },
      })
      return
    }

    if (event.type !== 'selectCards' || event.kind !== 'choose') return
    const selection = pendingSelectionFor(state, event.seat)
    if (selection?.action?.kind !== 'dredge') return

    const objectId = event.objectIds?.[0]
    if (!objectId) {
      draft.enqueue({
        type: 'draw',
        seat: event.seat,
        count: 1,
        replacedBy: selection.action.replacedBy,
      })
      if (selection.action.remainingAfter) {
        draft.enqueue({
          type: 'draw',
          seat: event.seat,
          count: selection.action.remainingAfter,
        })
      }
      return
    }

    const object = state.objects[objectId]
    const count = object && dredgeCount(object)
    if (!object || !count) return
    millLibrary(draft, event.seat, count)
    draft.enqueue({ type: 'move', objectId, to: 'hand' })
    if (selection.action.remainingAfter) {
      draft.enqueue({
        type: 'draw',
        seat: event.seat,
        count: selection.action.remainingAfter,
      })
    }
    draft.note(`${event.seat} dredges ${object.name}`)
  },
}
