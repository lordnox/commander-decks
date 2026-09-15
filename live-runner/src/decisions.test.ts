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
