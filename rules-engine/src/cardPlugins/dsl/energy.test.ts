import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { gainEnergy, players, ref } from './v1'

test('gainEnergy queues the amount for each resolved player recipient', () => {
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [instructionSpell({ instructions: [
      gainEnergy({ targets: players({ relation: 'opponent' }), amount: 2 }),
      gainEnergy({ targets: ref('controller'), amount: 1 }),
    ] })] },
  }, { random: () => 0 })

  const cast = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: server.state.zoneOrder.p1.hand[0]!,
  }))
  const resolved = resolveStack(server.rules, cast)

  expect(resolved.players.p1.energy).toBe(1)
  expect(resolved.players.p2.energy).toBe(2)
  expect(resolved.players.p3.energy).toBe(2)
})
