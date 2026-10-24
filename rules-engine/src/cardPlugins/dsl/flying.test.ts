import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, KEYWORDS, keyword } from './v1'

const reach = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.reach])))
const flying = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.flying])))
test.each([
  [true, 'ground', false],
  [true, 'flying', true],
  [true, 'reach', true],
  [false, 'flying', true],
] as const)('canonical flying attacker=%s versus %s blocker has legality=%s', (attackerFlies, blocker, legal) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Attacker fixture', { types: ['Creature'], power: 2, toughness: 2, ...(attackerFlies ? { ruleDefinition: flying } : {}) })],
      p2: [cardTemplate('Blocker fixture', { types: ['Creature'], power: 2, toughness: 2, ...(blocker === KEYWORDS.flying ? { ruleDefinition: flying } : {}), ...(blocker === KEYWORDS.reach ? { ruleDefinition: reach } : {}) })],
    },
  }, { random: () => 0 })
  const state = structuredClone(server.state)
  const attacker = state.zoneOrder.p1.battlefield[0]!
  const defender = state.zoneOrder.p2.battlefield[0]!
  state.step = 'declareAttackers'
  state.objects[attacker]!.summoningSickness = false
  const attacked = ok(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: attacker, defender: 'p2' }] }))
  const blocking = { ...attacked, step: 'declareBlockers' as const, priority: 'p2' }
  const result = server.rules(blocking, { type: 'declareBlockers', seat: 'p2', blockers: [{ blockerId: defender, attackerId: attacker }] })
  expect(result.ok).toBe(legal)
  if (!result.ok) expect(result.error).toContain(KEYWORDS.flying)
})
