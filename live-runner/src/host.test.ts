import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  commanderRules,
  createJournal,
  createServerGame,
} from '../../rules-engine/src/index'
import { acceptsPlayAction } from './actions'
import { createLobby } from './lobby'
import {
  actionsAfterJudgment,
  applyHostControl,
  applyKernelPass,
  beginJudgeRound,
  isHostControlMessage,
  needsJudgment,
  restoreKernelWindow,
} from './host'
import { kernelActions, kernelPath, kernelPriority, openKernel } from './kernelHost'

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
  test('automation controls update host state without a judge round', () => {
    const lobby = createLobby()
    lobby.phase = 'play'
    lobby.judge = 'Eva submitted a plan and is conferring with the judge.'

    const hold = { type: 'hold', until: 'my-turn' } as const
    expect(isHostControlMessage(hold)).toBe(true)
    expect(needsJudgment(hold)).toBe(false)
    applyHostControl(lobby, 'p4', hold)

    expect(lobby.holds.p4).toBe(true)
    expect(lobby.judge).toBe('Eva submitted a plan and is conferring with the judge.')

    applyHostControl(lobby, 'p4', { type: 'hold', until: 'off' })
    applyHostControl(lobby, 'p4', { type: 'priority-mode', always: true })
    expect(lobby.holds.p4).toBe(false)
    expect(lobby.alwaysStopOnPriority.p4).toBe(true)
  })

  test('a failed kernel pass remains handled and leaves priority on the kernel seat', async () => {
    const { kernel, lobby } = await setup()
    expect(kernelPriority(kernel.history.current())).toBe('p1')

    expect(applyKernelPass(kernel, lobby, 'p2')).toBe(false)
    expect(kernel.journal.events).toHaveLength(0)
    expect(lobby.actions).toEqual({ p1: ['plan', 'pass', 'act', 'advance'] })
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

    expect(actions).toEqual(kernelActions(kernel.history.current()))
    expect(legacyCalled).toBe(false)
  })

  test('a seat waiting on the judge is offered no stale buttons', () => {
    const lobby = createLobby()
    lobby.phase = 'play'
    lobby.occupants.p4 = { name: 'Sin-fall', deck: 'decks/sin' }
    lobby.actions = { p4: ['plan', 'pass', 'advance'] }

    const previous = beginJudgeRound(lobby, 'p4', { type: 'plan', text: 'cast it' })

    expect(lobby.actions.p4).toEqual([])
    expect(lobby.privateWaiting.p4).toContain('Nothing to do')
    expect(lobby.judge).toBe('Sin-fall submitted a plan and is conferring with the judge.')
    expect(acceptsPlayAction(lobby, 'p4', { type: 'pass', actionId: 0 })).toBe(false)
    expect(previous.p4).toEqual(['plan', 'pass', 'advance'])
  })

  test('a restored private choice keeps its dialog action', async () => {
    const { kernel, lobby } = await setup()
    lobby.topdeck = {
      seat: 'p4',
      kind: 'scry',
      cards: ['Island'],
      destinations: ['top', 'bottom'],
      kernel: {
        sourceId: 'spell',
        stage: 'scry',
        resumePassSeat: 'p3',
      },
    }

    restoreKernelWindow(kernel, lobby)

    expect(lobby.actions).toEqual({ p4: ['topdeck'] })
    expect(lobby.waiting).toContain('private scry choice')
    expect(lobby.privateWaiting.p4).toContain('pending scry choice')
  })

  test('the kernel window replaces a stale judge prompt', async () => {
    const { kernel, lobby } = await setup()
    lobby.occupants.p1 = { name: 'Eva', deck: 'decks/eva' }
    lobby.waiting = 'Sin: send a plan, pass, or advance.'
    lobby.privateWaiting = { p4: 'Sin still has priority.' }

    restoreKernelWindow(kernel, lobby)

    expect(lobby.waiting).toBe('p2 (p2): act, pass, or advance.')
    expect(lobby.waiting).not.toContain('Sin')
    expect(lobby.privateWaiting).toEqual({})
  })

  test('table talk and lobby bookkeeping never occupy the judge', () => {
    expect(needsJudgment({ type: 'talk', text: 'nice board' })).toBe(false)
    expect(needsJudgment({ type: 'ready' })).toBe(false)
    expect(needsJudgment({ type: 'plan', text: 'attack with Sygg' })).toBe(true)
    expect(needsJudgment({ type: 'rules', text: 'does this trigger?' })).toBe(true)
  })
})
