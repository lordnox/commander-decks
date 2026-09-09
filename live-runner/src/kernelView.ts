import { replayComparableState } from '../../rules-engine/src/replay'
import type { GameState, PlayerId } from '../../rules-engine/src/types'
import type { LiveHistoryFrame, LiveSeat, LiveSnapshot } from '../../site/src/liveCodec'
import { SEAT_COLORS, SEAT_IDS } from '../../site/src/liveCompact'
import type { LobbyState } from './lobby'
import type { SeatId } from './protocol'

const deckPath = (path?: string) => path || ''

export const liveSeatsFromState = (
  state: GameState,
  lobby: LobbyState,
  viewer: PlayerId | null,
): LiveSeat[] => {
  const comparable = replayComparableState(state)
  return state.playerOrder.map((seat, index) => {
    const player = comparable.players[seat]
    const occupant = lobby.occupants[seat as SeatId]
    const handHidden = viewer !== seat
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
  viewer: PlayerId | null
  history?: LiveHistoryFrame[]
  historyCursor?: number
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
    judge: viewer && lobby.privateJudge[viewer as SeatId]
      ? lobby.privateJudge[viewer as SeatId]
      : lobby.judge,
    judgeHistory: viewer ? lobby.judgeHistory[viewer as SeatId] : undefined,
    youAct: Boolean(viewer && priority === viewer),
    actions: viewer && lobby.actions[viewer as SeatId]
      ? lobby.actions[viewer as SeatId]
      : [],
    actionId: viewer ? lobby.actionIds[viewer as SeatId] : undefined,
    events: [],
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
  viewer: PlayerId | null,
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
