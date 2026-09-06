import { describe, expect, test } from 'bun:test'
import { buildSeatPacket } from './seat-packet'

const player = (hand: string[], revealed_top: string[] = []) => ({
  life: 40,
  library_count: 80,
  hand,
  battlefield: [],
  graveyard: [],
  exile: [],
  command: [],
  revealed_top,
})

const game = () => ({
  seed: 1729,
  _libraries: {
    p3: ['Snow-Covered Swamp', 'Forest'],
    p4: ['Goblin Electromancer', 'Island'],
  },
  seats: [
    { id: 'p3', name: 'Hybrid Theory' },
    { id: 'p4', name: 'Divergent Laughter' },
  ],
  events: [
    {
      id: 0,
      turn: 7,
      phase: 'draw',
      seat: 'p3',
      kind: 'draw',
      summary: 'Hybrid Theory draws Snow-Covered Swamp.',
      cards: ['Snow-Covered Swamp'],
      state: {},
    },
    {
      id: 1,
      turn: 7,
      phase: 'impact',
      seat: 'p3',
      kind: 'think',
      summary: 'Hybrid Theory sees Snow-Covered Swamp.',
      plan: {
        scope: 'impact',
        status: 'kept',
        summary: 'Play Snow-Covered Swamp.',
      },
      state: {},
    },
    {
      id: 2,
      turn: 7,
      phase: 'draw',
      seat: 'p4',
      kind: 'draw',
      summary: 'Divergent Laughter draws Goblin Electromancer.',
      cards: ['Goblin Electromancer'],
      state: {},
    },
    {
      id: 3,
      turn: 7,
      phase: 'impact',
      seat: 'p4',
      kind: 'think',
      summary: 'Divergent Laughter sees Goblin Electromancer.',
      plan: {
        scope: 'impact',
        status: 'revised',
        summary: 'Cast Goblin Electromancer.',
      },
      state: {
        active: 'p4',
        players: {
          p3: player(['Snow-Covered Swamp'], ['Forest']),
          p4: player(['Goblin Electromancer'], ['Island']),
        },
      },
    },
    {
      id: 4,
      turn: 7,
      phase: 'main1',
      seat: 'p3',
      kind: 'pass',
      summary: 'Hybrid Theory holds Withering Wisps.',
      decision: {
        available: ['Withering Wisps'],
        held: ['Withering Wisps'],
        reason: 'Keep Withering Wisps hidden for next turn.',
      },
      state: {
        active: 'p4',
        players: {
          p3: player(['Snow-Covered Swamp', 'Withering Wisps'], ['Forest']),
          p4: player(['Goblin Electromancer'], ['Island']),
        },
      },
    },
  ],
  catalog: {},
  references: [],
  tokens: {},
})

describe('buildSeatPacket', () => {
  test('redacts another seat draw and private plan', () => {
    const packet = buildSeatPacket(game(), 'p4')

    expect(packet.history[0]).toMatchObject({
      summary: 'Hybrid Theory draws a card.',
      cards: [],
    })
    expect(packet.history.some((event: any) => event.seat === 'p3' && event.plan)).toBe(false)
    expect(JSON.stringify(packet)).not.toContain('Snow-Covered Swamp')
    expect(JSON.stringify(packet)).not.toContain('Withering Wisps')
  })

  test('keeps the acting seat draw, hand, and latest plan', () => {
    const packet = buildSeatPacket(game(), 'p4')

    expect(packet.history[1]).toMatchObject({
      summary: 'Divergent Laughter draws Goblin Electromancer.',
      cards: ['Goblin Electromancer'],
    })
    expect(packet.state.players.p4.hand).toEqual(['Goblin Electromancer'])
    expect(packet.plans.impact.summary).toBe('Cast Goblin Electromancer.')
  })

  test('removes foreign hands, revealed tops, and all library order', () => {
    const packet = buildSeatPacket(game(), 'p4')

    expect(packet.state.players.p3.hand).toBeUndefined()
    expect(packet.state.players.p3.hand_count).toBe(2)
    expect(packet.state.players.p3.revealed_top).toBeUndefined()
    expect(JSON.stringify(packet)).not.toContain('"_libraries"')
    expect(JSON.stringify(packet)).not.toContain('"Forest"')
  })

  test('redacts a foreign pass and its private decision', () => {
    const packet = buildSeatPacket(game(), 'p4')
    const pass = packet.history.find((event: any) => event.kind === 'pass')

    expect(pass).toMatchObject({ summary: 'Hybrid Theory passes.', cards: [] })
    expect(pass.decision).toBeUndefined()
    expect(pass.notes).toBeUndefined()
  })

  test('rejects an unknown seat', () => {
    expect(() => buildSeatPacket(game(), 'p2')).toThrow('unknown seat p2')
  })
})
