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
import { pendingSelectionFor } from '../../rules/selectCards'

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

  test('server pins modal cardinality before a sacrifice cost changes the board', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'activated',
      availableFrom: ['battlefield'],
      timing: 'anyTime',
      costs: [{ kind: 'sacrifice', filter: objects({ zone: 'battlefield', type: 'Creature' }), count: amount(1) }],
      decisions: { targets: [], modes: { count: { kind: 'count', of: objects({ zone: 'battlefield', type: 'Creature' }) }, repeatable: false } },
      modes: [
        { decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: amount(1), targets: ref('controller') }] },
        { decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: amount(1), targets: ref('controller') }] },
      ],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Sacrifice modal source', { types: ['Artifact'], ruleDefinition: definition }),
          cardTemplate('Sacrifice modal creature one', { types: ['Creature'], power: 2, toughness: 2 }),
          cardTemplate('Sacrifice modal creature two', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Sacrifice modal source')!
    const sacrificed = Object.values(server.state.objects).find((object) => object.name === 'Sacrifice modal creature one')!
    const activated = server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]',
      choices: [sacrificed.id], modeIndices: [0, 1],
    } as any)
    expect(activated.ok).toBe(true)
    if (!activated.ok) return
    expect(activated.state.objects[sacrificed.id]?.zone).toBe('graveyard')
    const resolved = server.rules(activated.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.players.p1.life).toBe(42)
  })

  test('spell sacrifice costs retain announced modal cardinality through resolution', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [{ kind: 'sacrifice', filter: objects({ zone: 'battlefield', type: 'Creature' }), count: amount(1) }],
      decisions: { targets: [], modes: { count: { kind: 'count', of: objects({ zone: 'battlefield', type: 'Creature' }) }, repeatable: false } },
      modes: [
        { decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: amount(1), targets: ref('controller') }] },
        { decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: amount(1), targets: ref('controller') }] },
      ],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Sacrifice modal spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: {
        p1: [
          cardTemplate('Spell sacrifice creature one', { types: ['Creature'], power: 2, toughness: 2 }),
          cardTemplate('Spell sacrifice creature two', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Sacrifice modal spell')!
    const sacrificed = Object.values(server.state.objects).find((object) => object.name === 'Spell sacrifice creature one')!
    const cast = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spell.id, modeIndices: [0, 1], sacrifice: [sacrificed.id],
    } as any)
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    expect(cast.state.objects[sacrificed.id]?.zone).toBe('graveyard')
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
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

  test('server keeps separate proliferate instruction choices and results', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [] },
      instructions: [
        { kind: 'proliferate', targets: ref('controller') },
        { kind: 'proliferate', targets: ref('controller') },
      ],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Two proliferations', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: {
        p1: [
          cardTemplate('First counter creature', { types: ['Creature'], power: 2, toughness: 2, counters: { '+1/+1': 1 } }),
          cardTemplate('Second counter creature', { types: ['Creature'], power: 2, toughness: 2, counters: { '+1/+1': 1 } }),
        ],
      },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Two proliferations')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const first = pendingSelectionFor(started.state, 'p1')
    expect(first).toBeDefined()
    if (!first) return
    const firstTarget = Object.values(started.state.objects).find((object) => object.name === 'First counter creature')!
    const secondTarget = Object.values(started.state.objects).find((object) => object.name === 'Second counter creature')!
    const firstAnswer = server.rules(started.state, { type: 'selectCards', seat: 'p1', selectionId: first.id, kind: 'choose', count: first.count, objectIds: [firstTarget.id, secondTarget.id] })
    expect(firstAnswer.ok).toBe(true)
    if (!firstAnswer.ok) return
    const second = pendingSelectionFor(firstAnswer.state, 'p1')
    expect(second).toBeDefined()
    if (!second) return
    expect(second.id).not.toBe(first.id)
    const completed = server.rules(firstAnswer.state, { type: 'selectCards', seat: 'p1', selectionId: second.id, kind: 'choose', count: second.count, objectIds: [firstTarget.id, secondTarget.id] })
    expect(completed.ok).toBe(true)
    if (completed.ok) {
      expect(completed.state.objects[firstTarget.id]?.counters['+1/+1']).toBe(3)
      expect(completed.state.objects[secondTarget.id]?.counters['+1/+1']).toBe(3)
    }
  })

  test('modal resolution gates untargeted modes only when every target is illegal', () => {
    const targetClause = { filter: { kind: 'objects' as const, filter: { zone: 'battlefield' as const, type: 'Creature' as const } }, min: amount(1), max: amount(1), distinct: true as const }
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [], modes: { count: amount(2), repeatable: false } },
      modes: [
        { decisions: { targets: [targetClause] }, instructions: [{ kind: 'damage', amount: amount(1), targets: { kind: 'targetRef', clauseIndex: 0 }, source: ref('source') }] },
        { decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: amount(2), targets: ref('controller') }] },
      ],
    }])))
    const create = () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: { p1: [cardTemplate('Target gate modal', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
        battlefield: { p2: [cardTemplate('Target gate creature', { types: ['Creature'], power: 3, toughness: 3 })] },
      }, { random: () => 0 })
      const spell = Object.values(server.state.objects).find((object) => object.name === 'Target gate modal')!
      const target = Object.values(server.state.objects).find((object) => object.name === 'Target gate creature')!
      const cast = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spell.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: target.id }]],
      })
      expect(cast.ok).toBe(true)
      return { server, target, cast }
    }
    const illegal = create()
    if (illegal.cast.ok) {
      const changed = structuredClone(illegal.cast.state)
      changed.objects[illegal.target.id]!.phasedOut = true
      const resolved = illegal.server.rules(changed, { type: 'resolveTop' })
      expect(resolved.ok).toBe(true)
      if (resolved.ok) expect(resolved.state.players.p1.life).toBe(40)
    }
    const legal = create()
    if (legal.cast.ok) {
      const resolved = legal.server.rules(legal.cast.state, { type: 'resolveTop' })
      expect(resolved.ok).toBe(true)
      if (resolved.ok) expect(resolved.state.players.p1.life).toBe(42)
    }
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

  test('command pattern copies an Elemental before the later damage query', () => {
    const elementalClause = { filter: { kind: 'objects' as const, filter: { zone: 'battlefield' as const, subtypes: ['Elemental'] } }, min: amount(1), max: amount(1), distinct: true as const }
    const playerClause = { filter: { kind: 'players' as const, filter: {} }, min: amount(1), max: amount(1), distinct: true as const }
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [], modes: { count: amount(2), repeatable: false } },
      modes: [
        {
          decisions: { targets: [elementalClause] },
          instructions: [{ kind: 'copy', targets: { kind: 'targetRef', clauseIndex: 0 }, controller: ref('controller') }],
        },
        {
          decisions: { targets: [playerClause] },
          instructions: [{ kind: 'damage', amount: amount(2), source: ref('source'), targets: objects({ zone: 'battlefield', type: 'Creature', controller: { kind: 'targetRef', clauseIndex: 0 } }) }],
        },
      ],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Command pattern spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Command Elemental', { types: ['Creature'], subtypes: ['Elemental'], power: 3, toughness: 3 })] },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Command pattern spell')!
    const elemental = Object.values(server.state.objects).find((object) => object.name === 'Command Elemental')!
    const cast = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spell.id, modeIndices: [0, 1],
      targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'player', player: 'p1' }]],
    } as any)
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const copies = Object.values(resolved.state.objects).filter((object) => object.token && object.name === 'Command Elemental')
    expect(copies.length).toBeGreaterThan(0)
    expect(resolved.state.objects[elemental.id]?.damageMarked).toBe(2)
    expect(copies.every((copy) => copy.damageMarked === 2)).toBe(true)
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
