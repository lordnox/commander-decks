import { readFileSync } from 'node:fs'
import type { LobbyState } from './lobby'
import {
  SEAT_IDS,
  type InboxMessage,
  type PlayAction,
  type SeatActions,
  type SeatId,
} from './protocol'
import { replayPath } from './session'

type ReplayEvent = {
  kind?: string
  seat?: string | null
  seats?: unknown
  summary?: string
  state?: {
    active?: string
  }
}

const namedResponders = (
  event: ReplayEvent,
  state: LobbyState,
) => {
  if (Array.isArray(event.seats)) {
    return event.seats.filter(
      (seat): seat is SeatId =>
        typeof seat === 'string' && SEAT_IDS.includes(seat as SeatId),
    )
  }
  const summary = event.summary ?? ''
  return SEAT_IDS.filter((seat) => {
    const name = state.occupants[seat]?.name
    return summary.includes(seat) || Boolean(name && summary.includes(name))
  })
}

export const replayActions = (
  root: string,
  slug: string,
  state: LobbyState,
): SeatActions => {
  const replay = JSON.parse(readFileSync(replayPath(slug, root), 'utf8')) as {
    events?: ReplayEvent[]
  }
  const event = replay.events?.at(-1)
  if (!event) return {}
  if (event.kind === 'priority') {
    return Object.fromEntries(
      namedResponders(event, state).map((seat) => [seat, ['plan', 'pass']]),
    )
  }
  const active = event.state?.active ?? event.seat
  return SEAT_IDS.includes(active as SeatId)
    ? { [active as SeatId]: ['plan'] }
    : {}
}

export const setSeatActions = (
  actions: SeatActions,
  seat: SeatId,
  next: PlayAction[],
) => ({
  ...actions,
  [seat]: next,
})

export const sameActions = (
  left: PlayAction[] | undefined,
  right: PlayAction[] | undefined,
) => JSON.stringify(left ?? []) === JSON.stringify(right ?? [])

export const acceptsPlayAction = (
  state: LobbyState,
  seat: SeatId,
  message: InboxMessage,
) => {
  const action = message.type as PlayAction
  return message.actionId === state.actionIds[seat]
    && (state.actions[seat] ?? []).includes(action)
}

