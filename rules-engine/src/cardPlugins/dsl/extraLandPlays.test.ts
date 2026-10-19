import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  extraLandPlays,
  grantLandPlays,
  players,
  ref,
  spell,
  staticAbility,
} from './v1'
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
