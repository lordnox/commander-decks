import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { redactHiddenCards } from './brain'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('public judge notes', () => {
  test('redacts names still present in player hands', () => {
    const root = mkdtempSync(join(tmpdir(), 'live-brain-test-'))
    roots.push(root)
    const replay = join(root, 'game.json')
    writeFileSync(replay, JSON.stringify({
      events: [{
        state: {
          players: {
            p1: { hand: ['Reverse the Polarity', 'Forest'] },
            p2: { hand: [] },
          },
        },
      }],
    }))

    expect(redactHiddenCards(
      'Reverse the Polarity needs blue; FOREST does not help.',
      replay,
    )).toBe('a hidden card needs blue; a hidden card does not help.')
  })
})
