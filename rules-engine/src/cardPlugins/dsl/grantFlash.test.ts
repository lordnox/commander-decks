import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  grantFlash,
  players,
  ref,
  spell,
  untilCleanup,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { legalActsFor } from '../../actions'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'

describe('grantFlash', () => {
  test('a resolving grant lets the recipient cast a creature as though it had flash', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          instructionSpell({ instructions: [grantFlash({ targets: ref('controller'), duration: untilCleanup() })] }),
          cardTemplate('Surprise Bear', { types: ['Creature'], manaCost: '{0}', manaValue: 0 }),
        ],
      },
    }, { random: () => 0 })
    const granted = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    })))
    expect(granted.rules.find((rule) => rule.pluginId === 'flashGrant')?.params)
      .toMatchObject({ untilCleanup: true, controller: 'p1' })

    const offTurn = { ...granted, active: 'p2', step: 'declareBlockers' as const, priority: 'p1' }
    const bear = Object.values(offTurn.objects).find((object) => object.name === 'Surprise Bear')!
    expect(ok(server.rules(offTurn, { type: 'castSpell', seat: 'p1', objectId: bear.id })).stack[0])
      .toMatchObject({ name: 'Surprise Bear' })
    expect(legalActsFor(offTurn, 'p1').some((action) =>
      action.kind === 'castSpell' && action.objectId === bear.id)).toBe(true)
  })

  test('a grant to another player does not lift the controller timing limit', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          instructionSpell({ instructions: [grantFlash({ targets: players({ relation: 'opponent' }), duration: untilCleanup() })] }),
          cardTemplate('Surprise Bear', { types: ['Creature'], manaCost: '{0}', manaValue: 0 }),
        ],
      },
    }, { random: () => 0 })
    const granted = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    })))
    const offTurn = { ...granted, active: 'p2', step: 'declareBlockers' as const, priority: 'p1' }
    const bear = Object.values(offTurn.objects).find((object) => object.name === 'Surprise Bear')!
    expect(server.rules(offTurn, { type: 'castSpell', seat: 'p1', objectId: bear.id }))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
  })

  test('the compiler rejects object recipients', () => {
    expect(() => compileCardRuleDefinition(card([spell({
      instructions: [grantFlash({ targets: ref('source'), duration: untilCleanup() })],
    })]))).toThrow()
  })
})
