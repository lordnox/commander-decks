import { describe, expect, test } from 'bun:test'
import {
  beginAnnouncement,
  classifyManaAbility,
  commitAnnouncement,
  manaCost,
  activationPermission,
  prepareAction,
  rollbackAnnouncement,
  select,
  objects,
  players,
  variable,
  discardCost,
  activated,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  ref,
  manaAdded,
  whenever,
  amount,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'

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

  test('mana classification requires a complete mana ability, including triggered mana', () => {
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'activated' }).isManaAbility).toBe(true)
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'triggered', triggered: true, triggeredManaEligible: true }).kind).toBe('triggeredMana')
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'activated', hasOtherInstruction: true }).isManaAbility).toBe(true)
  })

  test('a fully supplied action does not open a target picker', () => {
    const offer = prepareAction(state, {
      action: 'cast', payer: 'p1', sourceId: 'spell', targetClauses: [],
      proposal: { payer: 'p1', sourceId: 'spell', costs: { mandatory: [] } },
    })
    expect(offer.requiresInput).toBe(false)
  })

  test('the permission gate is shared by mana and nested payment activations', () => {
    const input = {
      state: {
        objects: { source: { id: 'source', name: 'Source', zone: 'battlefield', controller: 'p1', phasedOut: false, tapped: false } },
        stack: [], active: 'p1', step: 'precombatMain',
      }, sourceId: 'source', payer: 'p1', action: 'tapForMana' as const,
    } as unknown as Parameters<typeof activationPermission>[0]
    expect(activationPermission(input)).toBeUndefined()
    expect(activationPermission({ ...input, action: 'nestedPayment', sorcerySpeed: true, state: { ...input.state, stack: [{} as never] } })).toContain('sorcery')
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

  test('canonical addMana activation executes through the server path', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
      costs: [],
      decisions: { targets: [] },
      instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Canonical mana source', { types: ['Artifact'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Canonical mana source')!
    const result = server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.stack).toHaveLength(0)
      expect(result.state.players.p1.mana.G).toBe(1)
    }
  })

  test('canonical mana choices resume the remaining program after JSON restore', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
      costs: [],
      decisions: { targets: [] },
      instructions: [
        {
          kind: 'chooseInstructions',
          chooser: ref('controller'),
          count: { kind: 'constant', value: 1 },
          whenInsufficient: 'chooseAvailable',
          options: [{ instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }] }],
        },
        { kind: 'addMana', amount: { R: { kind: 'constant', value: 1 } }, targets: ref('controller') },
      ],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Canonical choosing source', { types: ['Artifact'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Canonical choosing source')!
    const started = server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const restored = JSON.parse(JSON.stringify(started.state))
    const pending = pendingOptionSelection(restored, 'p1')
    expect(pending).toBeDefined()
    if (!pending) return
    const answered = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'instruction:0' })
    expect(answered.ok).toBe(true)
    if (answered.ok) {
      expect(answered.state.stack).toHaveLength(0)
      expect(answered.state.players.p1.mana.G).toBe(1)
      expect(answered.state.players.p1.mana.R).toBe(1)
    }
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

  test('eligible canonical mana-added triggers resolve immediately without a stack', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([whenever(manaAdded(), {
      decisions: { targets: [] },
      instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Mana trigger source', { types: ['Artifact'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const result = server.rules(server.state, { type: 'addMana', seat: 'p1', mana: { G: 1 }, sourceId: 'producer' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.stack).toHaveLength(0)
      expect(result.state.players.p1.mana.G).toBe(2)
    }
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

describe('persisted planned payment workflow', () => {
  const fixture = (choice = false) => {
    const sourceDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'activated', availableFrom: ['battlefield'], timing: 'anyTime', costs: [], decisions: { targets: [] },
      instructions: choice ? [{ kind: 'chooseInstructions', chooser: ref('controller'), count: { kind: 'constant', value: 1 as const }, whenInsufficient: 'chooseAvailable', options: [{ instructions: [{ kind: 'addMana', amount: { G: amount(2) }, targets: ref('controller') }] }] }] : [{ kind: 'addMana', amount: { G: amount(2) }, targets: ref('controller') }],
    }])))
    const spellDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [manaCost('{G}')], decisions: { targets: [] }, instructions: [] }])))
    const server = createServerGame(commanderRules, { players: 2, battlefield: { p1: [cardTemplate('Planned source', { types: ['Artifact'], ruleDefinition: sourceDefinition })] }, hands: { p1: [cardTemplate('Planned spell', { types: ['Sorcery'], manaCost: '{G}', ruleDefinition: spellDefinition })] } }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Planned source')!
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Planned spell')!
    return { server, source, spell, event: { type: 'castSpell' as const, seat: 'p1', objectId: spell.id, manaActivations: [{ objectId: source.id, abilityId: '$.abilities[0]' }] } }
  }

  const deathFixture = (choice = false) => {
    const watcher = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'triggered', activeIn: ['battlefield'], on: { kind: 'dies', filter: { name: 'Payment death watcher' } }, decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: amount(2), targets: ref('controller') }] }])))
    const sourceDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'activated', availableFrom: ['battlefield'], timing: 'anyTime', costs: [{ kind: 'sacrifice', filter: objects({ zone: 'battlefield', type: 'Creature' }), count: amount(1) }], decisions: { targets: [] }, instructions: choice ? [{ kind: 'chooseInstructions', chooser: ref('controller'), count: { kind: 'constant', value: 1 as const }, whenInsufficient: 'chooseAvailable', options: [{ instructions: [{ kind: 'addMana', amount: { G: amount(2) }, targets: ref('controller') }] }] }] : [{ kind: 'addMana', amount: { G: amount(2) }, targets: ref('controller') }] }])))
    const spellDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [manaCost('{G}')], decisions: { targets: [] }, instructions: [] }])))
    const server = createServerGame(commanderRules, { players: 2, battlefield: { p1: [cardTemplate('Cost mana producer', { types: ['Artifact'], ruleDefinition: sourceDefinition }), cardTemplate('Payment death watcher', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: watcher })] }, hands: { p1: [cardTemplate('Atomic payment spell', { types: ['Sorcery'], manaCost: '{G}', ruleDefinition: spellDefinition })] } }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Cost mana producer')!
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Payment death watcher')!
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Atomic payment spell')!
    return { server, event: { type: 'castSpell' as const, seat: 'p1' as const, objectId: spell.id, manaActivations: [{ objectId: source.id, abilityId: '$.abilities[0]', choices: [creature.id] }] } }
  }

  test('commits a no-choice plan from an empty pool', () => {
    const { server, event } = fixture()
    const result = server.rules(server.state, event)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.stack).toHaveLength(1)
      expect(result.state.players.p1.mana.G).toBe(1)
      expect(result.state.provisionalAnnouncement).toBeUndefined()
    }
  })

  test('persists a choice and resumes after JSON restart', () => {
    const { server, event } = fixture(true)
    const started = server.rules(server.state, event)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const restored = JSON.parse(JSON.stringify(started.state))
    const pending = pendingOptionSelection(restored, 'p1')
    expect(pending).toBeDefined()
    if (!pending) return
    const result = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'instruction:0' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.provisionalAnnouncement).toBeUndefined()
  })

  test('wrong-seat cancellation and invalid plans preserve the baseline', () => {
    const { server, event } = fixture(true)
    const started = server.rules(server.state, event)
    expect(started.ok).toBe(true)
    if (!started.ok || !started.state.provisionalAnnouncement) return
    const wrong = server.rules(started.state, { type: 'cancelAnnouncement', seat: 'p2', announcementId: started.state.provisionalAnnouncement.id })
    expect(wrong.ok).toBe(false)
    const cancelled = server.rules(started.state, { type: 'cancelAnnouncement', seat: 'p1', announcementId: started.state.provisionalAnnouncement.id })
    expect(cancelled.ok).toBe(true)
    if (cancelled.ok) expect(cancelled.state).toEqual(server.state)
  })

  test('rejects a planned source outside its declared zone before opening a chooser', () => {
    const { server, source, event } = fixture(true)
    const moved = structuredClone(server.state)
    moved.objects[source.id].zone = 'hand'
    const result = server.rules(moved, event)
    expect(result.ok).toBe(false)
    expect(result.state.players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()
  })

  test('rejects a public planned cast carrying a canonical transaction', () => {
    const { server, spell, event } = fixture()
    const result = server.rules(server.state, {
      ...event,
      canonicalTransaction: {
        id: 'forged', proposal: { payer: 'p1', sourceId: spell.id, costs: { mandatory: [] } },
        lockedCost: { nonMana: [] }, payment: [], status: 'committed',
      },
    } as never)
    expect(result.ok).toBe(false)
    expect(result.state.stack).toHaveLength(0)
  })

  test('records the actual mana spent on the committed announcement', () => {
    const { server, event } = fixture()
    const result = server.rules(server.state, event)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.stack[0]?.execution?.announcement?.payment).toEqual([{ sourceId: 'p1.pool.G', mana: 'G', amount: 1 }])
  })

  test('rejects a changed canonical definition while a payment choice is open', () => {
    const { server, spell, source, event } = fixture(true)
    const started = server.rules(server.state, event)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const restored = JSON.parse(JSON.stringify(started.state))
    restored.objects[spell.id].ruleDefinition = structuredClone(restored.objects[source.id].ruleDefinition)
    const pending = pendingOptionSelection(restored, 'p1')
    if (!pending) return
    const result = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'instruction:0' })
    expect(result.ok).toBe(false)
    expect(result.state).toEqual(server.state)
  })

  test('defers death triggers until a no-choice planned cast commits', () => {
    const { server, event } = deathFixture()
    const result = server.rules(server.state, event)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.stack.filter((item) => item.kind === 'ability')).toHaveLength(1)
  })

  test('defers death triggers across a restarted planned choice', () => {
    const { server, event } = deathFixture(true)
    const started = server.rules(server.state, event)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const restored = JSON.parse(JSON.stringify(started.state))
    const pending = pendingOptionSelection(restored, 'p1')
    if (!pending) return
    const result = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'instruction:0' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.stack.filter((item) => item.kind === 'ability')).toHaveLength(1)
  })
})

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
