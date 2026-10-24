import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  legendRuleOff,
  staticAbility,
} from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

test('legendRuleOff lets a player keep two copies of the same legendary name', () => {
  const exemption = createDefinitionSnapshot(compileCardRuleDefinition(card([staticAbility(legendRuleOff())])))
  const server = createServerGame(commanderRules, {
    battlefield: {
      p1: [
        cardTemplate('Legend', {
          types: ['Creature'],
          supertypes: ['Legendary'],
          power: 2,
          toughness: 2,
          ruleDefinition: exemption,
        }),
        cardTemplate('Legend', {
          types: ['Creature'],
          supertypes: ['Legendary'],
          power: 2,
          toughness: 2,
        }),
      ],
    },
  }, { random: () => 0 })
  const after = resolveStack(server.rules, ok(server.rules(server.state, { type: 'passPriority', seat: 'p1' })))
  const legends = Object.values(after.objects).filter(object => object.name === 'Legend' && object.zone === 'battlefield')
  expect(legends).toHaveLength(2)
  expect(named(after, 'Legend').controller).toBe('p1')
})
