import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, mock, test } from 'bun:test'
import { mint } from './conduit'
import { ensureHostKeys } from './host'
import { applyInbox, createLobby, lobbyFromParts, restoreLobby } from './lobby'
import { BIN_LABELS } from './protocol'
import {
  journalInbox,
  loadSession,
  pidAlive,
  readJournal,
  saveKeys,
  saveSession,
} from './session'
import { encodeLobby } from './snapshot'

const fakeBins = () =>
  Object.fromEntries(
    BIN_LABELS.map((label) => [
      label,
      { read: `${label}-r`.padEnd(43, 'x'), write: `${label}-w`.padEnd(43, 'y') },
    ]),
  )

const mkdirGames = (root: string) => {
  writeFileSync(join(root, 'package.json'), '{}\n')
  mkdirSync(join(root, 'table-games'), { recursive: true })
}

describe('session', () => {
  test('save and load a host session', () => {
    const root = mkdtempSync(join(tmpdir(), 'live-runner-'))
    mkdirGames(root)
    saveSession(
      {
        role: 'host',
        slug: 'pod',
        origin: 'https://example.test',
        bins: fakeBins(),
        lastGen: { host: 1 },
        phase: 'gathering',
        occupants: {},
        firstPlayer: 'p1',
      },
      root,
    )
    expect(loadSession('pod', root)?.role).toBe('host')
  })

  test('a restored host keeps its seating instead of an empty lobby', () => {
    const root = mkdtempSync(join(tmpdir(), 'live-runner-'))
    mkdirGames(root)
    const lobby = createLobby('pod')
    applyInbox(lobby, 'p2', { type: 'join', name: 'Tea Party', deck: 'decks/tea' })
    saveSession(
      {
        role: 'host',
        slug: 'pod',
        origin: 'https://example.test',
        bins: fakeBins(),
        lastGen: { 'p2-inbox': 4 },
        phase: lobby.phase,
        occupants: lobby.occupants,
        firstPlayer: lobby.firstPlayer,
        lobby,
      },
      root,
    )
    const saved = loadSession('pod', root)
    const restored = restoreLobby(
      saved?.role === 'host' ? saved.lobby : undefined,
      'pod',
    )
    expect(restored.occupants.p2?.name).toBe('Tea Party')
    expect(restored.talk).toBe('')
    expect(restored.judge).toContain('joined as p2')
  })

  test('a session written before lobby state still resumes into play', () => {
    const legacy = lobbyFromParts({
      phase: 'play',
      occupants: { p1: { name: 'Borrowed Time', deck: 'decks/doctor' } },
      firstPlayer: 'p1',
    })
    expect(legacy.phase).toBe('play')
    expect(legacy.occupants.p1?.name).toBe('Borrowed Time')
    expect(legacy.active).toBe('p1')
  })

  test('inbox messages are journalled for the judge', () => {
    const root = mkdtempSync(join(tmpdir(), 'live-runner-'))
    mkdirGames(root)
    journalInbox('pod', { seat: 'p1', generation: 7, message: { type: 'ready' } }, root)
    journalInbox(
      'pod',
      { seat: 'p4', generation: 8, message: { type: 'talk', text: "I'll keep these 7" } },
      root,
    )
    const journal = readJournal('pod', root)
    expect(journal.map((entry) => entry.seat)).toEqual(['p1', 'p4'])
    expect(journal[1].message).toEqual({ type: 'talk', text: "I'll keep these 7" })
  })
})

describe('snapshot', () => {
  test('lobby payload is v2', () => {
    expect(encodeLobby(createLobby())).toStartWith('v2.')
  })
})

describe('conduit mint', () => {
  test('posts bins labels', async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://conduit.test/v1/mint')
      expect(JSON.parse(String(init?.body))).toEqual({ bins: [...BIN_LABELS] })
      return new Response(JSON.stringify({ bins: fakeBins() }), { status: 201 })
    })
    const original = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const result = await mint('https://conduit.test', 'secret')
      expect(result.bins.host.read.length).toBe(43)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('host keys', () => {
  test('does not mint when conduit json exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'live-runner-'))
    mkdirGames(root)
    saveKeys('pod', 'https://saved.test', fakeBins(), root)
    const fetchMock = mock(async () => {
      throw new Error('should not mint')
    })
    const original = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const keys = await ensureHostKeys('pod', root)
      expect(keys.minted).toBe(false)
      expect(keys.origin).toBe('https://saved.test')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('stop', () => {
  test('stale pid is not alive', () => {
    expect(pidAlive(999999999)).toBe(false)
  })
})
