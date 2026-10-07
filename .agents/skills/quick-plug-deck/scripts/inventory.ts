#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cardDefinition } from '../../../../rules-engine/src/cardPlugins/cardRules'

const [deckArg, outputArg] = process.argv.slice(2)
if (!deckArg || !outputArg) {
  console.error('Usage: bun inventory.ts decks/<deck> <output.json>')
  process.exit(1)
}
const root = resolve(import.meta.dir, '../../../..')
const deck = resolve(deckArg)
const output = resolve(outputArg)
if (output === resolve(deck, 'cards.json') || output === resolve(deck, 'tokens.json')) {
  throw new Error('Inventory output must not overwrite a deck manifest')
}
const manifestText = readFileSync(resolve(deck, 'cards.json'), 'utf8')
const manifest = JSON.parse(manifestText)
if (manifest.unresolved?.length) throw new Error('Resolve the deck before auditing')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const rows = manifest.cards
  .filter((entry: any) => !(entry.categories ?? []).some((tag: string) => tag.includes('{noDeck}')))
  .map((entry: any) => {
    const cached = JSON.parse(readFileSync(resolve(root, entry.cache), 'utf8'))
    const faces = (cached.card_faces ?? [cached]).map((face: any) => ({
      name: face.name, mana_cost: face.mana_cost ?? '', type_line: face.type_line,
      oracle_text: face.oracle_text ?? '', power: face.power, toughness: face.toughness,
      loyalty: face.loyalty, defense: face.defense,
    }))
    const names = [...new Set<string>([entry.name, ...faces.map((face: any) => face.name)])]
    const registrations = names.flatMap((name) => {
      const definition = cardDefinition(name)
      return definition ? [{ name, handlers: definition.handlerIds, effect_kinds: definition.effects.map((effect) => effect.op) }] : []
    })
    return { oracle_id: entry.oracle_id, name: entry.name, quantity: entry.quantity,
      oracle_sha256: digest(JSON.stringify(faces)), faces, registrations, status: 'unknown' }
  })
const tokenPath = resolve(deck, 'tokens.json')
// Token data is required by the deck workflow; missing files are actionable errors.
const tokenText = readFileSync(tokenPath, 'utf8')
const tokens = JSON.parse(tokenText)
const tokenRows = Object.entries(tokens.tokens ?? {}).map(([id, value]: [string, any]) => ({
  printing_id: id, name: value.name, type_line: value.type_line, oracle_text: value.oracle_text ?? '',
  power: value.power, toughness: value.toughness, status: 'unknown',
}))
writeFileSync(output, JSON.stringify({
  schema_version: 1, deck, engine_revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  engine_dirty_paths: execFileSync('git', ['status', '--porcelain', '--', 'rules-engine', 'live-runner', 'shared', 'site/src'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  manifest_sha256: digest(manifestText), tokens_sha256: digest(tokenText),
  cards: rows, tokens: tokenRows,
}, null, 2) + '\n')
console.log(JSON.stringify({ output, cards: rows.reduce((sum: number, row: any) => sum + row.quantity, 0),
  unique: rows.length, registration_leads: rows.filter((row: any) => row.registrations.length).length,
  tokens: tokenRows.length, verdict: 'Inventory only; every row requires coverage evidence.' }))
