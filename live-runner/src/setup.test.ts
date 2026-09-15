import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { BIN_LABELS } from './protocol'
import {
  createPlaySession,
  liveLinks,
  loadReplaySeats,
  parseSetupArgs,
} from './setup'

const bins = Object.fromEntries(
  BIN_LABELS.map((label) => [
    label,
    {
      read: `${label}-read`.padEnd(43, 'r'),
      write: `${label}-write`.padEnd(43, 'w'),
    },
  ]),
)

const replay = {
  seats: [
    { id: 'p1', name: 'Human', deck: 'decks/human' },
    { id: 'p2', name: 'Agent two', deck: 'decks/two' },
    { id: 'p3', name: 'Agent three', deck: 'decks/three' },
    { id: 'p4', name: 'Agent four', deck: 'decks/four' },
  ],
  events: [{
    kind: 'think',
    seat: 'p3',
    state: { active: 'p3' },
  }],
} as const

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'live-setup-'))
  mkdirSync(join(root, 'table-games'))
  writeFileSync(
    join(root, 'table-games', 'pod.json'),
    JSON.stringify(replay),
  )
  return root
}

describe('live setup', () => {
  test('parses the short agent-friendly command', () => {
    expect(parseSetupArgs(['--slug', 'pod', '--you', 'p3'])).toEqual({
      slug: 'pod',
      you: 'p3',
      noAgent: false,
    })
  })

  test('opens a dealt replay directly in play mode', () => {
    const root = fixture()
    const loaded = loadReplaySeats('pod', root)
    const session = createPlaySession(
      'pod',
      root,
      'https://conduit.test',
      bins,
      loaded.replay,
      loaded.seats,
      true,
      'p3',
    )

    expect(session.phase).toBe('play')
    expect(session.agent).toBe(true)
    expect(session.lobby?.active).toBe('p3')
    expect(session.lobby?.human).toBe('p3')
    expect(session.lobby?.occupants.p1?.name).toBe('Human')
    expect(session.lobby?.actions).toEqual({ p3: ['plan'] })
  })

  test('opens a dealt setup replay on keep or mulligan', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'table-games', 'pod.json'),
      JSON.stringify({
        ...replay,
        events: [{
          kind: 'keep',
          seat: 'p1',
          state: { active: 'p1', phase: 'setup' },
        }],
      }),
    )
    const loaded = loadReplaySeats('pod', root)
    const session = createPlaySession(
      'pod',
      root,
      'https://conduit.test',
      bins,
      loaded.replay,
      loaded.seats,
      true,
      'p1',
    )
    expect(session.lobby?.opening).toEqual({ seat: 'p1' })
    expect(session.lobby?.actions).toEqual({ p1: ['keep', 'mulligan'] })
    expect(session.lobby?.waiting).toContain('keep or mulligan')
  })

  test('prints a private human link and credential-free public link', () => {
    const links = liveLinks('https://conduit.test', bins, 'p2')
    const privateUrl = new URL(links.private)
    const publicUrl = new URL(links.public)

    expect(privateUrl.searchParams.get('k')).toBe(
      `${bins.p2.read}|${bins['p2-inbox'].write}`,
    )
    expect(publicUrl.searchParams.get('k')).toBe(bins.host.read)
    expect(publicUrl.toString()).not.toContain(bins['p2-inbox'].write)
  })
})
