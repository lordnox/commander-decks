import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { captureObject } from '../../objectIdentity'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { CONTROL_EVENT } from './controlConstants'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, grantKeyword, KEYWORDS, keyword, objects, staticAbility } from './v1'

const printed = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.firstStrike])))
const grant = createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(grantKeyword({ targets: objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }), keyword: KEYWORDS.firstStrike })),
])))

const setup = (mode: 'attacker' | 'blocker' | 'both' | 'none' | 'granted', toughness = 2) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Attacker fixture', { types: ['Creature'], power: 2, toughness, summoningSickness: false, ...(['attacker', 'both'].includes(mode) ? { ruleDefinition: printed } : {}) }), ...(mode === 'granted' ? [cardTemplate('Grant fixture', { types: ['Artifact'], ruleDefinition: grant })] : [])],
      p2: [cardTemplate('Blocker fixture', { types: ['Creature'], power: 2, toughness, ...(['blocker', 'both'].includes(mode) ? { ruleDefinition: printed } : {}) })],
    },
  }, { random: () => 0 })
  const attacker = server.state.zoneOrder.p1.battlefield[0]!
  const blocker = server.state.zoneOrder.p2.battlefield[0]!
  const attacked = ok(server.rules({ ...server.state, step: 'declareAttackers' }, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: attacker, defender: 'p2' }] }))
  const blocked = ok(server.rules({ ...attacked, step: 'declareBlockers', priority: 'p2' }, { type: 'declareBlockers', seat: 'p2', blockers: [{ blockerId: blocker, attackerId: attacker }] }))
  const first = ok(server.rules({ ...blocked, priority: null }, { type: 'advanceStep' }))
  return { server, attacker, blocker, first }
}

for (const mode of ['attacker', 'blocker', 'both', 'none', 'granted'] as const) {
  test(`canonical first strike selects the damage step and applies deaths before the next step: ${mode}`, () => {
    const { server, attacker, blocker, first } = setup(mode)
    expect(first.step).toBe(mode === 'none' ? 'combatDamage' : 'firstStrikeDamage')
    expect(first.objects[attacker].zone).toBe(mode === 'blocker' || mode === 'both' || mode === 'none' ? 'graveyard' : 'battlefield')
    expect(first.objects[blocker].zone).toBe(mode === 'attacker' || mode === 'granted' || mode === 'both' || mode === 'none' ? 'graveyard' : 'battlefield')
    if (mode !== 'none') {
      const second = ok(server.rules({ ...structuredClone(first), priority: null }, { type: 'advanceStep' }))
      expect(second.step).toBe('combatDamage')
      if (second.objects[attacker].zone === 'battlefield') expect(second.objects[attacker].damageMarked).toBe(0)
      if (second.objects[blocker].zone === 'battlefield') expect(second.objects[blocker].damageMarked).toBe(0)
    }
  })
}

test('losing first strike does not allow a second hit, while gaining it does not cancel the normal hit', () => {
  const { server, attacker, blocker, first } = setup('granted', 10)
  expect(first.objects[blocker].damageMarked).toBe(2)
  expect(first.objects[attacker].damageMarked).toBe(0)
  const grantId = first.zoneOrder.p1.battlefield.find(id => id !== attacker)!
  const changed = ok(server.rules(first, { type: CONTROL_EVENT.change, objectRef: captureObject(first.objects[grantId]).ref, controller: 'p2' }))
  const second = ok(server.rules({ ...structuredClone(changed), priority: null }, { type: 'advanceStep' }))
  expect(second.objects[blocker].damageMarked).toBe(2)
  expect(second.objects[attacker].damageMarked).toBe(2)
  const ended = ok(server.rules({ ...second, priority: null }, { type: 'advanceStep' }))
  expect(ended.firstStrikeCombatants).toBeUndefined()
})
