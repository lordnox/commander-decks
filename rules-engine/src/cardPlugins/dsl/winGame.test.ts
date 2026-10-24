import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, ref, spell, winGame } from './v1'

describe('winGame', () => {
  test('a resolving win concedes every other seat', () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: { p1: [instructionSpell({ instructions: [winGame({ targets: ref('controller') })] })] },
    }, { random: () => 0 })
    const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    })))
    expect(resolved.ended).toBe(true)
    expect(resolved.players.p1.lost).toBe(false)
    expect(resolved.players.p2.lost).toBe(true)
    expect(resolved.players.p3.lost).toBe(true)
  })

  test('a game-result restriction can replace the win event', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({ instructions: [winGame({ targets: ref('controller') })] })] },
    }, {
      random: () => 0,
      cardPlugins: [{
        id: 'fixture.noWin',
        replace: ({ event }) => event.type === 'winGame' ? null : undefined,
      }],
    })
    const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    })))
    expect(resolved.ended).toBe(false)
    expect(resolved.players.p1.lost).toBe(false)
    expect(resolved.players.p2.lost).toBe(false)
  })

  test('the compiler rejects object recipients', () => {
    expect(() => compileCardRuleDefinition(card([spell({
      instructions: [winGame({ targets: ref('source') as never })],
    })]))).toThrow()
  })
})
