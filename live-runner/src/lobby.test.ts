import { describe, expect, test } from 'bun:test'
import {
  applyInbox,
  createLobby,
  restoreLobby,
  rollTurnOrder,
  type LobbyState,
} from './lobby'
import { SEAT_IDS } from './protocol'

const joinAll = (headline = 'Pod') => {
  const state = createLobby(headline)
  applyInbox(state, 'p1', { type: 'join', name: 'A', deck: 'decks/a' })
  applyInbox(state, 'p2', { type: 'join', name: 'B', deck: 'decks/b' })
  applyInbox(state, 'p3', { type: 'join', name: 'C', deck: 'decks/c' })
  applyInbox(state, 'p4', { type: 'join', name: 'D', deck: 'decks/d' })
  return state
}

describe('lobby', () => {
  test('join then seating, swap, dice, pregame, ready, play', () => {
    const state = joinAll()
    expect(state.phase).toBe('seated')
    expect(state.waiting).toContain('Send ready to confirm')

    applyInbox(state, 'p1', { type: 'swap', with: 'p3' })
    for (const seat of SEAT_IDS) {
      applyInbox(state, seat, { type: 'ready' })
    }
    expect(state.occupants.p1?.name).toBe('C')
    expect(state.occupants.p3?.name).toBe('A')
    expect(state.phase).toBe('seated')
    expect(state.judge).toContain('p1: C')
    expect(state.talk).toBe('')

    for (const seat of SEAT_IDS) {
      applyInbox(state, seat, { type: 'ready' })
    }
    expect(state.waiting).toBe('Rolling turn order')

    rollTurnOrder(state, { p1: 2, p2: 20, p3: 3, p4: 4 })
    expect(state.firstPlayer).toBe('p2')
    expect(state.phase).toBe('pregame')
    expect(state.waiting).toBe('p2: pregame?')

    applyInbox(state, 'p2', { type: 'pregame', cards: ['Leyline of Sanctity'] })
    expect(state.waiting).toBe('p3: pregame?')
    applyInbox(state, 'p3', { type: 'pregame', cards: [] })
    applyInbox(state, 'p4', { type: 'pregame', cards: [] })
    applyInbox(state, 'p1', { type: 'pregame', cards: [] })
    expect(state.phase).toBe('ready')
    expect(state.waiting).toBe('Can we start?')

    applyInbox(state, 'p1', { type: 'talk', text: 'wait, swap seats' })
    expect(state.phase).toBe('seated')
    expect(state.ready).toEqual([])

    for (const seat of SEAT_IDS) {
      applyInbox(state, seat, { type: 'ready' })
    }
    rollTurnOrder(state, { p1: 1, p2: 2, p3: 3, p4: 4 })
    for (const seat of ['p4', 'p1', 'p2', 'p3'] as const) {
      applyInbox(state, seat, { type: 'pregame', cards: [] })
    }
    for (const seat of SEAT_IDS) {
      applyInbox(state, seat, { type: 'ready' })
    }
    expect(state.phase).toBe('play')
  })

  test('keeps control messages out of social table talk', () => {
    const state = createLobby()
    state.phase = 'play'

    applyInbox(state, 'p1', { type: 'plan', text: 'Cast a hidden card.' })
    applyInbox(state, 'p1', { type: 'confirm' })
    applyInbox(state, 'p2', { type: 'pass' })
    expect(state.talk).toBe('')
    expect(state.judge).toBe('p2 passes.')

    applyInbox(state, 'p4', { type: 'talk', text: 'Nice draw!' })
    expect(state.talk).toBe('p4: Nice draw!')
  })

  test('adds action state without clearing version two table talk', () => {
    const saved = {
      ...createLobby(),
      communicationVersion: 2,
      talk: 'p4: Good luck!',
      judge: 'Priority is open.',
    } as unknown as LobbyState

    const restored = restoreLobby(saved, 'Pod')
    expect(restored.communicationVersion).toBe(5)
    expect(restored.talk).toBe('p4: Good luck!')
    expect(restored.judge).toContain('Earlier judge details were cleared')
    expect(restored.privateJudge).toEqual({})
    expect(restored.actions).toEqual({})
    expect(restored.actionIds).toEqual({ p1: 0, p2: 0, p3: 0, p4: 0 })
  })

  test('clears legacy judge detail without losing a live action window', () => {
    const saved = {
      ...createLobby(),
      communicationVersion: 4,
      judge: 'Strategic details from an old public note.',
      privateJudge: {},
      actions: { p2: ['plan', 'pass'] },
      actionIds: { p1: 1, p2: 8, p3: 5, p4: 5 },
    } as unknown as LobbyState

    const restored = restoreLobby(saved, 'Pod')
    expect(restored.communicationVersion).toBe(5)
    expect(restored.judge).toContain('Earlier judge details were cleared')
    expect(restored.privateJudge).toEqual({})
    expect(restored.actions).toEqual({ p2: ['plan', 'pass'] })
    expect(restored.actionIds).toEqual({ p1: 1, p2: 8, p3: 5, p4: 5 })
  })
})
