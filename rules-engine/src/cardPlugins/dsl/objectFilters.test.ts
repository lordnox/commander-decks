import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate, newGame } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { evaluateObjectSelector } from './compiler/runtime'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, dies, enters, gainLife, leaves, objects, ref, whenever } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

test('other excludes only the captured source, not another object with the same name', () => {
  const state = newGame(commanderRules, { players: ['p1', 'p2'], battlefield: {
    p1: [cardTemplate('Exchangeable fixture', { types: ['Creature'] }), cardTemplate('Exchangeable fixture', { types: ['Creature'] })],
    p2: [cardTemplate('Opponent fixture', { types: ['Artifact'] })],
  } })
  const source = captureObject(Object.values(state.objects)[0]!)
  const context = { state, source, controller: 'p1' }
  const selected = evaluateObjectSelector(objects({ zone: 'battlefield', controller: 'you', other: true }), context)
  expect(selected.map(object => object.id)).toEqual([Object.values(state.objects)[1]!.id])
  expect(evaluateObjectSelector(objects({ other: false }), context)).toHaveLength(3)
  expect(evaluateObjectSelector(objects({ not: { other: true } }), context).map(object => object.id)).toEqual([source.ref.objectId])
  const returned = structuredClone(state)
  returned.objects[source.ref.objectId]!.incarnation += 2
  expect(evaluateObjectSelector(objects({ other: true }), { ...context, state: returned })).toHaveLength(3)
  expect(evaluateObjectSelector(objects({ other: true }), JSON.parse(JSON.stringify({ ...context, state: returned })))).toHaveLength(3)
})

test.each([enters, dies, leaves])('other occurrence predicates exclude the source during %p', pattern => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(pattern({ filter: { type: 'Creature', other: true } }), { instructions: [gainLife({ amount: 1, targets: ref('controller') })] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Watcher fixture', { types: ['Creature'], power: 1, toughness: 1, ruleDefinition: definition }), cardTemplate('Other fixture', { types: ['Creature'], power: 1, toughness: 1 })] },
  }, { random: () => 0 })
  let state = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Watcher fixture').id, to: 'battlefield' }))
  expect(state.stack).toHaveLength(0)
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'move', objectId: named(state, 'Other fixture').id, to: 'battlefield' })))
  expect(state.players.p1.life).toBe(pattern === enters ? 41 : 40)
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'move', objectId: named(state, 'Other fixture').id, to: 'graveyard' })))
  expect(state.players.p1.life).toBe(41)
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'move', objectId: named(state, 'Watcher fixture').id, to: 'graveyard' })))
  expect(state.players.p1.life).toBe(41)
})

test('other filter validation rejects nonboolean values in selectors and occurrence patterns', () => {
  for (const other of ['true', 1, null]) {
    expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'objects', filter: { other } }, min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 } }] }, instructions: [] }] })).toThrow()
    expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ ...whenever(enters({ filter: {} }), { instructions: [] }), on: { kind: 'enters', filter: { other } } }] })).toThrow()
  }
})
