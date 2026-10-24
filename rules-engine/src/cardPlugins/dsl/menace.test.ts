import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, grantKeywordEffect, KEYWORDS, keyword, objects, untilCleanup } from './v1'

const printed = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.menace])))
const setup = (granted: boolean, blockerCount: number) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Attacker fixture', { types: ['Creature'], power: 3, toughness: 4, summoningSickness: false, ...(granted ? {} : { ruleDefinition: printed }) })],
      p2: [0, 1].map(index => cardTemplate(`Blocker fixture ${index}`, { types: ['Creature'], power: 1, toughness: 2 })),
    },
    hands: { p1: granted ? [instructionSpell({ instructions: [createEffect({ targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }), effect: grantKeywordEffect(KEYWORDS.menace), duration: untilCleanup() })] })] : [] },
  }, { random: () => 0 })
  const ready = granted ? resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))) : server.state
  const attacker = ready.zoneOrder.p1.battlefield[0]!
  const attacked = ok(server.rules({ ...ready, step: 'declareAttackers' }, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: attacker, defender: 'p2' }] }))
  const state = { ...attacked, step: 'declareBlockers' as const, priority: 'p2' }
  const blockers = state.zoneOrder.p2.battlefield.slice(0, blockerCount).map(blockerId => ({ blockerId, attackerId: attacker }))
  return { server, state, attacker, blockers }
}

for (const granted of [false, true]) {
  for (const count of [0, 1, 2]) {
    test(`menace granted=${granted} allows ${count} blockers only when zero or at least two`, () => {
      const { server, state, blockers } = setup(granted, count)
      expect(server.rules(state, { type: 'declareBlockers', seat: 'p2', blockers }).ok).toBe(count !== 1)
    })
  }
}

test('losing a blocker after a legal menace declaration does not make the attacker unblocked', () => {
  const { server, state, blockers } = setup(false, 2)
  const blocked = ok(server.rules(state, { type: 'declareBlockers', seat: 'p2', blockers }))
  const removed = ok(server.rules(blocked, { type: 'move', objectId: blockers[0].blockerId, to: 'graveyard' }))
  const damaged = ok(server.rules({ ...removed, priority: null }, { type: 'advanceStep' }))
  expect(damaged.players.p2.life).toBe(40)
  expect(damaged.objects[blockers[1].blockerId].zone).toBe('graveyard')
})
