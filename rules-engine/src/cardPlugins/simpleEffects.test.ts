import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { activated } from './activated'
import { onResolve } from './onResolve'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('simple card effects', () => {
  test('Zagoth Triome cycling requires three mana and resolves from hand', () => {
    const triome = cardTemplate('Zagoth Triome', {
      types: ['Land'],
      subtypes: ['Swamp', 'Forest', 'Island'],
      tapProduces: { B: 1, G: 1, U: 1 },
    })
    const drawn = cardTemplate('Drawn card', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [triome] }, libraries: { p1: [drawn] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const triomeId = named(server.state, 'Zagoth Triome').id

    const rejected = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'cycling.zagothTriome',
      seat: 'p1',
      objectId: triomeId,
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.ok === false && rejected.error).toContain('not enough mana')

    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 3
    const cycled = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'cycling.zagothTriome',
      seat: 'p1',
      objectId: triomeId,
    }))
    expect(cycled.objects[triomeId].zone).toBe('graveyard')
    expect(named(cycled, 'Drawn card').zone).toBe('hand')
    expect(cycled.players.p1.mana.C).toBe(0)
  })

  test('Zagoth Triome cannot cycle from the battlefield', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Zagoth Triome', {
            types: ['Land'],
            tapProduces: { G: 1 },
          })],
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 3
    const result = server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'cycling.zagothTriome',
      seat: 'p1',
      objectId: named(ready, 'Zagoth Triome').id,
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not in hand')
  })

  test('Temple of the False God produces mana only with five lands', () => {
    const land = (name: string) => cardTemplate(name, {
      types: ['Land'],
      tapProduces: { G: 1 },
    })
    const temple = cardTemplate('Temple of the False God', {
      types: ['Land'],
      tapProduces: { C: 2 },
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [temple, land('One'), land('Two'), land('Three')] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const templeId = named(server.state, 'Temple of the False God').id
    const rejected = server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: templeId,
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.ok === false && rejected.error).toContain('cannot be activated')

    const fiveLands = structuredClone(server.state)
    const extra = cardTemplate('Four', { types: ['Land'], tapProduces: { G: 1 } })
    const extraId = 'extra-land'
    fiveLands.objects[extraId] = {
      ...extra,
      id: extraId,
      owner: 'p1',
      controller: 'p1',
      zone: 'battlefield',
    }
    fiveLands.zoneOrder.p1.battlefield.push(extraId)
    fiveLands.zoneCounts.p1.battlefield += 1
    const tapped = ok(server.rules(fiveLands, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: templeId,
    }))
    expect(tapped.players.p1.mana.C).toBe(2)
    expect(tapped.objects[templeId].tapped).toBe(true)
  })

  test('Windfall discards every hand and draws the greatest discarded count', () => {
    const windfall = cardTemplate('Windfall', { types: ['Sorcery'], manaCost: '{2}{U}' })
    const card = (name: string) => cardTemplate(name, { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [windfall, card('P1 card')], p2: [card('P2 a'), card('P2 b'), card('P2 c')] },
        libraries: {
          p1: [card('P1 draw 1'), card('P1 draw 2'), card('P1 draw 3')],
          p2: [card('P2 draw 1'), card('P2 draw 2'), card('P2 draw 3')],
        },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 2 }
    const windfallId = named(ready, 'Windfall').id
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: windfallId,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))

    expect(resolved.zoneOrder.p1.hand).toHaveLength(3)
    expect(resolved.zoneOrder.p2.hand).toHaveLength(3)
    expect(named(resolved, 'P1 card').zone).toBe('graveyard')
    expect(named(resolved, 'P2 c').zone).toBe('graveyard')
    expect(resolved.objects[windfallId].zone).toBe('graveyard')
  })
})
