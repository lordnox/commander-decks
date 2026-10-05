import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { addUntilCleanupRule, onResolve as onResolveEffect } from '../cardPlugins/effects'
import { onResolve } from '../cardPlugins/onResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const game = () => {
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      hands: {
        p1: [
          cardTemplate('Grant Flash', {
            types: ['Instant'],
            manaCost: '{0}',
            manaValue: 0,
            effects: [onResolveEffect(addUntilCleanupRule('flashGrant'))],
          }),
          cardTemplate('Surprise Bear', { types: ['Creature'], manaCost: '{0}', manaValue: 0 }),
          cardTemplate('Surprise Sorcery', { types: ['Sorcery'], manaCost: '{0}', manaValue: 0 }),
        ],
        p2: [cardTemplate('Rival Bear', { types: ['Creature'], manaCost: '{0}', manaValue: 0 })],
      },
    },
    { random: () => 0.5, cardPlugins: [onResolve] },
  )
  return server
}

const granted = () => {
  const server = game()
  const cast = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Grant Flash').id,
  }))
  return { server, state: ok(server.rules(cast, { type: 'resolveTop' })) }
}

const castOf = (server: ReturnType<typeof game>, state: GameState, name: string, seat = 'p1') =>
  server.rules(state, { type: 'castSpell', seat, objectId: named(state, name).id })

/** The opponent's combat, with p1 holding priority. */
const opponentsTurn = (state: GameState): GameState => ({
  ...structuredClone(state),
  active: 'p2',
  step: 'declareBlockers',
  priority: 'p1',
})

describe('turn-long flash grant', () => {
  test('without the grant, a creature or sorcery cannot be cast off-turn', () => {
    const server = game()
    const state = opponentsTurn(server.state)
    expect(castOf(server, state, 'Surprise Bear'))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
    expect(castOf(server, state, 'Surprise Sorcery'))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
    expect(legalActsFor(state, 'p1').some((action) =>
      action.kind === 'castSpell' && action.name === 'Surprise Bear')).toBe(false)
  })

  test('the grant lets its controller cast non-instants outside their main phase', () => {
    const { server, state: afterGrant } = granted()
    expect(afterGrant.rules.find((rule) => rule.pluginId === 'flashGrant')?.params)
      .toMatchObject({ untilCleanup: true, controller: 'p1' })

    const offTurn = opponentsTurn(afterGrant)
    expect(legalActsFor(offTurn, 'p1').some((action) =>
      action.kind === 'castSpell' && action.name === 'Surprise Bear')).toBe(true)
    const bear = ok(castOf(server, offTurn, 'Surprise Bear'))
    expect(bear.stack[0]).toMatchObject({ name: 'Surprise Bear' })

    const combat = { ...structuredClone(afterGrant), step: 'beginCombat' as const }
    expect(castOf(server, combat, 'Surprise Sorcery').ok).toBe(true)
  })

  test('the grant lets a non-instant be cast with another spell on the stack', () => {
    const { server, state: afterGrant } = granted()
    const withRival = ok(server.rules(opponentsTurn(afterGrant), {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(afterGrant, 'Surprise Sorcery').id,
    }))
    expect(withRival.stack).toHaveLength(1)
    expect(castOf(server, withRival, 'Surprise Bear').ok).toBe(true)
  })

  test('the grant does not extend to other seats or to priority they lack', () => {
    const { server, state: afterGrant } = granted()
    const rival = { ...opponentsTurn(afterGrant), active: 'p1', priority: 'p2' }
    expect(castOf(server, rival, 'Rival Bear', 'p2'))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
    expect(legalActsFor(rival, 'p2').some((action) =>
      action.kind === 'castSpell' && action.name === 'Rival Bear')).toBe(false)

    const noPriority = { ...opponentsTurn(afterGrant), priority: 'p2' }
    expect(castOf(server, noPriority, 'Surprise Bear'))
      .toMatchObject({ ok: false, error: 'seat does not have priority' })
  })

  test('the grant ends at cleanup', () => {
    const { server, state: afterGrant } = granted()
    const ending = { ...structuredClone(afterGrant), step: 'end' as const }
    const cleanup = ok(server.rules(ending, { type: 'advanceStep' }))
    expect(cleanup.step).toBe('cleanup')
    expect(cleanup.rules.some((rule) => rule.pluginId === 'flashGrant')).toBe(false)
    const nextTurn = ok(server.rules(cleanup, { type: 'advanceStep' }))

    const later = { ...opponentsTurn(nextTurn), priority: 'p1' }
    expect(castOf(server, later, 'Surprise Bear'))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
  })
})
