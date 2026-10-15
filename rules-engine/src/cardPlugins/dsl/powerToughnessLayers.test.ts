import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  modifyStats,
  objects,
  staticAbility,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'

describe('powerToughnessLayers', () => {

  const setCreatures = (power: number, toughness: number, set?: true) =>
    createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(modifyStats({
        targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
        power: { kind: 'constant', value: power },
        toughness: { kind: 'constant', value: toughness },
        ...(set ? { set } : {}),
      })),
    ])))

  const twoSourceLayerBoard = (order: 'pump-first' | 'set-first') => {
    const pump = cardTemplate('Pump Source', { types: ['Enchantment'], ruleDefinition: setCreatures(2, 2) })
    const setter = cardTemplate('Set Source', { types: ['Enchantment'], ruleDefinition: setCreatures(1, 1, true) })
    const bear = cardTemplate('Bear', { types: ['Creature'], power: 5, toughness: 5 })
    return createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: order === 'pump-first' ? [pump, setter, bear] : [setter, pump, bear],
      },
    }, { random: () => 0 })
  }

  test('layer 7b set-P/T applies before layer 7c pumps from independent static timestamps', () => {
    const layered = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(
        modifyStats({
          targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
          power: { kind: 'constant', value: 1 },
          toughness: { kind: 'constant', value: 1 },
          set: true,
        }),
        modifyStats({
          targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }),
          power: { kind: 'constant', value: 2 },
          toughness: { kind: 'constant', value: 2 },
        }),
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Layer Aura', { types: ['Enchantment'], ruleDefinition: layered }),
          cardTemplate('Bear', { types: ['Creature'], power: 5, toughness: 5 }),
        ],
      },
    }, { random: () => 0 })
    const bear = Object.values(server.state.objects).find((object) => object.name === 'Bear')!
    expect(bear.power).toBe(3)
    expect(bear.toughness).toBe(3)
  })

  test('asymmetric set-P/T keeps independent power and toughness', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Set Source', { types: ['Enchantment'], ruleDefinition: setCreatures(1, 3, true) }),
          cardTemplate('Bear', { types: ['Creature'], power: 5, toughness: 5 }),
        ],
      },
    }, { random: () => 0 })
    const bear = Object.values(server.state.objects).find((object) => object.name === 'Bear')!
    expect(bear.power).toBe(1)
    expect(bear.toughness).toBe(3)
  })

  test('layer 7b setters beat 7c pumps when the pump source is iterated first', () => {
    const server = twoSourceLayerBoard('pump-first')
    const bear = Object.values(server.state.objects).find((object) => object.name === 'Bear')!
    expect(bear.power).toBe(3)
    expect(bear.toughness).toBe(3)
  })

  test('layer 7b setters beat 7c pumps when the setter source is iterated first', () => {
    const server = twoSourceLayerBoard('set-first')
    const bear = Object.values(server.state.objects).find((object) => object.name === 'Bear')!
    expect(bear.power).toBe(3)
    expect(bear.toughness).toBe(3)
  })
})
