import type Draft from '../draft'
import type { GameState, PlayerId, Plugin } from '../types'

export const CUMULATIVE_UPKEEP_PENDING = 'kernel.cumulativeUpkeep'

export type PendingCumulativeUpkeep = {
  id: string
  objectId: string
  source: string
  seat: PlayerId
  count: number
  opponents: PlayerId[]
}

const isPending = (value: unknown): value is PendingCumulativeUpkeep =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingCumulativeUpkeep).id === 'string'
  && typeof (value as PendingCumulativeUpkeep).objectId === 'string'
  && typeof (value as PendingCumulativeUpkeep).seat === 'string'
  && Number.isSafeInteger((value as PendingCumulativeUpkeep).count)
  && Array.isArray((value as PendingCumulativeUpkeep).opponents)

export const pendingCumulativeUpkeep = (
  state: GameState,
  seat?: PlayerId,
): PendingCumulativeUpkeep | undefined => {
  for (const player of seat ? [seat] : state.playerOrder) {
    const value = state.players[player]?.data[CUMULATIVE_UPKEEP_PENDING]
    if (isPending(value)) return value
  }
}

export const openCumulativeUpkeep = (
  draft: Draft,
  sourceId: string,
) => {
  const source = draft.object(sourceId)
  if (!source || source.zone !== 'battlefield') return
  const count = (source.counters.age ?? 0) + 1
  source.counters.age = count
  const opponents = draft.playerOrder.filter(
    (seat) => seat !== source.controller && !draft.players[seat].lost,
  )
  draft.players[source.controller].data[CUMULATIVE_UPKEEP_PENDING] = {
    id: draft.allocId('upkeep'),
    objectId: source.id,
    source: source.name,
    seat: source.controller,
    count,
    opponents,
  } satisfies PendingCumulativeUpkeep
  draft.priority = source.controller
  draft.note(`${source.name} gets age counter ${count}`)
}

export const cumulativeUpkeep: Plugin = {
  id: 'cumulativeUpkeep',
  legal: ({ state, event }) => {
    const pending = pendingCumulativeUpkeep(state)
    if (event.type === 'passPriority' && pending) {
      return `${pending.seat} must resolve cumulative upkeep for ${pending.source}`
    }
    if (event.type !== 'payCumulativeUpkeep') return
    if (!pending || event.choiceId !== pending.id || event.objectId !== pending.objectId) {
      return 'that cumulative upkeep choice is not open'
    }
    if (event.seat !== pending.seat) return 'only the permanent controller may choose'
    if (!event.pay) {
      if (event.recipients?.length) return 'declining upkeep cannot choose recipients'
      return
    }
    if (event.recipients?.length !== pending.count) {
      return `choose one opponent for each of ${pending.count} age counters`
    }
    if (event.recipients.some((seat) => !pending.opponents.includes(seat))) {
      return 'cumulative upkeep recipient must be a living opponent'
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'payCumulativeUpkeep') return
    const pending = pendingCumulativeUpkeep(draft, event.seat)
    if (!pending || pending.id !== event.choiceId) return
    delete draft.players[event.seat].data[CUMULATIVE_UPKEEP_PENDING]
    if (!event.pay) {
      draft.enqueue({ type: 'move', objectId: pending.objectId, to: 'graveyard' })
      draft.note(`${event.seat} declines cumulative upkeep for ${pending.source}`)
      return
    }
    for (const recipient of event.recipients ?? []) {
      draft.enqueue({
        type: 'gainLife',
        seat: recipient,
        amount: 1,
        source: pending.objectId,
      })
    }
    draft.note(`${event.seat} pays cumulative upkeep for ${pending.source}`)
  },
}
