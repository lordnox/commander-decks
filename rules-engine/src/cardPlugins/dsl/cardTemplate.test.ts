import { expect, test } from 'bun:test'
import { cardTemplate } from '../../newGame'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'

test('catalog card templates own their mutable defaults', () => {
  const first = cardTemplate('Counterspell')
  first.types.push('Creature')
  first.ruleDefinition!.definitionRevision = 'changed fixture'
  const next = cardTemplate('Counterspell')
  expect(next.types).toEqual(['Instant'])
  expect(next.colors).toBe('U')
  expect(next.manaValue).toBe(2)
  expect(next.manaCost).toBe('{U}{U}')
  expect(next.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Counterspell'))
  expect(next.ruleDefinition).not.toBe(cardRuleDefinitionSnapshotFor('Counterspell'))
  expect(cardTemplate('Unknown fixture').types).toEqual([])
})

test('explicit printed characteristic overrides retain the catalog rule snapshot', () => {
  const overridden = cardTemplate('Counterspell', { manaCost: '{0}' })
  expect(overridden.manaCost).toBe('{0}')
  expect(overridden.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Counterspell'))
})
