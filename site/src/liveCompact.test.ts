import { describe, expect, test } from 'bun:test'
import {
  compactLiveWire,
  expandLiveWire,
  fetchDeckIndex,
  loadDeckIndexes,
  STRIDE,
  type DeckIndex,
} from './liveCompact'
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
  judge: 'Beta has priority.',
  judgeHistory: [{
    id: 6,
    type: 'plan',
    summary: 'Play Forest, then cast Cultivate — legal.',
  }],
  youAct: true,
  actions: ['confirm', 'replace'],
  actionId: 7,
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
  awaiting: 'p3',
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
  test('loads bracket-plus deck slugs without encoding the path separator', async () => {
    const original = globalThis.fetch
    let requested = ''
    globalThis.fetch = (input) => {
      requested = String(input)
      return Promise.resolve(new Response('{"cards":[]}'))
    }
    try {
      await fetchDeckIndex('2+_lady-evangela', '/commander-decks/')
      expect(requested).toBe('/commander-decks/decks/2+_lady-evangela.json')
    } finally {
      globalThis.fetch = original
    }
  })

  test('a missing deck index leaves the rest of the board loadable', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (input) =>
      Promise.resolve(
        String(input).includes('beta')
          ? new Response('<!doctype html>', { status: 200 })
          : new Response('{"cards":[{"n":"Island","id":"id-0"}]}'),
      )
    try {
      const indexes = await loadDeckIndexes(['alpha', 'beta'], '/commander-decks/')
      expect(indexes.alpha.cards).toHaveLength(1)
      expect(indexes.beta.cards).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })

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
    expect(expanded.awaiting).toBe('p3')
    expect(expanded.judge).toBe('Beta has priority.')
    expect(expanded.judgeHistory).toEqual(snapshot().judgeHistory)
    expect(expanded.youAct).toBe(true)
    expect(expanded.actions).toEqual(['confirm', 'replace'])
    expect(expanded.actionId).toBe(7)
  })

  test('history frames and replica round-trip', () => {
    const original = snapshot()
    original.history = [{
      seq: 0,
      summary: 'Setup',
      turn: 1,
      phase: 'planning',
      active: 'p1',
      seats: original.seats,
    }]
    original.historyCursor = 0
    original.replica = {
      format: 'commander',
      knowledge: { mode: 'replica', viewer: 'p2' },
    } as LiveSnapshot['replica']
    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.history?.[0].summary).toBe('Setup')
    expect(expanded.historyCursor).toBe(0)
    expect(expanded.replica?.knowledge).toEqual({ mode: 'replica', viewer: 'p2' })
  })

  test('private legal acts survive the wire', () => {
    const original = snapshot()
    original.actions = ['plan', 'pass', 'act']
    original.legalActs = [{ kind: 'playLand', objectId: 'o3', name: 'Forest' }]
    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.actions).toEqual(['plan', 'pass', 'act'])
    expect(expanded.legalActs).toEqual([{ kind: 'playLand', objectId: 'o3', name: 'Forest' }])
  })

  test('attack and block labels survive the wire', () => {
    const original = snapshot()
    original.seats[1].battlefield = [
      { name: 'Sol Ring', tapped: true },
      { name: 'Satyr Wayfinder', attacking: 'Delta' },
      { name: 'Hazel of the Rootbloom', blocking: 'Satyr Wayfinder' },
    ]
    original.combat = {
      step: 'attackers',
      attackers: [{ card: 'Satyr Wayfinder', defender: 'p4', pt: '1/1', tapped: true }],
      possible_blockers: { p4: [] },
    }
    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.seats[1].battlefield[1]).toEqual({
      name: 'Satyr Wayfinder',
      attacking: 'Delta',
    })
    expect(expanded.seats[1].battlefield[2].blocking).toBe('Satyr Wayfinder')
    expect(expanded.combat?.attackers?.[0].defender).toBe('p4')
  })

  test('summoning sickness survives the wire', () => {
    const original = snapshot()
    original.seats[1].battlefield = [{
      name: 'Satyr Wayfinder',
      summoningSickness: true,
    }]

    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.seats[1].battlefield[0]).toEqual({
      name: 'Satyr Wayfinder',
      summoningSickness: true,
    })
  })

  test('the card a clone is printed as survives the wire', () => {
    const original = snapshot()
    original.seats[1].battlefield = [{
      name: 'Satyr Wayfinder',
      printed_name: 'Spark Double',
    }]

    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.seats[1].battlefield[0]).toEqual({
      name: 'Satyr Wayfinder',
      printed_name: 'Spark Double',
    })
  })

  test('an exiled-with association survives the wire', () => {
    const original = snapshot()
    original.seats[1].exile = [{
      name: 'Blue Card',
      note: 'Exiled with Pit of Offerings.',
      objectId: 'o-blue',
    }]

    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.seats[1].exile[0]).toEqual({
      name: 'Blue Card',
      note: 'Exiled with Pit of Offerings.',
      objectId: 'o-blue',
    })
  })

  test('a floating mana pool survives the wire', () => {
    const original = snapshot()
    original.seats[0].mana = { W: 1, B: 2 }

    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.seats[0].mana).toEqual({ W: 1, B: 2 })
    // An untouched seat stays lean rather than shipping six zeroes.
    expect(expanded.seats[1].mana).toBeUndefined()
  })

  test('private opening keep/mulligan bits and bottom count survive the wire', () => {
    const original = snapshot()
    original.actions = ['keep', 'mulligan']
    original.opening = { mulligans: 2, bottomRequired: 1 }
    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.actions).toEqual(['keep', 'mulligan'])
    expect(expanded.opening).toEqual({ mulligans: 2, bottomRequired: 1 })
  })

  test('private top-deck choice and deterministic actions survive the wire', () => {
    const original = snapshot()
    original.actions = ['topdeck', 'advance']
    original.topdeck = {
      kind: 'surveil',
      cards: ['Forest'],
      destinations: ['top', 'graveyard'],
    }
    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.actions).toEqual(['topdeck', 'advance'])
    expect(expanded.topdeck).toEqual({
      kind: 'surveil',
      cards: ['Forest'],
      destinations: ['top', 'graveyard'],
      library: undefined,
      requirements: undefined,
    })
  })

  test('a search carries the whole readable library over the wire', () => {
    const original = snapshot()
    original.actions = ['topdeck']
    original.topdeck = {
      kind: 'search',
      cards: ['Forest'],
      destinations: ['library', 'battlefield'],
      library: ['Forest', 'Island'],
    }
    const expanded = expandLiveWire(compactLiveWire(original), original.deckIndexes)
    expect(expanded.topdeck?.library).toEqual(['Forest', 'Island'])
  })

  test('private always-stop priority preference survives the wire', () => {
    const original = snapshot()
    original.alwaysStopOnPriority = true
    const wire = compactLiveWire(original)
    expect(wire.b).toBe(1)
    expect(
      expandLiveWire(wire, original.deckIndexes).alwaysStopOnPriority,
    ).toBe(true)
  })
})
