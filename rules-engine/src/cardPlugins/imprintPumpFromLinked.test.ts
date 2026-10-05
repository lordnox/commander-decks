import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import {
  enters,
  handler,
  linkExile,
  pumpFromLinkedExileStats,
} from './effects'
import { exilePayoffs } from './exilePayoffs'
import { linkedExile } from './linkedExile'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const stats = (state: GameState, name: string) => {
  const { power, toughness } = named(state, name)
  return [power, toughness]
}

// The real card targets a nontoken creature; the nontoken target filter is added by another
// part, so these tests exile any creature an opponent controls.
const ingester = () => cardTemplate('Imprint Ingester', {
  types: ['Creature'],
  power: 3,
  toughness: 4,
  effects: [
    handler('linkedExile'),
    handler('exilePayoffs'),
    pumpFromLinkedExileStats(),
    enters(linkExile({ type: 'Creature', controller: 'opponent' }, { optional: true })),
  ],
})

const prey = (name: string, power: number, toughness: number, counters = 0) =>
  cardTemplate(name, {
    types: ['Creature'],
    power: power + counters,
    toughness: toughness + counters,
    counters: counters ? { '+1/+1': counters } : {},
  })

const game = (...preyCards: ReturnType<typeof prey>[]) => createServerGame(commanderRules, {
  hands: { p1: [ingester()] },
  battlefield: { p2: preyCards },
}, { random: () => 0.5, cardPlugins: [linkedExile, exilePayoffs] })

const enterAndChoose = (
  server: ReturnType<typeof createServerGame>,
  objectIds: string[],
) => {
  const entered = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'move',
    objectId: named(server.state, 'Imprint Ingester').id,
    to: 'battlefield',
  })))
  return resolveStack(server.rules, ok(server.rules(entered, {
    type: 'selectCards',
    seat: 'p1',
    kind: 'choose',
    count: 1,
    objectIds,
  })))
}

describe('imprint power and toughness', () => {
  test('the effect is clone-safe', () => {
    expect(structuredClone(pumpFromLinkedExileStats())).toEqual(pumpFromLinkedExileStats())
  })

  test('gets +X/+Y from the exiled creature card, ignoring its counters', () => {
    const server = game(prey('Juicy Prey', 4, 5, 2))
    const state = enterAndChoose(server, [named(server.state, 'Juicy Prey').id])
    expect(named(state, 'Juicy Prey').zone).toBe('exile')
    expect(stats(state, 'Imprint Ingester')).toEqual([7, 9])
  })

  test('declining the imprint leaves the base power and toughness', () => {
    const server = game(prey('Juicy Prey', 4, 5))
    const state = enterAndChoose(server, [])
    expect(named(state, 'Juicy Prey').zone).toBe('battlefield')
    expect(stats(state, 'Imprint Ingester')).toEqual([3, 4])
  })

  test('survives a restart and recomputes when the link breaks', () => {
    const server = game(prey('Juicy Prey', 4, 5))
    const state = enterAndChoose(server, [named(server.state, 'Juicy Prey').id])
    const restarted = structuredClone(state)
    expect(stats(restarted, 'Imprint Ingester')).toEqual([7, 9])

    const broken = resolveStack(server.rules, ok(server.rules(restarted, {
      type: 'move',
      objectId: named(restarted, 'Juicy Prey').id,
      to: 'graveyard',
    })))
    expect(named(broken, 'Juicy Prey').zone).toBe('graveyard')
    expect(stats(broken, 'Imprint Ingester')).toEqual([3, 4])
  })

  test('stacks with +1/+1 counters on the imprinting creature and follows a later change', () => {
    const server = game(prey('Juicy Prey', 2, 2))
    const state = enterAndChoose(server, [named(server.state, 'Juicy Prey').id])
    const grown = resolveStack(server.rules, ok(server.rules(state, {
      type: 'putCounters',
      objectId: named(state, 'Imprint Ingester').id,
      counter: '+1/+1',
      count: 1,
    })))
    expect(stats(grown, 'Imprint Ingester')).toEqual([6, 7])
    const broken = resolveStack(server.rules, ok(server.rules(grown, {
      type: 'move',
      objectId: named(grown, 'Juicy Prey').id,
      to: 'graveyard',
    })))
    expect(stats(broken, 'Imprint Ingester')).toEqual([4, 5])
  })
})
