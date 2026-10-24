import { expect, test } from 'bun:test'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { instructionSpell } from './instructionTestSupport'
import { amount, captureAmount, choice, choosePlayer, compareAmount, forEachPlayer, createDelayed, stepDelayed, gainLife, ifThen, players, ref, resultAmount, sequence } from './v1'

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

test('player programs collect choices in APNAP order even when the active player is not the first seat', () => {
  const server = createServerGame(commanderRules, {
    players: 3, first: 'p2',
    hands: { p2: [instructionSpell({ instructions: [forEachPlayer({ of: players(), instructions: [
      choosePlayer({ chooser: ref('event.player'), filter: players(), bindChoice: 'picked' }),
    ] })] })] },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p2', objectId: server.state.zoneOrder.p2.hand[0]! })))
  for (const seat of ['p2', 'p3', 'p1']) {
    const pick = pendingPlayerSelectionFor(state, seat)!
    expect(pick).toBeDefined()
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectPlayers', seat, selectionId: pick.id, players: [seat] }))
  }
  expect(state.resolution).toBeUndefined()
})

test.each([false, true])('chosen player bindings keep their domain in delayed callbacks, including empty sets (%s)', empty => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      choosePlayer({ chooser: ref('controller'), filter: players({ relation: empty ? 'teammate' : 'opponent' }), bindChoice: 'recipient' }),
      createDelayed({ condition: stepDelayed({ step: 'end' }), inheritTargets: false, instructions: [gainLife({ targets: choice('recipient'), amount: 2 })] }),
    ] })] },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  const pick = pendingPlayerSelectionFor(state, 'p1')
  if (pick) state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectPlayers', seat: 'p1', selectionId: pick.id, players: ['p2'] }))
  state = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), step: 'postcombatMain' }, { type: 'advanceStep' }))
  state = resolveStack(server.rules, state)
  expect(state.players.p2.life).toBe(empty ? 40 : 42)
})

test.each([false, true])('player iteration computes each targeted player library count separately after a board wipe (targets=%s)', selected => {
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [cardTemplate('Singularity Rupture', { manaCost: '{0}' })] },
    battlefield: { p1: [cardTemplate('Creature fixture', { types: ['Creature'] })] },
    libraries: { p1: [cardTemplate('Unchosen library')], p2: Array.from({ length: 5 }, (_, i) => cardTemplate(`First ${i}`)), p3: Array.from({ length: 3 }, (_, i) => cardTemplate(`Second ${i}`)) },
  }, { random: () => 0 })
  const targets = selected ? ['p2', 'p3'].map(player => ({ kind: 'player' as const, player })) : []
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!, targets })))
  expect(state.zoneOrder.p1.battlefield).toHaveLength(0)
  expect(state.zoneOrder.p1.library).toHaveLength(1)
  expect(state.zoneOrder.p2.library).toHaveLength(selected ? 3 : 5)
  expect(state.zoneOrder.p3.library).toHaveLength(selected ? 2 : 3)
})


test('an explicit starting player overrides APNAP and survives the choice continuation', () => {
  const server = createServerGame(commanderRules, { players: 3, first: 'p2', hands: { p2: [instructionSpell({ instructions: [forEachPlayer({ of: players(), startingWith: ref('controller'), instructions: [choosePlayer({ chooser: ref('event.player'), filter: players(), bindChoice: 'picked' })] })] })] } }, { random: () => 0 })
  const ready = { ...server.state, active: 'p1' }
  let state = resolveStack(server.rules, ok(server.rules(ready, { type: 'castSpell', seat: 'p2', objectId: ready.zoneOrder.p2.hand[0]! })))
  for (const seat of ['p2', 'p3', 'p1']) {
    const pick = pendingPlayerSelectionFor(state, seat)!
    expect(pick).toBeDefined()
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectPlayers', seat, selectionId: pick.id, players: [seat] }))
  }
  expect(state.resolution).toBeUndefined()
})
