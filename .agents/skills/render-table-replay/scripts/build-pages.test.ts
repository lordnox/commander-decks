import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publicGame, rankGames } from './build-pages'
import type { ReplayGame } from '../../../../site/src/replayTypes'

describe('rankGames', () => {
  test('newest first, oldest is index 1', () => {
    const ranked = rankGames([
      { slug: 'old', played_at: '2026-09-04T15:15:04+02:00' },
      { slug: 'new', played_at: '2026-09-06T20:12:28+02:00' },
      { slug: 'mid', played_at: '2026-09-05T20:30:55+02:00' },
    ])
    expect(ranked.map((game) => game.slug)).toEqual(['new', 'mid', 'old'])
    expect(ranked.map((game) => game.index)).toEqual([3, 2, 1])
  })

  test('slug breaks ties', () => {
    const ranked = rankGames([
      { slug: 'b-game', played_at: '2026-09-06T12:00:00Z' },
      { slug: 'a-game', played_at: '2026-09-06T12:00:00Z' },
    ])
    expect(ranked.map((game) => game.slug)).toEqual(['b-game', 'a-game'])
    expect(ranked.map((game) => game.index)).toEqual([2, 1])
  })
})

const writeGame = (game: Partial<ReplayGame> & { catalog?: ReplayGame['catalog'] }) => {
  const dir = mkdtempSync(join(tmpdir(), 'build-pages-'))
  const log = join(dir, 'sample-table.json')
  writeFileSync(log, JSON.stringify(game))
  return log
}

describe('publicGame', () => {
  test('compacts index metadata from a replay log', async () => {
    const log = writeGame({
      headline: 'Tea time',
      seed: 1729,
      played_at: '2026-09-06T12:00:00Z',
      result: {
        winner: 'p2',
        ended: 'win',
        turn: 8,
        summary: 'Hazel wins',
      },
      seats: [
        {
          id: 'p1',
          name: 'Atticus',
          deck: 'decks/a',
          commanders: ['Osgir, the Reconstructor'],
          plan: '',
          mulligans: 0,
          color: '#111111',
        },
        {
          id: 'p2',
          name: 'Hazel',
          deck: 'decks/b',
          commanders: ['Hazel of the Rootbloom'],
          plan: '',
          mulligans: 0,
          color: '',
        },
      ],
      catalog: {
        'Osgir, the Reconstructor': {
          image_normal: 'https://img.example/osgir-normal.jpg',
          image_small: 'https://img.example/osgir-small.jpg',
        },
        'Hazel of the Rootbloom': {
          image_small: 'https://img.example/hazel-small.jpg',
        },
      },
    })

    expect(await publicGame(log)).toEqual({
      slug: 'sample-table',
      headline: 'Tea time',
      summary: 'Hazel wins',
      seed: 1729,
      turn: 8,
      ended: 'win',
      winner: 'Hazel',
      played_at: '2026-09-06T12:00:00+00:00',
      seats: [
        {
          id: 'p1',
          name: 'Atticus',
          commander: 'Osgir, the Reconstructor',
          color: '#111111',
          image: 'https://img.example/osgir-normal.jpg',
        },
        {
          id: 'p2',
          name: 'Hazel',
          commander: 'Hazel of the Rootbloom',
          color: '#7aa89a',
          image: 'https://img.example/hazel-small.jpg',
        },
      ],
    })
  })

  test('falls back to result summary, unknown end, and no winner', async () => {
    const log = writeGame({
      headline: '',
      seed: 1,
      played_at: '2026-09-04T15:15:04+02:00',
      result: {
        winner: null,
        ended: '' as ReplayGame['result']['ended'],
        turn: 3,
        summary: 'Truncated mid-combo',
      },
      seats: [],
      catalog: {},
    })

    const game = await publicGame(log)
    expect(game.headline).toBe('Truncated mid-combo')
    expect(game.ended).toBe('unknown')
    expect(game.winner).toBeNull()
    expect(game.played_at).toBe('2026-09-04T15:15:04+02:00')
    expect(game.seats).toEqual([])
  })
})
