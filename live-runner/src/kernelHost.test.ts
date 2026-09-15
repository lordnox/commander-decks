import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  commanderRules,
  createJournal,
  createServerGame,
  forest,
} from '../../rules-engine/src/index'
import { createLobby } from './lobby'
import {
  applyKernelAdvance,
  kernelActions,
  kernelPath,
  kernelPriority,
  historyForViewer,
  loadHostCardPlugins,
  openKernel,
} from './kernelHost'

const mkdirGames = (root: string) => {
  writeFileSync(join(root, 'package.json'), '{}\n')
  mkdirSync(join(root, 'table-games'), { recursive: true })
}

const seedKernel = (
  root: string,
  slug = 'pod',
  adjust?: (state: ReturnType<typeof createServerGame>['state']) => void,
  stocked = false,
) => {
  const server = createServerGame(
    commanderRules,
    stocked
      ? {
          libraries: Object.fromEntries(
            (['p1', 'p2', 'p3', 'p4'] as const).map((seat) => [
              seat,
              Array.from({ length: 40 }, forest),
            ]),
          ),
        }
      : undefined,
    { random: () => 0.5, cardPlugins: [] },
  )
  const journal = createJournal(server.state)
  adjust?.(journal.initial)
  writeFileSync(kernelPath(slug, root), JSON.stringify(journal))
}

describe('kernel host journal', () => {
  test('play start persists and restores a pass', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-host-'))
    mkdirGames(root)
    seedKernel(root)
    const lobby = createLobby()
    lobby.phase = 'play'
    const first = await openKernel('pod', root, lobby)
    expect(readFileSync(kernelPath('pod', root), 'utf8')).toContain('rules-engine/v0')

    const seat = first.history.current().priority
    expect(seat).toBeTruthy()
    const passed = first.dispatch({ type: 'passPriority', seat: seat! })
    expect(passed.ok).toBe(true)

    const restored = await openKernel('pod', root, lobby)
    expect(restored.history.current().priority).toBe(first.history.current().priority)
    const priority = kernelPriority(restored.history.current())
    expect(priority).toBeTruthy()
    if (priority) {
      expect(kernelActions(restored.history.current())[priority]).toEqual(['plan', 'pass'])
    }
  })

  test('does not publish a blank kernel over a turn-zero replay', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-host-'))
    mkdirGames(root)
    writeFileSync(
      join(root, 'table-games', 'pod.json'),
      JSON.stringify({ events: [{ id: 0, turn: 0 }] }),
    )
    const lobby = createLobby()
    lobby.phase = 'play'

    await expect(openKernel('pod', root, lobby)).rejects.toThrow('reach turn one')
    expect(existsSync(kernelPath('pod', root))).toBe(false)
  })

  test('does not invent an empty game without setup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-host-'))
    mkdirGames(root)
    const lobby = createLobby()
    lobby.phase = 'play'

    await expect(openKernel('pod', root, lobby)).rejects.toThrow('waits for game setup')
    expect(existsSync(kernelPath('pod', root))).toBe(false)
  })

  test('loads generated card handlers from the current worktree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-plugins-'))
    mkdirSync(join(root, 'cards'), { recursive: true })
    mkdirSync(join(root, 'rules-engine', 'src', 'cardPlugins'), { recursive: true })
    writeFileSync(
      join(root, 'cards', 'rules-plugins.json'),
      JSON.stringify({
        oracle: {
          name: 'Test Card',
          pluginIds: [],
          handlerIds: ['testHandler'],
        },
      }),
    )
    const handlerPath = join(
      root,
      'rules-engine',
      'src',
      'cardPlugins',
      'testHandler.ts',
    )
    writeFileSync(handlerPath, "export const testHandler = { id: 'testHandler', version: 1 }\n")

    const first = await loadHostCardPlugins(root)
    expect(first.map((plugin) => plugin.id)).toEqual(['testHandler'])
    expect((first[0] as typeof first[0] & { version: number }).version).toBe(1)

    writeFileSync(handlerPath, "export const testHandler = { id: 'testHandler', version: 2 }\n")
    const reloaded = await loadHostCardPlugins(root)
    expect((reloaded[0] as typeof reloaded[0] & { version: number }).version).toBe(2)
  })

  test('bounds published history frames', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-history-'))
    mkdirGames(root)
    // Forty pass rounds outlive a seven card hand, and this test is about
    // frame bounds rather than the cleanup discard rule.
    seedKernel(
      root,
      'pod',
      (state) => {
        for (const seat of state.playerOrder) state.players[seat].data.maximumHandSize = null
      },
      true,
    )
    const lobby = createLobby()
    lobby.phase = 'play'
    const kernel = await openKernel('pod', root, lobby)

    for (let index = 0; index < 40; index += 1) {
      const priority = kernelPriority(kernel.history.current())
      expect(priority).toBeTruthy()
      if (priority) expect(kernel.dispatch({ type: 'passPriority', seat: priority }).ok).toBe(true)
    }

    expect(historyForViewer(kernel, lobby, 'p1')).toHaveLength(32)
  })

  test('advances a coarse phase through the kernel without a judge round', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-advance-'))
    mkdirGames(root)
    const server = createServerGame(
      commanderRules,
      { first: 'p1' },
      { random: () => 0.5, cardPlugins: [] },
    )
    const journal = createJournal(server.state)
    journal.initial.step = 'precombatMain'
    writeFileSync(kernelPath('pod', root), JSON.stringify(journal))
    const lobby = createLobby()
    lobby.phase = 'play'
    lobby.occupants.p1 = { name: 'Active player', deck: 'deck' }
    const kernel = await openKernel('pod', root, lobby)

    expect(kernelActions(kernel.history.current()).p1).toContain('advance')
    expect(applyKernelAdvance(kernel, lobby, 'p1')).toBe(true)
    expect(kernel.history.current().step).toBe('beginCombat')
    expect(kernel.journal.events.at(-1)).toEqual({ type: 'advanceStep' })
    expect(lobby.actions.p1).toContain('advance')
  })
})
