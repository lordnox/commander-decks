import { ANY_TARGET_KINDS } from '../../rules/canonicalAnnouncement'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingPlayerSelection } from '../../rules/selectPlayers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { anyTarget, card, compileCardRuleDefinition, createDefinitionSnapshot, self, whenever, damage, destroy, draw, ref, select, spell, target } from './v1'

const setup = () => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({ decisions: { targets: [select({ filter: anyTarget(), count: 1 })] }, instructions: [damage({ source: ref('source'), targets: target(0), amount: 3 })] })] },
  battlefield: { p2: [
    cardTemplate('Creature target', { types: ['Creature'], power: 1, toughness: 5 }),
    cardTemplate('Planeswalker target', { types: ['Planeswalker'], counters: { loyalty: 5 } }),
    cardTemplate('Battle target', { types: ['Battle'], counters: { defense: 5 } }),
    cardTemplate('Land decoy', { types: ['Land'] }),
    cardTemplate('Shielded creature', { types: ['Creature'], power: 1, toughness: 5, oracleText: 'Hexproof' }),
  ] },
}, { random: () => 0 })

test.each(['player', 'Creature', 'Planeswalker', 'Battle'] as const)('any-target damage accepts %s and uses its damage rules', kind => {
  const server = setup()
  const victim = Object.values(server.state.objects).find(object => object.name === `${kind} target`)
  const targets = kind === 'player' ? [{ kind: 'player' as const, player: 'p2' }] : [{ kind: 'object' as const, objectId: victim!.id }]
  const state = resolveStack(server.rules, JSON.parse(JSON.stringify(ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], targets })))))
  switch (kind) {
    case 'player': expect(state.players.p2.life).toBe(37); break
    case 'Creature': expect(state.objects[victim!.id].damageMarked).toBe(3); break
    case 'Planeswalker': expect(state.objects[victim!.id].counters.loyalty).toBe(2); break
    case 'Battle': expect(state.objects[victim!.id].counters.defense).toBe(2); break
  }
})

test.each(['Land decoy', 'Shielded creature'])('any-target selector rejects %s', name => {
  const server = setup()
  const victim = Object.values(server.state.objects).find(object => object.name === name)!
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], targets: [{ kind: 'object', objectId: victim.id }] }).ok).toBe(false)
})

test('a mixed-domain target cannot be consumed by an object-only or player-only instruction', () => {
  for (const instruction of [destroy({ targets: target(0) }), draw({ targets: target(0), count: 1 })]) {
    expect(() => compileCardRuleDefinition(card([spell({ decisions: { targets: [select({ filter: anyTarget(), count: 1 })] }, instructions: [instruction] })]))).toThrow()
  }
})


test.each([ANY_TARGET_KINDS.player, ANY_TARGET_KINDS.permanent])('an any-target trigger opens the typed %s picker after restore', kind => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Trigger source', { types: ['Creature'], power: 1, toughness: 5, ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(self.enters, { decisions: { targets: [select({ filter: anyTarget(), count: 1 })] }, instructions: [damage({ source: ref('source'), targets: target(0), amount: 3 })] }),
    ]))) })] },
    battlefield: { p2: [cardTemplate('Target creature', { types: ['Creature'], power: 1, toughness: 5 })] },
  }, { random: () => 0 })
  const targetId = server.state.zoneOrder.p2.battlefield[0]
  let state = ok(server.rules(server.state, { type: 'move', objectId: server.state.zoneOrder.p1.hand[0], to: 'battlefield' }))
  const option = pendingOptionSelection(state, 'p1')!
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p1', selectionId: option.id, optionId: kind }))
  if (kind === ANY_TARGET_KINDS.player) {
    const pick = pendingPlayerSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: pick.id, players: ['p2'] }))
  } else {
    const pick = pendingSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [targetId] }))
  }
  state = resolveStack(server.rules, state)
  if (kind === ANY_TARGET_KINDS.player) expect(state.players.p2.life).toBe(37)
  else expect(state.objects[targetId].damageMarked).toBe(3)
})

test('mixed-domain clauses reject unsupported multi-target cardinality', () => {
  expect(() => compileCardRuleDefinition(card([spell({ decisions: { targets: [select({ filter: anyTarget(), count: 2 })] }, instructions: [damage({ source: ref('source'), targets: target(0), amount: 3 })] })]))).toThrow()
})
