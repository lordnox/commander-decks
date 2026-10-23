import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { addTypesEffect, addTypesTo, card, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, keyword, objects, spell, staticAbility, untilCleanup } from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

test('changeling adds every creature type in hidden and public zones without adding land types', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Fixture', { types: ['Creature'], subtypes: ['Shapeshifter'], ruleDefinition: snapshot([keyword.changeling]) })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  for (const zone of ['hand', 'battlefield', 'graveyard', 'exile'] as const) {
    const state = zone === 'hand' ? server.state : ok(server.rules(server.state, { type: 'move', objectId: id, to: zone }))
    expect(state.objects[id]!.subtypes).toContain('Time Lord')
    expect(state.objects[id]!.subtypes).toContain('Elf')
    expect(state.objects[id]!.subtypes).not.toContain('Forest')
  }
})

test('static type additions follow controller changes and stop when their source leaves', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [
    cardTemplate('Fixture', { types: ['Artifact'], ruleDefinition: snapshot([staticAbility(addTypesTo({ targets: objects({ type: 'Creature', controller: 'you' }), allCreatureTypes: true }))]) }),
    cardTemplate('Subject', { types: ['Creature'], subtypes: ['Human'], power: 2, toughness: 2 }),
  ] }, hands: { p1: [cardTemplate('Hidden subject', { types: ['Creature'], subtypes: ['Human'] })] } }, { random: () => 0 })
  const [source, subject] = server.state.zoneOrder.p1.battlefield
  const hidden = server.state.zoneOrder.p1.hand[0]!
  expect(server.state.objects[subject!]!.subtypes).toContain('Elf')
  expect(server.state.objects[hidden]!.subtypes).toContain('Elf')
  const left = ok(server.rules(server.state, { type: 'move', objectId: source!, to: 'graveyard' }))
  expect(left.objects[subject!]!.subtypes).toEqual(['Human'])
  expect(left.objects[hidden]!.subtypes).toEqual(['Human'])
})

test('temporary additive types retain existing characteristics and survive restore', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Subject', { types: ['Artifact'], subtypes: ['Food'] })] }, hands: { p1: [cardTemplate('Fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot([spell({ instructions: [createEffect({ targets: objects({ zone: 'battlefield', type: 'Artifact' }), effect: addTypesEffect({ types: ['Enchantment'], subtypes: ['Shrine'] }), duration: untilCleanup() })] })]) })] } }, { random: () => 0 })
  const subject = server.state.zoneOrder.p1.battlefield[0]!
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  expect(state.objects[subject]!.types).toEqual(['Artifact', 'Enchantment'])
  expect(state.objects[subject]!.subtypes).toEqual(['Food', 'Shrine'])
  const ended = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), step: 'end' }, { type: 'advanceStep' }))
  expect(ended.objects[subject]!.types).toEqual(['Artifact'])
  expect(ended.objects[subject]!.subtypes).toEqual(['Food'])
})
