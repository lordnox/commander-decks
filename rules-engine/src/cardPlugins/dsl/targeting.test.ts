import { describe, expect, test } from 'bun:test'
import { amount, card, compareAmount, compileCardRuleDefinition, createDefinitionSnapshot, destroy, damage, objects, players, ref, select, spell, target, counter, stackItems, whenever } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import type { ReduceResult, GameState } from '../../types'
import { captureObject } from '../../objectIdentity'
import { freezeDraft, makeDraft } from '../../draft'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ward as wardEffect } from '../effects'
import { ward as wardPlugin } from '../ward'
import type { Instruction, TargetClause } from './schema/v1'
import { canonicalTargetBindings } from './compiler/targeting'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const snapshotFor = (instructions: readonly Instruction[], targets: readonly TargetClause[] = []) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
    decisions: { targets },
    instructions,
  })])))

const targetCreature = (count: 0 | 1 = 1) => select({
  filter: objects({ zone: 'battlefield', type: 'Creature' }),
  count,
})

const canonicalServer = (
  snapshot: ReturnType<typeof snapshotFor>,
  targetOverrides: Parameters<typeof cardTemplate>[1] = {},
) => createServerGame(commanderRules, {
  players: 2,
  hands: {
    p1: [cardTemplate('Canonical Target Spell', {
      types: ['Instant'],
      manaCost: '{0}',
      manaValue: 0,
      ruleDefinition: snapshot,
    })],
  },
  battlefield: {
    p2: [cardTemplate('Target Bear', { types: ['Creature'], power: 2, toughness: 2, ...targetOverrides })],
  },
}, { random: () => 0 })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('canonical Rule DSL target bindings and resolution gate', () => {
  test('optional zero targets resolve and retain their empty clause slot', () => {
    const server = canonicalServer(snapshotFor([
      { kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
    ], [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: 0, max: 1 })]))
    const spellObject = named(server.state, 'Canonical Target Spell')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id, targets: [],
    }))
    expect(cast.stack[0].execution?.targetBindings).toEqual([{
      scopeId: '$.abilities[0]', clauseIndex: 0, recipients: [],
    }])
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(41)
  })

  test('ambiguous flat optional partitions require explicit clause grouping', () => {
    const clauses = [
      select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: 0, max: 1 }),
      select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: 0, max: 1 }),
    ]
    const server = canonicalServer(snapshotFor([
      { kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
    ], clauses))
    const spellObject = named(server.state, 'Canonical Target Spell')
    const targetObject = named(server.state, 'Target Bear')
    const ambiguous = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [{ kind: 'object', objectId: targetObject.id }],
    })
    expect(ambiguous.ok).toBe(false)
    const grouped = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targetClauses: [[{ kind: 'object', objectId: targetObject.id }], []],
    }))
    expect(grouped.stack[0].execution?.targetBindings).toHaveLength(2)
  })

  test('shared shroud and hexproof restrictions apply during canonical announcement', () => {
    const server = canonicalServer(
      snapshotFor([{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }], [targetCreature()]),
      { oracleText: 'Hexproof' },
    )
    const spellObject = named(server.state, 'Canonical Target Spell')
    const targetObject = named(server.state, 'Target Bear')
    const result = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [{ kind: 'object', objectId: targetObject.id }],
    })
    expect(result.ok).toBe(false)
  })

  test('canonical player targets are retained by clause and drive player instructions', () => {
    const server = canonicalServer(snapshotFor([
      { kind: 'gainLife', amount: amount(1), targets: target(0) },
    ], [select({ filter: { kind: 'players', filter: { relation: 'opponent' } }, count: 1 })]))
    const spellObject = named(server.state, 'Canonical Target Spell')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.players.p2.life).toBe(41)
  })

  test('later target filters can reference the legal recipient from an earlier clause', () => {
    const server = canonicalServer(snapshotFor([
      damage({ amount: amount(1), targets: target(1), source: ref('self') }),
    ], [
      select({ filter: players(), count: 1 }),
      select({ filter: objects({ type: 'Creature', controller: target(0) }), count: 1 }),
    ]))
    const spellObject = named(server.state, 'Canonical Target Spell')
    const targetObject = named(server.state, 'Target Bear')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [
        { kind: 'player', player: 'p2' },
        { kind: 'object', objectId: targetObject.id },
      ],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[targetObject.id].damageMarked).toBe(1)
  })

  test('canonical targeting leaves Ward as a stack trigger and declined Ward counters the spell', () => {
    const snapshot = snapshotFor([{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }], [targetCreature()])
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Canonical Target Spell', { types: ['Instant'], manaCost: '{0}', manaValue: 0, ruleDefinition: snapshot, effects: [{ op: 'spellTrait', uncounterable: true }] })] },
      battlefield: { p2: [cardTemplate('Target Bear', { types: ['Creature'], power: 2, toughness: 2, effects: [wardEffect({ life: 2 })] })] },
    }, { random: () => 0, cardPlugins: [wardPlugin] })
    const spellObject = named(server.state, 'Canonical Target Spell')
    const targetObject = named(server.state, 'Target Bear')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [{ kind: 'object', objectId: targetObject.id }],
    }))
    expect(cast.stack[0]?.kind).toBe('ability')
    expect(cast.stack[0]?.payload?.canonicalWard).toBe(true)
    expect(cast.stack[0]?.controller).toBe('p2')
    const response = structuredClone(cast)
    response.objects[targetObject.id].controller = 'p1'
    const waiting = ok(server.rules(response, { type: 'resolveTop' }))
    const selection = pendingOptionSelection(waiting, 'p1')!
    expect(selection).toBeDefined()
    const declined = ok(server.rules(waiting, {
      type: 'selectOption', seat: 'p1', selectionId: selection.id, optionId: 'decline',
    }))
    expect(declined.stack.some((item) => item.kind === 'spell')).toBe(true)
  })

  test('all illegal targets suppress every instruction and record a did-not-resolve outcome', () => {
    const server = canonicalServer(snapshotFor([
      destroy({ targets: target(0) }),
      { kind: 'gainLife', amount: amount(7), targets: { kind: 'contextRef', name: 'controller' } },
    ], [targetCreature()]))
    const targetObject = named(server.state, 'Target Bear')
    const spellObject = named(server.state, 'Canonical Target Spell')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [{ kind: 'object', objectId: targetObject.id }],
    }))
    const moved = ok(server.rules(cast, { type: 'move', objectId: targetObject.id, to: 'graveyard' }))
    const resolved = ok(server.rules(moved, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(40)
    expect(resolved.log.some((line) => line.includes('didNotResolve:allTargetsIllegal'))).toBe(true)
  })

  test('one legal clause target executes while the same bound recipient is illegal in another clause', () => {
    const server = canonicalServer(snapshotFor([
      damage({ amount: 1, targets: target(0), source: ref('self') }),
      destroy({ targets: target(1) }),
    ], [
      select({ filter: objects({ type: 'Creature' }), count: 1 }),
      select({ filter: objects({ zone: 'battlefield', type: 'Creature', name: 'Target Bear' }), count: 1 }),
    ]))
    const targetObject = named(server.state, 'Target Bear')
    const spellObject = named(server.state, 'Canonical Target Spell')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [
        { kind: 'object', objectId: targetObject.id },
        { kind: 'object', objectId: targetObject.id },
      ],
    }))
    const changed = structuredClone(cast)
    changed.objects[targetObject.id].name = 'Renamed Bear'
    const resolved = ok(server.rules(changed, { type: 'resolveTop' }))
    expect(resolved.objects[targetObject.id].zone).toBe('battlefield')
    expect(resolved.objects[targetObject.id].damageMarked).toBe(1)
  })

  test('source departure does not re-gate a legal target and never retargets it', () => {
    const server = canonicalServer(snapshotFor([
      destroy({ targets: target(0) }),
    ], [targetCreature()]))
    const targetObject = named(server.state, 'Target Bear')
    const spellObject = named(server.state, 'Canonical Target Spell')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [{ kind: 'object', objectId: targetObject.id }],
    }))
    const sourceGone = ok(server.rules(cast, { type: 'move', objectId: spellObject.id, to: 'graveyard' }))
    const resolved = ok(server.rules(sourceGone, { type: 'resolveTop' }))
    expect(resolved.objects[targetObject.id].zone).toBe('graveyard')
  })

  test('damage keeps the captured source characteristics after the source departs', () => {
    const definition = compileCardRuleDefinition(card([whenever(
      { kind: 'draw', filter: {} },
      {
        decisions: { targets: [targetCreature()] },
        instructions: [damage({ amount: amount(1), targets: target(0), source: ref('self') })],
      },
    )]))
    const snapshot = createDefinitionSnapshot(definition)
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Infecting Ability Source', {
          types: ['Creature'], oracleText: 'Infect', ruleDefinition: snapshot,
        })],
        p2: [cardTemplate('Damage Recipient', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0 })
    const source = named(server.state, 'Infecting Ability Source')
    const recipient = named(server.state, 'Damage Recipient')
    const draft = makeDraft(server.state)
    const stackItem = draft.addToStack({
      kind: 'ability', objectId: source.id, controller: 'p1', name: source.name, targets: [
        { kind: 'object', objectId: recipient.id },
      ],
      execution: { controller: 'p1', source: captureObject(source), definitionSnapshot: snapshot, abilityIndex: 0 },
    })
    stackItem.execution!.targetBindings = canonicalTargetBindings(
      server.state,
      source,
      definition.definition,
      0,
      [{ kind: 'object', objectId: recipient.id }],
      stackItem,
      undefined,
      'p1',
    )
    const moved = ok(server.rules(freezeDraft(draft), { type: 'move', objectId: source.id, to: 'graveyard' }))
    const resolved = ok(server.rules(moved, { type: 'resolveTop' }))
    expect(resolved.objects[recipient.id].counters['-1/-1']).toBe(1)
    expect(resolved.objects[recipient.id].damageMarked).toBe(0)
  })

  test('an uncounterable but legal counter action fails while later instructions execute', () => {
    const counterSnapshot = snapshotFor([
      counter({ targets: target(0) }),
      { kind: 'gainLife', amount: amount(3), targets: { kind: 'contextRef', name: 'controller' } },
    ], [select({ filter: stackItems({ kind: 'spell' }), count: 1 })])
    const uncounterable = cardTemplate('Uncounterable Spell', {
      types: ['Instant'],
      manaCost: '{0}',
      manaValue: 0,
      effects: [{ op: 'spellTrait', uncounterable: true }],
    })
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [uncounterable, cardTemplate('Canonical Target Spell', {
          types: ['Instant'], manaCost: '{0}', manaValue: 0, ruleDefinition: counterSnapshot,
        })],
      },
    }, { random: () => 0 })
    const targetSpell = named(server.state, 'Uncounterable Spell')
    let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: targetSpell.id }))
    const counterSpell = named(state, 'Canonical Target Spell')
    const targetStackId = state.stack.find((item) => item.objectId === targetSpell.id)!.id
    state = ok(server.rules(state, {
      type: 'castSpell', seat: 'p1', objectId: counterSpell.id,
      targets: [{ kind: 'stackItem', stackId: targetStackId }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.life).toBe(43)
    expect(state.stack.some((item) => item.id === targetStackId)).toBe(true)
  })

  test('canonical triggered ability applies intervening-if before resolving independently of its source', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([whenever(
      { kind: 'draw', filter: {} },
      {
        decisions: {},
        interveningIf: compareAmount(1, 'eq', 1),
        instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
      },
    )])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Canonical Ability Source', { types: ['Creature'], ruleDefinition: snapshot })],
      },
    }, { random: () => 0 })
    const source = named(server.state, 'Canonical Ability Source')
    const draft = makeDraft(server.state)
    draft.addToStack({
      kind: 'ability', objectId: source.id, controller: 'p1', name: source.name, targets: [],
      execution: { controller: 'p1', source: captureObject(source), definitionSnapshot: snapshot, abilityIndex: 0 },
    })
    const stacked = freezeDraft(draft)
    const sourceGone = ok(server.rules(stacked, { type: 'move', objectId: source.id, to: 'graveyard' }))
    const resolved = ok(server.rules(sourceGone, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(41)
  })

  test('canonical triggered ability does not resolve when intervening-if is false', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([whenever(
      { kind: 'draw', filter: {} },
      {
        decisions: {},
        interveningIf: compareAmount(1, 'eq', 2),
        instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
      },
    )])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Conditional Ability Source', { types: ['Creature'], ruleDefinition: snapshot })],
      },
    }, { random: () => 0 })
    const source = named(server.state, 'Conditional Ability Source')
    const draft = makeDraft(server.state)
    draft.addToStack({
      kind: 'ability', objectId: source.id, controller: 'p1', name: source.name, targets: [],
      execution: { controller: 'p1', source: captureObject(source), definitionSnapshot: snapshot, abilityIndex: 0 },
    })
    const resolved = ok(server.rules(freezeDraft(draft), { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(40)
    expect(resolved.log.some((line) => line.includes('didNotResolve:interveningIf'))).toBe(true)
  })
})
