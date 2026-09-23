import { describe, expect, test } from 'bun:test'
import { availableActions } from '../actions'
import { createCatalog } from '../catalog'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { cardTemplate } from '../newGame'
import { newGame } from '../testGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { validTarget } from '../cardPlugins/targetedResolve'
import { discard } from '../rules/discard'
import { draw } from '../rules/draw'
import { openCardSelection, pendingSelectionFor } from '../rules/selectCards'
import { turnStructure } from './turnStructure'
import { priority } from './priority'
import { makeDraft, freezeDraft } from '../draft'

const creature = (name: string) => cardTemplate(name, {
  types: ['Creature'],
  power: 2,
  toughness: 2,
})

const diedThisTurnFilter = {
  zone: 'graveyard',
  controller: 'you',
  permanent: true,
  fromBattlefieldThisTurn: true,
}

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const catalog = createCatalog([turnStructure, priority, draw, discard])
const builtinRules = ['turnStructure', 'priority', 'draw', 'discard']

const step = (state: GameState) => ok(rules(state, { type: 'advanceStep' }, catalog))

const idNamed = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)?.id

describe('fromBattlefieldThisTurn targeting', () => {
  test('validTarget matches a permanent put into the graveyard from the battlefield this turn', () => {
    const fallen = creature('Fallen Gargoyle')
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [fallen] },
    })
    const fallenId = idNamed(server.state, 'Fallen Gargoyle')
    expect(fallenId).toBeDefined()
    const destroyed = ok(server.rules(server.state, {
      type: 'move',
      objectId: fallenId!,
      to: 'graveyard',
    }))
    const card = destroyed.objects[fallenId!]
    expect(validTarget(destroyed, card, diedThisTurnFilter, 'p1')).toBe(true)
  })

  test('milled and discarded cards do not match', () => {
    const milled = creature('Milled Relic')
    const discarded = creature('Discarded Relic')
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [milled] },
      hands: { p1: [discarded] },
    })
    const milledId = server.state.zoneOrder.p1.library[0]
    const discardedId = server.state.zoneOrder.p1.hand[0]
    const afterMill = ok(server.rules(server.state, {
      type: 'move',
      objectId: milledId,
      to: 'graveyard',
    }))
    const afterDiscard = ok(server.rules(afterMill, {
      type: 'discard',
      seat: 'p1',
      objectId: discardedId,
    }))
    expect(validTarget(afterDiscard, afterDiscard.objects[milledId], diedThisTurnFilter, 'p1')).toBe(false)
    expect(validTarget(afterDiscard, afterDiscard.objects[discardedId], diedThisTurnFilter, 'p1')).toBe(false)
  })

  test('a permanent that died last turn does not match after the next untap', () => {
    const fallen = creature('Yesterday Gargoyle')
    const base = newGame({
      builtinRules,
      first: 'p2',
      battlefield: { p1: [fallen] },
    })
    const fallenId = idNamed(base, 'Yesterday Gargoyle')!
    const died = ok(rules(base, { type: 'move', objectId: fallenId, to: 'graveyard' }, catalog))
    expect(validTarget(died, died.objects[fallenId], diedThisTurnFilter, 'p1')).toBe(true)

    let state = { ...died, step: 'cleanup' as const }
    state = step(state)
    expect(state.turn).toBe(2)
    expect(validTarget(state, state.objects[fallenId], diedThisTurnFilter, 'p1')).toBe(false)
  })

  test('selectCards only offers graveyard permanents that died from the battlefield this turn', () => {
    const diedToday = creature('Today Statue')
    const milled = creature('Library Statue')
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [diedToday] },
      libraries: { p1: [milled] },
    })
    const diedId = idNamed(server.state, 'Today Statue')!
    let state = ok(server.rules(server.state, { type: 'move', objectId: diedId, to: 'graveyard' }))
    state = ok(server.rules(state, {
      type: 'move',
      objectId: state.zoneOrder.p1.library[0],
      to: 'graveyard',
    }))
    const draft = makeDraft(state)
    openCardSelection(draft, {
      seat: 'p1',
      kind: 'choose',
      count: 1,
      candidates: state.zoneOrder.p1.graveyard,
      fromSeat: 'p1',
      fromZone: 'graveyard',
      targetFilter: diedThisTurnFilter,
      prompt: 'Choose a permanent card in your graveyard that was put there from the battlefield this turn.',
      destinations: ['target'],
      moveSelectedTo: 'hand',
    })
    const opened = freezeDraft(draft)
    const action = availableActions(opened, 'p1')[0]
    expect(action).toMatchObject({
      kind: 'selectCards',
      cardKind: 'choose',
      count: 1,
      objectIds: [diedId],
    })

    const resolved = ok(server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [diedId],
    }))
    expect(resolved.objects[diedId].zone).toBe('hand')
    expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
  })

  test('selectCards rejects a milled candidate when targetFilter requires battlefield death', () => {
    const milled = creature('Rejected Statue')
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [milled] },
    })
    const milledId = server.state.zoneOrder.p1.library[0]
    const state = ok(server.rules(server.state, {
      type: 'move',
      objectId: milledId,
      to: 'graveyard',
    }))
    const draft = makeDraft(state)
    openCardSelection(draft, {
      seat: 'p1',
      kind: 'choose',
      count: 1,
      candidates: [milledId],
      fromSeat: 'p1',
      fromZone: 'graveyard',
      targetFilter: diedThisTurnFilter,
      destinations: ['target'],
    })
    const opened = freezeDraft(draft)
    const result = server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [milledId],
    })
    expect(result.ok).toBe(false)
  })
})
