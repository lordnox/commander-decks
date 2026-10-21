import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { canonicalTargetCandidates } from './compiler/targeting'
import { instructionSpell } from './instructionTestSupport'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  move,
  objects,
  select,
  spell,
  target,
} from './v1'

const mixedFilter = objects({
  controller: 'opponent',
  any: [
    { zone: 'stack' },
    { zone: 'battlefield', not: { type: 'Land' } },
  ],
})

const bounceProgram = () => ({
  decisions: { targets: [select({ filter: mixedFilter, count: 1 })] },
  instructions: [move({ targets: target(0), to: 'hand' })],
})

const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!

const bounceSpell = () => instructionSpell(bounceProgram())

test('mixed object targeting bounces an opponent creature and rejects lands and own permanents', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [bounceSpell()] },
    battlefield: {
      p1: [cardTemplate('Own Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      p2: [
        cardTemplate('Enemy Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        cardTemplate('Forest', { types: ['Land'] }),
      ],
    },
  }, { random: () => 0 })
  const source = named(server.state, 'Instruction fixture')
  expect(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: source.id,
    targets: [{ kind: 'object', objectId: named(server.state, 'Forest').id }],
  }).ok).toBe(false)
  expect(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: source.id,
    targets: [{ kind: 'object', objectId: named(server.state, 'Own Bear').id }],
  }).ok).toBe(false)
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: source.id,
    targets: [{ kind: 'object', objectId: named(server.state, 'Enemy Bear').id }],
  })))
  expect(named(resolved, 'Enemy Bear').zone).toBe('hand')
  expect(named(resolved, 'Forest').zone).toBe('battlefield')
  expect(named(resolved, 'Own Bear').zone).toBe('battlefield')
})

const withPriority = (state: GameState, seat: 'p1' | 'p2') => {
  const next = structuredClone(state)
  next.priority = seat
  return next
}

test('mixed object targeting returns an opponent spell to hand and removes it from the stack', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [bounceSpell()],
      p2: [cardTemplate('Threat', { types: ['Instant'], manaCost: '{0}' })],
    },
  }, { random: () => 0 })
  const stacked = ok(server.rules(withPriority(server.state, 'p2'), {
    type: 'castSpell', seat: 'p2', objectId: named(server.state, 'Threat').id,
  }))
  const responding = withPriority(stacked, 'p1')
  expect(server.rules(responding, {
    type: 'castSpell', seat: 'p1', objectId: named(responding, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: named(responding, 'Threat').id }],
  }).ok).toBe(true)
  const resolved = resolveStack(server.rules, ok(server.rules(responding, {
    type: 'castSpell', seat: 'p1', objectId: named(responding, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: named(responding, 'Threat').id }],
  })))
  expect(named(resolved, 'Threat').zone).toBe('hand')
  expect(named(resolved, 'Instruction fixture').zone).toBe('graveyard')
  expect(resolved.stack).toHaveLength(0)
  expect(server.rules(resolved, { type: 'resolveTop' }).ok).toBe(false)
})

test('mixed object targeting rejects a spell you control', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [
      bounceSpell(),
      cardTemplate('Own instant', { types: ['Instant'], manaCost: '{0}' }),
    ] },
  }, { random: () => 0 })
  const stacked = ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Own instant').id,
  }))
  expect(server.rules(stacked, {
    type: 'castSpell', seat: 'p1', objectId: named(stacked, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: named(stacked, 'Own instant').id }],
  }).ok).toBe(false)
})

test('one mixed clause offers stack spells and battlefield nonlands, not lands or own cards', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell(bounceProgram())])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [cardTemplate('Bounce fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: definition })],
      p2: [cardTemplate('Threat', { types: ['Instant'], manaCost: '{0}' })],
    },
    battlefield: {
      p1: [cardTemplate('Own Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      p2: [
        cardTemplate('Enemy Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        cardTemplate('Forest', { types: ['Land'] }),
      ],
    },
  }, { random: () => 0 })
  const stacked = ok(server.rules(withPriority(server.state, 'p2'), {
    type: 'castSpell', seat: 'p2', objectId: named(server.state, 'Threat').id,
  }))
  const source = named(stacked, 'Bounce fixture')
  const ability = definition.definition.abilities[0]
  if (ability.kind !== 'spell') throw new Error('expected spell')
  const [candidates] = canonicalTargetCandidates(stacked, source, ability, 'p1')
  const names = new Set(candidates.map((candidate) => {
    if (candidate.kind !== 'object') return candidate.kind
    return stacked.objects[candidate.objectId]?.name
  }))
  expect(names).toEqual(new Set(['Threat', 'Enemy Bear']))
})

test('battlefield-only object targeting still excludes spells on the stack', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Land' } }), count: 1 })] },
    instructions: [move({ targets: target(0), to: 'hand' })],
  })])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [cardTemplate('Battlefield bounce', { types: ['Instant'], manaCost: '{0}', ruleDefinition: definition })],
      p2: [cardTemplate('Threat', { types: ['Instant'], manaCost: '{0}' })],
    },
    battlefield: { p2: [cardTemplate('Enemy Bear', { types: ['Creature'], power: 2, toughness: 2 })] },
  }, { random: () => 0 })
  const stacked = ok(server.rules(withPriority(server.state, 'p2'), {
    type: 'castSpell', seat: 'p2', objectId: named(server.state, 'Threat').id,
  }))
  const source = named(stacked, 'Battlefield bounce')
  const ability = definition.definition.abilities[0]
  if (ability.kind !== 'spell') throw new Error('expected spell')
  const [candidates] = canonicalTargetCandidates(stacked, source, ability, 'p1')
  expect(candidates.map((candidate) => candidate.kind === 'object' && stacked.objects[candidate.objectId]?.name))
    .toEqual(['Enemy Bear'])
  expect(server.rules(withPriority(stacked, 'p1'), {
    type: 'castSpell', seat: 'p1', objectId: source.id,
    targets: [{ kind: 'object', objectId: named(stacked, 'Threat').id }],
  }).ok).toBe(false)
})
