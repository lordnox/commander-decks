import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { instructionSpell } from './instructionTestSupport'
import { amount, captureAmount, choice, choosePlayer, compareAmount, forEachPlayer, gainLife, ifThen, players, ref, resultAmount, sequence } from './v1'

test('player iteration keeps nested player context, private continuation, and independent local results through restore', () => {
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [instructionSpell({ instructions: [
      captureAmount({ amount: 7, bindResult: 'outer' }),
      forEachPlayer({ of: players({ relation: 'opponent' }), instructions: [
        choosePlayer({ chooser: ref('event.player'), filter: players({ relation: 'any' }), bindChoice: 'recipient' }),
        captureAmount({ amount: 2, bindResult: 'local' }),
        ifThen(compareAmount(resultAmount('local'), 'eq', 2), { then: [sequence(
          gainLife({ targets: ref('event.player'), amount: 1 }),
          gainLife({ targets: choice('recipient'), amount: resultAmount('local') }),
        )] }),
      ] }),
      gainLife({ targets: ref('controller'), amount: resultAmount('outer') }),
    ] })] },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  for (const seat of ['p2', 'p3']) {
    const pick = pendingPlayerSelectionFor(state, seat)!
    expect(pick).toBeDefined()
    expect(state.resolution?.kind === 'canonicalSpell' && state.resolution.results?.local).toBeUndefined()
    expect(server.rules(state, { type: 'selectPlayers', seat, selectionId: pick.id, players: ['p1', 'p2'] }).ok).toBe(false)
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectPlayers', seat, selectionId: pick.id, players: [seat] }))
  }
  expect(state.players.p1.life).toBe(47)
  expect(state.players.p2.life).toBe(43)
  expect(state.players.p3.life).toBe(43)
  expect(state.resolution).toBeUndefined()
})

test('an empty player selection binds an empty set and continues without a prompt', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      choosePlayer({ chooser: ref('controller'), filter: players({ relation: 'teammate' }), bindChoice: 'absent' }),
      gainLife({ targets: choice('absent'), amount: 3 }),
      gainLife({ targets: ref('controller'), amount: amount(1) }),
    ] })] },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  expect(state.players.p1.life).toBe(41)
})
