import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { landfall } from './landfall'
import { mossbornHydra } from './mossborn-hydra'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const forest = () => cardTemplate('Forest', {
  types: ['Land'],
  subtypes: ['Forest'],
  tapProduces: { G: 1 },
})

describe('mossborn hydra', () => {
  test('enters with a +1/+1 counter when its spell resolves', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Mossborn Hydra', {
            types: ['Creature'],
            subtypes: ['Elemental', 'Hydra'],
            power: 0,
            toughness: 0,
            manaCost: '{2}{G}',
          })],
        },
        battlefield: { p1: [forest(), forest(), forest()] },
      },
      { random: () => 0.5, cardPlugins: [landfall, mossbornHydra] },
    )
    const [forestA, forestB, forestC] = server.state.zoneOrder.p1.battlefield
    const hydraId = server.state.zoneOrder.p1.hand[0]
    let state = server.state
    state = ok(server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: forestA }))
    state = ok(server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: forestB }))
    state = ok(server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: forestC }))
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: hydraId }))
    state = ok(server.rules(state, { type: 'passPriority', seat: 'p1' }))
    state = ok(server.rules(state, { type: 'passPriority', seat: 'p2' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const resolved = state.objects[hydraId]
    expect(resolved.zone).toBe('battlefield')
    expect(resolved.counters['+1/+1']).toBe(1)
    expect([resolved.power, resolved.toughness]).toEqual([1, 1])
  })
})
