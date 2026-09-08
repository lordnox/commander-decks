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
  acceptsPlayAction,
  applyDeterministicPass,
  replayActions,
} from './actions'
import { createLobby } from './lobby'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const rootWithEvent = (event: object) => {
  const root = mkdtempSync(join(tmpdir(), 'live-actions-'))
  roots.push(root)
  mkdirSync(join(root, 'table-games'))
  writeFileSync(
    join(root, 'table-games', 'test.json'),
    JSON.stringify({ events: [event] }),
  )
  return root
}

describe('play actions', () => {
  test('keeps concurrent priority responders independently actionable', () => {
    const state = createLobby()
    const root = rootWithEvent({
      kind: 'priority',
      seats: ['p2', 'p3'],
      state: { active: 'p1' },
    })

    expect(replayActions(root, 'test', state)).toEqual({
      p2: ['plan', 'pass'],
      p3: ['plan', 'pass'],
    })
  })

  test('asks only the active seat for a plan outside priority', () => {
    const state = createLobby()
    const root = rootWithEvent({
      kind: 'note',
      seat: 'p3',
      state: { active: 'p4' },
    })

    expect(replayActions(root, 'test', state)).toEqual({
      p4: ['plan'],
    })
  })

  test('rejects stale and unavailable actions', () => {
    const state = createLobby()
    state.actions = {
      p2: ['plan', 'pass'],
      p3: ['confirm', 'replace'],
    }
    state.actionIds = { p1: 0, p2: 4, p3: 7, p4: 0 }

    expect(acceptsPlayAction(
      state,
      'p2',
      { type: 'pass', actionId: 4 },
    )).toBe(true)
    expect(acceptsPlayAction(
      state,
      'p2',
      { type: 'pass', actionId: 3 },
    )).toBe(false)
    expect(acceptsPlayAction(
      state,
      'p3',
      { type: 'pass', actionId: 7 },
    )).toBe(false)
    expect(acceptsPlayAction(
      state,
      'p3',
      { type: 'confirm', actionId: 7 },
    )).toBe(true)
  })

  test('records intermediate passes without judging the unchanged window', () => {
    const state = createLobby()
    state.occupants = {
      p1: { name: 'Alpha', deck: 'decks/a' },
      p2: { name: 'Beta', deck: 'decks/b' },
      p3: { name: 'Gamma', deck: 'decks/c' },
    }
    state.actions = {
      p1: ['plan', 'pass'],
      p2: ['plan', 'pass'],
      p3: ['plan', 'pass'],
    }
    const root = rootWithEvent({
      id: 9,
      turn: 2,
      kind: 'priority',
      summary: 'End step priority: Alpha, Beta, and Gamma may respond.',
      seats: ['p1', 'p2', 'p3'],
      state: { active: 'p1', turn: 2, phase: 'priority', players: {} },
    })

    expect(applyDeterministicPass(root, 'test', state, 'p2')).toBe(true)
    const replay = JSON.parse(
      readFileSync(join(root, 'table-games', 'test.json'), 'utf8'),
    )
    expect(replay.events.at(-2)).toMatchObject({
      id: 10,
      seat: 'p2',
      kind: 'pass',
    })
    expect(replay.events.at(-1)).toMatchObject({
      id: 11,
      kind: 'priority',
      seats: ['p1', 'p3'],
    })
    expect(replay.events.at(-1).summary).toContain('Alpha and Gamma')
  })

  test('finishes an empty end step on the correct round', () => {
    const state = createLobby()
    state.firstPlayer = 'p1'
    state.occupants = {
      p1: { name: 'Alpha', deck: 'decks/a' },
      p2: { name: 'Beta', deck: 'decks/b' },
    }
    state.actions = { p4: ['plan', 'pass'] }
    const root = rootWithEvent({
      id: 3,
      turn: 2,
      kind: 'priority',
      summary: 'End step priority: Delta may respond or pass.',
      seats: ['p4'],
      state: { active: 'p1', turn: 2, phase: 'priority', stack: [] },
    })

    expect(applyDeterministicPass(root, 'test', state, 'p4')).toBe(true)
    const replay = JSON.parse(
      readFileSync(join(root, 'table-games', 'test.json'), 'utf8'),
    )
    expect(replay.events.at(-1)).toMatchObject({
      id: 6,
      turn: 2,
      phase: 'planning',
      seat: 'p2',
      summary: 'Turn 2 — Beta to act.',
      state: {
        active: 'p2',
        turn: 2,
        phase: 'planning',
      },
    })
  })

  test('leaves a final stack pass for the judge', () => {
    const state = createLobby()
    state.actions = { p4: ['plan', 'pass'] }
    const root = rootWithEvent({
      id: 3,
      kind: 'priority',
      summary: 'Stack priority: Delta may respond or pass.',
      seats: ['p4'],
      state: { active: 'p1', stack: ['Spell'] },
    })

    expect(applyDeterministicPass(root, 'test', state, 'p4')).toBe(false)
  })
})

