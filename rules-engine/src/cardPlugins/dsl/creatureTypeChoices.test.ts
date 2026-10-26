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

test('catalog Cavern of Souls restores its private type choice and restricts mana to matching creatures', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [
      cardTemplate('Cavern of Souls'),
      cardTemplate('Wrong Bear', { types: ['Creature'], subtypes: ['Bear'], manaCost: '{U}', power: 2, toughness: 2 }),
      cardTemplate('Matching Wizard', { types: ['Creature'], subtypes: ['Wizard'], manaCost: '{U}', power: 2, toughness: 2 }),
    ] },
    battlefield: { p1: [cardTemplate('Wizard', { types: ['Creature'], subtypes: ['Wizard'] })] },
  }, { random: () => 0.5 })
  const cavern = server.state.zoneOrder.p1.hand[0]!
  const entered = server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: cavern })
  if (!entered.ok) throw new Error(entered.error)
  const pick = pendingOptionSelection(entered.state, 'p1')!
  expect(pick.options.some(option => option.id === 'Wizard')).toBe(true)
  expect(pendingOptionSelection(server.project(entered.state, 'p2'), 'p1')).toBeUndefined()
  const restored = JSON.parse(JSON.stringify(entered.state))
  const restoredPick = pendingOptionSelection(restored, 'p1')!
  const chosen = server.rules(restored, {
    type: 'selectOption', seat: 'p1', selectionId: restoredPick.id, optionId: 'Wizard',
  })
  if (!chosen.ok) throw new Error(chosen.error)
  expect(chosen.state.objects[cavern]).toMatchObject({ zone: 'battlefield', chosenType: 'Wizard' })

  const ready = structuredClone(chosen.state)
  ready.priority = 'p1'
  ready.active = 'p1'
  ready.step = 'precombatMain'
  const tapped = server.rules(ready, { type: 'tapForMana', seat: 'p1', objectId: cavern, mana: 'U' })
  if (!tapped.ok) throw new Error(tapped.error)
  expect(tapped.state.players.p1.restrictedMana).toMatchObject([
    { mana: 'U', creatureType: 'Wizard', uncounterable: true },
  ])
  expect(tapped.state.players.p1.mana.U).toBe(0)
  expect(server.rules(tapped.state, { type: 'castSpell', seat: 'p1', objectId: named(tapped.state, 'Wrong Bear').id }).ok).toBe(false)
  const cast = server.rules(tapped.state, { type: 'castSpell', seat: 'p1', objectId: named(tapped.state, 'Matching Wizard').id })
  if (!cast.ok) throw new Error(cast.error)
  expect(cast.state.stack[0]).toMatchObject({ name: 'Matching Wizard', uncounterable: true })
  expect(cast.state.players.p1.restrictedMana).toEqual([])
})

function named(state: ReturnType<typeof createServerGame>['state'], name: string) {
  return Object.values(state.objects).find(object => object.name === name)!
}
