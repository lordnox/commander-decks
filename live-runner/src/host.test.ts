import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  commanderRules,
  createJournal,
  createServerGame,
} from '../../rules-engine/src/index'
import { createLobby } from './lobby'
import { actionsAfterJudgment, applyKernelPass } from './host'
import { kernelPath, kernelPriority, openKernel } from './kernelHost'

const setup = async () => {
  const root = mkdtempSync(join(tmpdir(), 'kernel-host-actions-'))
  mkdirSync(join(root, 'table-games'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}\n')
  const server = createServerGame(
    commanderRules,
    undefined,
    { random: () => 0.5, cardPlugins: [] },
  )
  writeFileSync(kernelPath('pod', root), JSON.stringify(createJournal(server.state)))
  const lobby = createLobby()
  lobby.phase = 'play'
  const kernel = await openKernel('pod', root, lobby)
  return { kernel, lobby }
}

describe('kernel host actions', () => {
  test('a failed kernel pass remains handled and leaves priority on the kernel seat', async () => {
    const { kernel, lobby } = await setup()
    expect(kernelPriority(kernel.history.current())).toBe('p1')

    expect(applyKernelPass(kernel, lobby, 'p2')).toBe(false)
    expect(kernel.journal.events).toHaveLength(0)
    expect(lobby.actions).toEqual({ p1: ['plan', 'pass'] })
    expect(lobby.judge).toContain('Pass rejected')
  })

  test('confirm keeps kernel priority actions even if a replay change was reported', async () => {
    const { kernel } = await setup()
    expect(applyKernelPass(kernel, createLobby(), 'p1')).toBe(true)
    let legacyCalled = false

    const actions = actionsAfterJudgment({
      current: { p1: ['confirm', 'replace'] },
      message: { type: 'confirm' },
      seat: 'p1',
      result: { replayChanged: true },
      kernel,
      legacy: () => {
        legacyCalled = true
        return { p4: ['plan'] }
      },
    })

    expect(actions).toEqual({ p2: ['plan', 'pass'] })
    expect(legacyCalled).toBe(false)
  })
})
