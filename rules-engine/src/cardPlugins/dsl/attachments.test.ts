import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { ok, resolveStack } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, draw, objects, players, ref, staticAbility, stepBegins, whenever } from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

test('a typed player Aura attaches on cast and its end-step program captures the enchanted player', () => {
  const server = createServerGame(commanderRules, { players: 3, hands: { p1: [cardTemplate('Fixture', { types: ['Enchantment'], subtypes: ['Aura'], manaCost: '{0}', ruleDefinition: snapshot([
    staticAbility({ kind: 'enchant', filter: players({ relation: 'opponent' }) }),
    whenever(stepBegins({ step: 'end', player: ref('enchanted.player') }), { instructions: [draw({ targets: ref('controller'), count: 1 }), draw({ targets: ref('enchanted.player'), count: 1 })] }),
  ]) })] }, libraries: { p1: [cardTemplate('One')], p2: [cardTemplate('Two')] } }, { random: () => 0 })
  const aura = server.state.zoneOrder.p1.hand[0]!
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: aura, targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(false)
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: aura, targets: [{ kind: 'player', player: 'p2' }] })))
  expect(state.objects[aura]!).toMatchObject({ zone: 'battlefield', attachedTo: 'p2' })
  state = resolveStack(server.rules, ok(server.rules({ ...JSON.parse(JSON.stringify(state)), active: 'p2', step: 'postcombatMain' }, { type: 'advanceStep' })))
  expect(state.zoneOrder.p1.hand).toHaveLength(1)
  expect(state.zoneOrder.p2.hand).toHaveLength(1)
})

test.each([false, true])('a noncast Aura chooses its host before entering with typed choices (player=%s)', player => {
  const server = createServerGame(commanderRules, { players: 3, hands: { p1: [cardTemplate('Fixture', { types: ['Enchantment'], subtypes: ['Aura'], ruleDefinition: snapshot([
    staticAbility({ kind: 'enchant', filter: player ? players({ relation: 'opponent' }) : objects({ zone: 'battlefield', type: 'Creature' }) }),
  ]) })] }, battlefield: { p2: [cardTemplate('Host', { types: ['Creature'], power: 2, toughness: 2 })] } }, { random: () => 0 })
  const aura = server.state.zoneOrder.p1.hand[0]!
  let state = ok(server.rules(server.state, { type: 'move', objectId: aura, to: 'battlefield' }))
  expect(state.objects[aura]!.zone).toBe('hand')
  state = JSON.parse(JSON.stringify(state))
  if (player) {
    const pick = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: pick.id, players: ['p2'] }))
  } else {
    const pick = pendingSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [server.state.zoneOrder.p2.battlefield[0]!] }))
  }
  expect(state.objects[aura]!.zone).toBe('battlefield')
  expect(state.objects[aura]!.attachedTo).toBe(player ? 'p2' : server.state.zoneOrder.p2.battlefield[0]!)
})

test('noncast attachment ignores hexproof while a targeted Aura spell cannot', () => {
  const definition = snapshot([staticAbility({ kind: 'enchant', filter: objects({ zone: 'battlefield', type: 'Creature' }) })])
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Fixture', { types: ['Enchantment'], subtypes: ['Aura'], manaCost: '{0}', ruleDefinition: definition })] }, battlefield: { p2: [cardTemplate('Host', { types: ['Creature'], power: 2, toughness: 2, oracleText: 'Hexproof' })] } }, { random: () => 0 })
  const aura = server.state.zoneOrder.p1.hand[0]!
  const host = server.state.zoneOrder.p2.battlefield[0]!
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: aura, targets: [{ kind: 'object', objectId: host }] }).ok).toBe(false)
  let state = ok(server.rules(server.state, { type: 'move', objectId: aura, to: 'battlefield' }))
  const pick = pendingSelectionFor(state, 'p1')!
  state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [host] }))
  expect(state.objects[aura]!).toMatchObject({ zone: 'battlefield', attachedTo: host })
})

test('a noncast Aura with no legal attachment remains in its original zone', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Fixture', { types: ['Enchantment'], subtypes: ['Aura'], ruleDefinition: snapshot([staticAbility({ kind: 'enchant', filter: objects({ zone: 'battlefield', type: 'Creature' }) })]) })] } }, { random: () => 0 })
  const aura = server.state.zoneOrder.p1.hand[0]!
  const state = ok(server.rules(server.state, { type: 'move', objectId: aura, to: 'battlefield' }))
  expect(state.objects[aura]!.zone).toBe('hand')
  expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
})

test('catalog Tenuous Truce attaches to an opponent, draws at their end step, and breaks on attacks', () => {
  const server = createServerGame(commanderRules, {
    players: 4,
    hands: { p1: [cardTemplate('Tenuous Truce')] },
    battlefield: { p1: [cardTemplate('Diplomat', { types: ['Creature'], power: 2, toughness: 2 })] },
    libraries: { p1: [cardTemplate('P1 Draw')], p2: [cardTemplate('P2 Draw')] },
  }, { random: () => 0.5 })
  const named = (current: typeof server.state, name: string) =>
    Object.values(current.objects).find((object) => object.name === name)!
  let state = structuredClone(server.state)
  state.step = 'precombatMain'
  state.players.p1.mana = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 1 }
  const truce = named(state, 'Tenuous Truce')
  state = ok(server.rules(state, {
    type: 'castSpell', seat: 'p1', objectId: truce.id, targets: [{ kind: 'player', player: 'p2' }],
  }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(state.objects[truce.id].attachedTo).toBe('p2')

  const ending = structuredClone(state)
  ending.active = 'p2'
  ending.step = 'postcombatMain'
  state = ok(server.rules(ending, { type: 'custom', name: 'advanceStep' }))
  expect(state.stack[0]?.execution?.abilityIndex).toBe(1)
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(state.zoneOrder.p1.hand).toHaveLength(1)
  expect(state.zoneOrder.p2.hand).toHaveLength(1)

  const attacking = structuredClone(state)
  attacking.active = 'p1'
  attacking.priority = 'p1'
  attacking.step = 'declareAttackers'
  const diplomat = named(attacking, 'Diplomat')
  diplomat.summoningSickness = false
  state = ok(server.rules(attacking, {
    type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: diplomat.id, defender: 'p2' }],
  }))
  expect(state.stack[0]?.execution?.abilityIndex).toBe(2)
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(state.objects[truce.id].zone).toBe('graveyard')
})
