import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { Plugin } from '../types'
import { activate, damage, gainLife, loseLife, opponentsLoseLife, players, type CardInstruction } from './effects'
import { activated } from './activated'
import { selectedPlayers } from './selectors'

const game = (instructions: CardInstruction[], plugins: Plugin[] = [], oracleText = '') =>
  createServerGame(commanderRules, {
    players: 4, battlefield: { p1: [cardTemplate('Source', {
      types: ['Enchantment'], oracleText,
      effects: [activate({ id: 'test', costs: {}, do: instructions })],
    })] },
  }, { random: () => 0.5, cardPlugins: [activated, ...plugins] })
const queue = (server: ReturnType<typeof game>) => ok(server.rules(server.state, {
  type: 'activateAbility', seat: 'p1', objectId: server.state.zoneOrder.p1.battlefield[0], abilityId: 'test',
}))
const life = (state: ReturnType<typeof queue>) => state.playerOrder.map((seat) => state.players[seat].life)

describe('parameterized player effects', () => {
  test('opponent life loss uses a serializable selector and takes effect only at resolution', () => {
    const instruction = loseLife({ amount: 1, to: players('opponent') })
    expect(structuredClone(instruction)).toEqual(instruction)
    expect(opponentsLoseLife(1)).toEqual(instruction)
    const server = game([instruction])
    const queued = queue(server)
    expect(life(queued)).toEqual([40, 40, 40, 40])
    expect(life(resolveStack(server.rules, queued))).toEqual([40, 39, 39, 39])
  })

  test('player predicates compose AND, OR, and NOT and exclude lost players', () => {
    const server = game([])
    const state = structuredClone(server.state)
    state.players.p3.lost = true
    const selector = players({ all: [{ any: [{ relation: 'you' }, { relation: 'opponent' }] }], not: { relation: 'you' } })
    expect(selectedPlayers(state, selector, 'p1')).toEqual(['p2', 'p4'])
    expect(selectedPlayers(state, players({ any: [] }), 'p1')).toEqual([])
    expect(selectedPlayers(state, players({ all: [] }), 'p1')).toEqual(['p1', 'p2', 'p4'])
  })

  test('gain life can affect yourself, all players, or opponents', () => {
    const server = game([
      gainLife({ amount: 2, to: players('you') }),
      gainLife({ amount: 1, to: players('any') }),
      gainLife({ amount: 3, to: players('opponent') }),
    ])
    expect(life(resolveStack(server.rules, queue(server)))).toEqual([43, 44, 44, 44])
  })

  test('a removed or newly controlled source does not change the ability controller used by selectors', () => {
    const server = game([loseLife({ amount: 2, to: players('opponent') }), gainLife({ amount: 1, to: players('you') })])
    for (const remove of [false, true]) {
      let state = queue(server)
      const objectId = server.state.zoneOrder.p1.battlefield[0]
      if (remove) state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
      else {
        state = structuredClone(state)
        state.objects[objectId].controller = 'p2'
      }
      expect(life(resolveStack(server.rules, state))).toEqual([41, 38, 38, 38])
    }
  })

  test('groups are evaluated at resolution and skip players who have lost since stacking', () => {
    const server = game([loseLife({ amount: 1, to: players('opponent') })])
    const state = structuredClone(queue(server))
    state.players.p3.lost = true
    const settled = resolveStack(server.rules, state)
    expect(life(settled)).toEqual([40, 39, 40, 39])
  })

  test('player selectors affect a group without declaring targets', () => {
    const server = game([damage({ amount: 2, to: players('opponent') })])
    const state = queue(server)
    expect(state.stack[0].targets).toEqual([])
    expect(life(resolveStack(server.rules, state))).toEqual([40, 38, 38, 38])
  })

  test('damage passes through prevention while life loss bypasses damage prevention', () => {
    const prevent: Plugin = { id: 'preventDamage', replace: ({ event }) => event.type === 'dealDamage' ? null : undefined }
    const server = game([
      damage({ amount: 2, to: players('opponent') }),
      loseLife({ amount: 1, to: players('opponent') }),
    ], [prevent])
    expect(life(resolveStack(server.rules, queue(server)))).toEqual([40, 39, 39, 39])
  })

  test('damage retains its source and triggers lifelink; life loss never does', () => {
    const server = game([
      damage({ amount: 2, to: players('opponent') }),
      loseLife({ amount: 1, to: players('opponent') }),
    ], [], 'Lifelink')
    expect(life(resolveStack(server.rules, queue(server)))).toEqual([46, 37, 37, 37])
  })

  test('infect damage adds poison while configured life loss still reduces life', () => {
    const server = game([
      damage({ amount: 2, to: players('opponent') }),
      loseLife({ amount: 1, to: players('opponent') }),
    ], [], 'Infect')
    const state = resolveStack(server.rules, queue(server))
    expect(life(state)).toEqual([40, 39, 39, 39])
    expect(state.playerOrder.map((seat) => state.players[seat].poison)).toEqual([0, 2, 2, 2])
  })

  test('saved legacy instruction kinds continue to work through shared player matching', () => {
    const server = game([
      { kind: 'opponentsLoseLife', amount: 1 },
      { kind: 'eachPlayerLoseLife', amount: 2 },
      gainLife(1), loseLife(1, 'controller'),
    ])
    expect(life(resolveStack(server.rules, queue(server)))).toEqual([38, 37, 37, 37])
  })
})
