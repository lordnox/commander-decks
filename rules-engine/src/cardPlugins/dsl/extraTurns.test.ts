import type { GameState } from '../../types'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { players, ref, select, takeExtraTurn, target } from './v1'

const extraTurnFor = () => instructionSpell({
  decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
  instructions: [takeExtraTurn(target(0))],
})

const game = (spells = 1) => createServerGame(commanderRules, {
  players: 3,
  hands: { p1: Array.from({ length: spells }, extraTurnFor) },
}, { random: () => 0 })

const cast = (server: ReturnType<typeof game>, state: GameState, player: string) =>
  resolveStack(server.rules, ok(server.rules(state, {
    type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0], targets: [{ kind: 'player', player }],
  })))

const nextTurn = (server: ReturnType<typeof game>, state: GameState) =>
  ok(server.rules({ ...state, step: 'cleanup', priority: state.active, passedInRow: [] }, { type: 'advanceStep' }))

test('an extra turn is taken right after this turn, then normal order resumes after the original player', () => {
  const server = game()
  const scheduled = restoreJournal(createJournal(cast(server, server.state, 'p3')), server.rules).current()
  expect(scheduled.extraTurns).toEqual(['p3'])
  const extra = restoreJournal(createJournal(nextTurn(server, scheduled)), server.rules).current()
  expect(extra.active).toBe('p3')
  const resumed = nextTurn(server, extra)
  expect(resumed.active).toBe('p2')
  expect(nextTurn(server, resumed).active).toBe('p3')
})

test('CR 500.7: the most recently created extra turn is taken first', () => {
  const server = game(2)
  const both = cast(server, cast(server, server.state, 'p3'), 'p2')
  expect(both.extraTurns).toEqual(['p2', 'p3'])
  const first = nextTurn(server, both)
  expect(first.active).toBe('p2')
  const second = nextTurn(server, first)
  expect(second.active).toBe('p3')
  expect(nextTurn(server, second).active).toBe('p2')
})

test('an extra turn for a player who has left the game is skipped', () => {
  const server = game()
  const scheduled = cast(server, server.state, 'p3')
  const conceded = ok(server.rules(scheduled, { type: 'concede', seat: 'p3' }))
  expect(nextTurn(server, conceded).active).toBe('p2')
})

test('takeExtraTurn only accepts player recipients', () => {
  expect(() => instructionSpell({ instructions: [takeExtraTurn(ref('source') as never)] })).toThrow()
})
