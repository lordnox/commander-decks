import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
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

/** Catalog Jace, Multiverse Architect for p1 and an exchangeable attacker for p2. */
const jaceTaxGame = () => createServerGame(commanderRules, {
  players: 2,
  battlefield: {
    p1: [cardTemplate('Jace, Multiverse Architect', { counters: { loyalty: 4 } })],
    p2: [cardTemplate('Attacker', { types: ['Creature'], power: 2, toughness: 2 })],
  },
}, { random: () => 0 })

const jaceTaxIds = (state: GameState) => ({
  jace: Object.values(state.objects).find((object) => object.name === 'Jace, Multiverse Architect')!.id,
  attacker: Object.values(state.objects).find((object) => object.name === 'Attacker')!.id,
})

const atOpponentBeginCombat = (
  runtime: ReturnType<typeof jaceTaxGame>,
  state: GameState,
) => {
  let current: GameState = { ...state, active: 'p2' as const, step: 'precombatMain' as const }
  current = ok(runtime.rules(current, { type: 'advanceStep' }))
  expect(current.step).toBe('beginCombat')
  return current
}

/** p2 answers the begin-combat {2} offer, then moves to its declare-attackers step. */
const answerJaceTax = (runtime: ReturnType<typeof jaceTaxGame>, optionId: 'pay' | 'decline') => {
  let state = resolveStack(runtime.rules, atOpponentBeginCombat(runtime, runtime.state))
  const offer = pendingOptionSelection(state, 'p2')
  expect(offer).toBeDefined()
  if (optionId === 'pay') state.players.p2.mana.C = 2
  state = ok(runtime.rules(state, { type: 'selectOption', seat: 'p2', selectionId: offer!.id, optionId }))
  return state
}

test('catalog Jace, Multiverse Architect lets an opponent who pays {2} at begin combat attack its Jace planeswalkers', () => {
  const runtime = jaceTaxGame()
  const { jace, attacker } = jaceTaxIds(runtime.state)
  expect(runtime.state.objects[jace].name).toBe('Jace, Multiverse Architect')
  let state = answerJaceTax(runtime, 'pay')
  expect(state.players.p2.mana.C).toBe(0)
  state = { ...state, step: 'declareAttackers', priority: 'p2', active: 'p2' }
  const declared = runtime.rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: attacker, defender: { kind: 'object', objectId: jace } }],
  })
  expect(declared.ok).toBe(true)
})

test('catalog Jace, Multiverse Architect declining the {2} tax bans attacks on its Jaces but not on its controller', () => {
  const runtime = jaceTaxGame()
  const { jace, attacker } = jaceTaxIds(runtime.state)
  let state = answerJaceTax(runtime, 'decline')
  state = { ...state, step: 'declareAttackers', priority: 'p2', active: 'p2' }
  const blocked = runtime.rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: attacker, defender: { kind: 'object', objectId: jace } }],
  })
  expect(blocked.ok).toBe(false)
  const atPlayer = runtime.rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: attacker, defender: 'p1' }],
  })
  expect(atPlayer.ok).toBe(true)
})

test('catalog Jace, Multiverse Architect attack ban clears after the turn', () => {
  const runtime = jaceTaxGame()
  const { jace, attacker } = jaceTaxIds(runtime.state)
  let state = answerJaceTax(runtime, 'decline')
  state = { ...state, step: 'cleanup', active: 'p2' }
  state = ok(runtime.rules(state, { type: 'advanceStep' }))
  state = { ...state, step: 'declareAttackers', priority: 'p2', active: 'p2' }
  const declared = runtime.rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: attacker, defender: { kind: 'object', objectId: jace } }],
  })
  expect(declared.ok).toBe(true)
})
