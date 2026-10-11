import { describe, expect, test } from 'bun:test'
import {
  amount,
  distribution,
  modeOccurrences,
  ref,
  validateDistributionAllocation,
  validateModeSelection,
  validateScopedDistributions,
  whenever,
} from './v1'
import { card, compileCardRuleDefinition, createDefinitionSnapshot } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { objects } from './v1'
import { pendingOptionSelection } from '../../rules/selectOptions'

const context = { variables: { X: 4 }, eventAmount: undefined, count: () => 0, characteristic: () => 0 }

describe('Part09 scoped modes and distributions', () => {
  const modalSpellFixture = (modes: any[], count: any) => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [], modes: { count, repeatable: true } }, modes }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Modal supplied spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Modal count creature', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    return { server, spell: Object.values(server.state.objects).find((object) => object.name === 'Modal supplied spell')! }
  }

  test('server keeps repeated modal target occurrences in separate scopes', () => {
    const clause = { filter: { kind: 'players' as const, filter: {} }, min: amount(1), max: amount(1), distinct: true as const }
    const { server, spell } = modalSpellFixture([{ decisions: { targets: [clause] }, instructions: [{ kind: 'gainLife', amount: amount(2), targets: { kind: 'targetRef', clauseIndex: 0 } }] }], amount(2))
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id, modeIndices: [0, 0], targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'player', player: 'p2' }]] })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.players.p1.life).toBe(42)
    expect(resolved.state.players.p2.life).toBe(42)
  })

  test('server locks general Amount modal cardinality at announcement', () => {
    const { server, spell } = modalSpellFixture([{ decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: amount(2), targets: ref('controller') }] }], { kind: 'count', of: objects({ zone: 'battlefield', type: 'Creature' }) })
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id, modeIndices: [0] })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.players.p1.life).toBe(42)
  })

  test('server applies general Amount modal cardinality to activated abilities', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'activated',
      availableFrom: ['battlefield'],
      timing: 'anyTime',
      costs: [],
      decisions: { targets: [], modes: { count: { kind: 'count', of: objects({ zone: 'battlefield', type: 'Creature' }) }, repeatable: false } },
      modes: [{ decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: amount(2), targets: ref('controller') }] }],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Modal activated source', { types: ['Artifact'], ruleDefinition: definition }),
          cardTemplate('Modal activated creature', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Modal activated source')!
    const activated = server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]', modeIndices: [0] } as any)
    expect(activated.ok).toBe(true)
    if (!activated.ok) return
    const resolved = server.rules(activated.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.players.p1.life).toBe(42)
  })

  test('server captures general Amount modal cardinality for triggered abilities', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        {
          decisions: { modes: { count: { kind: 'count', of: objects({ zone: 'battlefield', type: 'Creature' }) }, repeatable: false } },
          modes: [
            { instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }] },
            { instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }] },
          ],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Modal trigger watcher', { types: ['Creature'], ruleDefinition: definition }),
          cardTemplate('Modal trigger creature', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
      libraries: { p1: [cardTemplate('Modal trigger draw')] },
    }, { random: () => 0 })
    const drawn = server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const first = pendingOptionSelection(drawn.state, 'p1')
    expect(first).toBeDefined()
    if (!first) return
    const selected = server.rules(drawn.state, { type: 'selectOption', seat: 'p1', selectionId: first.id, optionId: 'mode:0' })
    expect(selected.ok).toBe(true)
    if (!selected.ok) return
    const second = pendingOptionSelection(selected.state, 'p1')
    expect(second).toBeDefined()
    if (!second) return
    const completed = server.rules(selected.state, { type: 'selectOption', seat: 'p1', selectionId: second.id, optionId: 'mode:1' })
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.stack).toHaveLength(1)
    const resolved = server.rules(completed.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.players.p1.life).toBe(42)
  })

  test('server rejects a distribution bound to a different modal occurrence', () => {
    const clause = { filter: { kind: 'players' as const, filter: {} }, min: amount(1), max: amount(1), distinct: true as const }
    const mode = (total: number) => ({ decisions: { targets: [clause], distributions: [{ targetClauseIndex: 0, total: amount(total), minEach: amount(1) }] }, instructions: [{ kind: 'gainLife', amount: amount(total), targets: { kind: 'targetRef', clauseIndex: 0 } }] })
    const { server, spell } = modalSpellFixture([mode(3), mode(1)], amount(2))
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id, modeIndices: [0, 1], targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'player', player: 'p2' }]], distributionBindings: [{ scopeId: '$.abilities[0].modes[1]#1', clauseIndex: 0, amounts: [3] }, { scopeId: '$.abilities[0].modes[0]#0', clauseIndex: 0, amounts: [1] }] } as any)
    expect(cast.ok).toBe(false)
    expect(cast.state).toEqual(server.state)
  })

  test('server consumes modal damage allocations per bound recipient', () => {
    const clause = { filter: { kind: 'objects' as const, filter: { zone: 'battlefield' as const, type: 'Creature' } }, min: amount(2), max: amount(2), distinct: true as const }
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell', costs: [], decisions: { targets: [], modes: { count: amount(1), repeatable: false } },
      modes: [{ decisions: { targets: [clause], distributions: [{ targetClauseIndex: 0, total: amount(3), minEach: amount(1) }] }, instructions: [{ kind: 'damage', amount: amount(3), targets: { kind: 'targetRef', clauseIndex: 0 }, source: ref('source') }] }],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Distributed damage', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('First creature', { types: ['Creature'], power: 4, toughness: 4 }), cardTemplate('Second creature', { types: ['Creature'], power: 4, toughness: 4 })] },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Distributed damage')!
    const creatures = Object.values(server.state.objects).filter((object) => object.types.includes('Creature')).map((object) => ({ kind: 'object' as const, objectId: object.id }))
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id, modeIndices: [0], targetClauses: [creatures], distributionBindings: [{ scopeId: '$.abilities[0].modes[0]#0', clauseIndex: 0, amounts: [1, 2] }] } as any)
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.objects[creatures[0].objectId]?.damageMarked).toBe(1)
    expect(resolved.state.objects[creatures[1].objectId]?.damageMarked).toBe(2)
  })
  test('server resolves supplied modal spell occurrences in printed order', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [], modes: { count: amount(2), repeatable: false } },
      modes: [
        { decisions: { targets: [] }, instructions: [{ kind: 'move', targets: objects({ zone: 'battlefield', type: 'Creature' }), to: 'exile' }] },
        { decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: { kind: 'count', of: objects({ zone: 'battlefield', type: 'Creature' }) }, targets: ref('controller') }] },
      ],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Printed modal', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
      battlefield: { p1: [cardTemplate('Creature', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Printed modal')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id, modeIndices: [1, 0] })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.players.p1.life).toBe(40)
  })
  test('repeated modes receive independent generated scopes and retain selection order', () => {
    expect(modeOccurrences(2, [1, 1, 0])).toEqual([
      { modeIndex: 1, occurrence: 0, scopeId: '$.abilities[2].modes[1]#0' },
      { modeIndex: 1, occurrence: 1, scopeId: '$.abilities[2].modes[1]#1' },
      { modeIndex: 0, occurrence: 2, scopeId: '$.abilities[2].modes[0]#2' },
    ])
    expect(validateModeSelection({ count: amount(3), repeatable: true }, 2, 3, [1, 1, 0])).toHaveLength(3)
    expect(() => validateModeSelection({ count: amount(2), repeatable: false }, 2, 2, [1, 1])).toThrow('cannot be selected')
  })

  test('allocation validates sums, minima, cardinality, and X bindings', () => {
    const spec = distribution({ targetClauseIndex: 0, total: { kind: 'variable', name: 'X' }, minEach: 1 })
    expect(validateDistributionAllocation(spec, [1, 3], 2, context)).toEqual([1, 3])
    expect(() => validateDistributionAllocation(spec, [2, 1], 2, context)).toThrow('sum')
    expect(() => validateDistributionAllocation(spec, [4], 2, context)).toThrow('one amount per recipient')
    expect(() => validateDistributionAllocation(spec, [0, 4], 2, context)).toThrow('minEach')
  })

  test('scoped allocations bind to each local repeated clause', () => {
    const spec = distribution({ targetClauseIndex: 0, total: 2, minEach: 1 })
    const result = validateScopedDistributions(
      [spec, spec],
      [
        { scopeId: 'mode#0', clauseIndex: 0, amounts: [1, 1] },
        { scopeId: 'mode#1', clauseIndex: 0, amounts: [2] },
      ],
      (scopeId) => scopeId === 'mode#0' ? [{ kind: 'player', player: 'p1' }, { kind: 'player', player: 'p2' }] : [{ kind: 'player', player: 'p1' }],
      context,
    )
    expect(result.map(({ scopeId }) => scopeId)).toEqual(['mode#0', 'mode#1'])
    expect(() => validateScopedDistributions([spec], [], () => [], context)).toThrow('every distribution')
  })
})
