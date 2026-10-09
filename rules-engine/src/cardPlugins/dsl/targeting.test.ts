import { describe, expect, test } from 'bun:test'
import { amount, card, compileCardRuleDefinition, createDefinitionSnapshot, destroy, damage, objects, ref, select, spell, target, counter, stackItems } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import type { ReduceResult, GameState } from '../../types'
import type { Instruction, TargetClause } from './schema/v1'

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
})
