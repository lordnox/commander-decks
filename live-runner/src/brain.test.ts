import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertGameAuthority,
  enforceResultPolicy,
  normalizeKernelResult,
  redactHiddenCards,
  redactHiddenCardsFromKernel,
  shouldPersistKernelChange,
} from './brain'

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

  test('redacts hidden names when only a kernel journal exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'live-brain-kernel-test-'))
    roots.push(root)
    const journal = join(root, 'game.kernel.json')
    writeFileSync(journal, JSON.stringify({
      initial: {
        objects: {
          o1: { name: 'Reverse the Polarity', zone: 'hand' },
          o2: { name: 'Forest', zone: 'battlefield' },
        },
      },
    }))

    expect(redactHiddenCardsFromKernel(
      'Reverse the Polarity is available; Forest is public.',
      journal,
    )).toBe('a hidden card is available; Forest is public.')
  })
})

describe('host result policy', () => {
  test('rejects replay writes once the kernel is authoritative', () => {
    expect(() => assertGameAuthority({
      kernelExists: true,
      replayChangedOnDisk: true,
    })).toThrow('kernel is authoritative')
    expect(() => assertGameAuthority({
      kernelExists: false,
      replayChangedOnDisk: true,
    })).not.toThrow()
  })

  test('treats replayChanged as a stale result flag in kernel mode', () => {
    expect(normalizeKernelResult({ replayChanged: true }, true)).toEqual({
      replayChanged: false,
    })
    expect(normalizeKernelResult({ replayChanged: true }, false)).toEqual({
      replayChanged: true,
    })
  })

  test('only confirmation may persist a changed kernel journal', () => {
    expect(shouldPersistKernelChange({ type: 'plan', text: 'Cast a spell.' }, true)).toBe(false)
    expect(shouldPersistKernelChange({ type: 'replace', text: 'Pass instead.' }, true)).toBe(false)
    expect(shouldPersistKernelChange({ type: 'rules', text: 'Does this trigger?' }, true)).toBe(false)
    expect(shouldPersistKernelChange({ type: 'confirm' }, true)).toBe(true)
  })

  test('never executes a plan before confirmation', () => {
    expect(enforceResultPolicy(
      {
        judge: 'The line is legal.',
        waiting: 'Priority is open.',
        replayChanged: true,
      },
      { type: 'plan', text: 'Play a Plains.' },
      'p4',
    )).toEqual({
      judge: 'The host rejected a state change attempted while checking a plan.',
      waiting: 'p4: send a replacement plan. Nothing was executed.',
      replayChanged: false,
      allowedActions: ['replace'],
    })
  })

  test('allows a confirmed line to change the replay', () => {
    const result = { replayChanged: true }
    expect(enforceResultPolicy(
      result,
      { type: 'confirm', actionId: 3 },
      'p1',
    )).toBe(result)
  })

  test('rejects a kernel mutation during plan even without replayChanged', () => {
    expect(enforceResultPolicy(
      { privateJudge: 'The line is legal.' },
      { type: 'plan', text: 'Play a Plains.' },
      'p4',
      true,
    )).toMatchObject({
      judge: 'The host rejected a state change attempted while checking a plan.',
      waiting: 'p4: send a replacement plan. Nothing was executed.',
      allowedActions: ['replace'],
    })
  })
})
