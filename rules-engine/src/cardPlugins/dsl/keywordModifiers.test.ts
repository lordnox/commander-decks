import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'
import { captureObject } from '../../objectIdentity'
import { ok } from '../../testHelpers'
import { CONTROL_EVENT } from './controlConstants'
import { amount, card, compareAmount, compileCardRuleDefinition, count, createDefinitionSnapshot, grantKeyword, KEYWORDS, modifyStats, objects, players, ref, staticAbility } from './v1'

const definition = (conditional = false) => {
  const when = conditional ? compareAmount(count(objects({ among: ref('source'), tapped: false })), 'eq', 1) : undefined
  return createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(grantKeyword({ targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }), keyword: KEYWORDS.haste, ...(when ? { when } : {}) })),
    ...(conditional ? [staticAbility(modifyStats({ targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }), power: amount(2), toughness: amount(2), when }))] : []),
  ])))
}

const setup = (conditional = false) => createServerGame(commanderRules, {
  players: 2,
  battlefield: {
    p1: [cardTemplate('Grant source', { types: ['Artifact'], ruleDefinition: definition(conditional) }), cardTemplate('Ally', { types: ['Creature'], power: 2, toughness: 2 }), cardTemplate('Relic', { types: ['Artifact'] })],
    p2: [cardTemplate('Opponent', { types: ['Creature'], power: 2, toughness: 2 })],
  },
  hands: { p1: [cardTemplate('Newcomer', { types: ['Creature'], power: 2, toughness: 2 })] },
}, { random: () => 0 })

const named = (state: ReturnType<typeof setup>['state'], name: string) => Object.values(state.objects).find(object => object.name === name)!
const haste = (state: ReturnType<typeof setup>['state'], name: string) => hasKeyword(named(state, name), KEYWORDS.haste, state)

test('filtered keyword grants follow new entrants and source departure without changing timestamps', () => {
  const server = setup()
  const source = named(server.state, 'Grant source')
  const ally = named(server.state, 'Ally')
  const timestamp = ally.continuousEffects![0].duration
  expect(haste(server.state, 'Ally')).toBe(true)
  expect(haste(server.state, 'Opponent')).toBe(false)
  expect(haste(server.state, 'Relic')).toBe(false)
  const entered = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Newcomer').id, to: 'battlefield' }))
  expect(haste(entered, 'Newcomer')).toBe(true)
  expect(entered.objects[ally.id].continuousEffects![0].duration).toEqual(timestamp)
  const left = ok(server.rules(entered, { type: 'move', objectId: source.id, to: 'graveyard' }))
  expect(haste(left, 'Ally')).toBe(false)
  expect(haste(left, 'Newcomer')).toBe(false)
})

test('conditional keyword and stat grants recompute in both directions after restore', () => {
  const server = setup(true)
  const source = named(server.state, 'Grant source')
  expect(haste(server.state, 'Ally')).toBe(true)
  expect(named(server.state, 'Ally').power).toBe(4)
  const tapped = ok(server.rules(structuredClone(server.state), { type: 'tap', objectId: source.id }))
  expect(haste(tapped, 'Ally')).toBe(false)
  expect(named(tapped, 'Ally').power).toBe(2)
  const untapped = ok(server.rules(structuredClone(tapped), { type: 'untap', objectId: source.id }))
  expect(haste(untapped, 'Ally')).toBe(true)
  expect(named(untapped, 'Ally').power).toBe(4)
})

test('keyword grants follow the source controller and phase with their source', () => {
  const server = setup()
  const source = named(server.state, 'Grant source')
  const changed = ok(server.rules(server.state, { type: CONTROL_EVENT.change, objectRef: captureObject(source).ref, controller: 'p2' }))
  expect(haste(changed, 'Ally')).toBe(false)
  expect(haste(changed, 'Opponent')).toBe(true)
  const phased = ok(server.rules(changed, { type: 'phaseOut', objectId: source.id }))
  expect(haste(phased, 'Opponent')).toBe(false)
  const returned = ok(server.rules(phased, { type: 'phaseIn', objectId: source.id }))
  expect(haste(returned, 'Opponent')).toBe(true)
})

test('keyword modifier validation rejects unsupported keywords and player recipients', () => {
  for (const effect of [
    { kind: 'grantKeyword', targets: objects({ zone: 'battlefield' }), keyword: 'unknown' },
    { kind: 'grantKeyword', targets: players(), keyword: KEYWORDS.haste },
  ]) {
    expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ kind: 'static', activeIn: ['battlefield'], effects: [effect] }] })).toThrow()
  }
})
