import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import { annihilator, card, compileCardRuleDefinition, createDefinitionSnapshot } from './v1'

const betrayer = createDefinitionSnapshot(compileCardRuleDefinition(card([annihilator(2)])))

const game = (permanents = 3) => createServerGame(commanderRules, {
  players: 3,
  battlefield: {
    p1: [cardTemplate('Annihilator fixture', {
      types: ['Creature'],
      power: 10,
      toughness: 10,
      ruleDefinition: betrayer,
    })],
    p2: Array.from({ length: permanents }, (_, index) => cardTemplate(`P2 Permanent ${index}`, { types: ['Artifact'] })),
    p3: [cardTemplate('P3 Permanent', { types: ['Artifact'] })],
  },
}, { random: () => 0 })

const attack = (server: ReturnType<typeof game>, defender: 'p2' | 'p3' = 'p2') => {
  const attacker = server.state.zoneOrder.p1.battlefield[0]!
  const state = structuredClone(server.state)
  state.step = 'declareAttackers'
  state.objects[attacker]!.summoningSickness = false
  return ok(server.rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker, defender }],
  }))
}

test.each([0, 1, 3])('canonical annihilator asks the defending player to sacrifice up to N permanents (%s available)', available => {
  const server = game(available)
  const declared = attack(server)
  expect(declared.stack).toHaveLength(available === 0 ? 1 : 1)
  let state = resolveStack(server.rules, declared)
  const selection = pendingSelectionFor(state, 'p2')
  if (available === 0) {
    expect(selection).toBeUndefined()
    expect(state.zoneOrder.p2.battlefield).toHaveLength(0)
    expect(state.zoneOrder.p3.battlefield).toHaveLength(1)
    return
  }
  expect(selection).toBeDefined()
  expect(selection!.seat).toBe('p2')
  expect(selection!.candidates).toHaveLength(available)
  const chosen = selection!.candidates.slice(0, Math.min(2, available))
  const event = {
    type: 'selectCards' as const,
    seat: 'p2' as const,
    selectionId: selection!.id,
    kind: 'choose' as const,
    count: chosen.length,
    objectIds: chosen,
  }
  const direct = ok(server.rules(state, event))
  expect(ok(server.rules(JSON.parse(JSON.stringify(state)), event))).toEqual(direct)
  expect(direct.zoneOrder.p2.battlefield).toHaveLength(available - chosen.length)
  expect(direct.zoneOrder.p3.battlefield).toHaveLength(1)
})

test('annihilator names the defending player of that attacker', () => {
  const server = game(1)
  const declared = attack(server, 'p3')
  const choosing = resolveStack(server.rules, declared)
  const selection = pendingSelectionFor(choosing, 'p3')!
  expect(selection.candidates).toEqual(choosing.zoneOrder.p3.battlefield)
  expect(pendingSelectionFor(choosing, 'p2')).toBeUndefined()
})
