import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  extraLandPlays,
  draw,
  grantLandPlays,
  players,
  ref,
  spell,
  staticAbility,
} from './v1'
import type { GameState } from '../../types'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { createJournal, restoreJournal } from '../../journal'
import { instructionSpell } from './instructionTestSupport'

const extraLandDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(extraLandPlays(1)),
])))

const forest = () => cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })

describe('extraLandPlays static', () => {
  test('without a source a seat has only its normal land play', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [forest(), forest()] },
    }, { random: () => 0.5 })
    const played = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
    expect(played.players.p1.landPlaysAllowed).toBe(1)
    expect(played.players.p1.landsPlayed).toBe(1)
    expect(server.rules(played, { type: 'playLand', seat: 'p1', objectId: played.zoneOrder.p1.hand[0] }).ok).toBe(false)
  })

  test('static sources stack with grants and leaving sources remove only their own allowance', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [forest(), forest()] },
      battlefield: { p1: Array.from({ length: 2 }, () => cardTemplate('Allowance source', {
        types: ['Artifact'], ruleDefinition: extraLandDefinition(),
      })) },
    }, { random: () => 0.5 })
    const granted = ok(server.rules(server.state, { type: 'grantLandPlays', seat: 'p1', count: 1 }))
    expect(granted.players.p1.landPlaysAllowed).toBe(4)
    expect(granted.players.p2.landPlaysAllowed).toBe(1)
    const [first, second] = granted.zoneOrder.p1.battlefield
    const one = ok(server.rules(granted, { type: 'move', objectId: first, to: 'graveyard' }))
    expect(one.players.p1.landPlaysAllowed).toBe(3)
    const none = ok(server.rules(one, { type: 'move', objectId: second, to: 'graveyard' }))
    expect(none.players.p1.landPlaysAllowed).toBe(2)
  })

  test('removing a static source preserves spent plays and restores the base allowance', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [forest(), forest(), forest()] },
      battlefield: { p1: [cardTemplate('Allowance source', { types: ['Artifact'], ruleDefinition: extraLandDefinition() })] },
    }, { random: () => 0.5 })
    let state = server.state
    for (let index = 0; index < 2; index += 1) {
      state = ok(server.rules(state, { type: 'playLand', seat: 'p1', objectId: state.zoneOrder.p1.hand[0] }))
    }
    const gone = ok(server.rules(state, { type: 'move', objectId: server.state.zoneOrder.p1.battlefield[0], to: 'graveyard' }))
    expect(gone.players.p1.landPlaysAllowed).toBe(1)
    expect(gone.players.p1.landsPlayed).toBe(2)
    expect(server.rules(gone, { type: 'playLand', seat: 'p1', objectId: gone.zoneOrder.p1.hand[0] }).ok).toBe(false)
  })

  test('a nameless fixture grants one additional land play on the battlefield', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [forest(), forest()] },
        battlefield: {
          p1: [cardTemplate('Extra land source', {
            types: ['Creature'],
            ruleDefinition: extraLandDefinition(),
          })],
        },
      },
      { random: () => 0.5 },
    )
    const first = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.hand[0],
    }))
    expect(first.players.p1.landPlaysAllowed).toBe(2)
    const second = ok(server.rules(first, {
      type: 'playLand',
      seat: 'p1',
      objectId: first.zoneOrder.p1.hand[0],
    }))
    expect(second.players.p1.landsPlayed).toBe(2)
  })
})


describe('temporary additional land plays', () => {
  test('grants add to static allowances and spent land plays survive journal restore until cleanup', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [instructionSpell({ instructions: [grantLandPlays({ count: 1, targets: ref('controller') }), grantLandPlays({ count: 2, targets: ref('controller') })] }), ...Array.from({ length: 6 }, forest)] },
      battlefield: { p1: [cardTemplate('Static fixture', { types: ['Artifact'], ruleDefinition: extraLandDefinition() })] },
    }, { random: () => 0.5 })
    let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[1] }))
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0] }))
    state = resolveStack(server.rules, state)
    expect(state.players.p1.landPlaysAllowed).toBe(5)
    expect(state.players.p1.landsPlayed).toBe(1)
    expect(state.players.p2.landPlaysAllowed).toBe(1)
    state = restoreJournal(createJournal(state), server.rules).current()
    for (let index = 0; index < 4; index += 1) {
      state = ok(server.rules(state, { type: 'playLand', seat: 'p1', objectId: state.zoneOrder.p1.hand[0] }))
    }
    expect(state.players.p1.landsPlayed).toBe(5)
    expect(server.rules(state, { type: 'playLand', seat: 'p1', objectId: state.zoneOrder.p1.hand[0] }).ok).toBe(false)
    const cleanup = ok(server.rules({ ...state, step: 'end', priority: null }, { type: 'advanceStep' }))
    expect(cleanup.step).toBe('cleanup')
    expect(cleanup.players.p1.landPlaysAllowed).toBe(2)
    expect(cleanup.players.p1.landsPlayed).toBe(5)
  })

  test.each([1, 3])('a resolving grant of %i composes with drawing and expires at the next untap', (count) => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [instructionSpell({ instructions: [grantLandPlays({ count, targets: ref('controller') }), draw(1)] })] },
      libraries: { p1: [forest()] },
    }, { random: () => 0.5 })
    const source = server.state.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source }))
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.players.p1.landPlaysAllowed).toBe(1 + count)
    expect(resolved.zoneOrder.p1.hand.map(id => resolved.objects[id].name)).toEqual(['Forest'])
    expect(resolved.objects[source].zone).toBe('graveyard')
    let state: GameState = { ...resolved, priority: null }
    for (let guard = 0; guard < 24 && state.step !== 'untap'; guard += 1) {
      state = ok(server.rules(state, { type: 'advanceStep' }))
    }
    expect(state.step).toBe('untap')
    expect(state.players.p1.landPlaysAllowed).toBe(1)
  })

  test('a grant to another player changes allowance without permitting lands outside their turn', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [instructionSpell({ instructions: [grantLandPlays({ count: 3, targets: players({ relation: 'opponent' }) }), grantLandPlays({ count: 0, targets: ref('controller') })] })], p2: [forest()] },
    }, { random: () => 0.5 })
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
    const state = resolveStack(server.rules, cast)
    expect(state.players.p1.landPlaysAllowed).toBe(1)
    expect(state.players.p2.landPlaysAllowed).toBe(4)
    expect(server.rules(state, { type: 'playLand', seat: 'p2', objectId: state.zoneOrder.p2.hand[0] }).ok).toBe(false)
  })

  test('the compiler rejects negative counts and object recipients', () => {
    expect(() => compileCardRuleDefinition(card([spell({ instructions: [grantLandPlays({ count: -1, targets: ref('controller') })] })]))).toThrow()
    expect(() => compileCardRuleDefinition(card([spell({ instructions: [grantLandPlays({ count: 1, targets: ref('source') })] })]))).toThrow()
  })
})
