import { describe, expect, test } from 'bun:test'
import { freezeDraft, makeDraft } from '../draft'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, Plugin, ReduceResult } from '../types'
import { initiateDiscard } from './discard'

const card = (name: string, types: string[] = ['Instant']) =>
  cardTemplate(name, { types })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const pushDiscard = (
  state: GameState,
  args: Parameters<typeof initiateDiscard>[1],
) => {
  const draft = makeDraft(state)
  const item = initiateDiscard(draft, args)
  return { state: freezeDraft(draft), item }
}

describe('discard game rule', () => {
  test('CR 701.9a discard event moves a known card from hand to graveyard', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [card('Hand Card')] },
      players: 2,
    })
    const objectId = server.state.zoneOrder.p1.hand[0]

    const discarded = ok(server.rules(server.state, {
      type: 'discard',
      seat: 'p1',
      objectId,
    }))

    expect(discarded.objects[objectId].zone).toBe('graveyard')
    expect(discarded.zoneOrder.p1.graveyard).toContain(objectId)
  })

  test('CR 701.9a rejects discard when the card is not in hand', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [card('On Board', ['Creature'])] },
      players: 2,
    })
    const objectId = server.state.zoneOrder.p1.battlefield[0]

    const result = server.rules(server.state, {
      type: 'discard',
      seat: 'p1',
      objectId,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.state).toEqual(server.state)
  })

  test('discard action with chosen objectIds resolves immediately', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [card('Chosen')] },
      players: 2,
    })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const { state: stacked, item } = pushDiscard(server.state, {
      seat: 'p1',
      count: 1,
      objectIds: [objectId],
    })

    expect(stacked.stack).toHaveLength(1)
    expect(stacked.stack[0].id).toBe(item.id)

    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))

    expect(resolved.stack).toHaveLength(0)
    expect(resolved.objects[objectId].zone).toBe('graveyard')
  })

  test('discard action without choices waits with a stable stack id', () => {
    const server = createServerGame(commanderRules, {
      hands: { p2: [card('Waiting')] },
      players: 2,
    })
    const objectId = server.state.zoneOrder.p2.hand[0]
    const { state: stacked, item } = pushDiscard(server.state, {
      seat: 'p2',
      count: 1,
    })

    const waiting = ok(server.rules(stacked, { type: 'resolveTop' }))

    expect(waiting.stack).toHaveLength(1)
    expect(waiting.stack[0].id).toBe(item.id)
    expect(waiting.stack[0].waiting).toBe('choice')
    expect(waiting.objects[objectId].zone).toBe('hand')

    const continued = ok(server.rules(waiting, {
      type: 'continueAction',
      stackId: item.id,
      seat: 'p2',
      payload: { objectIds: [objectId] },
    }))

    expect(continued.stack).toHaveLength(0)
    expect(continued.objects[objectId].zone).toBe('graveyard')
  })

  test('CR 701.9b discarding two cards fires two discard events', () => {
    let discardEvents = 0
    const witness: Plugin = {
      id: 'discardWitness',
      apply: ({ event }) => {
        if (event.type === 'discard') discardEvents += 1
      },
    }
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('One'), card('Two')] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [witness] },
    )
    const [first, second] = server.state.zoneOrder.p1.hand
    const { state: stacked } = pushDiscard(server.state, {
      seat: 'p1',
      count: 2,
      objectIds: [first, second],
    })

    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))

    expect(discardEvents).toBe(2)
    expect(resolved.objects[first].zone).toBe('graveyard')
    expect(resolved.objects[second].zone).toBe('graveyard')
  })

  test('discard action discards as many cards as possible when hand is smaller than count', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [card('Only One')] },
      players: 2,
    })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const { state: stacked } = pushDiscard(server.state, {
      seat: 'p1',
      count: 2,
      objectIds: [objectId],
    })

    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))

    expect(resolved.stack).toHaveLength(0)
    expect(resolved.objects[objectId].zone).toBe('graveyard')
  })

  test('random discard resolves immediately and picks distinct cards', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [card('One'), card('Two'), card('Three')] },
      players: 2,
    }, { random: () => 0 })
    const { state: stacked } = pushDiscard(server.state, {
      seat: 'p1',
      count: 2,
      random: true,
    })

    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))

    expect(resolved.stack).toHaveLength(0)
    expect(resolved.zoneOrder.p1.graveyard).toHaveLength(2)
    expect(new Set(resolved.zoneOrder.p1.graveyard).size).toBe(2)
    expect(resolved.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('continueAction rejects duplicate objectIds', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [card('Only')] },
      players: 2,
    })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const { state: stacked, item } = pushDiscard(server.state, {
      seat: 'p1',
      count: 1,
    })
    const waiting = ok(server.rules(stacked, { type: 'resolveTop' }))

    const duplicate = server.rules(waiting, {
      type: 'continueAction',
      stackId: item.id,
      seat: 'p1',
      payload: { objectIds: [objectId, objectId] },
    })
    expect(duplicate.ok).toBe(false)
    if (duplicate.ok) return
    expect(duplicate.state).toEqual(waiting)
  })

  test('illegal continueAction is rejected without changing state', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [card('Chooser Card')],
        p2: [card('Wrong Seat')],
      },
      players: 2,
    })
    const p2Card = server.state.zoneOrder.p2.hand[0]
    const { state: stacked, item } = pushDiscard(server.state, {
      seat: 'p2',
      count: 1,
    })
    const waiting = ok(server.rules(stacked, { type: 'resolveTop' }))

    const wrongStack = server.rules(waiting, {
      type: 'continueAction',
      stackId: 'stack-missing',
      seat: 'p2',
      payload: { objectIds: [p2Card] },
    })
    expect(wrongStack.ok).toBe(false)
    if (wrongStack.ok) return
    expect(wrongStack.state).toEqual(waiting)

    const wrongSeat = server.rules(waiting, {
      type: 'continueAction',
      stackId: item.id,
      seat: 'p1',
      payload: { objectIds: [p2Card] },
    })
    expect(wrongSeat.ok).toBe(false)
    if (wrongSeat.ok) return
    expect(wrongSeat.state).toEqual(waiting)

    const notInHand = server.rules(waiting, {
      type: 'continueAction',
      stackId: item.id,
      seat: 'p2',
      payload: { objectIds: [server.state.zoneOrder.p1.hand[0]] },
    })
    expect(notInHand.ok).toBe(false)
    if (notInHand.ok) return
    expect(notInHand.state).toEqual(waiting)
  })
})
