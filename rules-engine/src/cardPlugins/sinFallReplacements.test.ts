import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { abundance } from './abundance'
import { alternateCosts } from './alternateCosts'
import { hiddenPiles } from './hiddenPiles'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'

const card = (name: string, types: string[], manaCost = '') =>
  cardTemplate(name, { types, manaCost })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('Sin Fall replacement and hidden-information cards', () => {
  test('Abundance replaces each draw, orders the rest, and keeps choices private', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        battlefield: { p1: [card('Abundance', ['Enchantment'])] },
        libraries: {
          p1: [
            card('First Spell', ['Instant']),
            card('Wanted Land', ['Land']),
            card('Next Spell', ['Sorcery']),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [abundance] },
    )
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 2 }))
    const choice = pendingOptionSelection(state, 'p1')!
    expect(choice.options.map(({ id }) => id)).toEqual(['draw', 'land', 'nonland'])
    expect(server.project(state, 'p1').players.p1.data['kernel.pendingOptionSelection'])
      .toBeDefined()
    expect(server.project(state, 'p2').players.p1.data['kernel.pendingOptionSelection'])
      .toBeUndefined()
    expect(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: choice.id,
      optionId: 'creature',
    }).ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: choice.id,
      optionId: 'land',
    }))
    expect(named(state, 'Wanted Land').zone).toBe('hand')
    const order = pendingSelectionFor(state, 'p1')!
    expect(order.candidates.map((id) => state.objects[id].name)).toEqual(['First Spell'])
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'scry',
      count: 1,
      choices: [{ objectId: order.candidates[0], destination: 'bottom' }],
    }))
    const second = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: second.id,
      optionId: 'draw',
    }))
    expect(named(state, 'Next Spell').zone).toBe('hand')
    expect(named(state, 'First Spell').zone).toBe('library')
    expect(pendingOptionSelection(state)).toBeUndefined()
  })

  test('Cling to Dust escape exiles exactly five other graveyard cards and resolves', () => {
    const fillers = Array.from({ length: 5 }, (_, index) => card(`Filler ${index}`, ['Sorcery']))
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: {
          p1: [
            card('Cling to Dust', ['Instant'], '{B}'),
            ...fillers,
            card('Target Creature', ['Creature']),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [alternateCosts, targetedResolve] },
    )
    let state = structuredClone(server.state)
    for (const objectId of state.zoneOrder.p1.hand.slice()) {
      state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
    }
    state.players.p1.mana.B = 1
    state.players.p1.mana.C = 3
    const cling = named(state, 'Cling to Dust')
    const target = named(state, 'Target Creature')
    const costs = fillers.map(({ name }) => named(state, name).id)
    const action = legalActsFor(state, 'p1').find((candidate) =>
      candidate.kind === 'castSpell'
      && candidate.objectId === cling.id
      && candidate.castOption === 'escape')
    expect(action).toMatchObject({
      castLabel: 'Escape—{3}{B}, Exile 5 other cards from your graveyard.',
      targetGroups: [{ min: 5, max: 5, purpose: 'cost' }],
    })
    expect(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: cling.id,
      castOption: 'escape',
      exile: [cling.id, ...costs.slice(0, 4)],
      targets: [{ kind: 'object', objectId: target.id }],
    }).ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: cling.id,
      castOption: 'escape',
      exile: costs,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    expect(costs.every((id) => state.objects[id].zone === 'exile')).toBe(true)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(target.zone).not.toBe('exile')
    expect(state.objects[target.id].zone).toBe('exile')
    expect(state.objects[cling.id].zone).toBe('graveyard')
    expect(state.players.p1.life).toBe(43)
  })

  test('Hostile Negotiations reveals one pile without leaking the other and completes', () => {
    const library = Array.from({ length: 7 }, (_, index) =>
      card(`Library ${index + 1}`, index === 3 ? ['Land'] : ['Sorcery']))
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: { p1: [card('Hostile Negotiations', ['Instant'], '{3}{B}')] },
        libraries: { p1: library },
      },
      { random: () => 0.5, cardPlugins: [onResolve, hiddenPiles] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana.B = 1
    state.players.p1.mana.C = 3
    const spell = named(state, 'Hostile Negotiations')
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const reveal = pendingOptionSelection(state, 'p1')!
    expect(reveal.options).toHaveLength(4)
    expect(state.zoneOrder.p1.exile).toHaveLength(6)
    expect(server.project(state, 'p1').zoneOrder.p1.exile).toHaveLength(6)
    expect(server.project(state, 'p2').zoneOrder.p1.exile).toHaveLength(0)

    const revealChoice = reveal.options.find(({ id }) => id === '0:p2')!
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: reveal.id,
      optionId: revealChoice.id,
    }))
    const take = pendingOptionSelection(state, 'p2')!
    expect(take.options[0].label).toContain('Library 1')
    expect(take.options[1].label).toBe('Face-down pile 2 (3 cards)')
    const bystander = server.project(state, 'p3')
    expect(bystander.zoneOrder.p1.exile).toHaveLength(3)
    expect(JSON.stringify(bystander)).not.toContain('Library 4')
    expect(bystander.players.p2.data['kernel.pendingOptionSelection']).toBeUndefined()

    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: take.id,
      optionId: '1',
    }))
    expect(state.zoneOrder.p1.hand.map((id) => state.objects[id].name).sort())
      .toEqual(['Library 4', 'Library 5', 'Library 6'])
    expect(state.zoneOrder.p1.graveyard.map((id) => state.objects[id].name).sort())
      .toEqual(['Hostile Negotiations', 'Library 1', 'Library 2', 'Library 3'])
    expect(state.players.p1.life).toBe(37)
    expect(pendingOptionSelection(state)).toBeUndefined()
  })
})
