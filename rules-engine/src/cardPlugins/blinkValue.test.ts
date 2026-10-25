import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingPlayerSelection } from '../rules/selectPlayers'

describe('Lady Evangela blink and value cards', () => {
  test('Queza queues a typed opponent choice and drains only the chosen player', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [forest()] },
      battlefield: {
        p1: [cardTemplate('Queza, Augur of Agonies', { types: ['Creature'] })],
      },
    }, { random: () => 0.5 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    const pending = pendingPlayerSelection(state, 'p1')!
    expect(pending.candidates).toEqual(['p2', 'p3', 'p4'])
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      selectionId: pending.id,
      seat: 'p1',
      players: ['p3'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.players.p1.life).toBe(41)
    expect(state.players.p2.life).toBe(40)
    expect(state.players.p3.life).toBe(39)
  })
})
