import { DIALOG_CHOSEN, pendingDialogFor } from '../pendingDialog'
import { markKnownTo } from '../knowledge'
import { openCardSelection } from '../rules/selectCards'
import type Draft from '../draft'
import { addPlusCounters } from './effectRuntime'
import type { Plugin } from '../types'

export const STEAL_CAST_DRAW = 'stealCast.drawChoice'

type DrawThenSteal = {
  sourceId: string
  opponent: string
  count: number
  awaitingDraws?: number
}

const pendingDrawThenSteal = (value: unknown): DrawThenSteal | undefined => {
  if (!value || typeof value !== 'object') return
  const pending = value as Partial<DrawThenSteal>
  if (
    typeof pending.sourceId !== 'string'
    || typeof pending.opponent !== 'string'
    || !Number.isSafeInteger(pending.count)
  ) return
  return pending as DrawThenSteal
}

const openStealCast = (
  draft: Draft,
  seat: string,
  pending: DrawThenSteal,
  sourceName: string,
) => {
  const hand = draft.zoneOrder[pending.opponent]?.hand ?? []
  const spells = hand.filter((objectId) => {
    const object = draft.object(objectId)
    return object && !object.types.includes('Land')
  })
  markKnownTo(draft, spells, [seat])
  openCardSelection(draft, {
    seat,
    kind: 'choose',
    count: 1,
    min: 0,
    candidates: spells,
    sourceId: pending.sourceId,
    source: sourceName,
    prompt: `You may cast a spell from ${pending.opponent}'s hand without paying its mana cost.`,
    destinations: ['skip', 'target'],
    fromSeat: pending.opponent,
    fromZone: 'hand',
    castWithoutPaying: true,
  })
}

export const stealCast: Plugin = {
  id: 'stealCast',
  apply: ({ state, event, draft }) => {
    if (event.type === 'draw') {
      for (const seat of state.playerOrder) {
        const pending = pendingDrawThenSteal(draft.players[seat].data[STEAL_CAST_DRAW])
        if (!pending || pending.opponent !== event.seat) continue
        if (!pending.awaitingDraws) continue
        const remaining = pending.awaitingDraws - 1
        if (remaining > 0 && !draft.players[event.seat].lost) {
          draft.players[seat].data[STEAL_CAST_DRAW] = { ...pending, awaitingDraws: remaining }
          continue
        }
        delete draft.players[seat].data[STEAL_CAST_DRAW]
        const source = draft.object(pending.sourceId)
        openStealCast(draft, seat, pending, source?.name ?? 'Steal')
      }
      return
    }
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'may-draw') return
    for (const seat of state.playerOrder) {
      const pending = pendingDrawThenSteal(state.players[seat].data[STEAL_CAST_DRAW])
      if (!pending || pending.opponent !== event.seat) continue
      if (event.payload?.accepted !== true) {
        delete draft.players[seat].data[STEAL_CAST_DRAW]
        const source = draft.object(pending.sourceId)
        if (source) addPlusCounters(source, 2)
        draft.note(`${pending.opponent} declined ${dialog.source}`)
        return
      }
      draft.players[seat].data[STEAL_CAST_DRAW] = {
        ...pending,
        awaitingDraws: pending.count,
      }
      draft.enqueue({ type: 'draw', seat: pending.opponent, count: pending.count })
    }
  },
}
