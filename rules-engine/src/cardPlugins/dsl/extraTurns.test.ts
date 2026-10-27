import type { GameState } from '../../types'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { createServerGame, projectForViewer } from '../../runtime'
import { cardTemplate } from '../../newGame'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { eventsForAvailableAction, legalActsFor } from '../../actions'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { players, ref, select, takeExtraTurn, target } from './v1'

const extraTurnFor = () => instructionSpell({
  decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
  instructions: [takeExtraTurn(target(0))],
})

const game = (spells = 1) => createServerGame(commanderRules, {
  players: 3,
  hands: { p1: Array.from({ length: spells }, extraTurnFor) },
}, { random: () => 0 })

const cast = (server: ReturnType<typeof game>, state: GameState, player: string) =>
  resolveStack(server.rules, ok(server.rules(state, {
    type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0], targets: [{ kind: 'player', player }],
  })))

const nextTurn = (server: ReturnType<typeof game>, state: GameState) =>
  ok(server.rules({ ...state, step: 'cleanup', priority: state.active, passedInRow: [] }, { type: 'advanceStep' }))

test('an extra turn is taken right after this turn, then normal order resumes after the original player', () => {
  const server = game()
  const scheduled = restoreJournal(createJournal(cast(server, server.state, 'p3')), server.rules).current()
  expect(scheduled.extraTurns).toEqual(['p3'])
  const extra = restoreJournal(createJournal(nextTurn(server, scheduled)), server.rules).current()
  expect(extra.active).toBe('p3')
  const resumed = nextTurn(server, extra)
  expect(resumed.active).toBe('p2')
  expect(nextTurn(server, resumed).active).toBe('p3')
})

test('CR 500.7: the most recently created extra turn is taken first', () => {
  const server = game(2)
  const both = cast(server, cast(server, server.state, 'p3'), 'p2')
  expect(both.extraTurns).toEqual(['p2', 'p3'])
  const first = nextTurn(server, both)
  expect(first.active).toBe('p2')
  const second = nextTurn(server, first)
  expect(second.active).toBe('p3')
  expect(nextTurn(server, second).active).toBe('p2')
})

test('an extra turn for a player who has left the game is skipped', () => {
  const server = game()
  const scheduled = cast(server, server.state, 'p3')
  const conceded = ok(server.rules(scheduled, { type: 'concede', seat: 'p3' }))
  expect(nextTurn(server, conceded).active).toBe('p2')
})

test('takeExtraTurn only accepts player recipients', () => {
  expect(() => instructionSpell({ instructions: [takeExtraTurn(ref('source') as never)] })).toThrow()
})

test('Perch Protection gifts an extra turn and phases out on the promised gift', () => {
  const server = createServerGame(commanderRules, {
    players: 4,
    hands: { p1: [cardTemplate('Perch Protection')] },
    battlefield: { p1: [cardTemplate('Held Bear', { types: ['Creature'], power: 2, toughness: 2 })] },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 4 }
  const spell = Object.values(ready.objects).find((object) => object.name === 'Perch Protection')!
  const gifts = legalActsFor(ready, 'p1').filter((action) =>
    action.kind === 'castSpell' && action.objectId === spell.id && action.selectedOptionalCosts?.includes(0))
  expect(gifts.map((action) => action.kind === 'castSpell' ? action.costPlayers?.['0'] : undefined))
    .toEqual(['p2', 'p3', 'p4'])
  const gifted = gifts.find((action) => action.kind === 'castSpell' && action.costPlayers?.['0'] === 'p2')!
  const cast = eventsForAvailableAction(ready, 'p1', gifted)!.reduce((current, event) => ok(server.rules(current, event)), ready)
  expect(cast.stack[0]?.execution?.announcement?.costChoices).toMatchObject({
    optional: [0],
    players: { 0: 'p2' },
  })
  const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
  expect(resolved.zoneOrder.p1.battlefield.filter((id) =>
    resolved.objects[id].subtypes.includes('Bird'))).toHaveLength(4)
  expect(resolved.objects[Object.values(resolved.objects).find((object) => object.name === 'Held Bear')!.id].phasedOut)
    .toBe(true)
  expect(resolved.extraTurns).toEqual(['p2'])
})

test('Perch Protection gift recipient survives JSON restore and is hidden from another player', () => {
  const server = createServerGame(commanderRules, {
    players: 4,
    hands: { p1: [cardTemplate('Perch Protection')] },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 4 }
  const spell = Object.values(ready.objects).find((object) => object.name === 'Perch Protection')!
  const gifted = legalActsFor(ready, 'p1').find((action) =>
    action.kind === 'castSpell' && action.objectId === spell.id && action.costPlayers?.['0'] === 'p3')!
  const cast = eventsForAvailableAction(ready, 'p1', gifted)!.reduce((current, event) => ok(server.rules(current, event)), ready)
  const restored = JSON.parse(JSON.stringify(cast)) as typeof cast
  expect(restored.stack[0]?.execution?.announcement?.costChoices).toMatchObject({
    optional: [0],
    players: { 0: 'p3' },
  })
  expect(pendingPlayerSelectionFor(projectForViewer(restored, 'p2'), 'p1')).toBeUndefined()
  expect(ok(server.rules(restored, { type: 'resolveTop' })).extraTurns).toEqual(['p3'])
})
