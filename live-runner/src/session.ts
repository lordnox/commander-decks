import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BinPair, LobbyPhase, SeatId } from './protocol'
import type { Occupant } from './lobby'
import { SEAT_IDS } from './protocol'

export type HostSession = {
  role: 'host'
  slug: string
  origin: string
  bins: Record<string, BinPair>
  lastGen: Record<string, number>
  phase: LobbyPhase
  occupants: Partial<Record<SeatId, Occupant>>
  firstPlayer: SeatId
  pid?: number
}

export type SeatSession = {
  role: 'seat'
  slug: string
  origin: string
  read: string
  mailbox?: string
  lastGen: number
  pid?: number
}

export type RunnerSession = HostSession | SeatSession

export const repoRoot = (start = fileURLToPath(new URL('.', import.meta.url))) => {
  let dir = start
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'table-games'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

export const sessionPath = (slug: string, root = repoRoot()) =>
  join(root, 'table-games', `${slug}.runner.json`)

export const pidPath = (slug: string, root = repoRoot()) =>
  join(root, 'table-games', `${slug}.runner.pid`)

export const logPath = (slug: string, root = repoRoot()) =>
  join(root, 'table-games', `${slug}.runner.log`)

export const keysPath = (slug: string, root = repoRoot()) =>
  join(root, 'table-games', `${slug}.conduit.json`)

export const loadSession = (slug: string, root = repoRoot()) => {
  const path = sessionPath(slug, root)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as RunnerSession
}

export const saveSession = (session: RunnerSession, root = repoRoot()) => {
  const path = sessionPath(session.slug, root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`)
}

export const loadKeys = (slug: string, root = repoRoot()) => {
  const path = keysPath(slug, root)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as {
    origin: string
    bins: Record<string, BinPair>
  }
}

export const saveKeys = (
  slug: string,
  origin: string,
  bins: Record<string, BinPair>,
  root = repoRoot(),
) => {
  const path = keysPath(slug, root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ origin, bins }, null, 2)}\n`)
}

export const writePid = (slug: string, pid: number, root = repoRoot()) => {
  writeFileSync(pidPath(slug, root), `${pid}\n`)
}

export const readPid = (slug: string, root = repoRoot()) => {
  const path = pidPath(slug, root)
  if (!existsSync(path)) return null
  const value = Number(readFileSync(path, 'utf8').trim())
  return Number.isFinite(value) ? value : null
}

export const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const emptyLastGen = () => {
  const lastGen: Record<string, number> = {}
  for (const seat of SEAT_IDS) lastGen[`${seat}-inbox`] = 0
  lastGen.host = 0
  return lastGen
}
