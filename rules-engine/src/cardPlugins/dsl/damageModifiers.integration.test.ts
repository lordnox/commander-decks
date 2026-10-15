import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  multiplyDamage,
  players,
  prevention,
  preventDamage,
  replacement,
  staticAbility,
  wouldDealDamage,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'
import type { GameState } from '../../types'

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('damageModifiers — integration', () => {

  describe('competing damage modifiers', () => {
    const shieldDefinition = (capacity: number) => createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prevention(
        { recipient: players({ relation: 'you' }) },
        preventDamage(),
        { capacity: amount(capacity) },
      )),
    ])))
    const doublerDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(
        wouldDealDamage({ recipient: players({ relation: 'you' }) }),
        multiplyDamage(2),
      )),
    ])))

    const chooseModifier = (
      server: ReturnType<typeof createServerGame>,
      state: GameState,
      label: string,
    ) => {
      const pending = pendingOptionSelection(state, 'p1')!
      const option = pending.options.find((entry) => entry.label.includes(label))!
      return reduce(server, state, {
        type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: option.id,
      })
    }

    const dealThreeToP1 = (
      server: ReturnType<typeof createServerGame>,
      state: GameState,
    ) => reduce(server, state, {
      type: 'dealDamage',
      sourceId: Object.values(state.objects)[0]!.id,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    })

    test('player ordering settles to 4 life lost when doubling precedes a 2-point shield', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) }),
            cardTemplate('Doubler', { types: ['Enchantment'], ruleDefinition: doublerDefinition }),
          ],
        },
      }, { random: () => 0 })
      let state = dealThreeToP1(server, server.state)
      expect(state.eventProcessing).toBeDefined()
      state = chooseModifier(server, state, 'Doubler')
      if (state.eventProcessing) state = chooseModifier(server, state, 'Shield')
      expect(state.players.p1.life).toBe(36)
      expect(state.preventionInstances?.[0]?.remaining).toBe(0)
    })

    test('player ordering settles to 2 life lost when prevention precedes doubling', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Shield', { types: ['Enchantment'], ruleDefinition: shieldDefinition(2) }),
            cardTemplate('Doubler', { types: ['Enchantment'], ruleDefinition: doublerDefinition }),
          ],
        },
      }, { random: () => 0 })
      let state = dealThreeToP1(server, server.state)
      state = chooseModifier(server, state, 'Shield')
      if (state.eventProcessing) state = chooseModifier(server, state, 'Doubler')
      expect(state.players.p1.life).toBe(38)
      expect(state.preventionInstances?.[0]?.remaining).toBe(0)
    })
  })
})
