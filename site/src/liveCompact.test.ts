import { describe, expect, test } from 'bun:test'
import { compactLiveWire, expandLiveWire, STRIDE, type DeckIndex } from './liveCompact'
import type { LiveSnapshot } from './liveCodec'

const index = (names: string[]): DeckIndex => ({
  cards: names.map((name, slot) => ({ n: name, id: `id-${slot}` })),
})

const snapshot = (): LiveSnapshot => ({
  v: 1,
  you: 'p2',
  headline: 'Test table',
  waiting: 'Would this line work? Confirm or replace it.',
  talk: 'Hold up.',
  events: [
    {
      id: 8,
      turn: 3,
      phase: 'main1',
      seat: 'p2',
      kind: 'cast',
      summary: 'Beta casts Cultivate.',
    },
  ],
  turn: 3,
  phase: 'main1',
  active: 'p2',
  stack: [{ name: 'Counterspell', controller: 'p1', text: 'on Sol Ring' }],
  seats: [
    {
      id: 'p1',
      name: 'Alpha',
      deck: 'decks/alpha',
      commanders: ['Sygg, River Cutthroat'],
      color: '#c45c26',
      life: 40,
      poison: 0,
      commander_tax: 0,
      library_count: 90,
      hand_count: 2,
      commander_damage: { p2: 0, p3: 0, p4: 0 },
      battlefield: [],
      graveyard: [],
      exile: [],
      command: ['Sygg, River Cutthroat'],
    },
    {
      id: 'p2',
      name: 'Beta',
      deck: 'decks/beta',
      commanders: ['Hazel of the Rootbloom'],
      color: '#2f6f64',
      life: 39,
      poison: 0,
      commander_tax: 0,
      library_count: 89,
      hand_count: 2,
      hand: ['Forest', 'Cultivate'],
      commander_damage: { p1: 0, p3: 0, p4: 0 },
      battlefield: [{ name: 'Sol Ring', tapped: true }],
      graveyard: [],
      exile: [],
      command: ['Hazel of the Rootbloom'],
      revealed_top: ['Forest'],
    },
    {
      id: 'p3',
      name: 'Gamma',
      deck: 'decks/gamma',
      commanders: ['Osgir, the Reconstructor'],
      color: '#4a5d9e',
      life: 40,
      poison: 0,
      commander_tax: 0,
      library_count: 90,
      hand_count: 1,
      commander_damage: { p1: 0, p2: 0, p4: 0 },
      battlefield: [],
      graveyard: [],
      exile: [],
      command: ['Osgir, the Reconstructor'],
    },
    {
      id: 'p4',
      name: 'Delta',
      deck: 'decks/delta',
      commanders: ['Homer, the Hermit'],
      color: '#8a3d6b',
      life: 40,
      poison: 0,
      commander_tax: 0,
      library_count: 90,
      hand_count: 1,
      commander_damage: { p1: 0, p2: 0, p3: 0 },
      battlefield: [],
      graveyard: [],
      exile: [],
      command: ['Homer, the Hermit'],
    },
  ],
  catalog: {},
  decks: ['alpha', 'beta', 'gamma', 'delta'],
  deckIndexes: {
    alpha: index(['Sygg, River Cutthroat', 'Island', 'Counterspell']),
    beta: index(['Hazel of the Rootbloom', 'Forest', 'Sol Ring', 'Cultivate']),
    gamma: index(['Osgir, the Reconstructor']),
    delta: index(['Homer, the Hermit']),
  },
})

describe('live compact v2', () => {
  test('board cards are deck slot integers', () => {
    const wire = compactLiveWire(snapshot())
    expect(wire.v).toBe(2)
    expect(wire.d).toEqual(['alpha', 'beta', 'gamma', 'delta'])
    expect(wire.x).toBeUndefined()
    const beta = wire.z[1] as unknown[]
    const hand = beta[3] as number[]
    const board = beta[4] as unknown[]
    expect(hand).toEqual([1 * STRIDE + 1, 1 * STRIDE + 3])
    expect(board[0]).toEqual([1 * STRIDE + 2, 1])
    const stack = wire.s as unknown[]
    expect(stack[0]).toEqual([2, 0, 'on Sol Ring'])
  })

  test('expand restores names from the four 99s', () => {
    const original = snapshot()
    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.you).toBe('p2')
    expect(expanded.seats[1].hand).toEqual(['Forest', 'Cultivate'])
    expect(expanded.seats[1].battlefield[0]).toEqual({ name: 'Sol Ring', tapped: true })
    expect(expanded.stack[0]).toEqual({
      name: 'Counterspell',
      controller: 'p1',
      text: 'on Sol Ring',
    })
    expect(expanded.catalog.Forest).toEqual({ id: 'id-1' })
    expect(expanded.seats[0].hand).toBeUndefined()
    expect(expanded.events).toEqual(original.events)
  })
})
