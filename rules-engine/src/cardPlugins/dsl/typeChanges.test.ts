import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { addTypesEffect, addTypesTo, card, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, keyword, move, objects, permanentEffect, ref, select, spell, staticAbility, target, untilCleanup } from './v1'

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

test('additive types follow a targeted creature that was just moved onto the battlefield', () => {
  const definition = snapshot([spell({
    decisions: { targets: [select({ filter: objects({ zone: 'graveyard', type: 'Creature' }), count: 1 })] },
    instructions: [
      move({ targets: target(0), to: 'battlefield', controller: ref('controller') }),
      createEffect({ targets: target(0), effect: addTypesEffect({ subtypes: ['Phyrexian'] }), duration: permanentEffect() }),
    ],
  })])
  const server = createServerGame(commanderRules, {
    hands: {
      p1: [cardTemplate('Reanimator', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })],
      p2: [cardTemplate('Borrowed Body', { types: ['Creature'], subtypes: ['Beast'] })],
    },
  }, { random: () => 0 })
  const body = server.state.zoneOrder.p2.hand[0]!
  const gy = ok(server.rules(server.state, { type: 'move', objectId: body, to: 'graveyard' }))
  const resolved = resolveStack(server.rules, ok(server.rules(gy, {
    type: 'castSpell', seat: 'p1', objectId: gy.zoneOrder.p1.hand[0]!,
    targets: [{ kind: 'object', objectId: body }],
  })))
  expect(resolved.objects[body]).toMatchObject({ zone: 'battlefield', controller: 'p1' })
  expect(resolved.objects[body]!.subtypes).toEqual(['Beast', 'Phyrexian'])
})
