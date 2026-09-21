import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

test('attackSubtypeDraw draws when a listed subtype attacks', () => {
  const server = createServerGame(
    commanderRules,
    {
      battlefield: {
        p1: [cardTemplate('Sea Serpent', {
          types: ['Creature'],
          subtypes: ['Serpent'],
          power: 4,
          toughness: 4,
        })],
      },
      libraries: { p1: [cardTemplate('Draw', { types: ['Instant'] })] },
    },
    { random: () => 0.5 },
  )
  let state = ok(server.rules(server.state, {
    type: 'addRule',
    pluginId: 'attackSubtypeDraw',
    params: {
      untilCleanup: true,
      controller: 'p1',
      subtypes: ['Kraken', 'Leviathan', 'Merfolk', 'Octopus', 'Serpent'],
    },
  }))
  const serpent = named(state, 'Sea Serpent').id
  state.step = 'declareAttackers'
  state.priority = 'p1'
  state = ok(server.rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: serpent, defender: 'p2' }],
  }))
  expect(named(state, 'Draw').zone).toBe('hand')
})
