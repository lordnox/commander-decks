import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { hasKeyword } from '../../keywords'
import { playerAttackRequirements } from '../../rules/attackRequirements'
import { snapshotFor } from '../../cards/snapshot'
import { CONTROL_EVENT } from './controlConstants'
import { encore } from './v1'

const fixture = () => createServerGame(commanderRules, {
  players: 4,
  hands: { p1: [cardTemplate('Encore fixture', { zone: 'graveyard', types: ['Creature'], subtypes: ['Beast'],
    colors: ['G'], manaCost: '{3}{G}', manaValue: 4, power: 4, toughness: 4, ruleDefinition: snapshotFor([encore('{2}')]) })] },
}, { random: () => 0 })
const activate = (server: ReturnType<typeof fixture>) => {
  const state = structuredClone(server.state)
  state.players.p1.mana.C = 2
  return ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: state.zoneOrder.p1.graveyard[0], abilityId: '$.abilities[0]' }))
}

test('encore copies captured source values once per current opponent, then binds one delayed sacrifice across restore', () => {
  const server = fixture()
  let state = activate(server)
  const source = state.zoneOrder.p1.exile[0]
  state = ok(server.rules(state, { type: 'move', objectId: source, to: 'hand' }))
  state.opponents.p1 = ['p2', 'p4'] // p3 is a teammate.
  state.players.p4.lost = true
  state = resolveStack(server.rules, restoreJournal(createJournal(state), server.rules).current())
  const [token] = state.zoneOrder.p1.battlefield.map(id => state.objects[id])
  expect(state.zoneOrder.p1.battlefield).toHaveLength(1)
  expect(token).toMatchObject({ token: true, power: 4, toughness: 4, manaCost: '{3}{G}', subtypes: ['Beast'], colors: ['G'] })
  expect(hasKeyword(token, 'haste')).toBe(true)
  expect(playerAttackRequirements(token)).toEqual(['p2'])
  expect(state.delayedTriggers).toHaveLength(1)
  state = ok(server.rules({ ...state, step: 'postcombatMain', priority: 'p1' }, { type: 'advanceStep' }))
  expect(state.step).toBe('end')
  expect(state.stack).toHaveLength(1)
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.zoneOrder.p1.battlefield).toHaveLength(0)
  expect(state.objects[source].zone).toBe('hand')
})

test('one counterable end-step trigger covers every copy; attack requirements expire but haste remains', () => {
  const server = fixture()
  let state = resolveStack(server.rules, activate(server))
  const ids = [...state.zoneOrder.p1.battlefield]
  expect(ids.map(id => playerAttackRequirements(state.objects[id]))).toEqual([['p2'], ['p3'], ['p4']])
  expect(state.delayedTriggers).toHaveLength(1)
  state = ok(server.rules({ ...state, step: 'postcombatMain', priority: 'p1' }, { type: 'advanceStep' }))
  expect(state.stack).toHaveLength(1)
  state = ok(server.rules(state, { type: 'counterStackItem', stackId: state.stack[0].id }))
  state = ok(server.rules(state, { type: 'advanceStep' }))
  expect(state.step).toBe('cleanup')
  expect(state.zoneOrder.p1.battlefield).toEqual(ids)
  for (const id of ids) {
    expect(playerAttackRequirements(state.objects[id])).toEqual([])
    expect(hasKeyword(state.objects[id], 'haste')).toBe(true)
  }
  expect(state.delayedTriggers).toHaveLength(0)
})

test('delayed sacrifice follows captured copies and only sacrifices those still controlled by its player', () => {
  const server = fixture()
  let state = resolveStack(server.rules, activate(server))
  const [first, second, third] = state.zoneOrder.p1.battlefield
  state = ok(server.rules(state, { type: CONTROL_EVENT.change, objectRef: { objectId: first, incarnation: state.objects[first].incarnation, zone: 'battlefield' }, controller: 'p2' }))
  state = ok(server.rules(state, { type: 'move', objectId: second, to: 'exile' }))
  state = ok(server.rules({ ...state, step: 'postcombatMain', priority: 'p1' }, { type: 'advanceStep' }))
  state = resolveStack(server.rules, restoreJournal(createJournal(state), server.rules).current())
  expect(state.objects[first]).toMatchObject({ zone: 'battlefield', controller: 'p2' })
  expect(state.objects[second]).toBeUndefined()
  expect(state.objects[third]).toBeUndefined()
})

test('catalog encore copies keep entry programs and characteristic definitions', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Belonging', { zone: 'graveyard' }), cardTemplate('Soul of Eternity', { zone: 'graveyard' })] },
  })
  let state = structuredClone(server.state)
  const [belonging, soul] = state.zoneOrder.p1.graveyard
  state.players.p1.mana = { W: 4, U: 0, B: 0, R: 0, G: 0, C: 13 }
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: belonging, abilityId: '$.abilities[1]' })))
  const belongingCopy = state.zoneOrder.p1.battlefield.map(id => state.objects[id]).find(object => object.name === 'Belonging')!
  expect(hasKeyword(belongingCopy, 'changeling')).toBe(false)
  const shapeshifters = state.zoneOrder.p1.battlefield.map(id => state.objects[id]).filter(object => object.name === 'Shapeshifter')
  expect(shapeshifters).toHaveLength(3)
  expect(shapeshifters.every(object => hasKeyword(object, 'changeling') && object.subtypes.includes('Dragon'))).toBe(true)
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: soul, abilityId: '$.abilities[1]' })))
  const soulCopy = state.zoneOrder.p1.battlefield.map(id => state.objects[id]).find(object => object.name === 'Soul of Eternity')!
  expect(soulCopy.power).toBe(40)
  state = ok(server.rules(state, { type: 'loseLife', seat: 'p1', amount: 7 }))
  expect(state.objects[soulCopy.id].power).toBe(33)
  expect(state.objects[soulCopy.id].toughness).toBe(33)
})
