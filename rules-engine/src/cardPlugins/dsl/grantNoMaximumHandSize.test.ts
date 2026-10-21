import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  grantNoMaximumHandSize,
  players,
  ref,
  spell,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { maximumHandSize, NO_MAXIMUM_HAND_SIZE } from '../../plugins/turnStructure'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'

describe('grantNoMaximumHandSize', () => {
  test('a resolving grant survives the source leaving and skips cleanup discard', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          instructionSpell({ instructions: [grantNoMaximumHandSize({ targets: ref('controller') })] }),
          ...Array.from({ length: 8 }, () => cardTemplate('Held card')),
        ],
      },
    }, { random: () => 0 })
    const source = server.state.zoneOrder.p1.hand[0]
    const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: source,
    })))
    expect(resolved.objects[source].zone).toBe('graveyard')
    expect(resolved.players.p1.data[NO_MAXIMUM_HAND_SIZE]).toBe(true)
    expect(maximumHandSize(resolved, 'p1')).toBeNull()
    expect(maximumHandSize(resolved, 'p2')).toBe(7)
    expect(ok(server.rules({ ...resolved, step: 'cleanup' }, { type: 'advanceStep' })).step).toBe('untap')
  })

  test('a grant to another player does not lift the controller limit', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [instructionSpell({ instructions: [grantNoMaximumHandSize({ targets: players({ relation: 'opponent' }) })] })] },
    }, { random: () => 0 })
    const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    })))
    expect(maximumHandSize(resolved, 'p1')).toBe(7)
    expect(maximumHandSize(resolved, 'p2')).toBeNull()
  })

  test('the compiler rejects object recipients', () => {
    expect(() => compileCardRuleDefinition(card([spell({
      instructions: [grantNoMaximumHandSize({ targets: ref('source') })],
    })]))).toThrow()
  })
})
