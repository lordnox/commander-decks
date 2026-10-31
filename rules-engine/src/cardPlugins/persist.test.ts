import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { artifact, choose, deckCard, enter, fixtureCreature, libraries, named } from './cirdanCreatureCards'
describe('relocated from cirdanTriggers.test.ts → persist.test.ts', () => {
  const kill = (server: ReturnType<typeof createServerGame>, state: GameState) =>
    resolveStack(server.rules, ok(server.rules(state, {
      type: 'sacrifice',
      objectId: named(state, 'Woodfall Primus').id,
    })))

  const primusGame = (
    battlefield: Record<string, CardTemplate[]> = {
      p1: [artifact('Own Rock')],
      p2: [artifact('Enemy Rock'), fixtureCreature('Enemy Bear')],
      p3: [cardTemplate('Enemy Forest', { types: ['Land'] })],
    },
  ) => {
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: { p1: [deckCard('Woodfall Primus')] },
        battlefield,
        libraries: libraries(['p1', 'p2', 'p3']),
      },
      { random: () => 0.5 },
    )
    return { server, start: server.state }
  }

      test('it returns with a -1/-1 counter, destroys another permanent, and then stays dead', () => {
        const { server, start } = primusGame({
          p2: [artifact('Rock A'), artifact('Rock B')],
        })
        let state = enter(server, start, 'Woodfall Primus')
        state = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Rock A']))))
        expect(named(state, 'Rock A').zone).toBe('graveyard')

        state = kill(server, state)
        const back = named(state, 'Woodfall Primus')
        expect(back.zone).toBe('battlefield')
        expect(back.counters).toEqual({ '-1/-1': 1 })
        expect([back.power, back.toughness]).toEqual([5, 5])
        // It entered again, so its enter trigger asks for a new target.
        expect(pendingSelectionFor(state, 'p1')!.candidates.map((id) => state.objects[id].name))
          .toEqual(['Rock B'])
        state = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Rock B']))))
        expect(named(state, 'Rock B').zone).toBe('graveyard')

        state = kill(server, state)
        expect(named(state, 'Woodfall Primus').zone).toBe('graveyard')
        expect(state.stack).toEqual([])
      })

      test('exiled instead of dying, it does not persist', () => {
        const { server, start } = primusGame({ p2: [artifact('Rock A')] })
        let state = enter(server, start, 'Woodfall Primus')
        state = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Rock A']))))
        state = ok(server.rules(state, {
          type: 'move',
          objectId: named(state, 'Woodfall Primus').id,
          to: 'exile',
        }))
        expect(resolveStack(server.rules, state).objects[named(state, 'Woodfall Primus').id].zone).toBe('exile')
      })

      test('it returns under its owner, not the thief who killed it', () => {
        const { server, start } = primusGame({ p2: [artifact('Rock A')] })
        let state = enter(server, start, 'Woodfall Primus')
        state = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Rock A']))))
        state = structuredClone(state)
        named(state, 'Woodfall Primus').controller = 'p2'
        state = kill(server, state)
        expect(named(state, 'Woodfall Primus')).toMatchObject({ zone: 'battlefield', controller: 'p1' })
      })
})
