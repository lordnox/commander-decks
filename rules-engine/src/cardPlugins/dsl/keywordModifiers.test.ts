import type { CardTemplate } from '../../newGame'
import type { GameState } from '../../types'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'
import { captureObject } from '../../objectIdentity'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { CONTROL_EVENT } from './controlConstants'
import { activated, destroy, manaCost, select, target, amount, card, compareAmount, compileCardRuleDefinition, count, createDefinitionSnapshot, createEffect, grantKeywordEffect, grantKeyword, KEYWORDS, keyword, modifyStats, objects, players, ref, staticAbility, suppressKeyword, untilCleanup } from './v1'

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
const haste = (state: ReturnType<typeof setup>['state'], name: string) => hasKeyword(named(state, name), KEYWORDS.haste)

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
  const has = (state: typeof server.state, name: string) => hasKeyword(named(state, name), KEYWORDS.hexproof)
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
  const has = (state: typeof server.state, name: string) => hasKeyword(named(state, name), KEYWORDS.hexproof)
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
  for (const object of Object.values(server.state.objects)) expect(hasKeyword(object, KEYWORDS.hexproof)).toBe(false)
  const removed = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Second source').id, to: 'graveyard' }))
  expect(hasKeyword(named(removed, 'First source'), KEYWORDS.hexproof)).toBe(true)
})

describe('paid temporary indestructibility grants', () => {
  const creature = (name: string, extra: Partial<CardTemplate> = {}) =>
    cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })
  const filler = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => cardTemplate(`${prefix} ${i}`, { types: ['Sorcery'] }))
  const mainPhase = (state: GameState) => {
    const ready = structuredClone(state)
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.step = 'precombatMain'
    return ready
  }
  const pool = (state: GameState, mana: Partial<GameState['players'][string]['mana']>) => {
    Object.assign(state.players.p1.mana, mana)
    return state
  }
  const advanceTo = (server: ReturnType<typeof createServerGame>, state: GameState, step: GameState['step']) => {
    let current = state
    for (let guard = 0; guard < 24 && current.step !== step; guard += 1) {
      current = resolveStack(server.rules, ok(server.rules(current, { type: 'advanceStep' })))
    }
    expect(current.step).toBe(step)
    return current
  }

  const ABILITY = '$.abilities[1]'

  const setup = () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [{ ...instructionSpell({
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), count: 1 })] },
        instructions: [destroy({ targets: target(0) })],
      }), name: 'Destroy fixture' }] },
      battlefield: {
        p1: [
          creature('Grant fixture', {
            power: 5, toughness: 5,
            ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
              keyword.indestructible,
              activated({
                costs: [manaCost('{1}')],
                decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', powerAtLeast: 5 }), count: 1 })] },
                instructions: [createEffect({ targets: target(0), effect: grantKeywordEffect(KEYWORDS.indestructible), duration: untilCleanup() })],
              }),
            ]))),
          }),
          creature('Own Giant', { power: 5, toughness: 5 }),
          creature('Own Runt', { power: 4, toughness: 4 }),
        ],
        p2: [
          creature('Foe Giant', { power: 6, toughness: 6 }),
          creature('Foe Shrouded', { power: 7, toughness: 7, oracleText: 'Hexproof' }),
        ],
      },
      libraries: { p1: filler('A', 12), p2: filler('B', 12) },
    }, { random: () => 0.5 })
    const ready = pool(mainPhase(server.state), { B: 2, G: 2, C: 8 })
    return { server, ready }
  }

  const activate = (state: GameState, targetName: string, seat = 'p1') => ({
    type: 'activateAbility' as const,
    abilityId: ABILITY,
    seat,
    objectId: named(state, 'Grant fixture').id,
    targets: [{ kind: 'object' as const, objectId: named(state, targetName).id }],
  })

  const indestructible = (state: GameState, name: string) =>
    hasKeyword(named(state, name), 'indestructible')

  const lethalDamage = (server: ReturnType<typeof createServerGame>, state: GameState, name: string) =>
    ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Foe Giant').id,
      target: { kind: 'object', objectId: named(state, name).id },
      amount: 20,
    }))

  const destroyTarget = (server: ReturnType<typeof createServerGame>, state: GameState, name: string) =>
    resolveStack(server.rules, ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Destroy fixture').id,
      targets: [{ kind: 'object', objectId: named(state, name).id }],
    })))

  test('an intrinsic keyword survives lethal damage and destruction independently of grants', () => {
    const { server, ready } = setup()
    expect(indestructible(ready, 'Grant fixture')).toBe(true)
    const survived = lethalDamage(server, ready, 'Grant fixture')
    expect(named(survived, 'Grant fixture').zone).toBe('battlefield')
    const unharmed = destroyTarget(server, ready, 'Grant fixture')
    expect(named(unharmed, 'Grant fixture').zone).toBe('battlefield')
  })

  test('a legal target, even an opponent creature, survives lethal damage and destroy effects until end of turn', () => {
    const { server, ready } = setup()
    for (const name of ['Own Giant', 'Foe Giant', 'Grant fixture']) {
      const stacked = ok(server.rules(ready, activate(ready, name)))
      expect(stacked.stack[0]).toMatchObject({ kind: 'ability', abilityId: ABILITY })
      expect(stacked.players.p1.mana.C).toBe(7)
      const resolved = resolveStack(server.rules, stacked)
      expect(indestructible(resolved, name)).toBe(true)
      expect(named(lethalDamage(server, resolved, name), name).zone).toBe('battlefield')
    }
    const stacked = ok(server.rules(ready, activate(ready, 'Foe Giant')))
    const protectedGiant = resolveStack(server.rules, stacked)
    expect(named(destroyTarget(server, protectedGiant, 'Foe Giant'), 'Foe Giant').zone).toBe('battlefield')
    // Without the grant the same removal kills it.
    expect(named(destroyTarget(server, ready, 'Foe Giant'), 'Foe Giant').zone).toBe('graveyard')
    expect(named(lethalDamage(server, ready, 'Own Giant'), 'Own Giant').zone).toBe('graveyard')
  })

  test('a creature with power under 5, a non-creature, or a hexproof opponent creature cannot be targeted', () => {
    const { server, ready } = setup()
    for (const name of ['Own Runt', 'Foe Shrouded', 'Destroy fixture']) {
      expect(server.rules(ready, activate(ready, name)).ok).toBe(false)
    }
    expect(server.rules(ready, { ...activate(ready, 'Own Giant'), targets: [] }).ok).toBe(false)
    expect(server.rules(ready, { ...activate(ready, 'Own Giant'), seat: 'p2' }).ok).toBe(false)
  })

  test('the controller may target its own hexproof creature', () => {
    const { server, ready } = setup()
    const edited = structuredClone(ready)
    named(edited, 'Own Giant').oracleText = 'Hexproof'
    const resolved = resolveStack(server.rules, ok(server.rules(edited, activate(edited, 'Own Giant'))))
    expect(indestructible(resolved, 'Own Giant')).toBe(true)
  })

  test('a target whose power drops below 5 in response is not protected', () => {
    const { server, ready } = setup()
    const stacked = structuredClone(ok(server.rules(ready, activate(ready, 'Own Giant'))))
    named(stacked, 'Own Giant').power = 4
    const resolved = resolveStack(server.rules, stacked)
    expect(resolved.stack).toHaveLength(0)
    expect(indestructible(resolved, 'Own Giant')).toBe(false)
    expect(named(lethalDamage(server, resolved, 'Own Giant'), 'Own Giant').zone).toBe('graveyard')
  })

  test("an opponent's creature that gains hexproof in response fizzles the ability", () => {
    const { server, ready } = setup()
    const stacked = structuredClone(ok(server.rules(ready, activate(ready, 'Foe Giant'))))
    named(stacked, 'Foe Giant').oracleText = 'Hexproof'
    const resolved = resolveStack(server.rules, stacked)
    expect(indestructible(resolved, 'Foe Giant')).toBe(false)
  })

  test('a target that left the battlefield in response fizzles the ability', () => {
    const { server, ready } = setup()
    const stacked = ok(server.rules(ready, activate(ready, 'Own Giant')))
    const gone = ok(server.rules(stacked, {
      type: 'move',
      objectId: named(stacked, 'Own Giant').id,
      to: 'exile',
    }))
    const resolved = resolveStack(server.rules, gone)
    expect(resolved.stack).toHaveLength(0)
    expect(named(resolved, 'Own Giant').zone).toBe('exile')
    expect(indestructible(resolved, 'Own Giant')).toBe(false)
  })

  test('the protection wears off at cleanup, and the ability needs its {1}', () => {
    const { server, ready } = setup()
    const broke = structuredClone(ready)
    broke.players.p1.mana.C = 0
    broke.players.p1.mana.B = 0
    broke.players.p1.mana.G = 0
    expect(server.rules(broke, activate(broke, 'Own Giant')).ok).toBe(false)

    const resolved = resolveStack(server.rules, ok(server.rules(ready, activate(ready, 'Own Giant'))))
    expect(indestructible(resolved, 'Own Giant')).toBe(true)
    const next = advanceTo(server, resolved, 'upkeep')
    expect(next.active).toBe('p2')
    expect(indestructible(next, 'Own Giant')).toBe(false)
    expect(named(lethalDamage(server, next, 'Own Giant'), 'Own Giant').zone).toBe('graveyard')
    // The intrinsic keyword remains after temporary grants expire.
    expect(indestructible(next, 'Grant fixture')).toBe(true)
  })
})
