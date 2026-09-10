import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createLobby } from './lobby'
import { kernelActions, kernelPath, kernelPriority, openKernel } from './kernelHost'

const mkdirGames = (root: string) => {
  writeFileSync(join(root, 'package.json'), '{}\n')
  mkdirSync(join(root, 'table-games'), { recursive: true })
}

describe('kernel host journal', () => {
  test('play start persists and restores a pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-host-'))
    mkdirGames(root)
    const lobby = createLobby()
    lobby.phase = 'play'
    const first = openKernel('pod', root, lobby)
    expect(readFileSync(kernelPath('pod', root), 'utf8')).toContain('rules-engine/v0')

    const seat = first.history.current().priority
    expect(seat).toBeTruthy()
    const passed = first.dispatch({ type: 'passPriority', seat: seat! })
    expect(passed.ok).toBe(true)

    const restored = openKernel('pod', root, lobby)
    expect(restored.history.current().priority).toBe(first.history.current().priority)
    const priority = kernelPriority(restored.history.current())
    expect(priority).toBeTruthy()
    if (priority) {
      expect(kernelActions(restored.history.current())[priority]).toEqual(['plan', 'pass'])
    }
  })
})
