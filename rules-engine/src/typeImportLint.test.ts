import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'

const oxlint = join(import.meta.dir, '../../node_modules/.bin/oxlint')
const fixturePath = 'rules-engine/src/cardPlugins/dsl/compiler/fixture.ts'
// Include Node and native oxlint startup time on slower CI runners.
const OXLINT_TEST_TIMEOUT_MS = 30_000

const runOxlint = async (root: string) => {
  const process = Bun.spawn([oxlint, '--config', '.oxlintrc.json', '--quiet', fixturePath], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { code: await process.exited, output: `${stdout}${stderr}` }
}

const withFixture = async (source: string, check: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'type-import-lint-'))
  const compilerDirectory = join(root, 'rules-engine/src/cardPlugins/dsl/compiler')
  const file = join(compilerDirectory, 'fixture.ts')
  mkdirSync(compilerDirectory, { recursive: true })
  cpSync(join(import.meta.dir, '../../.oxlintrc.json'), join(root, '.oxlintrc.json'))
  writeFileSync(file, source)
  try {
    await check(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('rejects inline type imports in the checked DSL compiler scope', async () => {
  await withFixture(
    "type Mana = import('../../../types').ManaId\nconst mana: Mana = 'C'\nvoid mana\n",
    async (root) => {
      const result = await runOxlint(root)
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('typescript(consistent-type-imports)')
    },
  )
}, OXLINT_TEST_TIMEOUT_MS)

test('allows runtime dynamic imports alongside top-level type imports', async () => {
  await withFixture(
    "import type { ManaId } from '../../../types'\nconst mana: ManaId = 'C'\nconst loadTypes = () => import('../../../types')\nvoid mana\nvoid loadTypes\n",
    async (root) => {
      const result = await runOxlint(root)
      expect(result.code).toBe(0)
    },
  )
}, OXLINT_TEST_TIMEOUT_MS)
