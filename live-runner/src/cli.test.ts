import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { otherRunnerPid } from './cli'
import { writePid } from './session'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('host process guard', () => {
  test('detects another live process for the same slug', () => {
    const root = mkdtempSync(join(tmpdir(), 'live-cli-'))
    roots.push(root)
    mkdirSync(join(root, 'table-games'))
    writePid('test', process.pid, root)

    expect(otherRunnerPid('test', root, process.pid + 1)).toBe(process.pid)
    expect(otherRunnerPid('test', root, process.pid)).toBeNull()
  })
})

