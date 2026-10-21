import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'
import { captureObject } from '../../objectIdentity'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { CONTROL_EVENT } from './controlConstants'
import { amount, card, compareAmount, compileCardRuleDefinition, count, createDefinitionSnapshot, createEffect, grantKeywordEffect, grantKeyword, KEYWORDS, keyword, modifyStats, objects, players, ref, staticAbility, suppressKeyword, untilCleanup } from './v1'

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
  for (const kind of ['grantKeyword', 'suppressKeyword']) {
    for (const effect of [
      { kind, targets: objects({ zone: 'battlefield' }), keyword: 'unknown' },
      { kind, targets: players(), keyword: KEYWORDS.haste },
    ]) {
      expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ kind: 'static', activeIn: ['battlefield'], effects: [effect] }] })).toThrow()
    }
  }
})

const suppression = (conditional = false) => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(suppressKeyword({
    targets: objects({ zone: 'battlefield', controller: 'opponent', type: 'Creature' }),
    keyword: KEYWORDS.hexproof,
    ...(conditional ? { when: compareAmount(count(objects({ among: ref('source'), tapped: false })), 'eq', 1) } : {}),
  })),
])))

const hexproofGrant = createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(grantKeyword({ targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }), keyword: KEYWORDS.hexproof })),
])))
const printedHexproof = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.hexproof])))

test.each([[false], [true]] as const)('cannot-gain suppression overrides printed, static, and temporary grants regardless of source order (%s)', suppressionFirst => {
  const suppressor = cardTemplate('Suppressor', { types: ['Artifact'], ruleDefinition: suppression() })
  const grantor = cardTemplate('Grantor', { types: ['Artifact'], ruleDefinition: hexproofGrant })
  const sourceOrder = suppressionFirst ? { p1: [suppressor], p2: [grantor] } : { p2: [grantor], p1: [suppressor] }
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      ...sourceOrder,
      p2: [...sourceOrder.p2, cardTemplate('Printed recipient', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: printedHexproof }), cardTemplate('Granted recipient', { types: ['Creature'], power: 2, toughness: 2 }), cardTemplate('Unaffected relic', { types: ['Artifact'], ruleDefinition: printedHexproof })],
    },
    hands: { p1: [instructionSpell({ instructions: [createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature' }), effect: grantKeywordEffect(KEYWORDS.hexproof), duration: untilCleanup() })] })] },
  }, { random: () => 0 })
  const has = (state: typeof server.state, name: string) => hasKeyword(named(state, name), KEYWORDS.hexproof, state)
  expect(has(server.state, 'Printed recipient')).toBe(false)
  expect(has(server.state, 'Granted recipient')).toBe(false)
  expect(has(server.state, 'Unaffected relic')).toBe(true)
  const granted = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })))
  expect(has(granted, 'Granted recipient')).toBe(false)
  const withoutGrantor = ok(server.rules(granted, { type: 'move', objectId: named(granted, 'Grantor').id, to: 'graveyard' }))
  const restored = ok(server.rules(structuredClone(withoutGrantor), { type: 'move', objectId: named(withoutGrantor, 'Suppressor').id, to: 'graveyard' }))
  expect(has(restored, 'Printed recipient')).toBe(true)
  expect(has(restored, 'Granted recipient')).toBe(true)
  const cleanup = ok(server.rules({ ...restored, step: 'end', priority: null }, { type: 'advanceStep' }))
  expect(has(cleanup, 'Printed recipient')).toBe(true)
  expect(has(cleanup, 'Granted recipient')).toBe(false)
})

test('conditional suppression follows source control, phasing, and state changes', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Suppressor', { types: ['Artifact'], ruleDefinition: suppression(true) }), cardTemplate('Ally', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: printedHexproof })],
      p2: [cardTemplate('Opponent', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: printedHexproof })],
    },
  }, { random: () => 0 })
  const has = (state: typeof server.state, name: string) => hasKeyword(named(state, name), KEYWORDS.hexproof, state)
  const source = named(server.state, 'Suppressor')
  expect(has(server.state, 'Ally')).toBe(true)
  expect(has(server.state, 'Opponent')).toBe(false)
  const tapped = ok(server.rules(server.state, { type: 'tap', objectId: source.id }))
  expect(has(tapped, 'Opponent')).toBe(true)
  const untapped = ok(server.rules(tapped, { type: 'untap', objectId: source.id }))
  expect(has(untapped, 'Opponent')).toBe(false)
  const changed = ok(server.rules(untapped, { type: CONTROL_EVENT.change, objectRef: captureObject(source).ref, controller: 'p2' }))
  expect(has(changed, 'Ally')).toBe(false)
  expect(has(changed, 'Opponent')).toBe(true)
  const phased = ok(server.rules(changed, { type: 'phaseOut', objectId: source.id }))
  expect(has(phased, 'Ally')).toBe(true)
  const returned = ok(server.rules(phased, { type: 'phaseIn', objectId: source.id }))
  expect(has(returned, 'Ally')).toBe(false)
})

test('opposing grant-and-suppression sources each prevent the other side from having the keyword', () => {
  const both = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(
      grantKeyword({ targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }), keyword: KEYWORDS.hexproof }),
      suppressKeyword({ targets: objects({ zone: 'battlefield', controller: 'opponent', type: 'Creature' }), keyword: KEYWORDS.hexproof }),
    ),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('First source', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: both })],
      p2: [cardTemplate('Second source', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: both })],
    },
  }, { random: () => 0 })
  for (const object of Object.values(server.state.objects)) expect(hasKeyword(object, KEYWORDS.hexproof, server.state)).toBe(false)
  const removed = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Second source').id, to: 'graveyard' }))
  expect(hasKeyword(named(removed, 'First source'), KEYWORDS.hexproof, removed)).toBe(true)
})
