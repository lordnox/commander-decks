import { deflateSync } from 'node:zlib'
import { SEAT_IDS, type SeatId } from './protocol'
import type { LobbyState } from './lobby'

const HIDDEN = 0
const ABSENT = 0
const COLORS = ['#c45c26', '#2f6f64', '#4a5d9e', '#8a3d6b']
const ACTION_BITS = { plan: 1, confirm: 2, replace: 4, pass: 8 } as const

const emptyPackedSeat = () => [
  [40, 0, 0, 99, 0],
  [0, 0, 0, 0],
  [],
  HIDDEN,
  [],
  [],
  [],
  [],
  ABSENT,
]

const toBase64Url = (bytes: Buffer) =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

export const encodeWire = (wire: object) => {
  const compressed = deflateSync(Buffer.from(JSON.stringify(wire)))
  return `v2.${toBase64Url(compressed)}`
}

export const lobbyWire = (state: LobbyState, you?: SeatId) => {
  const names = SEAT_IDS.map(
    (seat, index) => state.occupants[seat]?.name || `Seat ${index + 1}`,
  )
  const wire: Record<string, unknown> = {
    v: 2,
    h: names.join(' / ') || 'Live table',
    w: state.waiting,
    k: state.talk,
    j: state.judge,
    t: 0,
    p: 0,
    a: SEAT_IDS.indexOf(state.active),
    n: names,
    c: COLORS,
    z: SEAT_IDS.map(() => emptyPackedSeat()),
  }
  if (you) {
    wire.y = SEAT_IDS.indexOf(you)
    const actions = state.actions[you] ?? []
    const actionMask = actions.reduce(
      (mask, action) => mask | ACTION_BITS[action],
      0,
    )
    if (actionMask) {
      wire.u = 1
      wire.r = actionMask
    }
    wire.i = state.actionIds[you]
  }
  return wire
}

export const encodeLobby = (state: LobbyState, you?: SeatId) =>
  encodeWire(lobbyWire(state, you))
