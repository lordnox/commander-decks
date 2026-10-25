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
import { eventsForAvailableAction, legalActsFor } from '../../actions'
import { emptyMana } from '../../draft'
import type { GameState } from '../../types'

const SEA_GATE = 'Sea Gate Restoration // Sea Gate, Reborn'

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

  describe('catalog Sea Gate Restoration front face', () => {
    const game = (hand: number, library: number) => createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate(SEA_GATE), ...Array.from({ length: hand }, (_, index) => cardTemplate(`Held ${index}`))] },
      libraries: { p1: Array.from({ length: library }, (_, index) => cardTemplate(`Library ${index}`)) },
    }, { random: () => 0.5 })
    const withPool = (state: GameState, pool: Partial<GameState['players']['p1']['mana']>) => {
      const next = structuredClone(state)
      next.players.p1.mana = { ...emptyMana(), ...pool }
      return next
    }
    const castActs = (state: GameState) =>
      legalActsFor(state, 'p1').filter((act) => act.kind === 'castSpell' && act.name === SEA_GATE)
    const seaGate = (state: GameState) => Object.values(state.objects).find((object) => object.name === SEA_GATE)!

    test('the spell draws your hand plus one and lifts the hand size limit for good', () => {
      const server = game(5, 20)
      expect(castActs(server.state)).toHaveLength(0) // not yet payable
      const prepared = withPool(server.state, { U: 3, C: 4 })
      const [cast] = castActs(prepared)
      expect(cast).toBeDefined()
      const announced = eventsForAvailableAction(prepared, 'p1', cast)!
        .reduce((current, event) => ok(server.rules(current, event)), prepared)
      const resolved = resolveStack(server.rules, announced)
      // Five cards were held when the spell resolved: draw 5 + 1.
      expect(resolved.zoneOrder.p1.hand).toHaveLength(5 + 6)
      expect(seaGate(resolved).zone).toBe('graveyard')
      expect(maximumHandSize(resolved, 'p1')).toBeNull()
      expect(maximumHandSize(resolved, 'p2')).toBe(7)
      const cleanup = { ...resolved, step: 'cleanup' as const }
      expect(ok(server.rules(cleanup, { type: 'advanceStep' })).step).toBe('untap')
    })

    test('without enough mana the spell is neither offered nor castable', () => {
      const server = game(0, 12)
      const poor = withPool(server.state, { U: 2, C: 4 })
      expect(castActs(poor)).toHaveLength(0)
      expect(server.rules(poor, { type: 'castSpell', seat: 'p1', objectId: seaGate(poor).id }).ok).toBe(false)
    })
  })

  test('the compiler rejects object recipients', () => {
    expect(() => compileCardRuleDefinition(card([spell({
      instructions: [grantNoMaximumHandSize({ targets: ref('source') })],
    })]))).toThrow()
  })
})
