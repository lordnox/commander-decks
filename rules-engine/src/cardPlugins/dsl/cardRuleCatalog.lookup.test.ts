import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { hasKeyword } from '../../keywords'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { CARD_RULES, effectsFor, effectsOf } from '../cardRules'
import { draw as legacyDraw, enters } from '../effects'
import { cardRuleDefinitionSnapshotFor, cardTemplateDefaultsFor } from './cardRuleCatalog'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, keyword, loadDefinitionSnapshot } from './v1'

// Catalog API contracts belong here once; per-card suites own configuration.
test('catalog lookup requires an exact own key and returns undefined for unknown names', () => {
  expect(cardRuleDefinitionSnapshotFor('Counterspell')).toBeDefined()
  for (const name of ['Unregistered catalog fixture', 'counterspell', ' Counterspell', 'toString', 'constructor', '__proto__']) {
    expect(cardRuleDefinitionSnapshotFor(name)).toBeUndefined()
    expect(cardTemplateDefaultsFor(name)).toBeUndefined()
  }
})

test('catalog snapshots are pinned and retain their revision when loaded', () => {
  const snapshot = cardRuleDefinitionSnapshotFor('Counterspell')!
  expect(cardRuleDefinitionSnapshotFor('Counterspell')).toBe(snapshot)
  expect(snapshot.definitionRevision).toMatch(/^v1-[0-9a-f]{16}$/)
  expect(cardRuleDefinitionSnapshotFor('Absorb')!.definitionRevision).not.toBe(snapshot.definitionRevision)
  expect(loadDefinitionSnapshot(snapshot).definitionRevision).toBe(snapshot.definitionRevision)
})

test('template callers own their characteristics and rule snapshot', () => {
  const original = cardTemplateDefaultsFor('Counterspell')!
  const edited = cardTemplateDefaultsFor('Counterspell')!
  edited.types.push('Creature')
  Reflect.set(edited.ruleDefinition.definition.abilities, 'length', 0)
  expect(cardTemplateDefaultsFor('Counterspell')).toEqual(original)
  expect(cardRuleDefinitionSnapshotFor('Counterspell')).toEqual(original.ruleDefinition)
})

test('newGame falls back to the catalog snapshot when the input omits ruleDefinition', () => {
  const template = cardTemplate('Counterspell')
  delete template.ruleDefinition
  const server = createServerGame(commanderRules, { hands: { p1: [template] } }, { random: () => 0 })
  const object = server.state.objects[server.state.zoneOrder.p1.hand[0]]!
  expect(object.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Counterspell'))
  expect(object.effects).toEqual([])
  expect(effectsOf(object)).toEqual([])
})

test('an explicit snapshot overrides catalog abilities', () => {
  const override = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.trample])))
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Wall of Omens', { ruleDefinition: override })] },
  }, { random: () => 0 })
  const object = server.state.objects[server.state.zoneOrder.p1.battlefield[0]]!
  expect(object.ruleDefinition).toEqual(override)
  expect(hasKeyword(object, 'trample')).toBe(true)
  expect(hasKeyword(object, 'defender')).toBe(false)
})

test('journal restore preserves the stamped snapshot revision', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Counterspell')] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  const snapshot = server.state.objects[id]!.ruleDefinition!
  const journal = JSON.parse(JSON.stringify(createJournal(server.state)))
  const restored = restoreJournal(journal, server.rules).current()
  expect(restored.objects[id]!.ruleDefinition).toEqual(snapshot)
  expect(loadDefinitionSnapshot(restored.objects[id]!.ruleDefinition!).definitionRevision).toBe(snapshot.definitionRevision)
})

// Temporary compatibility contracts disappear with the legacy registry. Choose
// an actual remaining key rather than making a particular card stay unmigrated.
test('every former CARD_RULES registration is authored in the canonical catalog', () => {
  expect(Object.keys(CARD_RULES)).toEqual([])
  for (const name of ['Concordant Crossroads', 'Everybody Lives!', 'Kuroki, Thief of Talents', 'Perch Protection', 'Snuff Out']) {
    expect(cardRuleDefinitionSnapshotFor(name)).toBeDefined()
    expect(effectsFor(name)).toEqual([])
  }
})

test('catalog programs and legacy compatibility effects execute together without duplicate triggers', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [
      cardTemplate('Wall of Omens'),
      cardTemplate('Legacy compatibility fixture', { types: ['Creature'], power: 1, toughness: 1, effects: [enters(legacyDraw(1))] }),
    ] },
    libraries: { p1: Array.from({ length: 3 }, (_, index) => cardTemplate(`Draw fixture ${index}`)) },
  }, { random: () => 0 })
  let state = server.state
  const ids = [...state.zoneOrder.p1.hand]
  for (const id of ids) {
    state = resolveStack(server.rules, ok(server.rules(state, { type: 'move', objectId: id, to: 'battlefield' })))
  }
  expect(state.zoneOrder.p1.hand).toHaveLength(2)
  expect(state.zoneOrder.p1.library).toHaveLength(1)
  expect(state.objects[ids[0]]!.effects).toEqual([])
  expect(state.objects[ids[1]]!.ruleDefinition).toBeUndefined()
})
