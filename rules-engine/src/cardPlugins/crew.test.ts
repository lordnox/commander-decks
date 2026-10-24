import { expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, crew } from './dsl/v1'

const vehicle = () => cardTemplate('Vehicle fixture', { types: ['Artifact'], subtypes: ['Vehicle'], power: 5, toughness: 5,
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([crew(3)]))),
})
const creature = (name: string, power: number) => cardTemplate(name, { types: ['Creature'], power, toughness: 4, summoningSickness: true })
const game = () => createServerGame(commanderRules, { players: 2,
  battlefield: { p1: [vehicle(), creature('Small', 1), creature('Large', 2), creature('Negative', -1)], p2: [creature('Opponent', 4)] },
}, { random: () => 0 })
const named = (state: ReturnType<typeof game>['state'], name: string) => Object.values(state.objects).find(object => object.name === name)!.id
const activation = (server: ReturnType<typeof game>, choices: string[]) => ({ type: 'activateAbility' as const, seat: 'p1', objectId: named(server.state, 'Vehicle fixture'), abilityId: '$.abilities[0]', choices })

test('crew pays with multiple sick creatures before animation resolves, survives restore, and expires at cleanup', () => {
  const server = game()
  const small = named(server.state, 'Small'), large = named(server.state, 'Large'), id = named(server.state, 'Vehicle fixture')
  const action = legalActsFor(server.state, 'p1').find(action => action.kind === 'activateAbility' && action.objectId === id)!
  if (action.kind !== 'activateAbility') throw new Error('expected crew activation')
  expect(action).toMatchObject({ targetGroups: [{ min: 1, max: 3, minTotalPower: 3 }] })
  let state = server.state
  for (const event of eventsForAvailableAction(state, 'p1', { ...action, targetObjectIds: [small, large] }) ?? []) state = ok(server.rules(state, event))
  expect(state.objects[small]!.tapped).toBe(true)
  expect(state.objects[large]!.tapped).toBe(true)
  expect(state.objects[id]!.types).toEqual(['Artifact'])
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.objects[id]).toMatchObject({ types: ['Artifact', 'Creature'], subtypes: ['Vehicle'], power: 5, toughness: 5 })
  state = ok(server.rules({ ...state, step: 'end' }, { type: 'advanceStep' }))
  expect(state.objects[id]).toMatchObject({ types: ['Artifact'], power: 5, toughness: 5 })
})

test('crew validates total signed power, distinctness, controller, tapped state, phasing, and source exclusion', () => {
  const server = game(), small = named(server.state, 'Small'), large = named(server.state, 'Large')
  for (const ids of [[], [small], [large, large], [small, large, named(server.state, 'Negative')], [named(server.state, 'Opponent')], [named(server.state, 'Vehicle fixture')]]) expect(server.rules(server.state, activation(server, ids)).ok).toBe(false)
  for (const change of ['tapped', 'phasedOut'] as const) {
    const state = structuredClone(server.state)
    state.objects[large]![change] = true
    expect(server.rules(state, activation(server, [small, large])).ok).toBe(false)
    expect(legalActsFor(state, 'p1').some(action => action.kind === 'activateAbility' && action.objectId === named(state, 'Vehicle fixture'))).toBe(false)
  }
  expect(server.state.objects[small]!.tapped).toBe(false)
})

test('a countered crew ability keeps payment tapped and a departed Vehicle does not animate its replacement', () => {
  const server = game(), small = named(server.state, 'Small'), large = named(server.state, 'Large'), id = named(server.state, 'Vehicle fixture')
  const cast = ok(server.rules(server.state, activation(server, [small, large])))
  const countered = ok(server.rules(cast, { type: 'counterStackItem', stackId: cast.stack[0]!.id }))
  expect(countered.objects[small]!.tapped).toBe(true)
  expect(countered.objects[id]!.types).toEqual(['Artifact'])
  const left = ok(server.rules(cast, { type: 'move', objectId: id, to: 'exile' }))
  const returned = ok(server.rules(left, { type: 'move', objectId: id, to: 'battlefield' }))
  expect(resolveStack(server.rules, returned).objects[id]!.types).toEqual(['Artifact'])
})

test('a replacement can modify a paid crew tap without undoing the cost (CR 118.11)', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [vehicle(), creature('Small', 1), creature('Large', 2)] } }, {
    random: () => 0, cardPlugins: [{ id: 'fixture.preventCrewTap', replace: ({ state, event }) => event.type === 'tap' && state.objects[event.objectId]?.name === 'Large' ? null : undefined }],
  })
  const result = server.rules(server.state, activation(server, [named(server.state, 'Small'), named(server.state, 'Large')]))
  expect(result.state.stack).toHaveLength(1)
  expect(result.state.objects[named(server.state, 'Small')]!.tapped).toBe(true)
  expect(result.state.objects[named(server.state, 'Large')]!.tapped).toBe(false)
})
