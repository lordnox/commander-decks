import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { instructionSpell } from './instructionTestSupport'
import { activated, card, chooseCards, compareAmount, compileCardRuleDefinition, createDefinitionSnapshot, exileThisSpell, gainLife, ifThen, objects, ref } from './v1'

const setup = (exile = true) => createServerGame(commanderRules, { players: 2, hands: { p1: [instructionSpell({ instructions: [
  ifThen(compareAmount(1, 'eq', exile ? 1 : 0), { then: [exileThisSpell()] }),
  chooseCards({ chooser: ref('controller'), filter: objects({ zone: 'hand', owner: 'you' }), bindChoice: 'optional', min: 0, max: 1 }),
  gainLife({ targets: ref('controller'), amount: 3 }),
] }), cardTemplate('Exchangeable fixture')] } }, { random: () => 0 })
const cast = (server: ReturnType<typeof setup>) => ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))

test.each([false, true])('spell exit follows the executed branch and preserves later choices through restore (exile=%s)', exile => {
  const server = setup(exile)
  const spellId = server.state.zoneOrder.p1.hand[0]!
  const waiting = ok(server.rules(cast(server), { type: 'resolveTop' }))
  expect(waiting.objects[spellId]!.zone).toBe(exile ? 'exile' : 'stack')
  const selection = pendingSelectionFor(waiting, 'p1')!
  const event = { type: 'selectCards' as const, seat: 'p1', selectionId: selection.id, kind: 'choose' as const, count: selection.count, objectIds: [] }
  const direct = ok(server.rules(waiting, event))
  expect(ok(server.rules(JSON.parse(JSON.stringify(waiting)), event))).toEqual(direct)
  expect(direct.objects[spellId]!.zone).toBe(exile ? 'exile' : 'graveyard')
  expect(direct.players.p1.life).toBe(43)
  expect(direct.stack).toHaveLength(0)
})

test('countering a spell does not execute its self-exile instruction', () => {
  const server = setup()
  const state = cast(server)
  const countered = ok(server.rules(state, { type: 'counterStackItem', stackId: state.stack[0]!.id }))
  expect(countered.objects[server.state.zoneOrder.p1.hand[0]!]!.zone).toBe('graveyard')
  expect(countered.players.p1.life).toBe(40)
})

test('a spell copy exiles its own instance without moving the original', () => {
  const server = createServerGame(commanderRules, { players: 2, hands: { p1: [instructionSpell({ instructions: [exileThisSpell()] })] } }, { random: () => 0 })
  const original = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))
  const copied = ok(server.rules(original, { type: 'copySpell', stackId: original.stack[0]!.id, controller: 'p1', targets: [], retarget: false }))
  const copyId = copied.stack[0]!.objectId
  const state = ok(server.rules(copied, { type: 'resolveTop' }))
  expect(state.objects[copyId]).toBeUndefined()
  expect(state.objects[original.stack[0]!.objectId]!.zone).toBe('stack')
  expect(state.stack).toHaveLength(1)
})

test('self-exile in an ability never exiles the ability source permanent', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ costs: [], instructions: [exileThisSpell()] })])))
  const server = createServerGame(commanderRules, { players: 2, battlefield: { p1: [cardTemplate('Ability fixture', { types: ['Artifact'], ruleDefinition: definition })] } }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.battlefield[0]!
  const announced = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]' }))
  const state = ok(server.rules(announced, { type: 'resolveTop' }))
  expect(state.objects[source]!.zone).toBe('battlefield')
})
