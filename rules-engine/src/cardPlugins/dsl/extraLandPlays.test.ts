import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  extraLandPlays,
  staticAbility,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'

const extraLandDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(extraLandPlays(1)),
])))

const forest = () => cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })

describe('extraLandPlays static', () => {
  test('a nameless fixture grants one additional land play on the battlefield', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [forest(), forest()] },
        battlefield: {
          p1: [cardTemplate('Extra land source', {
            types: ['Creature'],
            ruleDefinition: extraLandDefinition(),
          })],
        },
      },
      { random: () => 0.5 },
    )
    const first = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.hand[0],
    }))
    expect(first.players.p1.landPlaysAllowed).toBe(2)
    const second = ok(server.rules(first, {
      type: 'playLand',
      seat: 'p1',
      objectId: first.zoneOrder.p1.hand[0],
    }))
    expect(second.players.p1.landsPlayed).toBe(2)
  })
})
