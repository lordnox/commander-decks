import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'

test.each(['Utopia Sprawl', 'Wild Growth'])('an Aura enters attached, retains its color choice, and adds mana for the host controller (%s)', name => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate(name, { manaCost: '{0}' })] }, battlefield: { p2: [cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })] } }, { random: () => 0 })
  const aura = server.state.zoneOrder.p1.hand[0]!
  const land = server.state.zoneOrder.p2.battlefield[0]!
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: aura, targets: [{ kind: 'object', objectId: land }] })))
  if (name === 'Utopia Sprawl') {
    const pick = pendingOptionSelection(state, 'p1')!
    expect(state.objects[aura]?.zone).toBe('stack')
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p1', selectionId: pick.id, optionId: 'R' }))
  }
  expect(state.objects[aura]).toMatchObject({ zone: 'battlefield', attachedTo: land })
  state = ok(server.rules({ ...state, priority: 'p2' }, { type: 'tapForMana', seat: 'p2', objectId: land, mana: 'G' }))
  expect(state.players.p2.mana.G).toBe(name === 'Wild Growth' ? 2 : 1)
  expect(state.players.p2.mana.R).toBe(name === 'Utopia Sprawl' ? 1 : 0)
  expect(state.players.p1.mana.G).toBe(0)
  expect(state.stack).toEqual([])
  state = ok(server.rules(state, { type: 'move', objectId: land, to: 'graveyard' }))
  expect(state.objects[aura]?.zone).toBe('graveyard')
})

test('typed enchant restrictions reject a non-Forest and an Aura dies when its host ceases to qualify', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Utopia Sprawl', { manaCost: '{0}' })] }, battlefield: { p1: [cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] }), cardTemplate('Island', { types: ['Land'], subtypes: ['Island'] })] } }, { random: () => 0 })
  const aura = server.state.zoneOrder.p1.hand[0]!
  const [forest, island] = server.state.zoneOrder.p1.battlefield
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: aura, targets: [{ kind: 'object', objectId: island! }] }).ok).toBe(false)
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: aura, targets: [{ kind: 'object', objectId: forest! }] })))
  const pick = pendingOptionSelection(state, 'p1')!
  state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: pick.id, optionId: 'U' }))
  state.objects[forest!]!.subtypes = []
  state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 0 }))
  expect(state.objects[aura]?.zone).toBe('graveyard')
})

test('an attachment cannot follow the same card ID through a blink', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Wild Growth', { manaCost: '{0}' })] }, battlefield: { p1: [cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })] } }, { random: () => 0 })
  const aura = server.state.zoneOrder.p1.hand[0]!
  const land = server.state.zoneOrder.p1.battlefield[0]!
  const entered = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: aura, targets: [{ kind: 'object', objectId: land }] })))
  const result = ok(server.rules(entered, { type: 'actionGroup', events: [{ type: 'move', objectId: land, to: 'exile' }, { type: 'move', objectId: land, to: 'battlefield' }] }))
  expect(result.objects[land]?.zone).toBe('battlefield')
  expect(result.objects[aura]?.zone).toBe('graveyard')
})
