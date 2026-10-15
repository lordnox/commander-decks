import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASELINE_PATH, inspectRepository } from './check'
import { checkRepository } from './repository'

test('trusted git baseline rejects self-authorized growth and permits migration pruning', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsl-authoring-'))
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: root })
    if (result.exitCode) throw new Error(result.stderr.toString())
  }
  const write = (path: string, text: string) => writeFileSync(join(root, path), text)
  const baseline = () => write(BASELINE_PATH, JSON.stringify(inspectRepository(root)))
  const registry = 'rules-engine/src/cardPlugins/cardRules.ts'
  try {
    for (const path of ['rules-engine/src/cardPlugins/dsl', 'rules-engine/migration', 'live-runner/src', 'site/src', 'shared', '.agents']) mkdirSync(join(root, path), { recursive: true })
    git('init', '-q')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'Test')
    write(registry, 'export const CARD_RULES = { Old: [draw(1)] }')
    git('add', '.')
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Initial compatibility source')
    baseline()
    // First installation derives trust from source, not the newly written baseline.
    expect(checkRepository(root, 'HEAD').errors).toEqual([])
    write(registry, 'export const CARD_RULES = { Old: [draw(1)], New: [draw(2)] }')
    baseline()
    expect(checkRepository(root, 'HEAD').errors.some((error) => error.startsWith('Baseline growth:'))).toBe(true)
    write(registry, 'export const CARD_RULES = { Old: [draw(1)] }')
    baseline()
    git('add', '.')
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Install baseline')
    // Subsequent installations trust the previous baseline, and fail on enlargement.
    write(registry, 'export const CARD_RULES = { Old: [draw(1)], New: [draw(2)] }')
    baseline()
    expect(checkRepository(root, 'HEAD').errors.some((error) => error.startsWith('Baseline growth:'))).toBe(true)
    write(registry, 'export const CARD_RULES = {}')
    write('rules-engine/src/cardPlugins/dsl/new.ts', 'export const definition = card([spell({ instructions: [draw({ count: 1 })] })])')
    baseline()
    expect(checkRepository(root, 'HEAD').errors).toEqual([])
    expect(() => checkRepository(root, 'missing-trusted-ref')).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
