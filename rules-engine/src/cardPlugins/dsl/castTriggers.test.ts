import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { draw, activated, createEffect, grantAbilityEffect, untilCleanup, card, characteristic, compileCardRuleDefinition, createDefinitionSnapshot, gainLife, ref, spellCast, whenever } from './v1'

test.each([
  { type: 'Creature', caster: 'p1', change: 'none', matches: true },
  { type: 'Creature', caster: 'p1', change: 'counterAndRemove', matches: true },
  { type: 'Creature', caster: 'p1', change: 'copy', matches: true },
  { type: 'Instant', caster: 'p1', change: 'none', matches: false },
  { type: 'Creature', caster: 'p2', change: 'none', matches: false },
  { type: 'Creature', caster: 'p1', change: 'put', matches: false },
].map(testCase => ({ ...testCase, granted: false })).concat([
  { type: 'Creature', caster: 'p1', change: 'none', matches: true, granted: true },
  { type: 'Creature', caster: 'p1', change: 'counterAndRemove', matches: true, granted: true },
  { type: 'Creature', caster: 'p2', change: 'none', matches: false, granted: true },
]))('cast occurrence matches committed spells and captures their controller/characteristics (%j)', ({ type, caster, change, matches, granted }) => {
  const pattern = spellCast({ filter: { type: 'Creature', controller: 'you' } })
  const instructions = [gainLife({ targets: ref('triggering.player'), amount: characteristic(ref('triggering.object.after'), 'manaValue', { information: 'currentOrLastKnown' }) })]
  const ability = granted
    ? activated({ costs: [], instructions: [createEffect({ targets: ref('source'), effect: grantAbilityEffect({ kind: 'triggered', on: pattern, instructions }), duration: untilCleanup() })] })
    : whenever(pattern, { instructions })
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([ability])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Cast watcher fixture', { types: ['Enchantment'], ruleDefinition: definition })] },
    hands: { [caster]: [cardTemplate('Cast subject fixture', { types: [type], power: 2, toughness: 2, manaCost: '{3}', manaValue: 3 })] },
  }, { random: () => 0 })
  let state = structuredClone(server.state)
  const watcher = state.zoneOrder.p1.battlefield[0]
  const subject = state.zoneOrder[caster].hand[0]
  if (granted) state = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: watcher, abilityId: '$.abilities[0]' })))
  state.active = caster
  state.priority = caster
  state.step = 'precombatMain'
  state.players[caster].mana.C = 3
  state = ok(server.rules(state, change === 'put'
    ? { type: 'move', objectId: subject, to: 'battlefield' }
    : { type: 'castSpell', seat: caster, objectId: subject }))
  expect(state.stack.filter(item => item.kind === 'ability')).toHaveLength(matches ? 1 : 0)
  expect(state.players.p1.life).toBe(40)
  const spell = state.stack.find(item => item.kind === 'spell')
  if (change === 'counterAndRemove') {
    state = ok(server.rules(state, { type: 'counterStackItem', stackId: spell!.id }))
    state = ok(server.rules(state, { type: 'move', objectId: watcher, to: 'graveyard' }))
  }
  if (change === 'copy') {
    state = ok(server.rules(state, { type: 'copySpell', stackId: spell!.id, controller: caster, targets: [] }))
    expect(state.stack.filter(item => item.kind === 'ability')).toHaveLength(1)
  }
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.players.p1.life).toBe(matches ? 43 : 40)
  expect(state.players.p2.life).toBe(40)
})

test.each(['p1', 'p2', 'p3'])('noncreature opponent casts draw only for the watcher controller (caster %s)', caster => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(spellCast({ filter: { controller: 'opponent', not: { type: 'Creature' } } }), {
      instructions: [draw({ count: 1, targets: ref('controller') })],
    }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: { p1: [cardTemplate('Watcher fixture', { types: ['Artifact'], ruleDefinition: definition })] },
    hands: { [caster]: [
      cardTemplate('Creature fixture', { types: ['Creature'], manaCost: '{0}', power: 2, toughness: 2 }),
      cardTemplate('Noncreature fixture', { types: ['Instant'], manaCost: '{0}' }),
    ] },
    libraries: { p1: [cardTemplate('Reward fixture')] },
  }, { random: () => 0 })
  let state: typeof server.state = { ...server.state, active: caster, priority: caster }
  for (const name of ['Creature fixture', 'Noncreature fixture']) {
    const id = Object.values(state.objects).find(object => object.name === name)!.id
    state = resolveStack(server.rules, ok(server.rules({ ...state, priority: caster }, { type: 'castSpell', seat: caster, objectId: id })))
    const triggered = name === 'Noncreature fixture' && caster !== 'p1'
    const reward = Object.values(state.objects).find(object => object.name === 'Reward fixture')!
    expect(reward.zone).toBe(triggered ? 'hand' : 'library')
    expect(state.zoneOrder.p1.hand.includes(reward.id)).toBe(triggered)
    for (const opponent of ['p2', 'p3']) expect(state.zoneOrder[opponent].hand).not.toContain(reward.id)
  }
})
