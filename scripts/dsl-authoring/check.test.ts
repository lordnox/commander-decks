import { describe, expect, test } from 'bun:test'
import { compareFindings, inspectSource } from './check'

const registry = 'rules-engine/src/cardPlugins/cardRules.ts'
const host = 'live-runner/src/example.ts'
const scan = (source: string, path = host) => inspectSource(path, source)
const rejects = (source: string, path = host) => expect(compareFindings(scan(source, path), [])).not.toHaveLength(0)

describe('canonical DSL authoring ratchet', () => {
  test('existing legacy registrations pass unchanged, including formatting/comments', () => {
    const baseline = scan("export const CARD_RULES = { 'Old Card': [draw(1)] }", registry)
    expect(compareFindings(scan("// comment\nexport const CARD_RULES={ 'Old Card' : [draw( 1 )] };", registry), baseline)).toEqual([])
  })
  test('new registrations and extended legacy configurations fail', () => {
    const baseline = scan("export const CARD_RULES = { Old: [draw(1)] }", registry)
    for (const source of [
      'export const CARD_RULES = { Old: [draw(2)] }',
      'export const CARD_RULES = { Old: [draw(1)], New: [draw(1)] }',
      'export const CARD_RULES = { Old: [draw(1), gainLife(2)] }',
    ]) expect(compareFindings(scan(source, registry), baseline)).not.toHaveLength(0)
  })
  test('migration requires pruning and cannot grow the baseline', () => {
    const baseline = scan('export const CARD_RULES = { Old: [draw(1)] }', registry)
    expect(compareFindings([], baseline)).not.toHaveLength(0)
    expect(compareFindings([], [])).toEqual([])
    expect(compareFindings([], baseline, false)).toEqual([])
    expect(compareFindings(scan('export const CARD_RULES = { New: [draw(1)] }', registry), baseline, false)).not.toHaveLength(0)
  })
  test('canonical cards and reusable semantics pass', () => {
    expect(scan("import { card, draw, spell } from './v1'; export const cards = { New: card([spell({ instructions: [draw({ count: 2 })] })]) }", 'rules-engine/src/cardPlugins/dsl/newCards.ts')).toEqual([])
    expect(scan('export const draw = (count: number) => ({ kind: "draw", count })', 'rules-engine/src/cardPlugins/dsl/builders/newNode.ts')).toEqual([])
  })
  test('registry aliases, namespace mutations and alternate card configurations fail', () => {
    rejects("import { CARD_RULES as other } from '../../rules-engine/src/cardPlugins/cardRules'; other['New'] = []")
    rejects("import * as legacy from '../../rules-engine/src/cardPlugins/cardRules'; legacy.CARD_RULES.New = []")
    rejects("import { CARD_RULES as other } from '../../rules-engine/src/cardPlugins/cardRules'; const alias = other; Object.assign(alias, { New: [] })")
    rejects("import { draw } from '../../rules-engine/src/cardPlugins/effects'; export const alternate = { 'New Card': [draw(1)] }")
    rejects("export const alternate = { name: 'New Card', effects: [draw(1)] }")
    rejects("export const execute = (object) => { if (object.name === 'New Card') doThing() }", 'rules-engine/src/plugins/newExecutor.ts')
  })
  test('real name dispatch and custom pickers fail', () => {
    for (const source of [
      "if (object.name === 'New Card') draw(2)",
      "if ('New Card' !== object['name']) draw(2)",
      "switch (card['name']) { case 'New Card': draw(2) }",
      "['New Card'].includes(source.name)",
      "const handlers = { 'New Card': () => draw(1) }; handlers[object.name]()",
      "enqueue({ type: 'custom', name: 'pickNewCard', cards: ids })",
    ]) rejects(source)
  })
  test('shared engine infrastructure and type imports pass', () => {
    expect(scan("import type { CardEffect } from '../../rules-engine/src/cardPlugins/effects'; export const tick = (event: Event) => enqueue({ type: 'custom', name: 'advanceStep' })")).toEqual([])
    expect(scan("if (event.type === 'custom' && event.name === 'advanceStep') advance()")).toEqual([])
    expect(scan("export const plugin = { id: 'generic', reduce: (draft, event) => { if (event.type === 'draw') draft.draw(event.player) } }", 'rules-engine/src/plugins/generic.ts')).toEqual([])
  })
  test('generic engine edits, payloads, imports and UI serialization remain legal', () => {
    for (const source of [
      "actions.push({ kind: 'playLand', name: object.name })",
      "seat.name.toLowerCase().split(' ').join(' ')",
      "const snapshot = { effects: effectsOf(object), pluginIds: entry.pluginIds }",
      "import { manaValueOf } from '../cardPlugins/effects'; export const cost = manaValueOf(object)",
      "import { cardPluginEntry } from '../cardPlugins'; cardPluginEntry(object.name)",
      "import { card } from '../cardPlugins/dsl'; export const definition = card([])",
      "import { card } from '../cardPlugins/dsl/index.ts'; export const definition = card([])",
    ]) expect(scan(source, 'rules-engine/src/plugins/generic.ts')).toEqual([])
    const path = 'rules-engine/src/cardPlugins/ward.ts'
    const baseline = scan('export const execute = () => draw(1)', path)
    expect(compareFindings(scan('export const execute = () => draw(2)', path), baseline)).toEqual([])
  })
  test('extending a card-specific branch still fails', () => {
    const before = "if (object.name === 'Old Card') draw(1)"
    expect(compareFindings(scan("if (object.name === 'Old Card') draw(2)"), scan(before))).not.toHaveLength(0)
  })
})
