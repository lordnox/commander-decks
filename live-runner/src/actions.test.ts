import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptsPlayAction, replayActions } from './actions'
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
})

