import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import {
  attackTax,
  blockTax,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  staticAbility,
} from './v1'

const baird = createDefinitionSnapshot(compileCardRuleDefinition(card([staticAbility(attackTax(1))])))
const archangel = createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(attackTax(1, { whileUntapped: true }), blockTax(1, { whileAttacking: true })),
])))

const readyAttack = (server: ReturnType<typeof createServerGame>, attacker: string) => {
  const state = structuredClone(server.state)
  state.step = 'declareAttackers'
  state.objects[attacker]!.summoningSickness = false
  return state
}

test('canonical attack tax requires payment to attack that controller', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Attacker fixture', { types: ['Creature'], power: 2, toughness: 2 })],
      p2: [cardTemplate('Tax fixture', { types: ['Creature'], power: 2, toughness: 4, ruleDefinition: baird })],
    },
  }, { random: () => 0 })
  const attacker = server.state.zoneOrder.p1.battlefield[0]!
  const unpaid = server.rules(readyAttack(server, attacker), {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker, defender: 'p2' }],
  })
  expect(unpaid.ok).toBe(false)
  if (!unpaid.ok) expect(unpaid.error).toContain('requires {1}')
  const funded = readyAttack(server, attacker)
  funded.players.p1.mana.C = 1
  const paid = ok(server.rules(funded, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker, defender: 'p2' }],
  }))
  expect(paid.players.p1.mana.C).toBe(0)
})

test('a tapped canonical Archangel does not impose its attack tax', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Attacker fixture', { types: ['Creature'], power: 2, toughness: 2 })],
      p2: [cardTemplate('Tax fixture', {
        types: ['Creature'],
        power: 3,
        toughness: 5,
        tapped: true,
        ruleDefinition: archangel,
      })],
    },
  }, { random: () => 0 })
  const attacker = server.state.zoneOrder.p1.battlefield[0]!
  expect(server.rules(readyAttack(server, attacker), {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker, defender: 'p2' }],
  }).ok).toBe(true)
})

test('an attacking canonical Archangel taxes each blocker', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Tax fixture', {
        types: ['Creature'],
        power: 3,
        toughness: 5,
        ruleDefinition: archangel,
      })],
      p2: [cardTemplate('Blocker fixture', { types: ['Creature'], power: 2, toughness: 2 })],
    },
  }, { random: () => 0 })
  const attacker = server.state.zoneOrder.p1.battlefield[0]!
  const blocker = server.state.zoneOrder.p2.battlefield[0]!
  const attacked = ok(server.rules(readyAttack(server, attacker), {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker, defender: 'p2' }],
  }))
  const unpaid = server.rules({ ...attacked, step: 'declareBlockers', priority: 'p2' }, {
    type: 'declareBlockers',
    seat: 'p2',
    blockers: [{ blockerId: blocker, attackerId: attacker }],
  })
  expect(unpaid.ok).toBe(false)
  const funded = { ...attacked, step: 'declareBlockers' as const, priority: 'p2' as const }
  funded.players.p2.mana.C = 1
  expect(ok(server.rules(funded, {
    type: 'declareBlockers',
    seat: 'p2',
    blockers: [{ blockerId: blocker, attackerId: attacker }],
  })).objects[blocker].blocking).toBe(attacker)
})

test('the compiler rejects a zero combat tax', () => {
  expect(() => compileCardRuleDefinition(card([staticAbility(attackTax(0))]))).toThrow()
  expect(() => compileCardRuleDefinition(card([staticAbility(blockTax(0))]))).toThrow()
})
