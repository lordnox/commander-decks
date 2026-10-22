import { describe, expect, test } from 'bun:test'
import { cardTemplate } from '../../newGame'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { commanderRules } from '../../formats'
import { stampUntilControllerNextTurn } from '../../plugins/untilNextTurn'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import {
  card,
  draw,
  may,
  sequence,
  compileCardRuleDefinition,
  exchangeLife,
  gainLife,
  players,
  ref,
  resultAmount,
  setLife,
  spell,
} from './v1'

describe('exchangeLife and setLife', () => {
  test('exchange is one action that swaps both totals', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({
        instructions: [exchangeLife({ first: ref('controller'), second: players({ relation: 'opponent' }) })],
      })] },
    }, { random: () => 0 })
    const ready = structuredClone(server.state)
    ready.players.p1.life = 40
    ready.players.p2.life = 10
    const resolved = resolveStack(server.rules, ok(server.rules(ready, {
      type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0],
    })))
    expect([resolved.players.p1.life, resolved.players.p2.life]).toEqual([10, 40])
  })

  test("exchange binds only the first player's actual loss", () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({
        instructions: [
          exchangeLife({
            first: ref('controller'),
            second: players({ relation: 'opponent' }),
            bindResult: 'lost',
          }),
          gainLife({ amount: resultAmount('lost'), targets: ref('controller') }),
        ],
      })] },
    }, { random: () => 0 })
    const ready = structuredClone(server.state)
    ready.players.p1.life = 40
    ready.players.p2.life = 10
    const resolved = resolveStack(server.rules, ok(server.rules(ready, {
      type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0],
    })))
    expect(resolved.players.p1.life).toBe(40)
    expect(resolved.players.p2.life).toBe(40)
  })

  test('a player who gained from the exchange binds zero loss', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({
        instructions: [
          exchangeLife({
            first: ref('controller'),
            second: players({ relation: 'opponent' }),
            bindResult: 'lost',
          }),
          gainLife({ amount: resultAmount('lost'), targets: ref('controller') }),
        ],
      })] },
    }, { random: () => 0 })
    const ready = structuredClone(server.state)
    ready.players.p1.life = 10
    ready.players.p2.life = 40
    const resolved = resolveStack(server.rules, ok(server.rules(ready, {
      type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0],
    })))
    expect([resolved.players.p1.life, resolved.players.p2.life]).toEqual([40, 10])
  })

  test('signed current totals still exchange through lose and gain', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({
        instructions: [exchangeLife({ first: ref('controller'), second: players({ relation: 'opponent' }) })],
      })] },
    }, { random: () => 0 })
    const stacked = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    }))
    stacked.players.p1.life = -5
    stacked.players.p2.life = 12
    const resolved = resolveStack(server.rules, stacked)
    expect([resolved.players.p1.life, resolved.players.p2.life]).toEqual([12, -5])
  })

  test('a life-total lock replaces the whole exchange', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({
        instructions: [exchangeLife({ first: ref('controller'), second: players({ relation: 'opponent' }) })],
      })] },
    }, { random: () => 0 })
    const ready = structuredClone(server.state)
    ready.players.p1.life = 40
    ready.players.p2.life = 7
    ready.rules = [...ready.rules, {
      instanceId: 'lock-p1',
      pluginId: 'lifeTotalLock',
      sourceId: null,
      timestamp: 0,
      params: stampUntilControllerNextTurn('p1', ready.turn),
    }]
    const resolved = resolveStack(server.rules, ok(server.rules(ready, {
      type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0],
    })))
    expect([resolved.players.p1.life, resolved.players.p2.life]).toEqual([40, 7])
  })

  test('setLife writes a new total and records actual loss', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({
        instructions: [
          setLife({ amount: 5, targets: ref('controller'), bindResult: 'lost' }),
          gainLife({ amount: resultAmount('lost'), targets: ref('controller') }),
        ],
      })] },
    }, { random: () => 0 })
    const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    })))
    expect(resolved.players.p1.life).toBe(40)
  })

  test('setLife can raise a negative total', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({ instructions: [setLife({ amount: 10, targets: ref('controller') })] })] },
    }, { random: () => 0 })
    const stacked = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    }))
    stacked.players.p1.life = -5
    const resolved = resolveStack(server.rules, stacked)
    expect(resolved.players.p1.life).toBe(10)
  })

  test('the compiler rejects object recipients', () => {
    expect(() => compileCardRuleDefinition(card([spell({
      instructions: [setLife({ amount: 1, targets: ref('source') as never })],
    })]))).toThrow()
    expect(() => compileCardRuleDefinition(card([spell({
      instructions: [exchangeLife({ first: ref('source') as never, second: ref('controller') })],
    })]))).toThrow()
  })
})


for (const scenario of [
  { accept: true, otherLife: 10, drawn: 30 },
  { accept: false, otherLife: 10, drawn: 0 },
  { accept: true, otherLife: 50, drawn: 0 },
]) {
  test(`optional exchange draws only actual loss: ${JSON.stringify(scenario)}`, () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({ instructions: [may(sequence(
        exchangeLife({ first: ref('controller'), second: players({ relation: 'opponent' }), bindResult: 'lost' }),
        draw({ targets: ref('controller'), count: resultAmount('lost') }),
      ))] })] },
      libraries: { p1: Array.from({ length: 30 }, (_, index) => cardTemplate(`Draw fixture ${index}`)) },
    }, { random: () => 0 })
    const ready = structuredClone(server.state)
    ready.players.p2.life = scenario.otherLife
    const waiting = resolveStack(server.rules, ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0] })))
    const offer = pendingOptionSelection(waiting, 'p1')!
    const resolved = ok(server.rules(structuredClone(waiting), { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: scenario.accept ? 'instruction:0' : 'instruction:1' }))
    expect(resolved.zoneOrder.p1.hand).toHaveLength(scenario.drawn)
    expect(resolved.players.p1.life).toBe(scenario.accept ? scenario.otherLife : 40)
    expect(resolved.players.p2.life).toBe(scenario.accept ? 40 : scenario.otherLife)
  })
}
