import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import {
  becomeMonarch,
  enters,
  exileUntilOpponentBecomesMonarch,
  onResolve,
} from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { newGame } from '../testGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { bears } from '../testGame'
import { combat } from './combat'
import { damage } from './damage'
import { draw } from '../rules/main'
import { life } from './life'
import { monarch } from './monarch'
import { turnStructure } from './turnStructure'
import type { GameState } from '../types'

const creature = (name: string, controller?: 'p1' | 'p2' | 'p3') =>
  cardTemplate(name, {
    types: ['Creature'],
    power: 2,
    toughness: 2,
    ...(controller ? { controller } : {}),
  })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('monarch', () => {
  test('becomeMonarch designates at most one monarch', () => {
    const catalog = createCatalog([monarch])
    const state = newGame({ players: 3, builtinRules: ['monarch'] })
    const crowned = ok(rules(state, { type: 'becomeMonarch', seat: 'p1' }, catalog))
    expect(crowned.monarch).toBe('p1')
    const stolen = ok(rules(crowned, { type: 'becomeMonarch', seat: 'p2' }, catalog))
    expect(stolen.monarch).toBe('p2')
  })

  test('combat damage to the monarch passes the crown to the attacking player', () => {
    const catalog = createCatalog([combat, damage, life, monarch])
    let state = newGame({
      players: 3,
      battlefield: { p1: [bears()] },
      builtinRules: ['combat', 'damage', 'life', 'monarch'],
    })
    state = ok(rules(state, { type: 'becomeMonarch', seat: 'p2' }, catalog))
    const attackerId = Object.values(state.objects).find((o) => o.controller === 'p1')!.id
    state.objects[attackerId].attacking = 'p2'
    state.step = 'combatDamage'
    state = ok(rules(state, { type: 'assignCombatDamage' }, catalog))
    expect(state.monarch).toBe('p1')
  })

  test('the monarch draws at the beginning of their end step', () => {
    const catalog = createCatalog([turnStructure, draw, monarch])
    let state = newGame({
      players: 2,
      libraries: { p1: [cardTemplate('Top Card')] },
      builtinRules: ['turnStructure', 'draw', 'monarch'],
    })
    state.active = 'p1'
    state.step = 'postcombatMain'
    state = ok(rules(state, { type: 'becomeMonarch', seat: 'p1' }, catalog))
    const beforeHand = state.zoneCounts.p1.hand
    state = ok(rules(state, { type: 'advanceStep' }, catalog))
    expect(state.step).toBe('end')
    expect(state.zoneCounts.p1.hand).toBe(beforeHand + 1)
  })

  test('becomeMonarch instruction runs through the event', () => {
    const crown = creature('Crown Heralds', 'p1')
    crown.effects = [enters(becomeMonarch())]
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [crown] },
    })
    const crownId = named(server.state, 'Crown Heralds').id
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: crownId,
      to: 'battlefield',
    }))
    const resolved = resolveStack(server.rules, entered)
    expect(resolved.monarch).toBe('p1')
  })
})

describe('monarch linked exile', () => {
  const game = (setup: {
    hands?: Record<string, ReturnType<typeof cardTemplate>[]>
    battlefield?: Record<string, ReturnType<typeof cardTemplate>[]>
  }) =>
    createServerGame(commanderRules, { ...setup, players: 3 }, { random: () => 0.5 })

  test('exiles until an opponent becomes monarch and survives the source leaving', () => {
    const warden = creature('Throne Warden', 'p1')
    warden.effects = [
      {
        op: 'trigger',
        on: 'enters',
        targets: { filter: { type: 'Creature', controller: 'opponent' } },
        do: [becomeMonarch(), exileUntilOpponentBecomesMonarch({ type: 'Creature', controller: 'opponent' })],
      },
    ]
    const hostage = creature('Held Captive', 'p2')
    const server = game({ hands: { p1: [warden] }, battlefield: { p2: [hostage] } })
    const wardenId = named(server.state, 'Throne Warden').id
    const hostageId = named(server.state, 'Held Captive').id

    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: wardenId,
      to: 'battlefield',
    }))
    expect(pendingSelectionFor(entered, 'p1')).toBeDefined()
    const targeted = ok(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [hostageId],
    }))
    const resolved = resolveStack(server.rules, targeted)
    expect(resolved.monarch).toBe('p1')
    expect(resolved.objects[hostageId]).toMatchObject({
      zone: 'exile',
      exiledWith: wardenId,
      exiledUntilOpponentMonarch: true,
    })

    const sacrificed = ok(server.rules(resolved, {
      type: 'sacrifice',
      objectId: wardenId,
    }))
    expect(sacrificed.objects[hostageId].zone).toBe('exile')

    const crowned = ok(server.rules(sacrificed, { type: 'becomeMonarch', seat: 'p2' }))
    expect(crowned.objects[hostageId]).toMatchObject({
      zone: 'battlefield',
      controller: crowned.objects[hostageId].owner,
    })
    expect(crowned.objects[hostageId].exiledUntilOpponentMonarch).toBeUndefined()
  })

  test('private projection keeps the hostage choice on the choosing seat only', () => {
    const warden = creature('Throne Warden', 'p1')
    warden.effects = [
      {
        op: 'trigger',
        on: 'enters',
        targets: { filter: { type: 'Creature', controller: 'opponent' } },
        do: [exileUntilOpponentBecomesMonarch({ type: 'Creature', controller: 'opponent' })],
      },
    ]
    const hostage = creature('Held Captive', 'p2')
    const server = game({ hands: { p1: [warden] }, battlefield: { p2: [hostage] } })
    const wardenId = named(server.state, 'Throne Warden').id
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: wardenId,
      to: 'battlefield',
    }))
    const p1View = server.project(entered, 'p1')
    const p2View = server.project(entered, 'p2')
    expect(pendingSelectionFor(p1View, 'p1')).toBeDefined()
    expect(pendingSelectionFor(p2View, 'p1')).toBeUndefined()
    expect(p1View.monarch).toBeNull()
  })

  test('host restart preserves an open monarch-exile target choice', () => {
    const warden = creature('Throne Warden', 'p1')
    warden.effects = [
      enters(exileUntilOpponentBecomesMonarch({ type: 'Creature', controller: 'opponent' })),
    ]
    const hostage = creature('Held Captive', 'p2')
    const server = game({ hands: { p1: [warden] }, battlefield: { p2: [hostage] } })
    const wardenId = named(server.state, 'Throne Warden').id
    const hostageId = named(server.state, 'Held Captive').id
    let entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: wardenId,
      to: 'battlefield',
    }))
    entered = ok(server.rules(entered, { type: 'resolveTop' }))
    expect(pendingSelectionFor(entered, 'p1')).toBeDefined()
    const restarted = structuredClone(entered)
    expect(pendingSelectionFor(restarted, 'p1')?.id).toBe(
      pendingSelectionFor(entered, 'p1')?.id,
    )
    const finished = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [hostageId],
    }))
    expect(finished.objects[hostageId].zone).toBe('exile')
  })

  test('clone-safe stamped effects stay serializable', () => {
    const warden = creature('Throne Warden', 'p1')
    warden.effects = [
      enters(becomeMonarch(), exileUntilOpponentBecomesMonarch({ type: 'Creature', controller: 'opponent' })),
    ]
    expect(() => structuredClone(warden.effects)).not.toThrow()
  })
})
