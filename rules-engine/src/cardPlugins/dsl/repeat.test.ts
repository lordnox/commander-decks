import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { ok } from '../../testHelpers'
import { activated, card, choosePlayer, choice, compileCardRuleDefinition, createDefinitionSnapshot, gainLife, players, ref, repeat } from './v1'

const restored = <T>(value: T) => JSON.parse(JSON.stringify(value)) as T

test.each([0, 1, 3])('counted repetition preserves each remaining iteration through player choices (%s)', count => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ costs: [], instructions: [repeat(count, [
    choosePlayer({ chooser: ref('controller'), filter: players({ relation: 'opponent' }), bindChoice: 'recipient' }),
    gainLife({ targets: choice('recipient'), amount: 1 }),
  ])] })])))
  const server = createServerGame(commanderRules, { players: 3, battlefield: { p1: [cardTemplate('Fixture', { types: ['Artifact'], ruleDefinition: definition })] } }, { random: () => 0 })
  let state = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: server.state.zoneOrder.p1.battlefield[0]!, abilityId: '$.abilities[0]' }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  for (let i = 0; i < count; i++) {
    const pick = pendingPlayerSelectionFor(state, 'p1')!
    expect(pick.candidates).toEqual(['p2', 'p3'])
    state = ok(server.rules(restored(state), { type: 'selectPlayers', seat: 'p1', selectionId: pick.id, players: [i % 2 === 0 ? 'p2' : 'p3'] }))
  }
  expect(pendingPlayerSelectionFor(state, 'p1')).toBeUndefined()
  expect(state.players.p2.life).toBe(40 + Math.ceil(count / 2))
  expect(state.players.p3.life).toBe(40 + Math.floor(count / 2))
  expect(state.stack).toHaveLength(0)
})

test('cumulative upkeep adds ages, repeats the full payment, or sacrifices the permanent', () => {
  const server = createServerGame(commanderRules, { players: 3, battlefield: { p1: [cardTemplate('Wall of Shards', { types: ['Creature'], power: 1, toughness: 8 })] } }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.battlefield[0]!
  let state = server.state
  for (let age = 1; age <= 3; age++) {
    state = ok(server.rules({ ...state, step: 'untap', active: 'p1', priority: 'p1' }, { type: 'advanceStep' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[source]!.counters.age).toBe(age)
    const pick = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(restored(state), { type: 'selectOption', seat: 'p1', selectionId: pick.id, optionId: pick.options.find(option => option.label === (age === 3 ? 'Sacrifice' : 'Pay'))!.id }))
    if (age === 3) break
    for (let i = 0; i < age; i++) {
      const recipient = pendingPlayerSelectionFor(state, 'p1')!
      state = ok(server.rules(restored(state), { type: 'selectPlayers', seat: 'p1', selectionId: recipient.id, players: [i === 0 ? 'p2' : 'p3'] }))
    }
  }
  expect(state.objects[source]!.zone).toBe('graveyard')
  expect(state.players.p2.life).toBe(42)
  expect(state.players.p3.life).toBe(41)
})
