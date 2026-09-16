import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import {
  HOMER_CHOSEN,
  HOMER_NAME,
  homer,
  pendingHomer,
} from './homer'

const card = (name: string, types: string[], subtypes: string[] = []) =>
  cardTemplate(name, { types, subtypes })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = () => createServerGame(
  commanderRules,
  {
    players: 4,
    hands: { p1: [card('Forest', ['Land'])] },
    battlefield: {
      p1: [
        card(HOMER_NAME, ['Creature'], ['Crab', 'Druid']),
        card('Two-Type Creature', ['Creature'], ['Crab', 'Lobster']),
        card('Bear', ['Creature'], ['Bear']),
      ],
    },
    libraries: {
      p1: Array.from({ length: 6 }, (_, index) => card(`P1 ${index}`, ['Instant'])),
      p2: Array.from({ length: 6 }, (_, index) => card(`P2 ${index}`, ['Instant'])),
      p3: Array.from({ length: 6 }, (_, index) => card(`P3 ${index}`, ['Instant'])),
      p4: Array.from({ length: 6 }, (_, index) => card(`P4 ${index}`, ['Instant'])),
    },
  },
  { random: () => 0, cardPlugins: [homer] },
)

describe(HOMER_NAME, () => {
  test('landfall waits for any number of player targets, then mills each target', () => {
    const server = game()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))

    expect(pendingHomer(triggered)).toMatchObject({ controller: 'p1' })
    expect(server.rules(triggered, { type: 'passPriority', seat: 'p1' })).toMatchObject({
      ok: false,
    })

    const stacked = ok(server.rules(triggered, {
      type: 'custom',
      name: HOMER_CHOSEN,
      seat: 'p1',
      payload: { targets: ['p2', 'p4'] },
    }))
    expect(pendingHomer(stacked)).toBeUndefined()
    expect(stacked.stack[0]?.kind).toBe('ability')
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(resolved.zoneOrder.p2.graveyard).toHaveLength(4)
    expect(resolved.zoneOrder.p3.graveyard).toHaveLength(0)
    expect(resolved.zoneOrder.p4.graveyard).toHaveLength(4)
  })

  test('each sea-creature permanent counts once even with two relevant types', () => {
    const server = game()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    const stacked = ok(server.rules(triggered, {
      type: 'custom',
      name: HOMER_CHOSEN,
      seat: 'p1',
      payload: { targets: ['p1'] },
    }))
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p1.graveyard).toHaveLength(4)
  })

  test('counts sea creatures when the triggered ability resolves', () => {
    const server = game()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    let stacked = ok(server.rules(triggered, {
      type: 'custom',
      name: HOMER_CHOSEN,
      seat: 'p1',
      payload: { targets: ['p2'] },
    }))
    const otherCrab = stacked.zoneOrder.p1.battlefield.find(
      (id) => stacked.objects[id].name === 'Two-Type Creature',
    )!
    stacked = ok(server.rules(stacked, {
      type: 'move',
      objectId: otherCrab,
      to: 'graveyard',
    }))
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p2.graveyard).toHaveLength(2)
  })

  test('choosing no targets is legal', () => {
    const server = game()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    const stacked = ok(server.rules(triggered, {
      type: 'custom',
      name: HOMER_CHOSEN,
      seat: 'p1',
      payload: { targets: [] },
    }))
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(pendingHomer(resolved)).toBeUndefined()
    expect(resolved.playerOrder.map((seat) => resolved.zoneOrder[seat].graveyard.length))
      .toEqual([0, 0, 0, 0])
  })

  test('rejects duplicate, unknown, and wrong-controller target submissions', () => {
    const server = game()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    for (const event of [
      { type: 'custom', name: HOMER_CHOSEN, seat: 'p1', payload: { targets: ['p2', 'p2'] } },
      { type: 'custom', name: HOMER_CHOSEN, seat: 'p1', payload: { targets: ['nobody'] } },
      { type: 'custom', name: HOMER_CHOSEN, seat: 'p2', payload: { targets: ['p1'] } },
    ] as const) {
      expect(server.rules(triggered, event).ok).toBe(false)
    }
  })
})
