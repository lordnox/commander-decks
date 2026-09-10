import { replayComparableState } from '../../rules-engine/src/replay'
import type { EventTrace, GameState, ManaPool, PlayerId } from '../../rules-engine/src/types'
import type {
  LiveEvent,
  LiveHistoryFrame,
  LiveSeat,
  LiveSnapshot,
} from '../../site/src/liveCodec'
import { SEAT_COLORS } from '../../site/src/liveCompact'
import type { LobbyState } from './lobby'
import { isSeatId, type SeatId } from './protocol'

const deckPath = (path?: string) => path || ''

const manaText = (mana: Partial<ManaPool>) =>
  Object.entries(mana)
    .filter(([, amount]) => amount)
    .map(([symbol, amount]) => `${amount} {${symbol}}`)
    .join(', ')

const traceSummary = (trace: EventTrace, state: GameState) => {
  const { event } = trace
  let summary: string
  switch (event.type) {
    case 'activateAbility':
      summary = `${event.seat} activates ${event.abilityId}`
      break
    case 'payMana':
      summary = `${event.seat} pays ${event.cost}`
      break
    case 'tap':
      summary = `${state.objects[event.objectId]?.name ?? 'A permanent'} taps`
      break
    case 'addMana':
      summary = `${event.seat} adds ${manaText(event.mana)}`
      break
    case 'emptyManaPools':
      summary = 'Empty mana pools'
      break
    case 'loseLife':
      summary = `${event.seat} loses ${event.amount} life`
      break
    case 'custom':
      summary = event.name
      break
    default:
      summary = event.type
  }
  const outcome = trace.outcome === 'applied'
    ? ''
    : ` — ${trace.outcome}${trace.pluginId ? ` by ${trace.pluginId}` : ''}`
  return `${'↳ '.repeat(trace.depth)}${summary}${outcome}`
}

export const liveEventFromTrace = (
  trace: EventTrace,
  state: GameState,
  id: number,
): LiveEvent => {
  const comparable = replayComparableState(state)
  const event = trace.event
  return {
    id,
    turn: comparable.turn,
    phase: comparable.phase,
    ...('seat' in event ? { seat: event.seat ?? null } : {}),
    kind: `kernel-${trace.outcome}`,
    summary: traceSummary(trace, state),
  }
}

const liveSeatId = (player: PlayerId): SeatId => {
  if (!isSeatId(player)) throw new Error(`live host cannot project player ${player}`)
  return player
}

export const liveSeatsFromState = (
  state: GameState,
  lobby: LobbyState,
  viewer: SeatId | null,
): LiveSeat[] => {
  const comparable = replayComparableState(state)
  return state.playerOrder.map((playerId, index) => {
    const seat = liveSeatId(playerId)
    const player = comparable.players[playerId]
    const occupant = lobby.occupants[seat]
    const handHidden = viewer !== playerId
    return {
      id: seat,
      name: occupant?.name || seat,
      deck: deckPath(occupant?.deck),
      commanders: player.command,
      color: SEAT_COLORS[index] ?? SEAT_COLORS[0],
      life: player.life,
      poison: player.poison,
      commander_tax: 0,
      library_count: player.library_count,
      hand_count: state.zoneCounts[seat].hand,
      ...(handHidden ? {} : { hand: player.hand }),
      commander_damage: Object.fromEntries(
        state.playerOrder
          .filter((other) => other !== seat)
          .map((other) => [other, 0]),
      ),
      battlefield: player.battlefield,
      graveyard: player.graveyard,
      exile: player.exile,
      command: player.command,
    }
  })
}

export const liveSnapshotFromState = (options: {
  state: GameState
  lobby: LobbyState
  viewer: SeatId | null
  history?: LiveHistoryFrame[]
  historyCursor?: number
  events?: LiveEvent[]
}): LiveSnapshot => {
  const { state, lobby, viewer } = options
  const comparable = replayComparableState(state)
  const seats = liveSeatsFromState(state, lobby, viewer)
  const priority = state.priority
  return {
    v: 1,
    you: viewer,
    headline: seats.map((seat) => seat.name).join(' / ') || 'Live table',
    waiting: lobby.waiting,
    talk: lobby.talk,
    judge: viewer && lobby.privateJudge[viewer]
      ? lobby.privateJudge[viewer]
      : lobby.judge,
    judgeHistory: viewer ? lobby.judgeHistory[viewer] : undefined,
    youAct: Boolean(viewer && priority === viewer),
    actions: viewer && lobby.actions[viewer]
      ? lobby.actions[viewer]
      : [],
    actionId: viewer ? lobby.actionIds[viewer] : undefined,
    events: options.events ?? [],
    turn: comparable.turn,
    phase: comparable.phase,
    active: comparable.active,
    stack: comparable.stack,
    seats,
    catalog: {},
    history: options.history,
    historyCursor: options.historyCursor,
    replica: state,
  }
}

export const historyFrameFromState = (
  state: GameState,
  lobby: LobbyState,
  viewer: SeatId | null,
  summary: string,
): LiveHistoryFrame => {
  const comparable = replayComparableState(state)
  return {
    seq: 0,
    summary,
    turn: comparable.turn,
    phase: comparable.phase,
    active: comparable.active,
    seats: liveSeatsFromState(state, lobby, viewer),
  }
}
