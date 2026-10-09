import { describe, expect, test } from 'bun:test'
import { amount, card, characteristic, chooseX, compareAmount, compileCardRuleDefinition, createDefinitionSnapshot, destroy, damage, differentTargets, objects, players, ref, select, spell, target, counter, stackItems, variable, whenever } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame, projectForViewer } from '../../runtime'
import type { ReduceResult, GameState } from '../../types'
import { captureObject } from '../../objectIdentity'
import { freezeDraft, makeDraft } from '../../draft'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ward as wardEffect } from '../effects'
import { ward as wardPlugin } from '../ward'
import { targetingRequirement } from '../abilities'
import type { Instruction, TargetClause } from './schema/v1'
import { canonicalTargetBindings } from './compiler/targeting'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const snapshotFor = (
  instructions: readonly Instruction[],
  targets: readonly TargetClause[] = [],
  options: {
    constraints?: readonly ReturnType<typeof differentTargets>[]
    variables?: readonly ReturnType<typeof chooseX>[]
  } = {},
) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
    decisions: { targets, ...options },
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
    const restored = JSON.parse(JSON.stringify(cast)) as GameState
    expect(restored.stack[0].execution?.targetBindings).toEqual(cast.stack[0].execution?.targetBindings)
    const resolved = ok(server.rules(restored, { type: 'resolveTop' }))
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

  test('different constraints reject a recipient repeated across generated clauses', () => {
    const clauses = [
      select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 }),
      select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 }),
    ]
    const server = canonicalServer(snapshotFor([
      { kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
    ], clauses, { constraints: [differentTargets(0, 1)] }))
    const spellObject = named(server.state, 'Canonical Target Spell')
    const targetObject = named(server.state, 'Target Bear')
    const result = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targetClauses: [[{ kind: 'object', objectId: targetObject.id }], [{ kind: 'object', objectId: targetObject.id }]],
    })
    expect(result.ok).toBe(false)
  })

  test('target bounds use the cast event X value and reject an out-of-range value', () => {
    const snapshot = snapshotFor([
      { kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
    ], [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: variable('X'), max: variable('X') })], {
      variables: [chooseX({ min: 1, max: 2 })],
    })
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('X Target Spell', { types: ['Instant'], manaCost: '{0}', manaValue: 0, ruleDefinition: snapshot })] },
      battlefield: {
        p2: [
          cardTemplate('X Target One', { types: ['Creature'], power: 2, toughness: 2 }),
          cardTemplate('X Target Two', { types: ['Creature'], power: 2, toughness: 2 }),
          cardTemplate('X Target Three', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const spellObject = named(server.state, 'X Target Spell')
    const targetObject = named(server.state, 'X Target One')
    const valid = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id, x: 1,
      targets: [{ kind: 'object', objectId: targetObject.id }],
    })
    expect(valid.ok).toBe(true)
    const invalid = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id, x: 3,
      targets: [
        { kind: 'object', objectId: targetObject.id },
        { kind: 'object', objectId: named(server.state, 'X Target Two').id },
        { kind: 'object', objectId: named(server.state, 'X Target Three').id },
      ],
    })
    expect(invalid.ok).toBe(false)
    const belowMinimum = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id, x: 0, targets: [],
    })
    expect(belowMinimum.ok).toBe(false)
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

  test('an opposing Flagbearer permits choosing an eligible caster-controlled Flagbearer', () => {
    const snapshot = snapshotFor([
      { kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
    ], [targetCreature()])
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Flagbearer Test Spell', { types: ['Instant'], manaCost: '{0}', manaValue: 0, ruleDefinition: snapshot })] },
      battlefield: {
        p1: [cardTemplate('Own Flagbearer', { types: ['Creature'], power: 1, toughness: 1, effects: [targetingRequirement('flagbearer')] })],
        p2: [cardTemplate('Opposing Flagbearer', { types: ['Creature'], power: 1, toughness: 1, effects: [targetingRequirement('flagbearer')] })],
      },
    }, { random: () => 0 })
    const spellObject = named(server.state, 'Flagbearer Test Spell')
    const own = named(server.state, 'Own Flagbearer')
    const result = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [{ kind: 'object', objectId: own.id }],
    })
    expect(result.ok).toBe(true)
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
    expect(waiting.priority).toBeNull()
    const projected = projectForViewer(waiting, 'p1')
    expect(projected.stack[0]?.payload?.warded).toBeUndefined()
    expect(projected.stack[0]?.payload?.cast).toBeUndefined()
    expect(projected.players.p1.data['ward.pendingCast']).toBeUndefined()
    expect(projected.players.p2.data['ward.pendingCast']).toBeUndefined()
    const selection = pendingOptionSelection(waiting, 'p1')!
    expect(selection).toBeDefined()
    expect(pendingOptionSelection(projected, 'p1')).toBeDefined()
    expect(pendingOptionSelection(projectForViewer(waiting, 'p2'), 'p1')).toBeUndefined()
    const restored = JSON.parse(JSON.stringify(waiting)) as GameState
    const declined = ok(server.rules(waiting, {
      type: 'selectOption', seat: 'p1', selectionId: selection.id, optionId: 'decline',
    }))
    expect(declined.stack.some((item) => item.kind === 'spell')).toBe(true)
    expect(ok(server.rules(restored, {
      type: 'selectOption', seat: 'p1', selectionId: selection.id, optionId: 'decline',
    })).stack.some((item) => item.kind === 'spell')).toBe(true)
  })

  test('canonical Ward decline counters an ordinary spell by its pinned stack identity', () => {
    const snapshot = snapshotFor([{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }], [targetCreature()])
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Ordinary Ward Spell', { types: ['Instant'], manaCost: '{0}', manaValue: 0, ruleDefinition: snapshot })] },
      battlefield: { p2: [cardTemplate('Ordinary Ward Bear', { types: ['Creature'], power: 2, toughness: 2, effects: [wardEffect({ life: 2 })] })] },
    }, { random: () => 0, cardPlugins: [wardPlugin] })
    const spellObject = named(server.state, 'Ordinary Ward Spell')
    const targetObject = named(server.state, 'Ordinary Ward Bear')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [{ kind: 'object', objectId: targetObject.id }],
    }))
    const waiting = ok(server.rules(cast, { type: 'resolveTop' }))
    const selection = pendingOptionSelection(waiting, 'p1')!
    const declined = ok(server.rules(waiting, {
      type: 'selectOption', seat: 'p1', selectionId: selection.id, optionId: 'decline',
    }))
    expect(declined.stack.some((item) => item.objectId === spellObject.id)).toBe(false)
    expect(declined.objects[spellObject.id].zone).toBe('graveyard')
  })

  test('canonical Ward creates one trigger for a target repeated across clauses', () => {
    const snapshot = snapshotFor([
      { kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
    ], [targetCreature(), targetCreature()])
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Repeated Ward Spell', { types: ['Instant'], manaCost: '{0}', manaValue: 0, ruleDefinition: snapshot })] },
      battlefield: { p2: [cardTemplate('Repeated Ward Bear', { types: ['Creature'], power: 2, toughness: 2, effects: [wardEffect({ life: 2 })] })] },
    }, { random: () => 0, cardPlugins: [wardPlugin] })
    const spellObject = named(server.state, 'Repeated Ward Spell')
    const targetObject = named(server.state, 'Repeated Ward Bear')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [
        { kind: 'object', objectId: targetObject.id },
        { kind: 'object', objectId: targetObject.id },
      ],
    }))
    expect(cast.stack.filter((item) => item.payload?.canonicalWard === true)).toHaveLength(1)
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

  test('a current characteristic of a departed target skips only that dependent instruction', () => {
    const server = canonicalServer(snapshotFor([
      destroy({ targets: target(0) }),
      {
        kind: 'gainLife',
        amount: characteristic(target(0), 'power', { information: 'current' }),
        targets: { kind: 'contextRef', name: 'controller' },
      },
      { kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
    ], [targetCreature()]))
    const targetObject = named(server.state, 'Target Bear')
    const spellObject = named(server.state, 'Canonical Target Spell')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [{ kind: 'object', objectId: targetObject.id }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[targetObject.id].zone).toBe('graveyard')
    expect(resolved.players.p1.life).toBe(41)
  })

  test('an illegal earlier target does not retarget while a later target remains legal', () => {
    const snapshot = snapshotFor([
      damage({ amount: amount(1), targets: target(0), source: ref('self') }),
      destroy({ targets: target(1) }),
    ], [
      targetCreature(),
      targetCreature(),
    ])
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('No Retarget Spell', { types: ['Instant'], manaCost: '{0}', manaValue: 0, ruleDefinition: snapshot })] },
      battlefield: {
        p2: [
          cardTemplate('Departed Bear', { types: ['Creature'], power: 2, toughness: 2 }),
          cardTemplate('Stable Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0 })
    const spellObject = named(server.state, 'No Retarget Spell')
    const departed = named(server.state, 'Departed Bear')
    const stable = named(server.state, 'Stable Bear')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targets: [
        { kind: 'object', objectId: departed.id },
        { kind: 'object', objectId: stable.id },
      ],
    }))
    const moved = ok(server.rules(cast, { type: 'move', objectId: departed.id, to: 'graveyard' }))
    const blinked = ok(server.rules(moved, { type: 'move', objectId: departed.id, to: 'battlefield' }))
    const resolved = ok(server.rules(blinked, { type: 'resolveTop' }))
    expect(resolved.objects[departed.id].damageMarked).toBe(0)
    expect(resolved.objects[departed.id].zone).toBe('battlefield')
    expect(resolved.objects[stable.id].zone).toBe('graveyard')
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

  test('an illegal counter target does not block a legal player clause', () => {
    const counterSnapshot = snapshotFor([
      counter({ targets: target(0) }),
      { kind: 'gainLife', amount: amount(2), targets: target(1) },
    ], [
      select({ filter: stackItems({ kind: 'spell' }), count: 1 }),
      select({ filter: players(), count: 1 }),
    ])
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          cardTemplate('Soon Gone Spell', { types: ['Instant'], manaCost: '{0}', manaValue: 0 }),
          cardTemplate('Mixed Counter Spell', { types: ['Instant'], manaCost: '{0}', manaValue: 0, ruleDefinition: counterSnapshot }),
        ],
      },
    }, { random: () => 0 })
    const targetSpell = named(server.state, 'Soon Gone Spell')
    let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: targetSpell.id }))
    const counterSpell = named(state, 'Mixed Counter Spell')
    const targetStackId = state.stack.find((item) => item.objectId === targetSpell.id)!.id
    state = ok(server.rules(state, {
      type: 'castSpell', seat: 'p1', objectId: counterSpell.id,
      targets: [
        { kind: 'stackItem', stackId: targetStackId },
        { kind: 'player', player: 'p2' },
      ],
    }))
    state = ok(server.rules(state, { type: 'move', objectId: targetSpell.id, to: 'graveyard' }))
    const resolved = ok(server.rules(state, { type: 'resolveTop' }))
    expect(resolved.players.p2.life).toBe(42)
    expect(resolved.objects[targetSpell.id].zone).toBe('graveyard')
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
