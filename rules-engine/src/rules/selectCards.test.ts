import { describe, expect, test } from 'bun:test'
import { availableActions } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
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

  test('scry 2 orders top and bottom from server-owned candidates', () => {
    const server = createServerGame(commanderRules, {
      libraries: {
        p1: [card('Top'), card('Bottom'), card('Deep')],
      },
    })
    const [top, bottom] = server.state.zoneOrder.p1.library
    const draft = makeDraft(server.state)
    openCardSelection(draft, {
      seat: 'p1',
      kind: 'scry',
      count: 2,
      candidates: [top, bottom],
      destinations: ['top', 'bottom'],
    })
    const opened = freezeDraft(draft)

    const resolved = ok(server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'scry',
      count: 2,
      choices: [
        { objectId: top, destination: 'top' },
        { objectId: bottom, destination: 'bottom' },
      ],
    }))

    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name))
      .toEqual(['Top', 'Deep', 'Bottom'])
  })

  test('surveil 1 mills or keeps the private top card', () => {
    const server = createServerGame(commanderRules, {
      libraries: {
        p1: [card('Top'), card('Deep')],
      },
    })
    const [top, deep] = server.state.zoneOrder.p1.library
    const draft = makeDraft(server.state)
    openCardSelection(draft, {
      seat: 'p1',
      kind: 'surveil',
      count: 1,
      candidates: [top],
      destinations: ['top', 'graveyard'],
    })
    const opened = freezeDraft(draft)

    const milled = ok(server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'surveil',
      count: 1,
      choices: [{ objectId: top, destination: 'graveyard' }],
    }))
    expect(milled.objects[top].zone).toBe('graveyard')
    expect(milled.zoneOrder.p1.library).toEqual([deep])
  })

  test('only the choosing seat sees scry candidates in a projection', () => {
    const server = createServerGame(commanderRules, {
      libraries: {
        p1: [card('Seen'), card('Also Seen')],
        p2: [card('Hidden')],
      },
      players: 2,
    })
    const draft = makeDraft(server.state)
    openCardSelection(draft, {
      seat: 'p1',
      kind: 'scry',
      count: 2,
      candidates: server.state.zoneOrder.p1.library.slice(0, 2),
      destinations: ['top', 'bottom'],
    })
    const opened = freezeDraft(draft)

    const chooser = projectForViewer(opened, 'p1')
    const opponent = projectForViewer(opened, 'p2')

    expect(Object.values(chooser.objects).map((object) => object.name).sort())
      .toEqual(['Also Seen', 'Seen'])
    expect(Object.values(opponent.objects)).toEqual([])
    expect(chooser.zoneOrder.p1.library).toEqual([])
    expect(opponent.zoneOrder.p1.library).toEqual([])
  })
})
