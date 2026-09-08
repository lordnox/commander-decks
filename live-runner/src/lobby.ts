import {
  SEAT_IDS,
  type InboxMessage,
  type LobbyPhase,
  type SeatId,
} from './protocol'

export type Occupant = {
  name: string
  deck: string
}

export type LobbyState = {
  phase: LobbyPhase
  occupants: Partial<Record<SeatId, Occupant>>
  ready: SeatId[]
  pendingSwap?: { a: SeatId; b: SeatId; votes: SeatId[] }
  firstPlayer: SeatId
  pregameRemaining: SeatId[]
  talk: string
  waiting: string
  active: SeatId
}

const clockwiseFrom = (start: SeatId) => {
  const index = SEAT_IDS.indexOf(start)
  return SEAT_IDS.map((_, offset) => SEAT_IDS[(index + offset) % SEAT_IDS.length])
}

const occupied = (state: LobbyState) =>
  SEAT_IDS.filter((seat) => state.occupants[seat])

const seatingLines = (state: LobbyState) =>
  SEAT_IDS.map((seat) => {
    const occupant = state.occupants[seat]
    return occupant ? `${seat}: ${occupant.name}` : `${seat}: (empty)`
  }).join('\n')

const appendTalk = (state: LobbyState, line: string) => {
  state.talk = state.talk ? `${state.talk}\n${line}` : line
}

const announceSeats = (state: LobbyState) => {
  state.phase = 'seated'
  state.ready = []
  state.pendingSwap = undefined
  state.waiting = 'Seats assigned. Send ready to confirm, or swap.'
  appendTalk(state, `Seating:\n${seatingLines(state)}`)
}

const beginPregame = (state: LobbyState) => {
  state.phase = 'pregame'
  state.ready = []
  state.pendingSwap = undefined
  state.pregameRemaining = clockwiseFrom(state.firstPlayer)
  const current = state.pregameRemaining[0]
  state.active = current
  state.waiting = `${current}: pregame?`
  appendTalk(
    state,
    `Turn order starts at ${state.firstPlayer}. Pregame in turn order.`,
  )
}

const askStart = (state: LobbyState) => {
  state.phase = 'ready'
  state.ready = []
  state.waiting = 'Can we start?'
  appendTalk(state, 'Can we start? Each seat send ready.')
}

const startPlay = (state: LobbyState) => {
  state.phase = 'play'
  state.waiting = 'Play. Send a plan when it is your action.'
  appendTalk(state, 'All seats ready. Dealing.')
}

const nextSeat = (from: SeatId) =>
  SEAT_IDS[(SEAT_IDS.indexOf(from) + 1) % SEAT_IDS.length]

export const createLobby = (headline = 'Live table'): LobbyState => ({
  phase: 'gathering',
  occupants: {},
  ready: [],
  firstPlayer: 'p1',
  pregameRemaining: [],
  talk: headline,
  waiting: 'Waiting for players (0/4)',
  active: 'p1',
})

export const restoreLobby = (saved: LobbyState | undefined, headline: string) =>
  saved
    ? {
        ...saved,
        occupants: { ...saved.occupants },
        ready: [...saved.ready],
        pregameRemaining: [...saved.pregameRemaining],
      }
    : createLobby(headline)

export const rollTurnOrder = (
  state: LobbyState,
  rolls: Record<SeatId, number>,
) => {
  const ranked = [...SEAT_IDS].sort((a, b) => rolls[b] - rolls[a] || a.localeCompare(b))
  state.firstPlayer = ranked[0]
  state.active = ranked[0]
  appendTalk(
    state,
    `d20: ${SEAT_IDS.map((seat) => `${seat}=${rolls[seat]}`).join(', ')}. First: ${state.firstPlayer}.`,
  )
  beginPregame(state)
}

export const applyInbox = (
  state: LobbyState,
  from: SeatId,
  message: InboxMessage,
): LobbyState => {
  if (message.type === 'talk') {
    appendTalk(state, `${from}: ${message.text}`)
    if (state.phase === 'ready' || state.phase === 'seated') {
      const seating = /seat|swap/i.test(message.text)
      if (seating && state.phase === 'ready') {
        state.ready = []
        announceSeats(state)
      }
    }
    return state
  }

  if (message.type === 'rules') {
    appendTalk(state, `${from} (rules): ${message.text}`)
    return state
  }

  if (message.type === 'join') {
    if (state.phase !== 'gathering') return state
    state.occupants[from] = { name: message.name, deck: message.deck }
    const count = occupied(state).length
    state.waiting = `Waiting for players (${count}/4)`
    appendTalk(state, `${message.name} joined as ${from}.`)
    if (count === 4) announceSeats(state)
    return state
  }

  if (message.type === 'swap') {
    if (state.phase !== 'seated' && state.phase !== 'ready') return state
    if (state.phase === 'ready') {
      state.ready = []
      state.phase = 'seated'
    }
    if (message.with === from) return state
    state.pendingSwap = { a: from, b: message.with, votes: [from] }
    state.ready = []
    state.waiting = `Swap ${from} and ${message.with}? All must agree (ready).`
    appendTalk(state, `${from} wants to swap with ${message.with}.`)
    return state
  }

  if (message.type === 'ready') {
    if (state.phase === 'seated') {
      if (state.pendingSwap) {
        if (!state.pendingSwap.votes.includes(from)) {
          state.pendingSwap.votes = [...state.pendingSwap.votes, from]
        }
        if (state.pendingSwap.votes.length === 4) {
          const { a, b } = state.pendingSwap
          const left = state.occupants[a]
          const right = state.occupants[b]
          state.occupants[a] = right
          state.occupants[b] = left
          state.pendingSwap = undefined
          appendTalk(
            state,
            `Swap agreed. ${a} and ${b}: trade pipe invites. Bins stay ${SEAT_IDS.join(', ')}.`,
          )
          announceSeats(state)
        }
        return state
      }
      if (!state.ready.includes(from)) state.ready = [...state.ready, from]
      if (state.ready.length === 4) {
        appendTalk(state, 'Seating stands.')
        state.waiting = 'Rolling turn order'
      }
      return state
    }
    if (state.phase === 'ready') {
      if (!state.ready.includes(from)) state.ready = [...state.ready, from]
      if (state.ready.length === 4) startPlay(state)
      return state
    }
    return state
  }

  if (message.type === 'pregame') {
    if (state.phase !== 'pregame') return state
    const current = state.pregameRemaining[0]
    if (from !== current) return state
    const cards = message.cards.filter(Boolean)
    appendTalk(
      state,
      cards.length > 0
        ? `${from} pregame: ${cards.join(', ')}`
        : `${from} skips pregame.`,
    )
    state.pregameRemaining = state.pregameRemaining.slice(1)
    if (state.pregameRemaining.length === 0) {
      askStart(state)
      return state
    }
    const next = state.pregameRemaining[0]
    state.active = next
    state.waiting = `${next}: pregame?`
    return state
  }

  if (message.type === 'plan' || message.type === 'replace') {
    if (state.phase !== 'play') return state
    state.waiting = `Would this line work?\n${message.text}`
    appendTalk(state, `${from} ${message.type}: ${message.text}`)
    return state
  }

  if (message.type === 'confirm') {
    if (state.phase !== 'play') return state
    appendTalk(state, `${from} confirms.`)
    state.waiting = 'Confirmed. Host applying the line.'
    return state
  }

  return state
}

export { nextSeat, clockwiseFrom }
