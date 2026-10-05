import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { bounceAll, destroyAll, enters } from './effects'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const creature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

const land = (name: string) =>
  cardTemplate(name, { types: ['Land'], subtypes: ['Forest'], tapProduces: { G: 1 } })

const enterBattlefield = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
) => resolveStack(server.rules, ok(server.rules(state, {
  type: 'move',
  objectId: named(state, name).id,
  to: 'battlefield',
})))

describe('destroyAll', () => {
  const sweeper = () => cardTemplate('Sweeper Engine', {
    types: ['Artifact'],
    effects: [enters(destroyAll({ nonland: true, other: true }))],
  })

  test('destroys every other nonland permanent and spares lands and indestructible', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [sweeper()] },
      battlefield: {
        p1: [creature('Mine'), land('Home Forest')],
        p2: [
          creature('Theirs'),
          cardTemplate('Their Relic', { types: ['Artifact'] }),
          creature('Eternal', { oracleText: 'Indestructible' }),
          land('Away Forest'),
        ],
      },
    }, { random: () => 0.5 })
    const state = enterBattlefield(server, server.state, 'Sweeper Engine')
    expect(['Mine', 'Theirs', 'Their Relic'].map((name) => named(state, name).zone))
      .toEqual(['graveyard', 'graveyard', 'graveyard'])
    expect(named(state, 'Eternal').zone).toBe('battlefield')
    expect(named(state, 'Home Forest').zone).toBe('battlefield')
    expect(named(state, 'Away Forest').zone).toBe('battlefield')
    expect(named(state, 'Sweeper Engine').zone).toBe('battlefield')
  })

  test('without other, the source is destroyed with the rest', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [cardTemplate('Self Sweeper', {
          types: ['Artifact'],
          effects: [enters(destroyAll({ nonland: true }))],
        })],
      },
      battlefield: { p2: [creature('Theirs')] },
    }, { random: () => 0.5 })
    const state = enterBattlefield(server, server.state, 'Self Sweeper')
    expect(named(state, 'Self Sweeper').zone).toBe('graveyard')
    expect(named(state, 'Theirs').zone).toBe('graveyard')
  })

  test('the filter is clone-safe and honours controller', () => {
    const instruction = destroyAll({ type: 'Creature', controller: 'opponent' })
    expect(structuredClone(instruction)).toEqual(instruction)
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [cardTemplate('Opposition', { types: ['Artifact'], effects: [enters(instruction)] })],
      },
      battlefield: { p1: [creature('Mine')], p2: [creature('Theirs')] },
    }, { random: () => 0.5 })
    const state = enterBattlefield(server, server.state, 'Opposition')
    expect(named(state, 'Mine').zone).toBe('battlefield')
    expect(named(state, 'Theirs').zone).toBe('graveyard')
  })

  test('phased-out permanents are not affected', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [sweeper()] },
      battlefield: { p2: [creature('Ghost')] },
    }, { random: () => 0.5 })
    const ready = structuredClone(server.state)
    named(ready, 'Ghost').phasedOut = true
    const state = enterBattlefield(server, ready, 'Sweeper Engine')
    expect(named(state, 'Ghost').zone).toBe('battlefield')
  })
})

describe('bounceAll', () => {
  const tideEngine = () => cardTemplate('Tide Engine', {
    types: ['Creature'],
    effects: [enters(bounceAll({ nonland: true, other: true }))],
  })

  test('returns every other nonland permanent to its owner hand, keeping lands', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [tideEngine()] },
      battlefield: {
        p1: [creature('Mine'), land('Home Forest')],
        p2: [creature('Theirs'), cardTemplate('Their Relic', { types: ['Artifact'] })],
      },
    }, { random: () => 0.5 })
    const ready = structuredClone(server.state)
    named(ready, 'Theirs').controller = 'p1'
    const state = enterBattlefield(server, ready, 'Tide Engine')
    expect(named(state, 'Tide Engine').zone).toBe('battlefield')
    expect(named(state, 'Home Forest').zone).toBe('battlefield')
    expect(named(state, 'Mine').zone).toBe('hand')
    expect(named(state, 'Their Relic').zone).toBe('hand')
    expect(named(state, 'Theirs')).toMatchObject({ zone: 'hand', owner: 'p2' })
    expect(state.zoneOrder.p2.hand).toContain(named(state, 'Their Relic').id)
  })

  test('indestructible does not stop a bounce', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [tideEngine()] },
      battlefield: { p2: [creature('Eternal', { oracleText: 'Indestructible' })] },
    }, { random: () => 0.5 })
    const state = enterBattlefield(server, server.state, 'Tide Engine')
    expect(named(state, 'Eternal').zone).toBe('hand')
  })
})
