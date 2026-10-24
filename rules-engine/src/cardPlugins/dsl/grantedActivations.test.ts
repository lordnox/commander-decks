import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { activated, removeAbilitiesEffect, captureAmount, gainLife, resultAmount, card, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, grantActivatedAbilityEffect, objects, ref, sacrificeCost, spell, untilCleanup } from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

test('a granted activated mana program uses its recipient as source and outlives the granting spell', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Land', { types: ['Land'] })] }, hands: { p1: [cardTemplate('Fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot([spell({ instructions: [createEffect({ targets: objects({ zone: 'battlefield', type: 'Land', controller: 'you' }), effect: grantActivatedAbilityEffect(activated({ costs: [sacrificeCost(ref('source'), 1)], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { B: { kind: 'constant', value: 1 } } }] })), duration: untilCleanup() })] })]) })] } }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.hand[0]!
  const land = server.state.zoneOrder.p1.battlefield[0]!
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source })))
  expect(state.objects[source]!.zone).toBe('graveyard')
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'activateAbility', seat: 'p1', objectId: land, abilityId: '$.abilities[0]' }))
  expect(state.objects[land]!.zone).toBe('graveyard')
  expect(state.players.p1.mana.B).toBe(1)
  expect(state.stack).toHaveLength(0)
})

test('granted programs preserve lexical amounts across restore and expire at cleanup', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Subject', { types: ['Artifact'] })] }, hands: { p1: [cardTemplate('Fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot([spell({ instructions: [
    captureAmount({ amount: 3, bindResult: 'size' }),
    createEffect({ targets: objects({ zone: 'battlefield', type: 'Artifact' }), effect: grantActivatedAbilityEffect(activated({ costs: [], instructions: [gainLife({ targets: ref('controller'), amount: resultAmount('size') })] })), duration: untilCleanup() }),
  ] })]) })] } }, { random: () => 0 })
  const subject = server.state.zoneOrder.p1.battlefield[0]!
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  const announced = ok(server.rules(JSON.parse(JSON.stringify(resolved)), { type: 'activateAbility', seat: 'p1', objectId: subject, abilityId: '$.abilities[0]' }))
  const gained = resolveStack(server.rules, announced)
  expect(gained.players.p1.life).toBe(43)
  const ended = ok(server.rules({ ...gained, step: 'end' }, { type: 'advanceStep' }))
  expect(ended.objects[subject]!.canonicalGrantedActivations).toHaveLength(0)
})

test('later grants survive ability loss while earlier grants stop functioning', () => {
  const ability = activated({ costs: [], instructions: [gainLife({ targets: ref('controller'), amount: 2 })] })
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Subject', { types: ['Artifact'] })] }, hands: { p1: [cardTemplate('Fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot([spell({ instructions: [
    createEffect({ targets: objects({ zone: 'battlefield', type: 'Artifact' }), effect: grantActivatedAbilityEffect(ability), duration: untilCleanup() }),
    createEffect({ targets: objects({ zone: 'battlefield', type: 'Artifact' }), effect: removeAbilitiesEffect(), duration: untilCleanup() }),
    createEffect({ targets: objects({ zone: 'battlefield', type: 'Artifact' }), effect: grantActivatedAbilityEffect(ability), duration: untilCleanup() }),
  ] })]) })] } }, { random: () => 0 })
  const subject = server.state.zoneOrder.p1.battlefield[0]!
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  expect(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: subject, abilityId: '$.abilities[0]' }).ok).toBe(false)
  const accepted = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: subject, abilityId: '$.abilities[1]' })))
  expect(accepted.players.p1.life).toBe(42)
})
