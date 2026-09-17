import { expect, test } from 'bun:test'
import { commanderRules } from './formats'
import { createHistory, lastAuthoritativeState } from './history'
import { forest } from './newGame'
import { createServerGame } from './runtime'

test('history wraps the reducer without entering game state', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [forest()] },
  })
  const history = createHistory(server.state, server.rules)
  const land = Object.values(server.state.objects)[0]

  const result = history.dispatch({
    type: 'playLand',
    seat: 'p1',
    objectId: land.id,
  })

  expect(result.ok).toBe(true)
  expect(history.current().objects[land.id].zone).toBe('battlefield')
  expect(history.entries()).toHaveLength(1)
  expect(history.entries()[0].before.objects[land.id].zone).toBe('hand')
  expect(history.entries()[0].after.objects[land.id].zone).toBe('battlefield')
  expect('history' in history.current()).toBe(false)

  history.clear()
  expect(history.entries()).toHaveLength(0)
  expect(history.current().objects[land.id].zone).toBe('battlefield')
})

test('a rejected continueAction keeps the pre-event snapshot for rollback', () => {
  const server = createServerGame(commanderRules, {
    hands: { p2: [forest()] },
    players: 4,
  })
  const handId = server.state.zoneOrder.p2.hand[0]
  const waiting: typeof server.state = {
    ...server.state,
    stack: [{
      id: 'discard-action',
      kind: 'action',
      actionId: 'discard',
      objectId: 'cry',
      controller: 'p2',
      name: 'Discard',
      targets: [],
      waiting: 'choice',
      payload: { seat: 'p2', count: 1, chooser: 'p2' },
    }],
    priority: 'p2',
    passedInRow: [],
  }
  const history = createHistory(waiting, server.rules)
  const rejected = history.dispatch({
    type: 'continueAction',
    stackId: 'discard-action',
    seat: 'p2',
    payload: { objectIds: ['missing-card'] },
  })

  expect(rejected.ok).toBe(false)
  const rolled = lastAuthoritativeState(history)
  expect(rolled.stack[0]).toMatchObject({ id: 'discard-action', waiting: 'choice' })
  expect(rolled.objects[handId].zone).toBe('hand')
  expect(history.current().objects[handId].zone).toBe('hand')
})
