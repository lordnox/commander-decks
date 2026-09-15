import { inflateSync } from 'node:zlib'
import { describe, expect, test } from 'bun:test'
import { expandLiveWire, type LiveWireV2 } from '../../site/src/liveCompact'
import { normalizeSeats } from '../../site/src/liveCodec'
import { applyInbox, createLobby, rollTurnOrder } from './lobby'
import { encodeLobby, lobbyWire } from './snapshot'

const decodePayload = (payload: string) => {
  const body = payload.slice('v2.'.length)
  const padded = body.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (body.length % 4)) % 4)
  return JSON.parse(inflateSync(Buffer.from(padded, 'base64')).toString()) as LiveWireV2
}

describe('lobby snapshots', () => {
  test('Pages can expand a runner lobby frame with seat actions', () => {
    const state = createLobby('Pod')
    applyInbox(state, 'p1', { type: 'join', name: 'Alpha', deck: 'decks/a' })
    applyInbox(state, 'p2', { type: 'join', name: 'Beta', deck: 'decks/b' })
    state.actions = { p2: ['plan', 'pass'] }
    state.actionIds = { p1: 0, p2: 4, p3: 0, p4: 0 }

    const snapshot = expandLiveWire(decodePayload(encodeLobby(state, 'p2')))
    const seats = normalizeSeats(snapshot.seats)
    expect(snapshot.you).toBe('p2')
    expect(snapshot.youAct).toBe(true)
    expect(snapshot.actions).toEqual(['plan', 'pass'])
    expect(snapshot.actionId).toBe(4)
    expect(snapshot.headline).toContain('Beta')
    expect(seats[1]?.name).toBe('Beta')
    expect(seats[1]?.hand).toBeUndefined()
    expect(seats[1]?.library_count).toBe(99)
  })

  test('four ready does not deal a board into the lobby wire', () => {
    const state = createLobby('Pod')
    for (const [seat, name] of [
      ['p1', 'A'],
      ['p2', 'B'],
      ['p3', 'C'],
      ['p4', 'D'],
    ] as const) {
      applyInbox(state, seat, { type: 'join', name, deck: `decks/${name}` })
    }
    for (const seat of ['p1', 'p2', 'p3', 'p4'] as const) {
      applyInbox(state, seat, { type: 'ready' })
    }
    rollTurnOrder(state, { p1: 4, p2: 3, p3: 2, p4: 1 })
    for (const seat of ['p1', 'p2', 'p3', 'p4'] as const) {
      applyInbox(state, seat, { type: 'pregame', cards: [] })
    }
    for (const seat of ['p1', 'p2', 'p3', 'p4'] as const) {
      applyInbox(state, seat, { type: 'ready' })
    }
    expect(state.phase).toBe('play')
    expect(state.judge).toBe('All seats ready. Dealing.')

    const wire = lobbyWire(state, 'p1')
    expect(wire.d).toBeUndefined()
    expect(wire.z).toEqual(lobbyWire(createLobby(), 'p1').z)
  })
})
