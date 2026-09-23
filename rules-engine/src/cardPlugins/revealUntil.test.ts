import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import type { ReduceResult } from '../types'
import { onResolve, revealUntil, revealUntilBasicLand } from './effects'
import { onResolve as onResolvePlugin } from './onResolve'
import { serializableEffects } from './effectRuntime'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const graveyardNames = (state: ReturnType<typeof createServerGame>['state']) =>
  state.zoneOrder.p1.graveyard
    .map((id) => state.objects[id].name)
    .filter((name) => !name.startsWith('Fixture '))

const creature = (name: string) => cardTemplate(name, { types: ['Creature'] })
const instant = (name: string) => cardTemplate(name, { types: ['Instant'] })

const castFixture = (
  name: string,
  instructions: ReturnType<typeof onResolve>[],
  library: ReturnType<typeof cardTemplate>[],
  options: { players?: number } = {},
) => {
  const server = createServerGame(
    commanderRules,
    {
      players: options.players ?? 2,
      hands: {
        p1: [cardTemplate(name, {
          types: ['Sorcery'],
          manaCost: '{0}',
          manaValue: 0,
          effects: instructions,
        })],
      },
      libraries: { p1: library },
    },
    { random: () => 0, cardPlugins: [onResolvePlugin] },
  )
  const withMana = {
    ...server.state,
    players: {
      ...server.state.players,
      p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
    },
  }
  const cast = ok(server.rules(withMana, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(withMana, name).id,
  }))
  const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
  return { server, resolved }
}

describe('revealUntil', () => {
  test('stamped revealUntil effects are structuredClone-safe', () => {
    const effects = serializableEffects([
      onResolve(revealUntil(2, { type: 'Creature' }, 'battlefield', 'shuffle')),
    ])
    expect(() => structuredClone(effects)).not.toThrow()
    expect(effects[0]).toMatchObject({
      op: 'trigger',
      do: [{
        kind: 'revealUntil',
        count: 2,
        match: { type: 'Creature' },
        destination: 'battlefield',
        nonMatch: 'shuffle',
      }],
    })
  })

  test('revealUntilBasicLand builder uses the generalized instruction', () => {
    expect(revealUntilBasicLand()).toEqual({
      kind: 'revealUntil',
      count: 1,
      match: { type: 'Land', supertype: 'Basic' },
      destination: 'hand',
      nonMatch: 'mill',
    })
  })

  test('mills non-matches through the first basic land', () => {
    const { resolved } = castFixture(
      'Fixture Hermit Shape',
      [onResolve(revealUntilBasicLand())],
      [
        cardTemplate('Nonbasic', { types: ['Land'] }),
        instant('Spell'),
        forest(),
        creature('After'),
      ],
    )
    expect(graveyardNames(resolved)).toEqual(['Nonbasic', 'Spell'])
    expect(resolved.zoneOrder.p1.hand.map((id) => resolved.objects[id].name)).toEqual(['Forest'])
    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name)).toEqual(['After'])
  })

  test('mills the entire library when no basic land appears', () => {
    const { resolved } = castFixture(
      'Fixture Empty Basic',
      [onResolve(revealUntilBasicLand())],
      [instant('One'), creature('Two'), cardTemplate('Gate', { types: ['Land'] })],
    )
    expect(resolved.zoneOrder.p1.library).toHaveLength(0)
    expect(graveyardNames(resolved)).toEqual(['One', 'Two', 'Gate'])
    expect(resolved.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('puts N creatures on the battlefield and shuffles other revealed cards', () => {
    const { resolved } = castFixture(
      'Fixture Shuffle Shape',
      [onResolve(revealUntil(2, { type: 'Creature' }, 'battlefield', 'shuffle'))],
      [
        instant('Lead'),
        creature('First'),
        instant('Between'),
        creature('Second'),
        creature('Hidden'),
        instant('Tail'),
      ],
    )
    expect(resolved.zoneOrder.p1.battlefield.map((id) => resolved.objects[id].name))
      .toEqual(['First', 'Second'])
    expect(graveyardNames(resolved)).toEqual([])
    expect(resolved.zoneOrder.p1.library).toHaveLength(4)
    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name).sort())
      .toEqual(['Between', 'Hidden', 'Lead', 'Tail'])
  })

  test('opponentCount reveals one creature per opponent in the pod', () => {
    const { resolved } = castFixture(
      'Fixture Pod Count',
      [onResolve(revealUntil('opponentCount', { type: 'Creature' }, 'hand', 'mill'))],
      [
        instant('Noise'),
        creature('A'),
        instant('Gap'),
        creature('B'),
        creature('C'),
        instant('Rest'),
      ],
      { players: 4 },
    )
    expect(resolved.zoneOrder.p1.hand.map((id) => resolved.objects[id].name))
      .toEqual(['A', 'B', 'C'])
    expect(graveyardNames(resolved)).toEqual(['Noise', 'Gap'])
    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name)).toEqual(['Rest'])
  })

  test('revealed cards are public to opponents without exposing unrevealed library order', () => {
    const { resolved } = castFixture(
      'Fixture Privacy',
      [onResolve(revealUntil(1, { type: 'Creature' }, 'hand', 'mill'))],
      [instant('Top'), creature('Shown'), instant('Buried')],
    )
    const opponent = projectForViewer(resolved, 'p2')
    const shownId = named(resolved, 'Shown').id
    expect(opponent.objects[shownId]?.name).toBe('Shown')
    expect(opponent.zoneOrder.p1.library).toEqual([])
    expect(opponent.zoneCounts.p1.library).toBe(1)
    expect(opponent.objects[named(resolved, 'Buried').id]).toBeUndefined()
    expect(resolved.log.some((line) => line.includes('Shown'))).toBe(true)

    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name))
      .toEqual(['Buried'])
    expect(resolved.zoneCounts.p1.library).toBe(1)
  })
})
