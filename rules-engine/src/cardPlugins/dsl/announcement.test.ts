import { describe, expect, test } from 'bun:test'
import {
  beginAnnouncement,
  commitAnnouncement,
  manaCost,
  prepareAction,
  rollbackAnnouncement,
  select,
  objects,
  players,
  variable,
  discardCost,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'

const state = { players: { p1: { mana: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 2 } } }, objects: {}, stack: [] } as unknown as Parameters<typeof beginAnnouncement>[0]

describe('announcement transactions', () => {
  test('locks the total cost and commits only after full payment', () => {
    const result = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [manaCost('{2}{G}') ] },
      payment: [
        { sourceId: 'forest', mana: 'G' },
        { sourceId: 'solRing', mana: 'C', amount: 2 },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.transaction.status).toBe('provisional')
    expect(result.transaction.lockedCost.mana).toBe('{2}{G}')
    expect(commitAnnouncement(result.transaction).status).toBe('committed')
    expect(() => commitAnnouncement(result.transaction)).toThrow('no longer provisional')
  })

  test('duplicate sources, incomplete payment, and cancellation leave no committed transaction', () => {
    const duplicate = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [manaCost('{1}') ] },
      payment: [{ sourceId: 'land', mana: 'G' }, { sourceId: 'land', mana: 'G' }],
    })
    expect(duplicate.ok).toBe(false)
    const insufficient = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [manaCost('{2}') ] },
      payment: [{ sourceId: 'land', mana: 'G' }],
    })
    expect(insufficient.ok).toBe(false)
    const valid = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [] },
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(rollbackAnnouncement(valid.transaction).status).toBe('rolledBack')
  })

  test('ordered target slots reject duplicate targets and retain X in the frame', () => {
    const result = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', variables: { X: 0 },
      costs: { mandatory: [manaCost('{0}')] }, payment: [],
      targetClauses: [select({ filter: players({}), count: 1 })],
      targets: [[{ kind: 'player', player: 'p1' }]],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.transaction.lockedCost.x).toBe(0)
  })

  test('a fully supplied action does not open a target picker', () => {
    const offer = prepareAction(state, {
      action: 'cast', payer: 'p1', sourceId: 'spell', targetClauses: [],
      proposal: { payer: 'p1', sourceId: 'spell', costs: { mandatory: [] } },
    })
    expect(offer.requiresInput).toBe(false)
  })

  test('one X binds targets, mana, and discard choices in the same proposal', () => {
    const tideState = {
      players: {
        p1: { mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 }, life: 40 },
        p2: {}, p3: {},
      },
      objects: {
        a: { id: 'a', name: 'A', controller: 'p1', zone: 'hand', types: ['Land'], token: false },
        b: { id: 'b', name: 'B', controller: 'p1', zone: 'hand', types: ['Land'], token: false },
        c: { id: 'c', name: 'C', controller: 'p1', zone: 'hand', types: ['Land'], token: false },
      },
      stack: [],
    } as unknown as Parameters<typeof beginAnnouncement>[0]
    const result = beginAnnouncement(tideState, {
      payer: 'p1', sourceId: 'tide', variables: { X: 3 },
      targetClauses: [select({ filter: players({}), count: variable('X') })],
      targets: [[{ kind: 'player', player: 'p1' }, { kind: 'player', player: 'p2' }, { kind: 'player', player: 'p3' }]],
      costs: { mandatory: [manaCost('{X}'), discardCost(objects({ zone: 'hand', type: 'Land' }), variable('X'))] },
      payment: [{ sourceId: 'p1.pool.C', mana: 'C', amount: 3 }],
      nonManaChoices: ['a', 'b', 'c'],
    })
    expect(result.ok).toBe(true)
  })

  test('canonical announcements lock server-owned optional, alternative, and adjusted costs', () => {
    const optionalDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{1}')],
      optionalCosts: [manaCost('{2}')],
      decisions: { targets: [] },
      instructions: [],
    }])))
    const optionalServer = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Optional canonical spell', { types: ['Sorcery'], manaCost: '{1}', ruleDefinition: optionalDefinition })] },
    }, { random: () => 0 })
    optionalServer.state.players.p1.mana.C = 3
    const optionalSpell = Object.values(optionalServer.state.objects).find((object) => object.name === 'Optional canonical spell')!
    const optionalCast = optionalServer.rules(optionalServer.state, {
      type: 'castSpell', seat: 'p1', objectId: optionalSpell.id, selectedOptionalCosts: [0],
    })
    expect(optionalCast.ok).toBe(true)
    if (optionalCast.ok) expect(optionalCast.state.players.p1.mana.C).toBe(0)

    const alternativeDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{0}')],
      alternativeCosts: [[manaCost('{1}')], [manaCost('{3}')]],
      decisions: { targets: [] },
      instructions: [],
    }])))
    const alternativeServer = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Alternative canonical spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: alternativeDefinition })] },
    }, { random: () => 0 })
    alternativeServer.state.players.p1.mana.C = 3
    const alternativeSpell = Object.values(alternativeServer.state.objects).find((object) => object.name === 'Alternative canonical spell')!
    const invalid = alternativeServer.rules(alternativeServer.state, {
      type: 'castSpell', seat: 'p1', objectId: alternativeSpell.id, selectedAlternativeCost: 9,
    })
    expect(invalid.ok).toBe(false)
    const valid = alternativeServer.rules(alternativeServer.state, {
      type: 'castSpell', seat: 'p1', objectId: alternativeSpell.id, selectedAlternativeCost: 1,
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(valid.state.players.p1.mana.C).toBe(0)

    const adjustedDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{2}')],
      costIncreases: [{ amount: '{1}' }],
      costReductions: [{ generic: 1 }],
      decisions: { targets: [] },
      instructions: [],
    }])))
    const adjustedServer = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Adjusted canonical spell', { types: ['Sorcery'], manaCost: '{2}', ruleDefinition: adjustedDefinition })] },
    }, { random: () => 0 })
    adjustedServer.state.players.p1.mana.C = 1
    const adjustedSpell = Object.values(adjustedServer.state.objects).find((object) => object.name === 'Adjusted canonical spell')!
    const adjusted = adjustedServer.rules(adjustedServer.state, {
      type: 'castSpell', seat: 'p1', objectId: adjustedSpell.id,
    })
    expect(adjusted.ok).toBe(false)
    expect(adjusted.state.players.p1.mana.C).toBe(1)
  })

  test('public serializable transaction-shaped casts cannot bypass canonical payment', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [{ kind: 'life', amount: { kind: 'constant', value: 3 } }],
      decisions: { targets: [] },
      instructions: [],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Serializable payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Serializable payment spell')!
    const result = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spell.id,
      canonicalTransaction: {
        id: 'forged',
        proposal: { payer: 'p1', sourceId: spell.id, costs: { mandatory: [] } },
        lockedCost: { mana: '', nonMana: [] },
        payment: [], status: 'committed',
      },
    })
    expect(result.ok).toBe(false)
    expect(result.state.players.p1.life).toBe(40)
  })
})
