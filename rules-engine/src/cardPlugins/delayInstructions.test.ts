import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { grantUntilEot, onResolve, returnIfDiesThisTurn } from './effects'
import { onResolve as onResolvePlugin } from './onResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const toCleanup = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => ok(server.rules({ ...state, step: 'end' }, { type: 'advanceStep' }))

const castReturnSpell = () => {
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      hands: {
        p1: [cardTemplate('Return If Dies', {
          types: ['Instant'],
          manaCost: '{0}',
          manaValue: 0,
          effects: [onResolve(grantUntilEot('indestructible'), returnIfDiesThisTurn())],
        })],
      },
      battlefield: {
        p1: [
          cardTemplate('Watched Bear', { types: ['Creature'] }),
          cardTemplate('Other Bear', { types: ['Creature'] }),
        ],
      },
    },
    { random: () => 0.5, cardPlugins: [onResolvePlugin] },
  )
  const withMana = {
    ...server.state,
    players: {
      ...server.state.players,
      p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
    },
  }
  const watched = named(withMana, 'Watched Bear').id
  const cast = ok(server.rules(withMana, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(withMana, 'Return If Dies').id,
    targets: [{ kind: 'object', objectId: watched }],
  }))
  const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
  return { server, resolved, watched }
}

describe('return if dies this turn', () => {
  test('the delayed trigger snapshots the spell after it leaves the stack', () => {
    const { resolved, watched } = castReturnSpell()
    expect(named(resolved, 'Return If Dies').zone).toBe('graveyard')
    expect(resolved.objects[watched].zone).toBe('battlefield')
    expect(resolved.delayedTriggers).toHaveLength(1)
    expect(resolved.delayedTriggers[0]).toMatchObject({
      sourceName: 'Return If Dies',
      controller: 'p1',
      untilCleanup: true,
      condition: {
        kind: 'event',
        type: 'move',
        objectId: watched,
        from: 'battlefield',
        to: 'graveyard',
      },
    })
  })

  test('if that object dies this turn it returns under its owner even after the spell left', () => {
    const { server, resolved, watched } = castReturnSpell()
    const died = ok(server.rules(resolved, { type: 'move', objectId: watched, to: 'graveyard' }))
    expect(died.objects[watched].zone).toBe('graveyard')
    expect(died.delayedTriggers).toHaveLength(0)
    expect(died.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Return If Dies',
      controller: 'p1',
    })
    const returned = ok(server.rules(died, { type: 'resolveTop' }))
    expect(returned.objects[watched]).toMatchObject({
      zone: 'battlefield',
      controller: 'p1',
    })
  })

  test('a different creature dying does not consume the delayed trigger', () => {
    const { server, resolved, watched } = castReturnSpell()
    const other = named(resolved, 'Other Bear').id
    const died = ok(server.rules(resolved, { type: 'move', objectId: other, to: 'graveyard' }))
    expect(died.objects[other].zone).toBe('graveyard')
    expect(died.objects[watched].zone).toBe('battlefield')
    expect(died.delayedTriggers).toHaveLength(1)
    expect(died.stack).toHaveLength(0)
  })

  test('if it does not die this turn, dying next turn does not return it', () => {
    const { server, resolved, watched } = castReturnSpell()
    const cleaned = toCleanup(server, resolved)
    expect(cleaned.step).toBe('cleanup')
    expect(cleaned.delayedTriggers).toHaveLength(0)
    const nextTurn = ok(server.rules(cleaned, { type: 'advanceStep' }))
    expect(nextTurn.objects[watched].zone).toBe('battlefield')
    const died = ok(server.rules(nextTurn, { type: 'move', objectId: watched, to: 'graveyard' }))
    expect(died.objects[watched].zone).toBe('graveyard')
    expect(died.stack).toHaveLength(0)
  })
})
