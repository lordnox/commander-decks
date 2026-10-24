import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate, forest } from '../../newGame'
import { createServerGame } from '../../runtime'
import { isSwamp } from '../../plugins/swampOverlay'
import { ok } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, grantLandType, objects, staticAbility } from './v1'

const swampGrant = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(grantLandType({ targets: objects({ zone: 'battlefield', type: 'Land' }), landType: 'Swamp' })),
])))

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

test('a land-type grant makes other lands Swamps and confers {B} in addition to printed mana', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [
        forest(),
        cardTemplate('Grant source', { types: ['Land'], ruleDefinition: swampGrant() }),
      ],
    },
  }, { random: () => 0 })
  const grove = named(server.state, 'Forest')
  expect(isSwamp(grove, server.state)).toBe(true)
  expect(isSwamp(named(server.state, 'Grant source'), server.state)).toBe(true)
  const green = ok(server.rules(structuredClone(server.state), {
    type: 'tapForMana', seat: 'p1', objectId: grove.id, mana: 'G',
  }))
  expect(green.players.p1.mana.G).toBe(1)
  const black = ok(server.rules(structuredClone(server.state), {
    type: 'tapForMana', seat: 'p1', objectId: grove.id, mana: 'B',
  }))
  expect(black.players.p1.mana.B).toBe(1)
  const left = ok(server.rules(server.state, {
    type: 'move', objectId: named(server.state, 'Grant source').id, to: 'graveyard',
  }))
  expect(isSwamp(named(left, 'Forest'), left)).toBe(false)
  expect(server.rules(left, { type: 'tapForMana', seat: 'p1', objectId: named(left, 'Forest').id, mana: 'B' }).ok).toBe(false)
})

test('land-type grants follow new lands and reject unknown types', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Grant source', { types: ['Enchantment'], ruleDefinition: swampGrant() })] },
    hands: { p1: [forest()] },
  }, { random: () => 0 })
  const entered = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Forest').id, to: 'battlefield' }))
  expect(isSwamp(named(entered, 'Forest'), entered)).toBe(true)
  expect(() => compileCardRuleDefinition({
    ...card([]),
    abilities: [{ kind: 'static', activeIn: ['battlefield'], effects: [
      { kind: 'grantLandType', targets: objects({ zone: 'battlefield', type: 'Land' }), landType: 'Desert' },
    ] }],
  })).toThrow()
})
