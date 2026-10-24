import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  opponentsCantBlock,
  opponentsCantCast,
  staticAbility,
} from './v1'

const winnower = createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(opponentsCantCast('even'), opponentsCantBlock('even')),
])))

const game = () => createServerGame(commanderRules, {
  players: 2,
  battlefield: {
    p1: [cardTemplate('Even restriction fixture', {
      types: ['Creature'],
      power: 1,
      toughness: 1,
      ruleDefinition: winnower,
    })],
    p2: [cardTemplate('Even blocker', { types: ['Creature'], power: 2, toughness: 2, manaValue: 2 })],
  },
  hands: {
    p1: [cardTemplate('Own even spell', { types: ['Artifact'], manaCost: '{2}', manaValue: 2 })],
    p2: [
      cardTemplate('Even spell', { types: ['Artifact'], manaCost: '{2}', manaValue: 2 }),
      cardTemplate('Odd spell', { types: ['Artifact'], manaCost: '{3}', manaValue: 3 }),
      cardTemplate('Zero spell', { types: ['Artifact'], manaCost: '', manaValue: 0 }),
    ],
  },
}, { random: () => 0 })

const cast = (server: ReturnType<typeof game>, seat: 'p1' | 'p2', name: string) => {
  const state = structuredClone(server.state)
  state.step = 'precombatMain'
  state.active = seat
  state.priority = seat
  state.players[seat].mana.C = 6
  const objectId = Object.values(state.objects).find(object => object.name === name)!.id
  return server.rules(state, { type: 'castSpell', seat, objectId })
}

test('canonical even-mana-value restrictions include zero and spare the controller', () => {
  const server = game()
  const even = cast(server, 'p2', 'Even spell')
  expect(even.ok).toBe(false)
  if (!even.ok) expect(even.error).toContain('mana value 2')
  expect(cast(server, 'p2', 'Zero spell').ok).toBe(false)
  expect(ok(cast(server, 'p2', 'Odd spell')).stack).toHaveLength(1)
  expect(ok(cast(server, 'p1', 'Own even spell')).stack).toHaveLength(1)
})

test('canonical even-mana-value restrictions stop even-cost blockers', () => {
  const server = game()
  const attacker = server.state.zoneOrder.p1.battlefield[0]!
  const blocker = server.state.zoneOrder.p2.battlefield[0]!
  const state = structuredClone(server.state)
  state.step = 'declareAttackers'
  state.objects[attacker]!.summoningSickness = false
  const attacked = ok(server.rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker, defender: 'p2' }],
  }))
  const blocked = server.rules({ ...attacked, step: 'declareBlockers', priority: 'p2' }, {
    type: 'declareBlockers',
    seat: 'p2',
    blockers: [{ blockerId: blocker, attackerId: attacker }],
  })
  expect(blocked.ok).toBe(false)
})

test('the compiler rejects an unknown mana-value parity', () => {
  expect(() => compileCardRuleDefinition(card([
    staticAbility({ kind: 'opponentsCantCast', parity: 'prime' as 'even' }),
  ]))).toThrow()
})
