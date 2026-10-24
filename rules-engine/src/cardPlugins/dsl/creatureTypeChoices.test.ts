import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok, resolveStack } from '../../testHelpers'
import { addTypesTo, card, chooseCreatureType, chooseCreatureTypeAsEnters, chosenCreatureType, compileCardRuleDefinition, createDefinitionSnapshot, creatureTypeChoice, destroy, keyword, objects, spell, staticAbility } from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

test('a type choice offers absent types, restores, and excludes changelings from destroying other types', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Fixture', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot([spell({ instructions: [chooseCreatureType('type'), destroy({ targets: objects({ zone: 'battlefield', type: 'Creature', not: { creatureType: creatureTypeChoice('type') } }) })] })]) })] }, battlefield: { p1: [cardTemplate('Human', { types: ['Creature'], subtypes: ['Human'], power: 2, toughness: 2 }), cardTemplate('Changeling', { types: ['Creature'], subtypes: ['Shapeshifter'], power: 2, toughness: 2, ruleDefinition: snapshot([keyword.changeling]) })] } }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  const pick = pendingOptionSelection(state, 'p1')!
  expect(pick.options.some(option => option.id === 'Time Lord')).toBe(true)
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p1', selectionId: pick.id, optionId: 'Time Lord' }))
  const [human, changeling] = server.state.zoneOrder.p1.battlefield
  expect(state.objects[human!]!.zone).toBe('graveyard')
  expect(state.objects[changeling!]!.zone).toBe('battlefield')
})

test('an entry type choice is stored before observers and can drive static selectors', () => {
  const definition = snapshot([staticAbility(chooseCreatureTypeAsEnters(), addTypesTo({ targets: objects({ among: { kind: 'contextRef', name: 'source' } }), creatureType: chosenCreatureType() }))])
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Fixture', { types: ['Artifact'], power: 2, toughness: 2, ruleDefinition: definition })] } }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.hand[0]!
  let state = ok(server.rules(server.state, { type: 'move', objectId: source, to: 'battlefield' }))
  const pick = pendingOptionSelection(state, 'p1')!
  expect(state.objects[source]!.zone).toBe('hand')
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p1', selectionId: pick.id, optionId: 'Time Lord' }))
  expect(state.objects[source]!).toMatchObject({ zone: 'battlefield', chosenType: 'Time Lord' })
  expect(state.objects[source]!.subtypes).toContain('Time Lord')
  expect(() => snapshot([staticAbility({ kind: 'grantKeyword', targets: objects({ creatureType: chosenCreatureType() }), keyword: 'haste' })])).not.toThrow()
})
