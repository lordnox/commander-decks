import { readFileSync, writeFileSync } from 'node:fs'
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
  id?: number
  turn?: number
  phase?: string
  kind?: string
  seat?: string | null
  seats?: unknown
  summary?: string
  state?: {
    active?: string
    turn?: number
    phase?: string
    stack?: unknown[]
  }
}

const playerList = (seats: SeatId[], state: LobbyState) => {
  const names = seats.map((seat) => state.occupants[seat]?.name ?? seat)
  if (names.length < 2) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
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

/** Record priority passes that do not require rules or game-state judgment. */
export const applyDeterministicPass = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
) => {
  const responders = SEAT_IDS.filter(
    (candidate) => state.actions[candidate]?.includes('pass'),
  )
  if (!responders.includes(seat)) return false

  const path = replayPath(slug, root)
  const replay = JSON.parse(readFileSync(path, 'utf8')) as {
    events: ReplayEvent[]
  }
  const last = replay.events.at(-1)
  if (!last || last.kind !== 'priority' || !last.state) return false

  const nextId = (last.id ?? replay.events.length - 1) + 1
  const windowName = (last.summary ?? 'Priority').split(':', 1)[0]
  const pass = {
    id: nextId,
    turn: last.turn,
    phase: 'priority',
    seat,
    kind: 'pass',
    summary: `${state.occupants[seat]?.name ?? seat} takes no action in this priority window.`,
    state: structuredClone(last.state),
  }

  const remaining = responders.filter((candidate) => candidate !== seat)
  if (remaining.length > 0) {
    replay.events.push(pass, {
      id: nextId + 1,
      turn: last.turn,
      phase: 'priority',
      seat: null,
      kind: 'priority',
      summary: `${windowName}: ${playerList(remaining, state)} may plan a response or pass.`,
      seats: remaining,
      state: structuredClone(last.state),
    })
    writeFileSync(path, `${JSON.stringify(replay, null, 2)}\n`)
    return 'priority'
  } else {
    const active = last.state.active as SeatId
    const emptyStack = (last.state.stack ?? []).length === 0
    if (
      !SEAT_IDS.includes(active)
      || !emptyStack
      || !/^end step priority/i.test(last.summary ?? '')
    ) {
      return false
    }
    const next = SEAT_IDS[(SEAT_IDS.indexOf(active) + 1) % SEAT_IDS.length]
    const turn = last.turn ?? last.state.turn ?? 0
    const nextTurn = turn + (next === state.firstPlayer ? 1 : 0)
    const cleanupState = structuredClone(last.state)
    cleanupState.active = active
    cleanupState.turn = turn
    cleanupState.phase = 'end'
    const planningState = structuredClone(last.state)
    planningState.active = next
    planningState.turn = nextTurn
    planningState.phase = 'planning'
    replay.events.push(
      pass,
      {
        id: nextId + 1,
        turn,
        phase: 'end',
        seat: active,
        kind: 'note',
        summary: `Cleanup — no actions. ${state.occupants[active]?.name ?? active}'s turn ends.`,
        state: cleanupState,
      },
      {
        id: nextId + 2,
        turn: nextTurn,
        phase: 'planning',
        seat: next,
        kind: 'think',
        summary: `Turn ${nextTurn} — ${state.occupants[next]?.name ?? next} to act.`,
        state: planningState,
      },
    )
  }
  writeFileSync(path, `${JSON.stringify(replay, null, 2)}\n`)
  return 'turn'
}

