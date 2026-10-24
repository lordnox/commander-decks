import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { alternateCosts } from './alternateCosts'
import { targetedResolve } from './targetedResolve'

const card = (name: string, types: string[], manaCost = '') =>
  cardTemplate(name, { types, manaCost })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('Sin Fall replacement and hidden-information cards', () => {
  test('Cling to Dust escape exiles exactly five other graveyard cards and resolves', () => {
    const fillers = Array.from({ length: 5 }, (_, index) => card(`Filler ${index}`, ['Sorcery']))
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: {
          p1: [
            card('Cling to Dust', ['Instant'], '{B}'),
            ...fillers,
            card('Target Creature', ['Creature']),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [alternateCosts, targetedResolve] },
    )
    let state = structuredClone(server.state)
    for (const objectId of state.zoneOrder.p1.hand.slice()) {
      state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
    }
    state.players.p1.mana.B = 1
    state.players.p1.mana.C = 3
    const cling = named(state, 'Cling to Dust')
    const target = named(state, 'Target Creature')
    const costs = fillers.map(({ name }) => named(state, name).id)
    const action = legalActsFor(state, 'p1').find((candidate) =>
      candidate.kind === 'castSpell'
      && candidate.objectId === cling.id
      && candidate.castOption === 'escape')
    expect(action).toMatchObject({
      castLabel: 'Escape—{3}{B}, Exile 5 other cards from your graveyard.',
      targetGroups: [{ min: 5, max: 5, purpose: 'cost' }],
    })
    expect(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: cling.id,
      castOption: 'escape',
      exile: [cling.id, ...costs.slice(0, 4)],
      targets: [{ kind: 'object', objectId: target.id }],
    }).ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: cling.id,
      castOption: 'escape',
      exile: costs,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    expect(costs.every((id) => state.objects[id].zone === 'exile')).toBe(true)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(target.zone).not.toBe('exile')
    expect(state.objects[target.id].zone).toBe('exile')
    expect(state.objects[cling.id].zone).toBe('graveyard')
    expect(state.players.p1.life).toBe(43)
  })

})
