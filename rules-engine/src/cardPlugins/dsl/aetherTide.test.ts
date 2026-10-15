import { describe, expect, test } from 'bun:test'
import {
  manaCost,
  select,
  objects,
  variable,
  discardCost,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'

describe('Aether Tide one-X announcement integration', () => {
  const tideFixture = () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{X}{U}'), discardCost(objects({ zone: 'hand', type: 'Creature' }), variable('X'))],
      decisions: { variables: [{ name: 'X', min: 0, max: 4 }], targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: variable('X') })] },
      instructions: [{ kind: 'move', targets: { kind: 'targetRef', clauseIndex: 0 }, to: 'hand' }],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Aether Tide', { types: ['Sorcery'], manaCost: '{X}{U}', ruleDefinition: definition }), cardTemplate('Tide discard A', { types: ['Creature'] }), cardTemplate('Tide discard B', { types: ['Creature'] })] },
      battlefield: { p2: [cardTemplate('Tide target A', { types: ['Creature'], power: 2, toughness: 2 }), cardTemplate('Tide target B', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const state = structuredClone(server.state)
    state.players.p1.mana.U = 1
    state.players.p1.mana.C = 2
    const spell = Object.values(state.objects).find((object) => object.name === 'Aether Tide')!
    const discards = Object.values(state.objects).filter((object) => object.name.startsWith('Tide discard')).map((object) => object.id)
    const targets = Object.values(state.objects).filter((object) => object.name.startsWith('Tide target')).map((object) => ({ kind: 'object' as const, objectId: object.id }))
    return { server, state, spell, discards, targets }
  }

  test('X zero pays only blue and opens no picker', () => {
    const { server, state, spell } = tideFixture()
    const result = server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 0, targets: [], discard: [] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.players.p1.mana.U).toBe(0)
  })

  test('X two pays blue plus generic and discards two creatures', () => {
    const { server, state, spell, discards, targets } = tideFixture()
    const result = server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: discards })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.players.p1.mana.U).toBe(0)
      expect(result.state.players.p1.mana.C).toBe(0)
      expect(discards.every((id) => result.state.objects[id].zone === 'graveyard')).toBe(true)
    }
  })

  test('X two rejects insufficient creature discards atomically', () => {
    const { server, state, spell, targets } = tideFixture()
    const result = server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: [] })
    expect(result.ok).toBe(false)
    expect(result.state).toEqual(state)
  })
})
