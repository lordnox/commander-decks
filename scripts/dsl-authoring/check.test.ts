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
  test('legacy aliases, namespace imports, mutations and specialized executors fail', () => {
    rejects("import { CARD_RULES as other } from '../../rules-engine/src/cardPlugins/cardRules'; other['New'] = []")
    rejects("import * as legacy from '../../rules-engine/src/cardPlugins/cardRules'; legacy.CARD_RULES.New = []")
    rejects('export const newExecutor = () => doThing()', 'rules-engine/src/cardPlugins/newExecutor.ts')
    const old = "import { effectsFor as lookup } from '../../rules-engine/src/cardPlugins/cardRules'; lookup(name)"
    expect(compareFindings(scan(`${old}; lookup('New')`), scan(old))).not.toHaveLength(0)
    rejects('export const alternative = { New: draw(1) }', registry)
  })
  test('name dispatch, computed access, maps, payloads and custom pickers fail', () => {
    for (const source of [
      "if (object.name === 'New Card') draw(2)",
      "switch (card['name']) { case 'New Card': draw(2) }",
      "['New Card'].includes(source.name)",
      "const alternate = { effects: [draw(2)] }",
      "const alternate = { ['pluginIds']: ['new-card'] }",
      "enqueue({ type: 'custom', name: 'pickNewCard', cards: ids })",
    ]) rejects(source)
  })
  test('shared engine infrastructure and type imports pass', () => {
    expect(scan("import type { CardEffect } from '../../rules-engine/src/cardPlugins/effects'; export const tick = (event: Event) => enqueue({ type: 'custom', name: 'advanceStep' })")).toEqual([])
    expect(scan("if (event.type === 'custom' && event.name === 'advanceStep') advance()")).toEqual([])
    expect(scan("export const plugin = { id: 'generic', reduce: (draft, event) => { if (event.type === 'draw') draft.draw(event.player) } }", 'rules-engine/src/plugins/generic.ts')).toEqual([])
  })
  test('executor changes are frozen but removal is allowed with pruning', () => {
    const path = 'rules-engine/src/cardPlugins/old.ts'
    const baseline = scan('export const execute = () => draw(1)', path)
    expect(compareFindings(scan('export const execute = () => draw(2)', path), baseline)).not.toHaveLength(0)
    expect(compareFindings([], baseline, false)).toEqual([])
  })
})
