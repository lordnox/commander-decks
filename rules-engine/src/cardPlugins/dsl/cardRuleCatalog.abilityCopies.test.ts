import { expect, test } from 'bun:test'
import { cardTemplateDefaultsFor } from './cardRuleCatalog'

test('ability-copy and trigger-multiplier catalog entries preserve their complete selectors and faces', () => {
  expect(cardTemplateDefaultsFor('Rings of Brighthearth')?.ruleDefinition.definition.abilities).toMatchObject([{ kind: 'triggered', on: { kind: 'abilityActivated', filter: { filter: { relation: 'you' } } }, instructions: [{ kind: 'payOptional', ifPaid: [{ kind: 'copyAbility', targets: { kind: 'eventStackItem' } }] }] }])
  expect(cardTemplateDefaultsFor('Ancient Greenwarden')?.ruleDefinition.definition.abilities).toMatchObject([{ kind: 'keyword', keyword: 'reach' }, { kind: 'static', effects: [{ kind: 'playLands' }] }, { kind: 'static', effects: [{ kind: 'multiplyTriggers', cause: { enters: { type: 'Land' } } }] }])
  expect(cardTemplateDefaultsFor('Roaming Throne')?.ruleDefinition.definition.abilities).toMatchObject([{ kind: 'static', effects: [{ kind: 'replacement' }, { kind: 'addTypes', creatureType: { kind: 'chosenCreatureType' } }] }, { kind: 'static', effects: [{ kind: 'ward', cost: { kind: 'mana', generic: 2 } }] }, { kind: 'static', effects: [{ kind: 'multiplyTriggers', sources: { filter: { type: 'Creature', controller: 'you', other: true, creatureType: { kind: 'chosenCreatureType' } } } }] }])
  expect(cardTemplateDefaultsFor('Yarok, the Desecrated')?.ruleDefinition.definition.abilities).toMatchObject([{ kind: 'keyword', keyword: 'deathtouch' }, { kind: 'keyword', keyword: 'lifelink' }, { kind: 'static', effects: [{ kind: 'multiplyTriggers', cause: { enters: {} } }] }])
  const virtue = cardTemplateDefaultsFor('Virtue of Knowledge')!
  expect(virtue.frontFace?.ruleDefinition?.definition.abilities).toMatchObject([{ kind: 'static', effects: [{ kind: 'multiplyTriggers', cause: { enters: {} } }] }])
  expect(virtue.backFace).toMatchObject({ types: ['Instant'], subtypes: ['Adventure'], manaCost: '{1}{U}', ruleDefinition: { definition: { abilities: [{ kind: 'spell', decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'ability', controller: 'you' } } }] }, instructions: [{ kind: 'copyAbility', retarget: { kind: 'chooseNewTargets' } }] }] } } })
  expect(cardTemplateDefaultsFor('Vantress Visions')).toEqual(virtue)
})
