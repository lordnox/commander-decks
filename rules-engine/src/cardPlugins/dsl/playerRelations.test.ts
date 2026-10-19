import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate, newGame } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { evaluateObjectSelector, evaluatePlayerSelector, evaluateStackItemSelector } from './compiler/runtime'
import type { RuleDslRuntimeContext } from './compiler/runtime'
import { card, choice, compileCardRuleDefinition, createDefinitionSnapshot, destroy, enters, gainLife, objects, PLAYER_RELATIONS, players, ref, select, spell, stackItems, target, whenever } from './v1'

const seats = ['p1', 'p2', 'p3', 'p4'] as const
const teamFormat = {
  ...commanderRules,
  opponentsOf: (all: readonly string[], player: string) => all.filter(candidate =>
    ['p1', 'p2'].includes(candidate) !== ['p1', 'p2'].includes(player)),
}
const contextFor = () => {
  const state = newGame(teamFormat, {
    players: [...seats],
    battlefield: Object.fromEntries(seats.map(seat => [seat, [cardTemplate(seat, { types: ['Artifact'] })]])),
  })
  const artifacts = Object.values(state.objects)
  for (const [index, object] of artifacts.entries()) object.owner = seats[(index + 1) % seats.length]!
  state.stack = artifacts.map(object => ({ id: object.controller, name: object.name, kind: 'spell' as const, controller: object.controller, objectId: object.id, targets: [] }))
  return { state, controller: 'p1', source: captureObject(artifacts[0]!) } satisfies RuleDslRuntimeContext
}
const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

test.each([
  [PLAYER_RELATIONS.you, ['p1'], ['p4']],
  [PLAYER_RELATIONS.opponent, ['p3', 'p4'], ['p2', 'p3']],
  [PLAYER_RELATIONS.anyone, ['p1', 'p2', 'p3', 'p4'], ['p1', 'p2', 'p3', 'p4']],
  [PLAYER_RELATIONS.teammate, ['p2'], ['p1']],
] as const)('relation %s has the same meaning for players, controllers, owners and stack controllers', (relation, controlled, owned) => {
  const context = contextFor()
  expect(evaluatePlayerSelector(players({ relation }), context)).toEqual([...controlled])
  expect(evaluateObjectSelector(objects({ controller: relation }), context).map(object => object.name)).toEqual([...controlled])
  expect(evaluateObjectSelector(objects({ owner: relation }), context).map(object => object.name)).toEqual([...owned])
  expect(evaluateStackItemSelector(stackItems({ controller: relation }), context).map(item => item.controller)).toEqual([...controlled])
  const restored = JSON.parse(JSON.stringify(context)) as RuleDslRuntimeContext
  expect(evaluateObjectSelector(objects({ owner: relation }), restored)).toEqual(evaluateObjectSelector(objects({ owner: relation }), context))
})

test('negated and composed player-role relations retain the ownership/control distinction', () => {
  const context = contextFor()
  expect(evaluatePlayerSelector(players({ all: [{ not: { relation: 'you' } }, { not: { relation: 'opponent' } }] }), context)).toEqual(['p2'])
  expect(evaluateObjectSelector(objects({ not: { controller: 'you' } }), context).map(object => object.name)).toEqual(['p2', 'p3', 'p4'])
  expect(evaluateObjectSelector(objects({ not: { owner: 'you' } }), context).map(object => object.name)).toEqual(['p1', 'p2', 'p3'])
})

test('all relation roles exclude eliminated players and teammates exclude the acting player', () => {
  const context = contextFor()
  context.state.players.p2.lost = true
  expect(evaluatePlayerSelector(players({ relation: 'teammate' }), context)).toEqual([])
  expect(evaluateObjectSelector(objects({ controller: 'teammate' }), context)).toEqual([])
  expect(evaluateObjectSelector(objects({ owner: 'teammate' }), context)).toEqual([])
  expect(evaluateStackItemSelector(stackItems({ controller: 'teammate' }), context)).toEqual([])
  expect(evaluatePlayerSelector(players({ relation: 'any' }), context)).toEqual(['p1', 'p3', 'p4'])
})

test.each([ref('controller'), target(0), choice('selected')] as const)('specific-player references work in every player role (%j)', match => {
  const context: RuleDslRuntimeContext = { ...contextFor(), targets: { 0: [{ kind: 'player', playerId: 'p1' }] }, choices: { selected: [{ kind: 'player', playerId: 'p1' }] } }
  expect(evaluatePlayerSelector(players({ relation: match }), context)).toEqual(['p1'])
  expect(evaluateObjectSelector(objects({ controller: match }), context).map(object => object.name)).toEqual(['p1'])
  expect(evaluateObjectSelector(objects({ owner: match }), context).map(object => object.name)).toEqual(['p4'])
  expect(evaluateStackItemSelector(stackItems({ controller: match }), context).map(item => item.controller)).toEqual(['p1'])
})

test('the compiler validates shared relations for every player role', () => {
  for (const relation of Object.values(PLAYER_RELATIONS)) {
    for (const filter of [players({ relation }), objects({ controller: relation }), objects({ owner: relation }), stackItems({ controller: relation })]) {
      expect(() => compileCardRuleDefinition(card([spell({ decisions: { targets: [select({ filter, count: 1 })] }, instructions: [] })]))).not.toThrow()
    }
  }
  for (const [kind, role] of [['players', 'relation'], ['objects', 'controller'], ['objects', 'owner'], ['stackItems', 'controller']]) {
    for (const invalid of ['enemy', ref('source')]) {
      const clause = { ...select({ filter: players(), count: 1 }), filter: { kind, filter: { [role!]: invalid } } }
      expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ ...spell({ instructions: [] }), decisions: { targets: [clause] } }] })).toThrow()
    }
  }
})

test.each(['controller', 'owner'] as const)('%s opponent filters reject teammates at announcement and revalidate at resolution', role => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({ decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Artifact', [role]: 'opponent' }), count: 1 })] }, instructions: [destroy({ targets: target(0) })] }),
  ])))
  const server = createServerGame(teamFormat, {
    players: 4,
    hands: { p1: [cardTemplate('Instruction fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: definition })] },
    battlefield: { p2: [cardTemplate('Teammate artifact', { types: ['Artifact'] })], p3: [cardTemplate('Opponent artifact', { types: ['Artifact'] })] },
  }, { random: () => 0 })
  const announce = (objectId: string) => ({ type: 'castSpell' as const, seat: 'p1', objectId: named(server.state, 'Instruction fixture').id, targets: [{ kind: 'object' as const, objectId }] })
  expect(server.rules(server.state, announce(named(server.state, 'Teammate artifact').id)).ok).toBe(false)
  const victim = named(server.state, 'Opponent artifact').id
  const cast = ok(server.rules(server.state, announce(victim)))
  const changed = structuredClone(cast)
  changed.objects[victim]![role] = 'p2'
  const resolved = resolveStack(server.rules, changed)
  expect(resolved.objects[victim]!.zone).toBe('battlefield')
  expect(named(resolved, 'Instruction fixture').zone).toBe('graveyard')
})

test.each(['controller', 'owner'] as const)('%s relation filters also govern captured trigger occurrences', role => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(enters({ filter: { type: 'Artifact', [role]: 'teammate' } }), { instructions: [gainLife({ amount: 1, targets: ref('controller') })] }),
  ])))
  const server = createServerGame(teamFormat, {
    players: 4,
    battlefield: { p1: [cardTemplate('Watcher fixture', { types: ['Enchantment'], ruleDefinition: definition })] },
    hands: { p2: [cardTemplate('Teammate artifact', { types: ['Artifact'] })], p3: [cardTemplate('Opponent artifact', { types: ['Artifact'] })] },
  }, { random: () => 0 })
  let state = server.state
  for (const name of ['Teammate artifact', 'Opponent artifact']) {
    state = resolveStack(server.rules, ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to: 'battlefield' })))
    expect(state.players.p1.life).toBe(41)
  }
})
