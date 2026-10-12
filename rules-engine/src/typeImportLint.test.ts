import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'

const runOxlint = async (file: string) => {
  const process = Bun.spawn(['bunx', 'oxlint', '--config', '.oxlintrc.json', '--quiet', file], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { code: await process.exited, output: `${stdout}${stderr}` }
}

const withFixture = async (source: string, check: (file: string) => Promise<void>) => {
  const file = join('rules-engine/src/cardPlugins/dsl/compiler', `type-import-lint-fixture-${crypto.randomUUID()}.ts`)
  writeFileSync(file, source)
  try {
    await check(file)
  } finally {
    rmSync(file, { force: true })
  }
}

test('rejects inline type imports in the checked DSL compiler scope', async () => {
  await withFixture(
    "type Mana = import('../../../types').ManaId\nconst mana: Mana = 'C'\nvoid mana\n",
    async (file) => {
      const result = await runOxlint(file)
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('typescript(consistent-type-imports)')
    },
  )
})

test('allows runtime dynamic imports alongside top-level type imports', async () => {
  await withFixture(
    "import type { ManaId } from '../../../types'\nconst mana: ManaId = 'C'\nconst loadTypes = () => import('../../../types')\nvoid mana\nvoid loadTypes\n",
    async (file) => {
      const result = await runOxlint(file)
      expect(result.code).toBe(0)
    },
  )
})
