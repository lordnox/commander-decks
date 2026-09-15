import { readFileSync, writeFileSync } from 'node:fs'
import type { LobbyState } from './lobby'
import {
  SEAT_IDS,
  type InboxMessage,
  type SeatId,
} from './protocol'
import { replayPath } from './session'

export const bottomRequired = (mulligans: number) => Math.max(0, mulligans - 1)

const PREGAME_TEXT =
  /opening hand|beginning of the game|at the beginning of the game/i

type PlayerState = {
  hand: string[]
  library_count: number
  [key: string]: unknown
}

type ReplayEvent = {
  id?: number
  turn?: number
  phase?: string
  seat?: string | null
  kind?: string
  summary?: string
  cards?: string[]
  notes?: string
  decision?: { reason?: string; cheat?: boolean }
  state?: {
    active?: string
    turn?: number
    phase?: string
    stack?: unknown[]
    players?: Record<string, PlayerState>
  }
}

export type OpeningReplay = {
  seed?: number
  seats?: Array<{ id: string; name?: string; mulligans?: number }>
  catalog?: Record<string, { oracle_text?: string; type_line?: string }>
  events?: ReplayEvent[]
  _libraries?: Record<string, string[]>
}

const seededRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export const shuffle = (cards: string[], random: () => number) => {
  const shuffled = [...cards]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const card = shuffled[index]
    shuffled[index] = shuffled[swap]
    shuffled[swap] = card
  }
  return shuffled
}

const mixSeed = (seed: number, seat: SeatId, attempt: number) =>
  (seed ^ ((SEAT_IDS.indexOf(seat) + 1) * 0x9e3779b9) ^ (attempt * 0x85ebca6b)) >>> 0

const readReplay = (root: string, slug: string) =>
  JSON.parse(readFileSync(replayPath(slug, root), 'utf8')) as OpeningReplay

const writeReplay = (root: string, slug: string, replay: OpeningReplay) => {
  writeFileSync(replayPath(slug, root), `${JSON.stringify(replay, null, 2)}\n`)
}

const lastEvent = (replay: OpeningReplay) => {
  const event = replay.events?.at(-1)
  if (!event?.state?.players) throw new Error('replay is missing table state')
  return event
}

const seatName = (replay: OpeningReplay, seat: SeatId, state: LobbyState) =>
  state.occupants[seat]?.name
  ?? replay.seats?.find((item) => item.id === seat)?.name
  ?? seat

const nextId = (replay: OpeningReplay) =>
  (replay.events?.at(-1)?.id ?? (replay.events?.length ?? 1) - 1) + 1

const cloneState = (event: ReplayEvent) => structuredClone(event.state!)

const seatMulligans = (replay: OpeningReplay, seat: SeatId) =>
  replay.seats?.find((item) => item.id === seat)?.mulligans ?? 0

const setSeatMulligans = (replay: OpeningReplay, seat: SeatId, count: number) => {
  const meta = replay.seats?.find((item) => item.id === seat)
  if (meta) meta.mulligans = count
}

export const hasDrawnForTurn = (replay: OpeningReplay, seat: SeatId) =>
  (replay.events ?? []).some((event) => event.kind === 'draw' && event.seat === seat)

export const isOpeningFrame = (replay: OpeningReplay, seat: SeatId) => {
  const event = replay.events?.at(-1)
  const phase = event?.state?.phase ?? event?.phase
  return phase === 'setup' && !hasDrawnForTurn(replay, seat)
}

export const pregameCards = (
  hand: string[],
  catalog: OpeningReplay['catalog'] = {},
) =>
  hand.filter((name) => PREGAME_TEXT.test(catalog[name]?.oracle_text ?? ''))

const append = (replay: OpeningReplay, event: ReplayEvent) => {
  replay.events = [...(replay.events ?? []), event]
}

const requireLibraries = (replay: OpeningReplay, seat: SeatId) => {
  const library = replay._libraries?.[seat]
  if (!library) throw new Error(`replay is missing _libraries.${seat}`)
  return library
}

const takeFromHand = (hand: string[], cards: string[]) => {
  const next = [...hand]
  for (const card of cards) {
    const index = next.indexOf(card)
    if (index < 0) {
      throw new Error(`cannot bottom "${card}"; hand is ${hand.join(', ')}`)
    }
    next.splice(index, 1)
  }
  return next
}

export const applyMulligan = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
) => {
  const replay = readReplay(root, slug)
  if (!isOpeningFrame(replay, seat)) return false
  const last = lastEvent(replay)
  const player = last.state!.players![seat]
  if (!player) return false
  const rejected = [...(player.hand ?? [])]
  const library = requireLibraries(replay, seat)
  const attempt = seatMulligans(replay, seat) + 1
  const shuffled = shuffle(
    [...rejected, ...library],
    seededRandom(mixSeed(replay.seed ?? 0, seat, attempt)),
  )
  const hand = shuffled.slice(0, 7)
  const rest = shuffled.slice(7)
  replay._libraries![seat] = rest
  setSeatMulligans(replay, seat, attempt)
  const nextState = cloneState(last)
  nextState.players![seat] = {
    ...nextState.players![seat],
    hand,
    library_count: rest.length,
  }
  const name = seatName(replay, seat, state)
  append(replay, {
    id: nextId(replay),
    turn: 0,
    phase: 'setup',
    seat,
    kind: 'mulligan',
    summary: `${name} takes mulligan ${attempt}.`,
    cards: rejected,
    notes: 'The complete rejected seven-card hand is shown.',
    state: nextState,
  })
  writeReplay(root, slug, replay)
  const bottoms = bottomRequired(attempt)
  state.opening = { seat }
  state.active = seat
  state.actions = { [seat]: ['keep', 'mulligan'] }
  state.waiting = `${name} is choosing a new seven.`
  state.privateWaiting = {
    [seat]: bottoms === 0
      ? 'Free Commander mulligan. Keep all seven, mulligan again, or cheat-keep.'
      : `Select ${bottoms} card${bottoms === 1 ? '' : 's'} to put on the bottom, then keep. Mulligan again or cheat-keep all seven.`,
  }
  state.judge = `${name} shuffled and drew a new seven.`
  state.privateJudge = {
    [seat]: `New seven: ${hand.join(', ')}.`,
  }
  return 'mulligan'
}

export const applyKeep = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
  message: Extract<InboxMessage, { type: 'keep' }>,
) => {
  const replay = readReplay(root, slug)
  if (!isOpeningFrame(replay, seat)) return false
  const last = lastEvent(replay)
  const player = last.state!.players![seat]
  if (!player) return false
  const hand = [...(player.hand ?? [])]
  const mulligans = seatMulligans(replay, seat)
  const needed = bottomRequired(mulligans)
  const cheat = Boolean(message.cheat)
  const cards = cheat ? [] : (message.cards ?? [])
  if (!cheat && cards.length !== needed) {
    throw new Error(
      needed === 0
        ? 'Keep all seven, or mulligan.'
        : `Mulligan ${mulligans} requires ${needed} card(s) on the bottom.`,
    )
  }
  const kept = cheat ? hand : takeFromHand(hand, cards)
  const library = requireLibraries(replay, seat)
  if (!cheat) library.push(...cards)
  replay._libraries![seat] = library
  const nextState = cloneState(last)
  nextState.players![seat] = {
    ...nextState.players![seat],
    hand: kept,
    library_count: library.length,
  }
  const name = seatName(replay, seat, state)
  append(replay, {
    id: nextId(replay),
    turn: 0,
    phase: 'setup',
    seat,
    kind: 'keep',
    summary: cheat
      ? `${name} keeps 7 (test cheat).`
      : needed === 0
        ? `${name} keeps 7`
        : `${name} keeps ${kept.length}.`,
    cards: hand,
    notes: cheat
      ? 'Test cheat: no cards were put on the bottom.'
      : needed === 0
        ? 'The complete kept hand is shown.'
        : 'The complete seven-card candidate is shown before London bottoms.',
    decision: cheat ? { cheat: true, reason: 'test cheat keep-seven' } : undefined,
    state: nextState,
  })
  writeReplay(root, slug, replay)
  state.opening = undefined
  return beginFirstTurn(root, slug, state, seat)
}

export const beginFirstTurn = (
  root: string,
  slug: string,
  state: LobbyState,
  human: SeatId,
) => {
  const replay = readReplay(root, slug)
  const last = lastEvent(replay)
  const first = state.firstPlayer
  const firstName = seatName(replay, first, state)
  const humanPlayer = last.state!.players![human]
  const pending = pregameCards(humanPlayer?.hand ?? [], replay.catalog)
  if (pending.length > 0) {
    const nextState = cloneState(last)
    append(replay, {
      id: nextId(replay),
      turn: 0,
      phase: 'setup',
      seat: human,
      kind: 'note',
      summary: `${seatName(replay, human, state)} may have pregame actions.`,
      state: nextState,
    })
    writeReplay(root, slug, replay)
    state.active = human
    state.actions = { [human]: ['plan'] }
    state.waiting = `${seatName(replay, human, state)}: pregame before the first draw.`
    state.privateWaiting = {
      [human]: `Pregame possible: ${pending.join(', ')}. Play them or skip, then the first turn draws.`,
    }
    state.judge = 'Checking pregame actions before the first draw.'
    state.privateJudge = {
      [human]: `Your opening hand has beginning-of-game cards: ${pending.join(', ')}.`,
    }
    return 'pregame'
  }

  if (hasDrawnForTurn(replay, first)) {
    state.actions = { [first]: ['plan'] }
    state.waiting = `${firstName}: send a turn plan.`
    state.privateWaiting = {}
    state.judge = 'The first turn is ready.'
    return 'ready'
  }

  const library = requireLibraries(replay, first)
  const drawn = library.shift()
  if (!drawn) throw new Error(`${first} library is empty`)
  replay._libraries![first] = library
  let nextState = cloneState(last)
  nextState.active = first
  nextState.turn = 1
  nextState.phase = 'untap'
  append(replay, {
    id: nextId(replay),
    turn: 1,
    phase: 'untap',
    seat: first,
    kind: 'note',
    summary: `Turn 1 — ${firstName} untaps.`,
    state: nextState,
  })
  nextState = cloneState(replay.events!.at(-1)!)
  nextState.phase = 'upkeep'
  append(replay, {
    id: nextId(replay),
    turn: 1,
    phase: 'upkeep',
    seat: first,
    kind: 'note',
    summary: `Upkeep — no triggers.`,
    state: nextState,
  })
  nextState = cloneState(replay.events!.at(-1)!)
  nextState.phase = 'draw'
  nextState.players![first] = {
    ...nextState.players![first],
    hand: [...(nextState.players![first].hand ?? []), drawn],
    library_count: library.length,
  }
  append(replay, {
    id: nextId(replay),
    turn: 1,
    phase: 'draw',
    seat: first,
    kind: 'draw',
    summary: `${firstName} draws for turn.`,
    cards: [drawn],
    state: nextState,
  })
  nextState = cloneState(replay.events!.at(-1)!)
  nextState.phase = 'planning'
  append(replay, {
    id: nextId(replay),
    turn: 1,
    phase: 'planning',
    seat: first,
    kind: 'think',
    summary: `Turn 1 — ${firstName} to act.`,
    state: nextState,
  })
  writeReplay(root, slug, replay)
  state.active = first
  state.actions = { [first]: ['plan'] }
  state.waiting = `${firstName}: send a turn plan.`
  state.privateWaiting = {}
  state.judge = 'First-turn draw is done. Waiting on a plan.'
  state.privateJudge = {}
  return 'draw'
}

export const applyOpeningMessage = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
  message: InboxMessage,
) => {
  if (message.type === 'mulligan') return applyMulligan(root, slug, state, seat)
  if (message.type === 'keep') return applyKeep(root, slug, state, seat, message)
  return false
}
