import { describe, expect, test } from 'bun:test'
import { availableActions } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import {
  openCardSelection,
  pendingSelection,
  pendingSelectionFor,
} from './selectCards'
import { makeDraft, freezeDraft } from '../draft'

const card = (name: string, types: string[] = ['Instant']) =>
  cardTemplate(name, { types })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('selectCards game rule', () => {
  test('opens a server-owned candidate list and resolves with selectCards', () => {
    const server = createServerGame(commanderRules, {
      hands: { p2: [card('Island'), card('Forest')] },
      players: 2,
    })
    const island = server.state.zoneOrder.p2.hand[0]
    const draft = makeDraft(server.state)
    openCardSelection(draft, {
      seat: 'p2',
      kind: 'discard',
      count: 1,
      candidates: server.state.zoneOrder.p2.hand,
      source: 'Rankle, Master of Pranks',
      destinations: ['graveyard'],
    })
    const opened = freezeDraft(draft)

    expect(pendingSelectionFor(opened, 'p2')).toMatchObject({
      kind: 'discard',
      count: 1,
      candidates: [island, server.state.zoneOrder.p2.hand[1]],
    })

    const action = availableActions(opened, 'p2')[0]
    expect(action).toMatchObject({
      kind: 'selectCards',
      cardKind: 'discard',
      count: 1,
      objectIds: opened.zoneOrder.p2.hand,
    })

    const discarded = ok(server.rules(opened, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'discard',
      count: 1,
      objectIds: [island],
    }))

    expect(discarded.objects[island].zone).toBe('graveyard')
    expect(pendingSelectionFor(discarded, 'p2')).toBeUndefined()
  })

  test('rejects choices outside the offered candidate list', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [card('Hand Card')], p2: [card('Secret')] },
      players: 2,
    })
    const offered = server.state.zoneOrder.p2.hand[0]
    const foreign = server.state.zoneOrder.p1.hand[0]
    const draft = makeDraft(server.state)
    openCardSelection(draft, {
      seat: 'p2',
      kind: 'discard',
      count: 1,
      candidates: [offered],
      destinations: ['graveyard'],
    })
    const opened = freezeDraft(draft)

    const result = server.rules(opened, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'discard',
      count: 1,
      objectIds: [foreign],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.state).toEqual(opened)
  })

  test('blocks passPriority while a selection is open', () => {
    const server = createServerGame(commanderRules, {
      hands: { p2: [card('Waiting')] },
      players: 2,
    })
    const draft = makeDraft(server.state)
    openCardSelection(draft, {
      seat: 'p2',
      kind: 'discard',
      count: 1,
      candidates: server.state.zoneOrder.p2.hand,
      destinations: ['graveyard'],
    })
    const opened = freezeDraft(draft)

    const result = server.rules(opened, { type: 'passPriority', seat: 'p2' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('p2 is choosing cards')
  })

  test('sacrifice moves a chosen battlefield creature to the graveyard', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [cardTemplate('Hydra', { types: ['Creature'], power: 9, toughness: 9 })],
      },
      players: 2,
    })
    const hydra = server.state.zoneOrder.p1.battlefield[0]
    const draft = makeDraft(server.state)
    openCardSelection(draft, {
      seat: 'p1',
      kind: 'sacrifice',
      count: 1,
      candidates: [hydra],
      source: 'Rankle, Master of Pranks',
      destinations: ['battlefield', 'sacrifice'],
      fromSeat: 'p1',
    })
    const opened = freezeDraft(draft)

    const sacrificed = ok(server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'sacrifice',
      count: 1,
      objectIds: [hydra],
    }))

    expect(sacrificed.objects[hydra].zone).toBe('graveyard')
    expect(pendingSelectionFor(sacrificed, 'p1')).toBeUndefined()
  })

  test('pendingSelection returns the first open choice in player order', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [card('One')], p2: [card('Two')] },
      players: 2,
    })
    const draft = makeDraft(server.state)
    openCardSelection(draft, {
      seat: 'p2',
      kind: 'discard',
      count: 1,
      candidates: server.state.zoneOrder.p2.hand,
      destinations: ['graveyard'],
    })
    openCardSelection(draft, {
      seat: 'p1',
      kind: 'discard',
      count: 1,
      candidates: server.state.zoneOrder.p1.hand,
      destinations: ['graveyard'],
    })
    const opened = freezeDraft(draft)

    expect(pendingSelection(opened)?.seat).toBe('p1')
  })
})
