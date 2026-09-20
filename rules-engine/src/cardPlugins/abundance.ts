import { markKnownToAll } from '../knowledge'
import { openCardSelection, pendingSelectionFor } from '../rules/selectCards'
import {
  openOptionSelection,
  pendingOptionSelection,
} from '../rules/selectOptions'
import type { GameObject, Plugin } from '../types'
import { effectsOf } from './cardRules'

const ID = 'abundance'

const sourceFor = (objects: Record<string, GameObject>, seat: string) =>
  Object.values(objects).find((object) =>
    object.zone === 'battlefield'
    && object.controller === seat
    && effectsOf(object).some((effect) => effect.op === 'drawReplacementByType'))

const continueDraws = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  seat: string,
  remainingAfter?: number,
) => {
  if (remainingAfter) draft.enqueue({ type: 'draw', seat, count: remainingAfter })
}

export const abundance: Plugin = {
  id: ID,
  replace: ({ state, event }) => {
    if (
      event.type !== 'draw'
      || event.replacedBy?.includes(ID)
    ) return
    const source = sourceFor(state.objects, event.seat)
    if (!source) return
    return {
      type: 'beginAbundanceChoice',
      seat: event.seat,
      sourceId: source.id,
      replacedBy: [...(event.replacedBy ?? []), ID],
      ...(event.remainingAfter ? { remainingAfter: event.remainingAfter } : {}),
    }
  },
  legal: ({ state, event }) => {
    if (event.type !== 'beginAbundanceChoice') return
    const source = state.objects[event.sourceId]
    if (
      !source
      || source.zone !== 'battlefield'
      || source.controller !== event.seat
      || !effectsOf(source).some((effect) => effect.op === 'drawReplacementByType')
    ) return 'draw replacement source is not available'
    if (!event.replacedBy.includes(ID)) return 'draw replacement marker is missing'
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'beginAbundanceChoice') {
      const source = state.objects[event.sourceId]
      if (!source) return
      openOptionSelection(draft, {
        seat: event.seat,
        sourceId: source.id,
        source: source.name,
        prompt: 'Draw normally, or name land or nonland for this draw.',
        options: [
          { id: 'draw', label: 'Draw normally' },
          { id: 'land', label: 'Land' },
          { id: 'nonland', label: 'Nonland' },
        ],
        action: {
          kind: 'abundance',
          replacedBy: event.replacedBy,
          ...(event.remainingAfter ? { remainingAfter: event.remainingAfter } : {}),
        },
      })
      return
    }

    if (event.type === 'selectOption') {
      const pending = pendingOptionSelection(state, event.seat)
      if (pending?.action.kind !== 'abundance') return
      if (event.optionId === 'draw') {
        draft.enqueue({
          type: 'draw',
          seat: event.seat,
          count: 1,
          replacedBy: pending.action.replacedBy,
        })
        continueDraws(draft, event.seat, pending.action.remainingAfter)
        return
      }

      const wantsLand = event.optionId === 'land'
      const library = state.zoneOrder[event.seat].library
      const matchIndex = library.findIndex((objectId) =>
        state.objects[objectId]?.types.includes('Land') === wantsLand)
      const revealed = matchIndex < 0 ? [...library] : library.slice(0, matchIndex + 1)
      if (revealed.length > 0) {
        markKnownToAll(draft, revealed)
        draft.note(`${event.seat} reveals ${
          revealed.map((id) => state.objects[id]?.name).filter(Boolean).join(', ')
        } for ${pending.source ?? 'a draw replacement'}`)
      }
      const found = matchIndex < 0 ? undefined : revealed.at(-1)
      const rest = found ? revealed.slice(0, -1) : revealed
      if (found) draft.move(found, 'hand')
      if (rest.length === 0) {
        continueDraws(draft, event.seat, pending.action.remainingAfter)
        return
      }
      openCardSelection(draft, {
        seat: event.seat,
        kind: 'scry',
        count: rest.length,
        candidates: rest,
        sourceId: pending.sourceId,
        source: pending.source,
        prompt: 'Put the other revealed cards on the bottom in any order.',
        fromSeat: event.seat,
        fromZone: 'library',
        destinations: ['bottom'],
        action: {
          kind: 'abundance-order',
          ...(pending.action.remainingAfter
            ? { remainingAfter: pending.action.remainingAfter }
            : {}),
        },
      })
      return
    }

    if (event.type === 'selectCards' && event.kind === 'scry') {
      const selection = pendingSelectionFor(state, event.seat)
      if (selection?.action?.kind !== 'abundance-order') return
      continueDraws(draft, event.seat, selection.action.remainingAfter)
    }
  },
}
