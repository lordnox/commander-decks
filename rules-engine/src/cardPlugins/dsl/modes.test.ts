import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  chooseModes,
  compileCardRuleDefinition,
  copy,
  createDefinitionSnapshot,
  damage,
  modeOccurrences,
  objects,
  phase,
  players,
  proliferate,
  ref,
  select,
  spell,
  target,
  validateModeSelection,
  whenever,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('modes', () => {
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
})

describe('ashlingsCommand — integration', () => {

  describe('Ashling\'s Command pattern', () => {
    const commandPattern = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: { modes: chooseModes({ count: 2 }) },
        modes: [
          {
            decisions: {
              targets: [select({
                filter: objects({
                  zone: 'battlefield',
                  subtypes: ['Elemental'],
                  controller: 'you',
                }),
                count: 1,
              })],
            },
            instructions: [copy({
              targets: target(0),
              controller: ref('controller'),
            })],
          },
          {
            decisions: {
              targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
            },
            instructions: [damage({
              amount: 2,
              source: ref('source'),
              targets: objects({
                zone: 'battlefield',
                type: 'Creature',
                controller: target(0),
              }),
            })],
          },
        ],
      }),
    ])))

    const commandBoard = () => createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Ashling command', {
          types: ['Sorcery'],
          manaCost: '{0}',
          ruleDefinition: commandPattern(),
        })],
      },
      battlefield: {
        p1: [
          cardTemplate('Command Elemental', {
            types: ['Creature'],
            subtypes: ['Elemental'],
            power: 3,
            toughness: 3,
          }),
          cardTemplate('Command Bear', { types: ['Creature'], power: 2, toughness: 4 }),
        ],
        p2: [
          cardTemplate('Opposing Elemental', {
            types: ['Creature'],
            subtypes: ['Elemental'],
            power: 3,
            toughness: 3,
          }),
        ],
      },
    }, { random: () => 0 })

    const elementalCopies = (state: GameState) =>
      Object.values(state.objects).filter((object) => object.token && object.name === 'Command Elemental')

    test('each selected mode keeps a local target domain', () => {
      const server = commandBoard()
      const spellObject = named(server.state, 'Ashling command')
      const elemental = named(server.state, 'Command Elemental')
      const bear = named(server.state, 'Command Bear')
      const opposing = named(server.state, 'Opposing Elemental')
      const playerForCopy = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(playerForCopy.ok).toBe(false)
      const bearForCopy = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: bear.id }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(bearForCopy.ok).toBe(false)
      const opposingForCopy = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: opposing.id }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(opposingForCopy.ok).toBe(false)
      const creatureForDamage = server.rules(server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'object', objectId: bear.id }]],
      })
      expect(creatureForDamage.ok).toBe(false)
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'player', player: 'p1' }]],
      })
      expect(cast.stack[0].execution?.targetBindings?.map((binding) => ({
        scopeId: binding.scopeId,
        modeIndex: binding.modeIndex,
        kind: binding.recipients[0]?.kind,
      }))).toEqual([
        { scopeId: '$.abilities[0].modes[0]#0', modeIndex: 0, kind: 'object' },
        { scopeId: '$.abilities[0].modes[1]#1', modeIndex: 1, kind: 'player' },
      ])
    })

    test('copying an Elemental happens before the later damage query, so the copy is damaged', () => {
      const server = commandBoard()
      const spellObject = named(server.state, 'Ashling command')
      const elemental = named(server.state, 'Command Elemental')
      const bear = named(server.state, 'Command Bear')
      const opposing = named(server.state, 'Opposing Elemental')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 1],
        targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'player', player: 'p1' }]],
      })
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      const copies = elementalCopies(resolved)
      expect(copies).toHaveLength(1)
      expect(resolved.objects[elemental.id].damageMarked).toBe(2)
      expect(copies[0].damageMarked).toBe(2)
      expect(resolved.objects[bear.id].damageMarked).toBe(2)
      expect(resolved.objects[opposing.id].damageMarked ?? 0).toBe(0)
    })

    test('selected modes still resolve in printed order when announced out of order', () => {
      const server = commandBoard()
      const spellObject = named(server.state, 'Ashling command')
      const elemental = named(server.state, 'Command Elemental')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [1, 0],
        targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'object', objectId: elemental.id }]],
      })
      expect(cast.stack[0].execution?.modeIndices).toEqual([1, 0])
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      const copies = elementalCopies(resolved)
      expect(copies).toHaveLength(1)
      expect(copies[0].damageMarked).toBe(2)
      expect(resolved.objects[elemental.id].damageMarked).toBe(2)
    })
  })
})

describe('brokersConfluence — integration', () => {

  describe('Brokers Confluence pattern', () => {
    test('three proliferate modes make three separate resolution choices', () => {
      const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          decisions: { modes: chooseModes({ count: 3, repeatable: true }) },
          modes: [{ instructions: [proliferate({ targets: ref('controller') })] }],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Triple proliferate', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })],
        },
        battlefield: {
          p1: [
            cardTemplate('Proliferate A', { types: ['Creature'], power: 1, toughness: 1, counters: { '+1/+1': 1 } }),
            cardTemplate('Proliferate B', { types: ['Creature'], power: 1, toughness: 1, counters: { '+1/+1': 1 } }),
          ],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Triple proliferate')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id, modeIndices: [0, 0, 0],
      } as never)
      let state = reduce(server, cast, { type: 'resolveTop' })
      const ids: string[] = []
      for (let step = 0; step < 3; step += 1) {
        const offer = pendingSelectionFor(state, 'p1')
        expect(offer).toBeDefined()
        ids.push(offer!.id)
        const a = named(state, 'Proliferate A')
        const b = named(state, 'Proliferate B')
        state = reduce(server, state, {
          type: 'selectCards', seat: 'p1', selectionId: offer!.id, kind: 'choose', count: offer!.count, objectIds: [a.id, b.id],
        })
      }
      expect(new Set(ids).size).toBe(3)
      expect(named(state, 'Proliferate A').counters['+1/+1']).toBe(4)
    })

    test('repeated phasing modes keep independent target scopes for the same creature', () => {
      const creatureClause = select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })
      const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          decisions: { modes: chooseModes({ count: 2, repeatable: true }) },
          modes: [{
            decisions: { targets: [creatureClause] },
            instructions: [phase({ targets: target(0), out: true })],
          }],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Double phase', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })],
        },
        battlefield: {
          p2: [cardTemplate('Phase twice', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Double phase')
      const victim = named(server.state, 'Phase twice')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        modeIndices: [0, 0],
        targetClauses: [[{ kind: 'object', objectId: victim.id }], [{ kind: 'object', objectId: victim.id }]],
      } as never)
      expect(cast.stack[0].execution?.targetBindings?.map((binding) => binding.scopeId)).toEqual([
        '$.abilities[0].modes[0]#0',
        '$.abilities[0].modes[0]#1',
      ])
      const resolved = reduce(server, cast, { type: 'resolveTop' })
      expect(resolved.objects[victim.id].phasedOut).toBe(true)
    })
  })
})
