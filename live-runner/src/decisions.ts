import { readFileSync, writeFileSync } from 'node:fs'
import type { LobbyState, TopdeckDecision } from './lobby'
import {
  SEAT_IDS,
  type InboxMessage,
  type SeatId,
} from './protocol'
import { replayPath } from './session'

type PlayerState = {
  hand?: string[]
  graveyard?: string[]
  exile?: string[]
  library_count?: number
  revealed_top?: string[]
  battlefield?: Array<{ name?: string; tapped?: boolean; [key: string]: unknown }>
  [key: string]: unknown
}

type ReplayState = {
  active?: SeatId
  turn?: number
  phase?: string
  stack?: Array<{
    name?: string
    controller?: SeatId
    text?: string
    choice?: {
      kind?: string
      count?: number
      destinations?: Array<'top' | 'bottom' | 'graveyard' | 'hand' | 'exile'>
      requirements?: TopdeckDecision['requirements']
    }
    [key: string]: unknown
  }>
  players?: Record<string, PlayerState>
}

type ReplayEvent = {
  id?: number
  turn?: number
  phase?: string
  seat?: SeatId | null
  kind?: string
  summary?: string
  cards?: string[]
  state?: ReplayState
}

type Replay = {
  events?: ReplayEvent[]
  catalog?: Record<string, { oracle_text?: string }>
  _libraries?: Record<string, string[]>
}

const readReplay = (root: string, slug: string) =>
  JSON.parse(readFileSync(replayPath(slug, root), 'utf8')) as Replay

const writeReplay = (root: string, slug: string, replay: Replay) => {
  writeFileSync(replayPath(slug, root), `${JSON.stringify(replay, null, 2)}\n`)
}

const latest = (replay: Replay) => {
  const event = replay.events?.at(-1)
  if (!event?.state?.players) throw new Error('replay is missing table state')
  return event
}

const nextId = (replay: Replay) =>
  (replay.events?.at(-1)?.id ?? (replay.events?.length ?? 1) - 1) + 1

const effectFromStack = (state: ReplayState) => {
  const item = state.stack?.at(-1)
  if (!item?.controller) return null
  const structured = item.choice
  if (
    structured?.kind
    && Number.isSafeInteger(structured.count)
    && structured.count! > 0
    && Array.isArray(structured.destinations)
    && structured.destinations.length > 1
  ) {
    return {
      item,
      kind: structured.kind,
      count: structured.count!,
      seat: item.controller,
      destinations: structured.destinations,
      requirements: structured.requirements,
    }
  }
  if (!item.text) return null
  const match = item.text.match(/\b(surveil|scry)\s+(\d+)\b/i)
  if (!match) return null
  const kind = match[1].toLowerCase() as 'surveil' | 'scry'
  const count = Number(match[2])
  if (!Number.isSafeInteger(count) || count < 1) return null
  return {
    item,
    kind,
    count,
    seat: item.controller,
    destinations: kind === 'surveil'
      ? ['top', 'graveyard'] as const
      : ['top', 'bottom'] as const,
  }
}

const privatePrompt = (decision: TopdeckDecision) => {
  return `${decision.kind[0].toUpperCase()}${decision.kind.slice(1)} ${decision.cards.length}: choose ${decision.destinations.join(' or ')} for each card.`
}

export const prepareTopdeckDecision = (
  root: string,
  slug: string,
  state: LobbyState,
) => {
  const replay = readReplay(root, slug)
  const event = latest(replay)
  const effect = effectFromStack(event.state!)
  if (!effect) return false
  const library = replay._libraries?.[effect.seat]
  if (!library || library.length < effect.count) {
    throw new Error(`${effect.seat} library cannot satisfy ${effect.kind} ${effect.count}`)
  }
  const cards = library.slice(0, effect.count)
  state.topdeck = {
    seat: effect.seat,
    kind: effect.kind,
    cards,
    destinations: [...effect.destinations],
    requirements: effect.requirements,
  }
  state.active = effect.seat
  state.actions = { [effect.seat]: ['topdeck'] }
  state.waiting = `${state.occupants[effect.seat]?.name ?? effect.seat} is making a private ${effect.kind} choice.`
  state.privateWaiting = { [effect.seat]: privatePrompt(state.topdeck) }
  state.judge = `Waiting for a private ${effect.kind} choice.`
  state.privateJudge = {}
  return true
}

const sameCards = (left: string[], right: string[]) => {
  const sorted = (cards: string[]) => [...cards].sort((a, b) => a.localeCompare(b))
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
}

export const MAX_HAND_SIZE = 7

const seatName = (state: LobbyState, seat: SeatId) =>
  state.occupants[seat]?.name ?? seat

/** Append the cleanup step and hand the turn to the next seat, on disk. */
export const endTurnAt = (
  root: string,
  slug: string,
  state: LobbyState,
  active: SeatId,
  turn: number,
) => {
  const replay = readReplay(root, slug)
  const next = endTurn(replay, state, active, turn)
  writeReplay(root, slug, replay)
  return next
}

/** Append the cleanup step and hand the turn to the next seat. */
const endTurn = (
  replay: Replay,
  state: LobbyState,
  active: SeatId,
  turn: number,
) => {
  const base = replay.events?.at(-1)?.state
  if (!base) throw new Error('replay is missing table state')
  const next = SEAT_IDS[(SEAT_IDS.indexOf(active) + 1) % SEAT_IDS.length]
  const nextTurn = turn + (next === state.firstPlayer ? 1 : 0)
  const cleanupState = structuredClone(base)
  cleanupState.active = active
  cleanupState.turn = turn
  cleanupState.phase = 'end'
  const planningState = structuredClone(base)
  planningState.active = next
  planningState.turn = nextTurn
  planningState.phase = 'planning'
  replay.events!.push({
    id: nextId(replay),
    turn,
    phase: 'end',
    seat: active,
    kind: 'note',
    summary: `Cleanup — no actions. ${seatName(state, active)}'s turn ends.`,
    state: cleanupState,
  })
  replay.events!.push({
    id: nextId(replay),
    turn: nextTurn,
    phase: 'planning',
    seat: next,
    kind: 'think',
    summary: `Turn ${nextTurn} — ${seatName(state, next)} to act.`,
    state: planningState,
  })
  return next
}

/**
 * Ask the seat which cards leave a hand over the maximum size. Cleanup cannot
 * finish until they answer, so the turn ends with the discard recorded.
 */
export const prepareDiscardDecision = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
) => {
  const replay = readReplay(root, slug)
  const event = latest(replay)
  const hand = event.state!.players![seat]?.hand ?? []
  const excess = hand.length - MAX_HAND_SIZE
  if (excess <= 0) return false
  state.topdeck = {
    seat,
    kind: 'discard',
    cards: [...hand],
    destinations: ['hand', 'graveyard'],
    requirements: { graveyard: { min: excess, max: excess } },
  }
  state.active = seat
  state.actions = { [seat]: ['topdeck'] }
  state.waiting = `${seatName(state, seat)} is discarding to ${MAX_HAND_SIZE}.`
  state.privateWaiting = {
    [seat]: `Hand size is ${hand.length}. Choose ${excess} card${
      excess === 1 ? '' : 's'
    } to discard, then the turn ends.`,
  }
  state.judge = `${seatName(state, seat)} is over the maximum hand size.`
  state.privateJudge = {}
  return true
}

/**
 * A turn that ended while a seat was still over the maximum hand size owes a
 * discard. The boundary is the cleanup event, or the next seat's planning
 * event before anything else has happened.
 */
export const enforceHandSize = (
  root: string,
  slug: string,
  state: LobbyState,
) => {
  const replay = readReplay(root, slug)
  const events = replay.events ?? []
  const last = events.at(-1)
  if (!last?.state) return false
  const cleanup = last.phase === 'end'
    ? last
    : last.phase === 'planning' && events.at(-2)?.phase === 'end'
      ? events.at(-2)
      : undefined
  const seat = cleanup?.seat
  if (!seat || !SEAT_IDS.includes(seat)) return false
  const hand = last.state.players?.[seat]?.hand ?? []
  if (hand.length <= MAX_HAND_SIZE) return false
  return prepareDiscardDecision(root, slug, state, seat)
}

const applyDiscardChoice = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
  message: Extract<InboxMessage, { type: 'topdeck' }>,
) => {
  const replay = readReplay(root, slug)
  const event = latest(replay)
  const hand = event.state!.players![seat]?.hand ?? []
  if (!sameCards(message.choices.map(({ card }) => card), hand)) {
    throw new Error('Your hand changed. Refresh this discard.')
  }
  const discarded = message.choices
    .filter(({ destination }) => destination === 'graveyard')
    .map(({ card }) => card)
  const kept = message.choices
    .filter(({ destination }) => destination === 'hand')
    .map(({ card }) => card)
  if (kept.length > MAX_HAND_SIZE) {
    throw new Error(`Discard down to ${MAX_HAND_SIZE} cards.`)
  }

  const turn = event.turn ?? event.state!.turn ?? 0
  const nextState = structuredClone(event.state!)
  const player = nextState.players![seat]
  player.hand = kept
  player.graveyard = [...(player.graveyard ?? []), ...discarded]
  replay.events!.push({
    id: nextId(replay),
    turn,
    phase: 'end',
    seat,
    kind: 'discard',
    summary: `${seatName(state, seat)} discards ${discarded.length} at cleanup.`,
    cards: discarded,
    state: nextState,
  })
  const next = endTurn(replay, state, seat, turn)
  writeReplay(root, slug, replay)

  state.topdeck = undefined
  state.active = next
  state.actions = { [next]: ['plan', 'advance'] }
  state.waiting = `Waiting on ${seatName(state, next)}.`
  state.privateWaiting = {}
  state.judge = `${seatName(state, seat)} discarded ${discarded.length} at cleanup.`
  state.privateJudge = {
    [seat]: `Discarded: ${discarded.join(', ')}.`,
  }
  return true
}

export const applyTopdeckChoice = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
  message: Extract<InboxMessage, { type: 'topdeck' }>,
) => {
  const decision = state.topdeck
  if (!decision || decision.seat !== seat) return false
  const cards = message.choices.map(({ card }) => card)
  if (!sameCards(cards, decision.cards)) {
    throw new Error(
      decision.kind === 'discard'
        ? 'Your hand changed. Refresh this discard.'
        : 'The library changed. Refresh this top-deck choice.',
    )
  }
  if (
    message.choices.some(
      ({ destination }) => !decision.destinations.includes(destination),
    )
  ) {
    throw new Error(`Invalid ${decision.kind} destination.`)
  }
  for (const [destination, limits] of Object.entries(
    decision.requirements ?? {},
  )) {
    const count = message.choices.filter(
      (choice) => choice.destination === destination,
    ).length
    if (limits.min !== undefined && count < limits.min) {
      throw new Error(`${decision.kind} requires at least ${limits.min} card(s) in ${destination}.`)
    }
    if (limits.max !== undefined && count > limits.max) {
      throw new Error(`${decision.kind} allows at most ${limits.max} card(s) in ${destination}.`)
    }
  }

  if (decision.kind === 'discard') {
    return applyDiscardChoice(root, slug, state, seat, message)
  }

  const replay = readReplay(root, slug)
  const event = latest(replay)
  const effect = effectFromStack(event.state!)
  if (!effect || effect.seat !== seat || effect.kind !== decision.kind) {
    throw new Error('That top-deck effect is no longer on the stack.')
  }
  const library = replay._libraries?.[seat]
  if (!library || !sameCards(library.slice(0, cards.length), decision.cards)) {
    throw new Error('The library changed. Refresh this top-deck choice.')
  }

  const top = message.choices
    .filter(({ destination }) => destination === 'top')
    .map(({ card }) => card)
  const bottom = message.choices
    .filter(({ destination }) => destination === 'bottom')
    .map(({ card }) => card)
  const graveyard = message.choices
    .filter(({ destination }) => destination === 'graveyard')
    .map(({ card }) => card)
  const hand = message.choices
    .filter(({ destination }) => destination === 'hand')
    .map(({ card }) => card)
  const exile = message.choices
    .filter(({ destination }) => destination === 'exile')
    .map(({ card }) => card)
  const nextLibrary = [
    ...top,
    ...library.slice(cards.length),
    ...bottom,
  ]
  replay._libraries![seat] = nextLibrary

  const nextState = structuredClone(event.state!)
  nextState.stack = [...(nextState.stack ?? [])]
  nextState.stack.pop()
  const player = nextState.players![seat]
  player.graveyard = [...(player.graveyard ?? []), ...graveyard]
  player.hand = [...(player.hand ?? []), ...hand]
  player.exile = [...(player.exile ?? []), ...exile]
  player.library_count = nextLibrary.length
  player.revealed_top = []
  const destinations = message.choices
    .map(({ destination }) => destination)
    .join(', ')
  replay.events!.push({
    id: nextId(replay),
    turn: event.turn,
    phase: event.phase,
    seat,
    kind: decision.kind,
    summary: `${state.occupants[seat]?.name ?? seat} resolves ${decision.kind} ${cards.length}.`,
    cards,
    state: nextState,
  })
  writeReplay(root, slug, replay)

  state.topdeck = undefined
  state.actions = { [seat]: ['plan', 'advance'] }
  state.waiting = `${state.occupants[seat]?.name ?? seat}: act again or advance to the next phase.`
  state.privateWaiting = {}
  state.judge = `${state.occupants[seat]?.name ?? seat} resolved ${decision.kind}.`
  state.privateJudge = {
    [seat]: `${decision.kind} ${cards.length}: ${destinations}.`,
  }
  return true
}

/**
 * Anything that can want a choice or a trigger between untap and the first
 * main phase. A match hands the turn open back to the judge.
 */
const TURN_OPEN_TRIGGER =
  /beginning of (your|each|the) (next )?(untap|upkeep|draw)|skips? (your|their|his or her) (next )?draw step|draws? an additional card|at the beginning of the upkeep/i

export const turnOpenTriggers = (replay: Replay, state: ReplayState) => {
  const catalog = replay.catalog ?? {}
  const names = SEAT_IDS.flatMap((seat) =>
    (state.players?.[seat]?.battlefield ?? []).map((card) => card?.name ?? ''),
  )
  return [...new Set(names)].filter(
    (name) => name && TURN_OPEN_TRIGGER.test(catalog[name]?.oracle_text ?? ''),
  )
}

const drewThisTurn = (replay: Replay, seat: SeatId, turn: number) =>
  (replay.events ?? []).some(
    (event) =>
      event.kind === 'draw' && event.seat === seat && event.turn === turn,
  )

/**
 * Walk untap, upkeep, and the draw for a turn that has nothing to decide, so
 * a seat reaches its first main phase without a judge round trip.
 */
export const openTurn = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
) => {
  const replay = readReplay(root, slug)
  const event = latest(replay)
  const blocked = turnOpenTriggers(replay, event.state!)
  if (blocked.length > 0) {
    throw new Error(
      `${blocked.join(', ')} can trigger before your main phase. Send a plan so the judge resolves it.`,
    )
  }
  const turn = event.turn ?? event.state!.turn ?? 0
  const name = state.occupants[seat]?.name ?? seat
  const append = (next: ReplayEvent) => {
    replay.events!.push({ ...next, id: nextId(replay) })
  }
  const carried = () => structuredClone(replay.events!.at(-1)!.state!)

  const untapped = structuredClone(event.state!)
  untapped.phase = 'untap'
  const player = untapped.players![seat]
  player.battlefield = (player.battlefield ?? []).map((card) => ({
    ...card,
    tapped: false,
  }))
  append({
    turn,
    phase: 'untap',
    seat,
    kind: 'untap',
    summary: `${name} untaps.`,
    state: untapped,
  })

  const upkeep = carried()
  upkeep.phase = 'upkeep'
  append({
    turn,
    phase: 'upkeep',
    seat,
    kind: 'note',
    summary: 'Upkeep — no triggers.',
    state: upkeep,
  })

  let drawn: string | undefined
  if (!drewThisTurn(replay, seat, turn)) {
    const library = replay._libraries?.[seat]
    if (!library?.length) throw new Error(`${seat} library is empty`)
    drawn = library.shift()!
    replay._libraries![seat] = library
    const draw = carried()
    draw.phase = 'draw'
    draw.players![seat] = {
      ...draw.players![seat],
      hand: [...(draw.players![seat].hand ?? []), drawn],
      library_count: library.length,
    }
    append({
      turn,
      phase: 'draw',
      seat,
      kind: 'draw',
      summary: `${name} draws ${drawn}.`,
      cards: [drawn],
      state: draw,
    })
  }

  const main = carried()
  main.phase = 'main1'
  append({
    turn,
    phase: 'main1',
    seat,
    kind: 'note',
    summary: `${name} moves to the first main phase.`,
    state: main,
  })
  writeReplay(root, slug, replay)

  state.actions = { [seat]: ['plan', 'advance'] }
  state.waiting = `${name}: act or advance to the next phase.`
  state.privateWaiting = {}
  state.judge = `${name} untapped and drew for turn.`
  state.privateJudge = drawn ? { [seat]: `You drew ${drawn}.` } : {}
  return true
}

const NEXT_PHASE = {
  main1: 'combat',
  combat: 'main2',
  main2: 'end',
} as const

export const applyAdvance = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
) => {
  const replay = readReplay(root, slug)
  const event = latest(replay)
  const current = event.state!.phase ?? event.phase
  if (
    event.state!.active !== seat
    || (event.state!.stack?.length ?? 0) > 0
  ) {
    return false
  }
  if (current === 'planning') return openTurn(root, slug, state, seat)
  const next = NEXT_PHASE[current as keyof typeof NEXT_PHASE]
  if (!next) return false
  const nextState = structuredClone(event.state!)
  nextState.phase = next
  const name = state.occupants[seat]?.name ?? seat
  replay.events!.push({
    id: nextId(replay),
    turn: event.turn,
    phase: next,
    seat,
    kind: 'note',
    summary: next === 'combat'
      ? `${name} moves to combat.`
      : next === 'main2'
        ? `${name} moves to the second main phase.`
        : `${name} moves to the end step.`,
    state: nextState,
  })

  if (next === 'end') {
    const responders = SEAT_IDS.filter((candidate) => candidate !== seat)
    replay.events!.push({
      id: nextId(replay),
      turn: event.turn,
      phase: 'priority',
      seat: null,
      kind: 'priority',
      summary: `End step priority: ${responders.join(', ')} may respond or pass.`,
      state: { ...structuredClone(nextState), phase: 'priority' },
    })
    state.actions = Object.fromEntries(
      responders.map((candidate) => [candidate, ['plan', 'pass']]),
    )
    state.waiting = 'End step priority is open.'
  } else {
    state.actions = { [seat]: ['plan', 'advance'] }
    state.waiting = `${name}: act or advance to the next phase.`
  }
  writeReplay(root, slug, replay)
  state.privateWaiting = {}
  state.privateJudge = {}
  state.judge = next === 'end'
    ? `${name} ended the turn; priority is open.`
    : `${name} advanced to ${next}.`
  return true
}

export const applyDeterministicChoice = (
  root: string,
  slug: string,
  state: LobbyState,
  seat: SeatId,
  message: InboxMessage,
) => {
  if (message.type === 'topdeck') {
    return applyTopdeckChoice(root, slug, state, seat, message)
  }
  if (message.type === 'advance') {
    return applyAdvance(root, slug, state, seat)
  }
  return false
}
