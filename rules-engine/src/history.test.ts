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

test('lastAuthoritativeState returns before on a rejected dispatch', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [forest()] },
  })
  const land = Object.values(server.state.objects)[0]
  const history = createHistory(server.state, server.rules)
  history.dispatch({ type: 'playLand', seat: 'p1', objectId: land.id })

  const rejected = history.dispatch({
    type: 'playLand',
    seat: 'p1',
    objectId: land.id,
  })
  expect(rejected.ok).toBe(false)
  expect(lastAuthoritativeState(history).objects[land.id].zone).toBe('battlefield')
})
