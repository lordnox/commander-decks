import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLobby } from './lobby'
import {
  applyKeep,
  applyMulligan,
  bottomRequired,
  isOpeningFrame,
  pregameCards,
  shuffle,
} from './opening'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const emptyPlayer = (hand: string[], libraryCount: number) => ({
  life: 40,
  poison: 0,
  commander_damage: {},
  commander_tax: 0,
  library_count: libraryCount,
  hand,
  battlefield: [],
  graveyard: [],
  exile: [],
  command: ['Commander'],
})

const fixture = (overrides: {
  hand?: string[]
  library?: string[]
  catalog?: Record<string, { oracle_text?: string }>
} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'live-opening-'))
  roots.push(root)
  mkdirSync(join(root, 'table-games'))
  const hand = overrides.hand ?? [
    'Swamp',
    'Island',
    'Plains',
    'Forest',
    'Mountain',
    'Sol Ring',
    'Kami of False Hope',
  ]
  const library = overrides.library ?? Array.from(
    { length: 92 },
    (_, index) => `Spell ${index + 1}`,
  )
  const state = {
    active: 'p1',
    turn: 0,
    phase: 'setup',
    stack: [],
    players: {
      p1: emptyPlayer(hand, library.length),
      p2: emptyPlayer(['Island'], 92),
    },
  }
  writeFileSync(
    join(root, 'table-games', 'pod.json'),
    JSON.stringify({
      seed: 1729,
      seats: [
        { id: 'p1', name: 'Foggy', mulligans: 0 },
        { id: 'p2', name: 'Homer', mulligans: 0 },
      ],
      catalog: overrides.catalog ?? {},
      events: [{
        id: 0,
        turn: 0,
        phase: 'setup',
        kind: 'keep',
        seat: 'p1',
        summary: 'Foggy keeps 7',
        state,
      }],
      _libraries: { p1: library, p2: ['Island'] },
    }),
  )
  const lobby = createLobby('pod')
  lobby.phase = 'play'
  lobby.firstPlayer = 'p1'
  lobby.occupants = {
    p1: { name: 'Foggy', deck: 'decks/eva' },
    p2: { name: 'Homer', deck: 'decks/homer' },
  }
  lobby.actions = { p1: ['keep', 'mulligan'] }
  return { root, lobby, hand }
}

const replay = (root: string) =>
  JSON.parse(readFileSync(join(root, 'table-games', 'pod.json'), 'utf8'))

describe('commander london', () => {
  test('the first mulligan is free and later ones bottom one extra', () => {
    expect(bottomRequired(0)).toBe(0)
    expect(bottomRequired(1)).toBe(0)
    expect(bottomRequired(2)).toBe(1)
    expect(bottomRequired(3)).toBe(2)
  })

  test('treats a dealt keep as still opening until the first draw', () => {
    const { root } = fixture()
    expect(isOpeningFrame(replay(root), 'p1')).toBe(true)
  })

  test('redraws seven from a deterministic shuffle', () => {
    const { root, lobby, hand } = fixture()
    expect(applyMulligan(root, 'pod', lobby, 'p1')).toBe('mulligan')
    const first = replay(root)
    const seven = first.events.at(-1).state.players.p1.hand
    expect(seven).toHaveLength(7)
    expect(seven).not.toEqual(hand)
    expect(first.seats[0].mulligans).toBe(1)
    expect(lobby.privateWaiting.p1).toContain('Free Commander mulligan')
    expect(first.events.at(-1).cards).toEqual(hand)

    expect(applyMulligan(root, 'pod', lobby, 'p1')).toBe('mulligan')
    const second = replay(root)
    expect(second.seats[0].mulligans).toBe(2)
    expect(lobby.privateWaiting.p1).toContain('Select 1 card')
  })

  test('same seed redraws the same seven', () => {
    const left = fixture()
    const right = fixture()
    applyMulligan(left.root, 'pod', left.lobby, 'p1')
    applyMulligan(right.root, 'pod', right.lobby, 'p1')
    expect(replay(left.root).events.at(-1).state.players.p1.hand).toEqual(
      replay(right.root).events.at(-1).state.players.p1.hand,
    )
  })

  test('keeps seven for free, then bottoms after a second mulligan', () => {
    const { root, lobby } = fixture()
    applyMulligan(root, 'pod', lobby, 'p1')
    expect(applyKeep(root, 'pod', lobby, 'p1', { type: 'keep', cards: [] })).toBe('draw')
    const kept = replay(root)
    expect(kept.events.at(-1).kind).toBe('think')
    expect(kept.events.at(-1).state.players.p1.hand).toHaveLength(8)
    expect(kept.events.some((event: { kind: string }) => event.kind === 'draw')).toBe(true)
    expect(lobby.actions).toEqual({ p1: ['plan'] })
  })

  test('requires selected bottoms after the free mulligan is used', () => {
    const { root, lobby } = fixture()
    applyMulligan(root, 'pod', lobby, 'p1')
    applyMulligan(root, 'pod', lobby, 'p1')
    const seven = replay(root).events.at(-1).state.players.p1.hand as string[]
    expect(() => applyKeep(root, 'pod', lobby, 'p1', { type: 'keep', cards: [] }))
      .toThrow(/requires 1 card/)
    expect(applyKeep(root, 'pod', lobby, 'p1', {
      type: 'keep',
      cards: [seven[3]],
    })).toBe('draw')
    const kept = replay(root)
    const hand = kept.events.at(-1).state.players.p1.hand as string[]
    expect(hand).toHaveLength(7)
    expect(hand).not.toContain(seven[3])
    expect(kept._libraries.p1.at(-1)).toBe(seven[3])
  })

  test('cheat keeps all seven without bottoming', () => {
    const { root, lobby } = fixture()
    applyMulligan(root, 'pod', lobby, 'p1')
    applyMulligan(root, 'pod', lobby, 'p1')
    const seven = replay(root).events.at(-1).state.players.p1.hand as string[]
    expect(applyKeep(root, 'pod', lobby, 'p1', { type: 'keep', cheat: true })).toBe('draw')
    const kept = replay(root)
    const hand = kept.events.at(-1).state.players.p1.hand as string[]
    expect(hand.slice(0, 7)).toEqual(seven)
    expect(hand).toHaveLength(8)
    expect(kept.events.find((event: { decision?: { cheat?: boolean } }) =>
      event.decision?.cheat,
    )).toBeTruthy()
  })

  test('pauses for beginning-of-game cards before the first draw', () => {
    const { root, lobby } = fixture({
      hand: [
        'Leyline of Sanctity',
        'Swamp',
        'Island',
        'Plains',
        'Forest',
        'Mountain',
        'Sol Ring',
      ],
      catalog: {
        'Leyline of Sanctity': {
          oracle_text: 'If Leyline of Sanctity is in your opening hand, you may begin the game with it on the battlefield.',
        },
      },
    })
    expect(applyKeep(root, 'pod', lobby, 'p1', { type: 'keep' })).toBe('pregame')
    expect(lobby.actions).toEqual({ p1: ['plan'] })
    expect(lobby.privateWaiting.p1).toContain('Leyline of Sanctity')
    expect(replay(root).events.at(-1).kind).toBe('note')
    expect(replay(root).events.some((event: { kind: string }) => event.kind === 'draw'))
      .toBe(false)
  })

  test('shuffle is a permutation', () => {
    const cards = ['A', 'B', 'C', 'D']
    const shuffled = shuffle(cards, () => 0.3)
    expect([...shuffled].sort()).toEqual(cards)
  })

  test('detects leylines from oracle text', () => {
    expect(pregameCards(
      ['Forest', 'Leyline of the Void'],
      {
        'Leyline of the Void': {
          oracle_text: 'If this card is in your opening hand, you may begin the game with it on the battlefield.',
        },
      },
    )).toEqual(['Leyline of the Void'])
  })
})
