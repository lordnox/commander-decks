import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { instructionSpell } from './instructionTestSupport'
import { anyTarget, card, compileCardRuleDefinition, createDefinitionSnapshot, damage, gainLife, players, prevention, preventDamage, ref, resultAmount, select, staticAbility, target } from './v1'

const shield = (capacity: number) => cardTemplate('Prevention fixture', {
  types: ['Enchantment'],
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(prevention({ recipient: players({ relation: 'you' }) }, preventDamage(), { capacity })),
  ]))),
})

test.each([0, 2, 8])('damage result gains only damage actually dealt through a %s-point shield', capacity => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ decisions: { targets: [select({ filter: anyTarget(), count: 1 })] }, instructions: [
      damage({ source: ref('source'), targets: target(0), amount: 5, bindResult: 'dealt' }),
      gainLife({ targets: ref('controller'), amount: resultAmount('dealt') }),
    ] })] },
    battlefield: { p2: capacity ? [shield(capacity)] : [] },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], targets: [{ kind: 'player', player: 'p2' }] })))
  expect(state.players.p1.life).toBe(40 + Math.max(0, 5 - capacity))
  expect(state.players.p2.life).toBe(40 - Math.max(0, 5 - capacity))
})

test.each(['player', 'Creature', 'Planeswalker', 'Battle'] as const)('damage gain caps respect the %s recipient', kind => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Drain Life')] },
    battlefield: { p2: [cardTemplate('Damage target', { types: [kind === 'player' ? 'Creature' : kind], power: 2, toughness: kind === 'Creature' ? 2 : undefined, counters: kind === 'Planeswalker' ? { loyalty: 2 } : kind === 'Battle' ? { defense: 2 } : {} })] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.B = 6
  ready.players.p1.mana.C = 1
  ready.players.p2.life = 2
  const targets = kind === 'player' ? [{ kind: 'player' as const, player: 'p2' }] : [{ kind: 'object' as const, objectId: ready.zoneOrder.p2.battlefield[0] }]
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0], x: 5, targets }))
  const state = resolveStack(server.rules, JSON.parse(JSON.stringify(cast)))
  expect(state.players.p1.life).toBe(kind === 'Battle' ? 45 : 42)
})

// Replacement choices can suspend the damage instruction after its result is initialized.
test('damage results survive a competing-prevention choice and JSON restore', () => {
  const server = createServerGame(commanderRules, {
    players: 2, hands: { p1: [instructionSpell({ instructions: [
      damage({ source: ref('source'), targets: players({ relation: 'opponent' }), amount: 5, bindResult: 'dealt' }),
      gainLife({ targets: ref('controller'), amount: resultAmount('dealt') }),
    ] })] }, battlefield: { p2: [shield(1), shield(2)] },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
  let state = ok(server.rules(cast, { type: 'resolveTop' }))
  for (let i = 0; i < 4; i++) {
    const choice = pendingOptionSelection(state, 'p2')
    if (!choice) break
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p2', selectionId: choice.id, optionId: choice.options[0]!.id }))
  }
  expect(state.resolution).toBeUndefined()
  expect(state.players.p1.life).toBe(42)
  expect(state.players.p2.life).toBe(38)
})


test.each(['player', 'creature'] as const)('infect damage results use actual damage with a %s recipient', kind => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Drain Life', { oracleText: 'Infect' })] },
    battlefield: { p2: [cardTemplate('Damage fixture', { types: ['Creature'], power: 5, toughness: 5 })] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.B = 4
  ready.players.p1.mana.C = 1
  const state = resolveStack(server.rules, ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0], x: 3, targets: kind === 'player' ? [{ kind: 'player', player: 'p2' }] : [{ kind: 'object', objectId: ready.zoneOrder.p2.battlefield[0] }] })))
  expect(state.players.p1.life).toBe(kind === 'player' ? 43 : 42)
  expect(state.players.p2.life).toBe(40)
  expect(state.players.p2.poison).toBe(kind === 'player' ? 3 : 0)
})
