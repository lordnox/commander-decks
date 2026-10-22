import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingSelectionFor } from '../../rules/selectCards'
import { instructionSpell } from './instructionTestSupport'
import { choice, chooseCardsForEachPlayer, chooseParticipants, discardHands, draw, move, objects, players, ref } from './v1'
import { PARTICIPATION_OPTION } from './collectedChoices'

const setup = (cards = false) => createServerGame(commanderRules, { players: 3,
  hands: { p1: [instructionSpell({ instructions: cards ? [
    chooseCardsForEachPlayer({ of: players(), filter: objects({ zone: 'hand', owner: ref('event.player') }), min: 0, max: 1, bindChoice: 'cards' }),
    move({ targets: choice('cards'), to: 'graveyard' }),
  ] : [chooseParticipants({ of: players(), bindChoice: 'participants' }), discardHands({ targets: choice('participants') }), draw({ targets: choice('participants'), count: 2 })] }), cardTemplate('Seat one hand')],
    p2: [cardTemplate('Seat two hand')], p3: [cardTemplate('Seat three hand')] },
  libraries: { p1: [cardTemplate('One A'), cardTemplate('One B')], p2: [cardTemplate('Two A'), cardTemplate('Two B')], p3: [cardTemplate('Three A'), cardTemplate('Three B')] },
}, { random: () => 0 })
const begin = (server: ReturnType<typeof setup>) => {
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

test('participation is collected before any discard or draw, then binds only accepting players', () => {
  const server = setup()
  let state = begin(server)
  for (const [seat, option] of [['p1', PARTICIPATION_OPTION.accept], ['p2', PARTICIPATION_OPTION.decline], ['p3', PARTICIPATION_OPTION.accept]] as const) {
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.zoneOrder.p2.hand).toHaveLength(1)
    expect(state.zoneOrder.p3.hand).toHaveLength(1)
    expect(state.zoneOrder.p1.library).toHaveLength(2)
    expect(state.priority).toBeNull()
    const event = { type: 'selectOption' as const, seat, selectionId: pendingOptionSelection(state, seat)!.id, optionId: option }
    const direct = ok(server.rules(state, event))
    expect(ok(server.rules(JSON.parse(JSON.stringify(state)), event))).toEqual(direct)
    state = direct
  }
  expect(state.zoneOrder.p1.hand).toHaveLength(2)
  expect(state.zoneOrder.p2.hand).toHaveLength(1)
  expect(state.zoneOrder.p3.hand).toHaveLength(2)
  expect(state.zoneOrder.p1.library).toHaveLength(0)
  expect(state.zoneOrder.p2.library).toHaveLength(2)
  expect(state.zoneOrder.p3.library).toHaveLength(0)
})

test('card choices remain in place until every seat has chosen, with independent private candidate sets', () => {
  const server = setup(true)
  let state = begin(server)
  const chosen: string[] = []
  for (const seat of ['p1', 'p2', 'p3']) {
    const pending = pendingSelectionFor(state, seat)!
    const own = server.project(state, seat)
    const other = seat === 'p1' ? 'p2' : 'p1'
    for (const id of state.zoneOrder[other].hand) expect(own.objects[id]).toBeUndefined()
    expect(pending.candidates).toEqual(state.zoneOrder[seat].hand)
    for (const id of chosen) expect(state.objects[id]!.zone).toBe('hand')
    const ids = seat === 'p2' ? [] : pending.candidates
    chosen.push(...ids)
    const event = { type: 'selectCards' as const, seat, selectionId: pending.id, kind: 'choose' as const, count: pending.count, objectIds: ids }
    const direct = ok(server.rules(state, event))
    expect(ok(server.rules(JSON.parse(JSON.stringify(state)), event))).toEqual(direct)
    state = direct
  }
  for (const id of chosen) expect(state.objects[id]!.zone).toBe('graveyard')
  expect(state.zoneOrder.p2.hand).toHaveLength(1)
  expect(state.resolution).toBeUndefined()
})


test('collection follows APNAP order when the caster is not the active player, including all-decline', () => {
  const server = setup()
  const initial = structuredClone(server.state)
  initial.active = 'p2'
  initial.priority = 'p1'
  const cast = ok(server.rules(initial, { type: 'castSpell', seat: 'p1', objectId: initial.zoneOrder.p1.hand[0]! }))
  let state = ok(server.rules(cast, { type: 'resolveTop' }))
  for (const seat of ['p2', 'p3', 'p1']) {
    expect(pendingOptionSelection(state)!.seat).toBe(seat)
    state = ok(server.rules(state, { type: 'selectOption', seat, selectionId: pendingOptionSelection(state, seat)!.id, optionId: PARTICIPATION_OPTION.decline }))
  }
  for (const seat of state.playerOrder) {
    expect(state.zoneOrder[seat].hand).toHaveLength(1)
    expect(state.zoneOrder[seat].library).toHaveLength(2)
  }
  expect(state.resolution).toBeUndefined()
})

test.each([0, 1, 2])('collected card choices choose all available when fewer than required (%s)', size => {
  const server = createServerGame(commanderRules, { players: 2, hands: {
    p1: [instructionSpell({ instructions: [chooseCardsForEachPlayer({ of: players({ relation: 'opponent' }), filter: objects({ zone: 'hand', owner: ref('event.player') }), min: 2, max: 2, bindChoice: 'cards' }), move({ targets: choice('cards'), to: 'exile' })] })],
    p2: Array.from({ length: size }, (_, i) => cardTemplate(`Available ${i}`)),
  } }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))
  let state = ok(server.rules(cast, { type: 'resolveTop' }))
  const pending = pendingSelectionFor(state, 'p2')
  if (size) {
    expect(pending!.count).toBe(size)
    expect(pending!.min).toBe(size)
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p2', selectionId: pending!.id, kind: 'choose', count: pending!.count, objectIds: pending!.candidates }))
  } else expect(pending).toBeUndefined()
  expect(state.zoneOrder.p2.exile).toHaveLength(size)
  expect(state.resolution).toBeUndefined()
})
