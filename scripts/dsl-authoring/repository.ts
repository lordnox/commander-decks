import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Finding } from './check'
import { BASELINE_PATH, compareFindings, inspectRepository, inspectSource } from './check'

export const checkRepository = (root: string, base?: string) => {
  const baseline: Finding[] = JSON.parse(readFileSync(resolve(root, BASELINE_PATH), 'utf8'))
  const errors = compareFindings(inspectRepository(root), baseline)
  if (base) {
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], { cwd: root })
      if (result.exitCode !== 0) throw new Error(result.stderr.toString())
      return result.stdout.toString()
    }
    // Always apply today's detector to the trusted source tree. This lets a
    // detector correction add allowances for old source, never for new behavior.
    const trusted = git('ls-tree', '-r', '--name-only', base, 'rules-engine/src', 'live-runner/src', 'site/src', 'shared', '.agents')
      .trim().split('\n').filter((path) => /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path))
      .flatMap((path) => inspectSource(path, git('show', `${base}:${path}`)))
    errors.push(...compareFindings(baseline, trusted, false).map((error) => `Baseline growth: ${error}`))
  }
  return { errors, allowances: baseline.length }
}
