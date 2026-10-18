import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { objects, reveal } from './v1'

test('reveal publishes selected hidden objects belonging to different owners', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [instructionSpell({ instructions: [reveal(objects({ zone: 'hand', type: 'Land' }))] }), cardTemplate('First secret', { types: ['Land'] }), cardTemplate('Unrevealed', { types: ['Artifact'] })],
      p2: [cardTemplate('Other secret', { types: ['Land'] })],
    },
  }, { random: () => 0 })
  const fixture = server.state.zoneOrder.p1.hand[0]!
  const before = server.project(server.state, 'p2')
  expect(Object.values(before.objects).some(object => object.name === 'First secret')).toBe(false)
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: fixture }))
  const resolved = resolveStack(server.rules, cast)
  expect(Object.values(server.project(resolved, 'p2').objects).some(object => object.name === 'First secret')).toBe(true)
  expect(Object.values(server.project(resolved, 'p1').objects).some(object => object.name === 'Other secret')).toBe(true)
  expect(Object.values(server.project(resolved, 'p2').objects).some(object => object.name === 'Unrevealed')).toBe(false)
  expect(resolved.zoneOrder.p1.hand).toHaveLength(2)
  expect(resolved.zoneOrder.p2.hand).toHaveLength(1)
})

test('revealing an empty selection finishes without emitting an invalid reveal event', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [reveal(objects({ zone: 'hand', type: 'Land' }))] })] },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))
  const resolved = resolveStack(server.rules, cast)
  expect(resolved.resolution).toBeUndefined()
  expect(resolved.stack).toHaveLength(0)
})
