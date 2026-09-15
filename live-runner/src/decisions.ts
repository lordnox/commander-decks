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
    throw new Error('The library changed. Refresh this top-deck choice.')
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
  const next = NEXT_PHASE[current as keyof typeof NEXT_PHASE]
  if (
    event.state!.active !== seat
    || !next
    || (event.state!.stack?.length ?? 0) > 0
  ) {
    return false
  }
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
