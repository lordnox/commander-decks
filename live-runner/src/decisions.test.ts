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
import {
  applyAdvance,
  applyTopdeckChoice,
  prepareTopdeckDecision,
} from './decisions'
import { createLobby } from './lobby'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const fixture = (text = 'surveil 1') => {
  const root = mkdtempSync(join(tmpdir(), 'live-decisions-'))
  roots.push(root)
  mkdirSync(join(root, 'table-games'))
  writeFileSync(
    join(root, 'table-games', 'pod.json'),
    JSON.stringify({
      events: [{
        id: 11,
        turn: 1,
        phase: 'main1',
        seat: 'p1',
        kind: 'trigger',
        state: {
          active: 'p1',
          turn: 1,
          phase: 'main1',
          stack: [{
            name: 'Shadowy Backstreet',
            controller: 'p1',
            text,
          }],
          players: {
            p1: {
              hand: ['Swamp'],
              graveyard: [],
              library_count: 3,
            },
          },
        },
      }],
      _libraries: {
        p1: ['Teferi', 'Cabal Coffers', 'Island'],
      },
    }),
  )
  const lobby = createLobby('pod')
  lobby.phase = 'play'
  lobby.occupants = {
    p1: { name: 'Foggy', deck: 'decks/eva' },
  }
  return { root, lobby }
}

const replay = (root: string) =>
  JSON.parse(readFileSync(join(root, 'table-games', 'pod.json'), 'utf8'))

describe('top-deck decisions', () => {
  test('detects surveil from the unresolved stack item', () => {
    const { root, lobby } = fixture()
    expect(prepareTopdeckDecision(root, 'pod', lobby)).toBe(true)
    expect(lobby.topdeck).toEqual({
      seat: 'p1',
      kind: 'surveil',
      cards: ['Teferi'],
      destinations: ['top', 'graveyard'],
    })
    expect(lobby.actions).toEqual({ p1: ['topdeck'] })
  })

  test('surveil moves the private top card to the graveyard', () => {
    const { root, lobby } = fixture()
    prepareTopdeckDecision(root, 'pod', lobby)
    expect(applyTopdeckChoice(root, 'pod', lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Teferi', destination: 'graveyard' }],
    })).toBe(true)
    const game = replay(root)
    expect(game._libraries.p1).toEqual(['Cabal Coffers', 'Island'])
    expect(game.events.at(-1).state.players.p1.graveyard).toEqual(['Teferi'])
    expect(game.events.at(-1).state.stack).toEqual([])
    expect(lobby.actions).toEqual({ p1: ['plan', 'advance'] })
  })

  test('scry two preserves chosen order on top and bottom', () => {
    const { root, lobby } = fixture('scry 2')
    prepareTopdeckDecision(root, 'pod', lobby)
    applyTopdeckChoice(root, 'pod', lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'Cabal Coffers', destination: 'top' },
        { card: 'Teferi', destination: 'bottom' },
      ],
    })
    expect(replay(root)._libraries.p1).toEqual([
      'Cabal Coffers',
      'Island',
      'Teferi',
    ])
  })

  test('rejects stale top-card names', () => {
    const { root, lobby } = fixture()
    prepareTopdeckDecision(root, 'pod', lobby)
    expect(() => applyTopdeckChoice(root, 'pod', lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Island', destination: 'top' }],
    })).toThrow(/library changed/i)
  })
})

describe('deterministic phase advance', () => {
  test('moves main one to combat without invoking a judge', () => {
    const { root, lobby } = fixture()
    const game = replay(root)
    game.events[0].state.stack = []
    writeFileSync(
      join(root, 'table-games', 'pod.json'),
      JSON.stringify(game),
    )
    expect(applyAdvance(root, 'pod', lobby, 'p1')).toBe(true)
    expect(replay(root).events.at(-1)).toMatchObject({
      phase: 'combat',
      state: { phase: 'combat' },
    })
    expect(lobby.actions).toEqual({ p1: ['plan', 'advance'] })
  })

  test('does not advance through an unresolved stack', () => {
    const { root, lobby } = fixture()
    expect(applyAdvance(root, 'pod', lobby, 'p1')).toBe(false)
  })
})

const turnOpen = (
  battlefield: Array<{ name: string; tapped?: boolean }> = [],
  catalog: Record<string, { oracle_text?: string }> = {},
) => {
  const { root, lobby } = fixture()
  const game = replay(root)
  game.catalog = catalog
  game.events = [{
    id: 40,
    turn: 2,
    phase: 'planning',
    seat: 'p1',
    kind: 'think',
    state: {
      active: 'p1',
      turn: 2,
      phase: 'planning',
      stack: [],
      players: {
        p1: { hand: ['Swamp'], battlefield, graveyard: [], library_count: 3 },
      },
    },
  }]
  writeFileSync(join(root, 'table-games', 'pod.json'), JSON.stringify(game))
  return { root, lobby }
}

describe('opening a turn', () => {
  test('untaps, draws, and lands in the first main phase', () => {
    const { root, lobby } = turnOpen([{ name: 'Shadowy Backstreet', tapped: true }])
    expect(applyAdvance(root, 'pod', lobby, 'p1')).toBe(true)
    const game = replay(root)
    expect(game.events.map((event: { phase: string }) => event.phase)).toEqual([
      'planning',
      'untap',
      'upkeep',
      'draw',
      'main1',
    ])
    const last = game.events.at(-1).state.players.p1
    expect(last.hand).toEqual(['Swamp', 'Teferi'])
    expect(last.battlefield).toEqual([
      { name: 'Shadowy Backstreet', tapped: false },
    ])
    expect(last.library_count).toBe(2)
    expect(game._libraries.p1).toEqual(['Cabal Coffers', 'Island'])
    expect(lobby.actions).toEqual({ p1: ['plan', 'advance'] })
    expect(lobby.privateJudge.p1).toBe('You drew Teferi.')
  })

  test('keeps the drawn card off the public judge note', () => {
    const { root, lobby } = turnOpen()
    applyAdvance(root, 'pod', lobby, 'p1')
    expect(lobby.judge).not.toContain('Teferi')
  })

  test('hands a turn with upkeep triggers back to the judge', () => {
    const { root, lobby } = turnOpen(
      [{ name: 'Phyrexian Arena' }],
      {
        'Phyrexian Arena': {
          oracle_text:
            'At the beginning of your upkeep, you draw a card and you lose 1 life.',
        },
      },
    )
    expect(() => applyAdvance(root, 'pod', lobby, 'p1')).toThrow(
      /Phyrexian Arena can trigger/,
    )
    expect(replay(root).events).toHaveLength(1)
  })

  test('does not draw twice for one turn', () => {
    const { root, lobby } = turnOpen()
    const game = replay(root)
    game.events.push({
      id: 41,
      turn: 2,
      phase: 'draw',
      seat: 'p1',
      kind: 'draw',
      summary: 'Foggy draws a card.',
      state: structuredClone(game.events[0].state),
    })
    game.events.at(-1).state.phase = 'planning'
    writeFileSync(join(root, 'table-games', 'pod.json'), JSON.stringify(game))
    expect(applyAdvance(root, 'pod', lobby, 'p1')).toBe(true)
    expect(replay(root)._libraries.p1).toEqual([
      'Teferi',
      'Cabal Coffers',
      'Island',
    ])
  })
})
