import { expect, test } from 'bun:test'
import { legalActsFor } from '../../actions'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, embalm, keyword } from './v1'

const setup = () => createServerGame(commanderRules, { hands: { p1: [cardTemplate('Yard fixture', { zone: 'graveyard', types: ['Creature'], subtypes: ['Angel'], colors: 'G', manaCost: '{3}{G}', manaValue: 4, power: 4, toughness: 4, ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([embalm('{2}'), keyword.flying]))) })] } }, { random: () => 0 })

test('graveyard exile is paid before a modified token copy resolves from source LKI', () => {
  const server = setup(), id = server.state.zoneOrder.p1.graveyard[0]!
  const state = structuredClone(server.state)
  state.players.p1.mana.C = 2
  const event = { type: 'activateAbility' as const, seat: 'p1', objectId: id, abilityId: '$.abilities[0]' }
  expect(server.rules({ ...state, active: 'p2' }, event).ok).toBe(false)
  const activated = ok(server.rules(state, event))
  expect(activated.objects[id]!.zone).toBe('exile')
  expect(activated.players.p1.mana.C).toBe(0)
  const countered = ok(server.rules(activated, { type: 'counterStackItem', stackId: activated.stack[0]!.id }))
  expect(countered.zoneOrder.p1.battlefield).toHaveLength(0)
  expect(countered.objects[id]!.zone).toBe('exile')
  const resolved = resolveStack(server.rules, JSON.parse(JSON.stringify(activated)))
  const token = Object.values(resolved.objects).find(object => object.token)!
  expect(token).toMatchObject({ zone: 'battlefield', colors: ['W'], subtypes: ['Zombie', 'Angel'], manaCost: '', manaValue: 0, power: 4, toughness: 4 })
  expect(token.ruleDefinition).toEqual(state.objects[id]!.ruleDefinition)
})

test('catalog Angel of Sanctions embalms from the graveyard into a white Zombie token copy', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Angel of Sanctions', { zone: 'graveyard' })] },
  }, { random: () => 0.5 })
  const state = structuredClone(server.state)
  const sourceId = state.zoneOrder.p1.graveyard[0]!
  state.players.p1.mana.W = 6
  const embalmAbilityId = '$.abilities[2]'
  expect(legalActsFor(state, 'p1').some(action =>
    action.kind === 'activateAbility'
    && action.objectId === sourceId
    && action.abilityId === embalmAbilityId)).toBe(true)
  const activated = ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: sourceId, abilityId: embalmAbilityId }))
  const resolved = ok(server.rules(activated, { type: 'resolveTop' }))
  expect(resolved.zoneOrder.p1.battlefield).toHaveLength(1)
  const token = resolved.objects[resolved.zoneOrder.p1.battlefield[0]!]
  // Catalog Angel of Sanctions is an Angel, so the copy keeps Angel beside the added Zombie.
  expect(token).toMatchObject({ name: 'Angel of Sanctions', token: true, subtypes: ['Zombie', 'Angel'] })
})
