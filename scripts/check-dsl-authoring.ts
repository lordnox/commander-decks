import { resolve } from 'node:path'
import { checkRepository } from './dsl-authoring/repository'

const root = resolve(import.meta.dir, '..')
const baseIndex = process.argv.indexOf('--base')
const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined
if (baseIndex >= 0 && !base) throw new Error('--base requires a trusted git ref')
const { errors, allowances } = checkRepository(root, base)
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`DSL authoring check passed (${allowances} explicit migration allowances).`)
