import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createToken,
  draw,
  mill,
  objects,
  players,
  ref,
  saga,
  select,
  tap,
  target,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const sagaCard = (abilities: Parameters<typeof card>[0]) =>
  cardTemplate('Saga fixture', {
    types: ['Enchantment'],
    subtypes: ['Saga'],
    manaCost: '{0}',
    ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card(abilities))),
  })

const toPrecombatMain = (state: GameState) =>
  ({ ...state, step: 'draw' as const, active: 'p1' as const, priority: 'p1' as const })

test('canonical saga chapters fire on entry and precombat main, then the saga is sacrificed', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [sagaCard([saga({ chapters: [
      { numbers: [1], instructions: [draw({ count: 1, targets: ref('controller') })] },
      { numbers: [2], instructions: [mill({ count: 1, targets: ref('controller') })] },
      { numbers: [3], instructions: [createToken({
        count: 1,
        targets: ref('controller'),
        token: { name: 'Kraken', types: ['Creature'], power: 1, toughness: 1 },
      })] },
    ] })])] },
    libraries: { p1: [cardTemplate('Drawn', { types: ['Instant'] }), cardTemplate('Milled', { types: ['Instant'] })] },
  }, { random: () => 0 })
  const id = named(server.state, 'Saga fixture').id
  let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(state.objects[id].counters.lore).toBe(1)
  state = resolveStack(server.rules, state)
  expect(named(state, 'Drawn').zone).toBe('hand')
  state = ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' }))
  expect(state.objects[id].counters.lore).toBe(2)
  state = resolveStack(server.rules, state)
  expect(named(state, 'Milled').zone).toBe('graveyard')
  state = ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' }))
  expect(state.objects[id].counters.lore).toBe(3)
  expect(state.objects[id].zone).toBe('battlefield')
  state = resolveStack(server.rules, state)
  expect(Object.values(state.objects).some(object => object.token && object.name === 'Kraken')).toBe(true)
  expect(state.objects[id].zone).toBe('graveyard')
})

test('a canonical chapter waits on its player target and skipNextUntap through the next untap', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [sagaCard([saga({ chapters: [
      { numbers: [1], instructions: [] },
      { numbers: [2], decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] }, instructions: [
        tap(objects({ zone: 'battlefield', controller: { kind: 'targetRef', clauseIndex: 0 }, not: { type: 'Land' } }), { skipNextUntap: true }),
      ] },
    ] })])] },
    battlefield: {
      p2: [cardTemplate('Foe', { types: ['Creature'] }), cardTemplate('Foe Land', { types: ['Land'] })],
    },
  }, { random: () => 0 })
  const id = named(server.state, 'Saga fixture').id
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id })))
  state = ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' }))
  const selection = pendingPlayerSelectionFor(state, 'p1')!
  expect(selection.candidates).toEqual(['p2'])
  expect(state.objects[id].zone).toBe('battlefield')
  const restored = JSON.parse(JSON.stringify(state))
  state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: selection.id, players: ['p2'] }))
  expect(ok(server.rules(restored, { type: 'selectPlayers', seat: 'p1', selectionId: pendingPlayerSelectionFor(restored, 'p1')!.id, players: ['p2'] }))).toEqual(state)
  state = resolveStack(server.rules, state)
  expect(named(state, 'Foe')).toMatchObject({ tapped: true, skipNextUntap: true })
  expect(named(state, 'Foe Land').tapped).toBe(false)
  state = ok(server.rules({ ...state, step: 'cleanup', active: state.active, priority: null }, { type: 'advanceStep' }))
  expect(named(state, 'Foe')).toMatchObject({ tapped: true })
  expect(named(state, 'Foe').skipNextUntap).toBeUndefined()
})

test('a canonical chapter keeps the saga on the battlefield while its object target is still open', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [sagaCard([saga({ chapters: [
      { numbers: [1], instructions: [] },
      { numbers: [2], instructions: [] },
      { numbers: [3], decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'opponent' }), count: 1 })] }, instructions: [
        tap(target(0)),
      ] },
    ] })])] },
    battlefield: {
      p2: [cardTemplate('Relic', { types: ['Artifact'] })],
    },
  }, { random: () => 0 })
  const id = named(server.state, 'Saga fixture').id
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id })))
  state = resolveStack(server.rules, ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' })))
  state = ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' }))
  const pick = pendingSelectionFor(state, 'p1')!
  expect(pick.candidates).toEqual([named(state, 'Relic').id])
  expect(state.objects[id].zone).toBe('battlefield')
  state = ok(server.rules(state, {
    type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [named(state, 'Relic').id],
  }))
  expect(state.stack[0]).toMatchObject({ payload: { sagaChapter: 3 } })
  state = resolveStack(server.rules, state)
  expect(named(state, 'Relic').tapped).toBe(true)
  expect(state.objects[id].zone).toBe('graveyard')
})
