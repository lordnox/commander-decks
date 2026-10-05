#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import type { ReplayGame } from '../../../../site/src/replayTypes'
import { REPLAYS, ROOT, replayPaths } from './render-replay'

const gamesJson = join(ROOT, 'site/public/games.json')
const defaultColor = '#7aa89a'
const offsetPattern = /[+-]\d{2}:\d{2}$/

export type IndexSeat = {
  id: string
  name: string
  commander: string
  color: string
  image: string
}

export type IndexGame = {
  slug: string
  headline: string
  summary: string
  seed: number | null
  turn: number | null
  ended: 'win' | 'draw' | 'truncated' | 'unknown'
  winner: string | null
  played_at: string
  index?: number
  seats: IndexSeat[]
}

const parsePlayedAtMs = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return undefined
  let text = value.trim()
  if (text.endsWith('Z')) text = `${text.slice(0, -1)}+00:00`
  else if (!offsetPattern.test(text)) text = `${text}+00:00`
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? undefined : ms
}

const toIso = (value: string) => {
  const text = value.trim()
  if (text.endsWith('Z')) return `${text.slice(0, -1)}+00:00`
  if (!offsetPattern.test(text)) return `${text}+00:00`
  return text
}

const utcIso = (date: Date) => date.toISOString().replace(/Z$/, '+00:00').replace('.000+', '+')

const gitAddedAt = (log: string) => {
  try {
    const result = Bun.spawnSync(
      [
        'git',
        'log',
        '--follow',
        '--diff-filter=A',
        '--format=%aI',
        '--',
        relative(ROOT, log),
      ],
      { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
    )
    const lines = new TextDecoder()
      .decode(result.stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return lines.at(-1)
  } catch {
    return undefined
  }
}

const fileMtimeIso = (log: string) => utcIso(new Date(statSync(log).mtimeMs))

const playedAtIso = (log: string, game: ReplayGame) => {
  if (parsePlayedAtMs(game.played_at) !== undefined) return toIso(game.played_at as string)
  const added = gitAddedAt(log)
  if (added && parsePlayedAtMs(added) !== undefined) return toIso(added)
  return fileMtimeIso(log)
}

const commanderArt = (game: ReplayGame, commander: string) => {
  const entry = game.catalog?.[commander]
  return entry?.image_normal || entry?.image_small || ''
}

export const rankGames = <T extends { played_at?: string; slug?: string }>(games: T[]) => {
  const ranked = [...games].sort((left, right) => {
    const byTime =
      (parsePlayedAtMs(left.played_at) ?? Number.NEGATIVE_INFINITY) -
      (parsePlayedAtMs(right.played_at) ?? Number.NEGATIVE_INFINITY)
    if (byTime) return byTime
    const leftSlug = left.slug || ''
    const rightSlug = right.slug || ''
    if (leftSlug < rightSlug) return -1
    if (leftSlug > rightSlug) return 1
    return 0
  })
  return ranked
    .map((game, index) => ({ ...game, index: index + 1 }))
    .reverse()
}

export const publicGame = async (log: string): Promise<IndexGame> => {
  const game = JSON.parse(await readFile(log, 'utf8')) as ReplayGame
  const result = game.result ?? ({} as ReplayGame['result'])
  const seats = game.seats ?? []
  const winner = seats.find((seat) => seat.id === result.winner)

  return {
    slug: basename(log, '.json'),
    headline: game.headline || result.summary || basename(log, '.json'),
    summary: result.summary || '',
    seed: game.seed ?? null,
    turn: result.turn ?? null,
    ended: result.ended || 'unknown',
    winner: winner?.name ?? null,
    played_at: playedAtIso(log, game),
    seats: seats.map((seat) => {
      const commanders = seat.commanders?.length ? seat.commanders : undefined
      return {
        id: seat.id,
        name: seat.name || seat.id,
        commander: (commanders ?? ['Unknown'])[0],
        color: seat.color || defaultColor,
        image: commanderArt(game, (commanders ?? [''])[0]),
      }
    }),
  }
}

export const main = async () => {
  let logs: string[]
  try {
    logs = await replayPaths([])
  } catch (error) {
    console.error(`ERROR: ${(error as Error).message}`)
    return 1
  }

  const missing = logs
    .map((log) => join(REPLAYS, `${basename(log, '.json')}.json`))
    .filter((replay) => !existsSync(replay))
  if (missing.length) {
    for (const replay of missing) {
      console.error(
        `ERROR: missing ${relative(ROOT, replay)}; run bun run table:render`,
      )
    }
    return 1
  }

  const slugs = new Set(logs.map((log) => basename(log, '.json')))
  if (existsSync(REPLAYS)) {
    const glob = new Bun.Glob('*.json')
    const stale: string[] = []
    for await (const name of glob.scan({ cwd: REPLAYS, onlyFiles: true })) {
      if (!slugs.has(basename(name, '.json'))) stale.push(name)
    }
    for (const name of stale.sort()) {
      console.error(`WARNING: ${relative(ROOT, join(REPLAYS, name))} has no replay JSON`)
    }
  }

  const games = rankGames(await Promise.all(logs.map((log) => publicGame(log))))
  await mkdir(dirname(gamesJson), { recursive: true })
  await writeFile(gamesJson, `${JSON.stringify(games, null, 2)}\n`, 'utf8')
  console.log(relative(ROOT, gamesJson))
  return 0
}

if (import.meta.main) process.exit(await main())
