import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { KEYWORDS, createEffect, grantKeywordEffect, objects, untilCleanup, card, compileCardRuleDefinition, createDefinitionSnapshot, keyword, activated, tapCost, gainLife, ref } from './v1'

test.each([false, true])('canonical haste permits a new creature to attack and pay tap costs (haste=%s)', haste => {
  const abilities = [...(haste ? [keyword.haste] : []), activated({ costs: [tapCost()], instructions: [gainLife({ amount: 1, targets: ref('controller') })] })]
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('New creature fixture', { types: ['Creature'], power: 2, toughness: 2, summoningSickness: true, ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card(abilities))) })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[0]
  const state = { ...server.state, step: 'declareAttackers' as const }
  const attacked = server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: id, defender: 'p2' }] })
  expect(attacked.ok).toBe(haste)
  const tapped = server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: id, abilityId: `$.abilities[${abilities.length - 1}]` })
  expect(tapped.ok).toBe(haste)
})

test.each([false, true])('canonical vigilance controls tapping when attacking (vigilance=%s)', vigilance => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Ready creature fixture', { types: ['Creature'], power: 2, toughness: 2, summoningSickness: false, ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card(vigilance ? [keyword.vigilance] : []))) })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[0]
  const result = server.rules({ ...server.state, step: 'declareAttackers' }, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: id, defender: 'p2' }] })
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.state.objects[id].tapped).toBe(!vigilance)
})

test.each([KEYWORDS.deathtouch, KEYWORDS.haste, KEYWORDS.vigilance, KEYWORDS.hexproof, KEYWORDS.indestructible, KEYWORDS.reach, KEYWORDS.fear])('temporary canonical %s grants expire at cleanup', granted => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Keyword recipient fixture', { types: ['Creature'], power: 2, toughness: 2 })] },
    hands: { p1: [instructionSpell({ instructions: [createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature' }), effect: grantKeywordEffect(granted), duration: untilCleanup() })] })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[0]
  expect(hasKeyword(server.state.objects[id], granted, server.state)).toBe(false)
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })))
  expect(hasKeyword(resolved.objects[id], granted, resolved)).toBe(true)
  const cleanup = ok(server.rules({ ...resolved, step: 'end', priority: null }, { type: 'advanceStep' }))
  expect(hasKeyword(cleanup.objects[id], granted, cleanup)).toBe(false)
})
