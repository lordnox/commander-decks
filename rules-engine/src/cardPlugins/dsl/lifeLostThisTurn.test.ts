import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import {
  card,
  compileCardRuleDefinition,
  gainLife,
  lifeLostThisTurn,
  loseLife,
  players,
  ref,
  spell,
} from './v1'

const recover = (amount: ReturnType<typeof lifeLostThisTurn>) => instructionSpell({
  instructions: [gainLife({ amount, targets: ref('controller') })],
})

describe('lifeLostThisTurn', () => {
  test("a controller query uses that player's actual loss", () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [recover(lifeLostThisTurn({ of: ref('controller') }))] },
    }, { random: () => 0 })
    const ready = structuredClone(server.state)
    const lost = ok(server.rules(ready, { type: 'loseLife', seat: 'p1', amount: 6 }))
    ok(server.rules(lost, { type: 'loseLife', seat: 'p2', amount: 4 }))
    const resolved = resolveStack(server.rules, ok(server.rules(lost, {
      type: 'castSpell', seat: 'p1', objectId: lost.zoneOrder.p1.hand[0],
    })))
    expect(resolved.players.p1.life).toBe(40)
  })

  test("sum over anyone totals every player's actual loss", () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [recover(lifeLostThisTurn({ of: players({ relation: 'any' }), combine: 'sum' }))] },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 6 }))
    state = ok(server.rules(state, { type: 'loseLife', seat: 'p2', amount: 4 }))
    const resolved = resolveStack(server.rules, ok(server.rules(state, {
      type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0],
    })))
    expect(resolved.players.p1.life).toBe(44)
  })

  test('greatest among opponents ignores the controller and lesser losses', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [recover(lifeLostThisTurn({ of: players({ relation: 'opponent' }), combine: 'greatest' }))] },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 9 }))
    state = ok(server.rules(state, { type: 'loseLife', seat: 'p2', amount: 2 }))
    state = ok(server.rules(state, { type: 'loseLife', seat: 'p3', amount: 5 }))
    const resolved = resolveStack(server.rules, ok(server.rules(state, {
      type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0],
    })))
    expect(resolved.players.p1.life).toBe(36)
  })

  test('prevented loss does not count toward history', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [recover(lifeLostThisTurn({ of: ref('controller') }))] },
    }, {
      random: () => 0,
      cardPlugins: [{
        id: 'fixture.noLoss',
        replace: ({ event }) => event.type === 'loseLife' && event.amount === 6 ? null : undefined,
      }],
    })
    const prevented = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 6 }))
    expect(prevented.players.p1.life).toBe(40)
    const resolved = resolveStack(server.rules, ok(server.rules(prevented, {
      type: 'castSpell', seat: 'p1', objectId: prevented.zoneOrder.p1.hand[0],
    })))
    expect(resolved.players.p1.life).toBe(40)
  })

  test('a lost opponent still contributes history on the same turn', () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: { p1: [recover(lifeLostThisTurn({ of: players({ relation: 'opponent' }), combine: 'sum' }))] },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, { type: 'loseLife', seat: 'p2', amount: 7 }))
    state = ok(server.rules(state, { type: 'concede', seat: 'p2' }))
    expect(state.players.p2.lost).toBe(true)
    const resolved = resolveStack(server.rules, ok(server.rules(state, {
      type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0],
    })))
    expect(resolved.players.p1.life).toBe(47)
  })

  test('the compiler requires combine on a selector and forbids it on a reference', () => {
    expect(() => compileCardRuleDefinition(card([spell({
      instructions: [gainLife({
        amount: lifeLostThisTurn({ of: players({ relation: 'opponent' }) }),
        targets: ref('controller'),
      })],
    })]))).toThrow()
    expect(() => compileCardRuleDefinition(card([spell({
      instructions: [loseLife({
        amount: { kind: 'lifeLostThisTurn', of: ref('controller'), combine: 'sum' },
        targets: ref('controller'),
      })],
    })]))).toThrow()
  })
})
