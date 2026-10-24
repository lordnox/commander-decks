import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { activated, addTypesTo, card, characteristic, compileCardRuleDefinition, count, createDefinitionSnapshot, createEffect, gainLife, keyword, modifyStats, objects, ref, removeAbilitiesEffect, setStatsEffect, spell, staticAbility, untilCleanup } from './v1'
import { ZONE_IDS } from '../../types'

const snapshot = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

test('characteristic-defining stats apply in every zone and update with the live count', () => {
  const amount = count(objects({ zone: 'battlefield', type: 'Land', controller: 'you' }))
  const definition = snapshot([{ ...staticAbility({ kind: 'modifyStats', targets: objects({ among: ref('source') }), power: amount, toughness: amount, set: true, characteristicDefining: true }), activeIn: ZONE_IDS }])
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Subject', { types: ['Creature'], power: 0, toughness: 0, ruleDefinition: definition }), cardTemplate('Land', { types: ['Land'] })] }, battlefield: { p1: [cardTemplate('Land 1', { types: ['Land'] })] } }, { random: () => 0 })
  const [subject, land] = server.state.zoneOrder.p1.hand
  expect(server.state.objects[subject!]!.power).toBe(1)
  let state = ok(server.rules(server.state, { type: 'move', objectId: land!, to: 'battlefield' }))
  expect(state.objects[subject!]!.power).toBe(2)
  state = ok(server.rules(state, { type: 'move', objectId: subject!, to: 'graveyard' }))
  expect(state.objects[subject!]!.toughness).toBe(2)
})

test('conditional animation uses each subject mana value and preserves other types', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [
    cardTemplate('Fixture', { types: ['Artifact'], ruleDefinition: snapshot([staticAbility(
      addTypesTo({ targets: objects({ zone: 'battlefield', type: 'Enchantment' }), types: ['Creature'] }),
      modifyStats({ targets: objects({ zone: 'battlefield', type: 'Enchantment' }), set: true, power: characteristic(ref('subject'), 'manaValue', { information: 'current' }), toughness: characteristic(ref('subject'), 'manaValue', { information: 'current' }) }),
    )]) }),
    cardTemplate('Subject', { types: ['Enchantment'], manaValue: 4 }),
  ] } }, { random: () => 0 })
  const [source, subject] = server.state.zoneOrder.p1.battlefield
  expect(server.state.objects[subject!]!).toMatchObject({ types: ['Enchantment', 'Creature'], power: 4, toughness: 4 })
  const state = ok(server.rules(server.state, { type: 'move', objectId: source!, to: 'graveyard' }))
  expect(state.objects[subject!]!).toMatchObject({ types: ['Enchantment'], power: null, toughness: null })
})

test('ability loss removes printed canonical behavior without deleting unrelated types or counters', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Subject', { types: ['Artifact', 'Creature'], subtypes: ['Human'], power: 2, toughness: 2, ruleDefinition: snapshot([
    keyword.flying,
    activated({ costs: [], instructions: [gainLife({ targets: ref('controller'), amount: 1 })] }),
  ]) })] }, hands: { p1: [cardTemplate('Fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot([spell({ instructions: [
    createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature' }), effect: removeAbilitiesEffect(), duration: untilCleanup() }),
    createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature' }), effect: setStatsEffect(1, 1), duration: untilCleanup() }),
  ] })]) })] } }, { random: () => 0 })
  const subject = server.state.zoneOrder.p1.battlefield[0]!
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  expect(state.objects[subject]!).toMatchObject({ types: ['Artifact', 'Creature'], subtypes: ['Human'], power: 1, toughness: 1 })
  expect(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: subject, abilityId: '$.abilities[1]' }).ok).toBe(false)
  const restored = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), step: 'end' }, { type: 'advanceStep' }))
  expect(restored.objects[subject]!.power).toBe(2)
  expect(server.rules(restored, { type: 'activateAbility', seat: 'p1', objectId: subject, abilityId: '$.abilities[1]' }).ok).toBe(true)
})
