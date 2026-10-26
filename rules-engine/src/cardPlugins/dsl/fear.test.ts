import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import type { ColorSet } from '../../../../shared/cardColors'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, grantKeywordEffect, KEYWORDS, keyword, objects, untilCleanup } from './v1'

const fear = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.fear])))
const flyingFear = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.fear, keyword.flying])))

for (const granted of [false, true]) {
  test.each([
    [['Creature'], '', false],
    [['Creature'], 'G', false],
    [['Creature'], 'B', true],
    [['Creature'], 'BG', true],
    [['Artifact', 'Creature'], '', true],
    [['Artifact', 'Creature'], 'G', true],
  ])('fear granted=' + granted + ' permits blocker types=%j colors=%j: %s', (types, colors, legal) => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Attacker fixture', { types: ['Creature'], power: 2, toughness: 2, ...(granted ? {} : { ruleDefinition: fear }) })],
        p2: [cardTemplate('Blocker fixture', { types, colors: colors as ColorSet, power: 2, toughness: 2 })],
      },
      hands: { p1: [instructionSpell({ instructions: [createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), effect: grantKeywordEffect(KEYWORDS.fear), duration: untilCleanup() })] })] },
    }, { random: () => 0 })
    const ready = granted
      ? resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })))
      : server.state
    const state = structuredClone(ready)
    const attacker = state.zoneOrder.p1.battlefield[0]!
    const blocker = state.zoneOrder.p2.battlefield[0]!
    state.step = 'declareAttackers'
    state.objects[attacker]!.summoningSickness = false
    const attacked = ok(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: attacker, defender: 'p2' }] }))
    const result = server.rules({ ...attacked, step: 'declareBlockers', priority: 'p2' }, { type: 'declareBlockers', seat: 'p2', blockers: [{ blockerId: blocker, attackerId: attacker }] })
    expect(result.ok).toBe(legal)
    if (!result.ok) expect(result.error).toContain(KEYWORDS.fear)
  })
}

test('fear does not bypass other blocking restrictions', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Attacker fixture', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: flyingFear })],
      p2: [cardTemplate('Blocker fixture', { types: ['Artifact', 'Creature'], colors: 'B', power: 2, toughness: 2 })],
    },
  }, { random: () => 0 })
  const state = structuredClone(server.state)
  const attacker = state.zoneOrder.p1.battlefield[0]!
  const blocker = state.zoneOrder.p2.battlefield[0]!
  state.step = 'declareAttackers'
  state.objects[attacker]!.summoningSickness = false
  const attacked = ok(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: attacker, defender: 'p2' }] }))
  const result = server.rules({ ...attacked, step: 'declareBlockers', priority: 'p2' }, { type: 'declareBlockers', seat: 'p2', blockers: [{ blockerId: blocker, attackerId: attacker }] })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain(KEYWORDS.flying)
})
