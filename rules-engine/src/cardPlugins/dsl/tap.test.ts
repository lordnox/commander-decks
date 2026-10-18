import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { choice, chooseCards, objects, ref, tap, untap } from './v1'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

test.each([true, false])('tap-state instruction sets only matching permanents to tapped=%s', tapped => {
  const filter = objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } })
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [tapped ? tap(filter) : untap(filter)] })] },
    battlefield: {
      p1: [cardTemplate('Owned creature', { types: ['Creature'], tapped: !tapped })],
      p2: [cardTemplate('Other creature', { types: ['Creature'], tapped: !tapped }), cardTemplate('Other artifact', { types: ['Artifact'], tapped: !tapped })],
    },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id }))
  const state = resolveStack(server.rules, cast)
  expect(named(state, 'Other creature').tapped).toBe(tapped)
  expect(named(state, 'Owned creature').tapped).toBe(!tapped)
  expect(named(state, 'Other artifact').tapped).toBe(!tapped)
})

test('a bounded untap choice resumes after restore and leaves unchosen lands tapped', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      chooseCards({ bindChoice: 'lands', chooser: ref('controller'), filter: objects({ zone: 'battlefield', type: 'Land' }), min: 0, max: 2 }),
      untap(choice('lands')),
    ] })] },
    battlefield: { p1: ['First', 'Second', 'Third'].map(name => cardTemplate(name, { types: ['Land'], tapped: true })) },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id }))
  const paused = resolveStack(server.rules, cast)
  const restored = JSON.parse(JSON.stringify(paused))
  const pick = pendingSelectionFor(restored, 'p1')!
  const state = ok(server.rules(restored, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 2, objectIds: [named(restored, 'Second').id] }))
  expect(named(state, 'First').tapped).toBe(true)
  expect(named(state, 'Second').tapped).toBe(false)
  expect(named(state, 'Third').tapped).toBe(true)
  expect(state.resolution).toBeUndefined()
})
