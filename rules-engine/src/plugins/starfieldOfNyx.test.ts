import { describe, expect, test } from 'bun:test'
import { pump, targetOnResolve } from '../cardPlugins/effects'
import { targetedResolve } from '../cardPlugins/targetedResolve'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'

const enchantment = (
  name: string,
  manaValue = 1,
  extra: Parameters<typeof cardTemplate>[1] = {},
) => cardTemplate(name, {
  types: ['Enchantment'],
  manaCost: `{${manaValue}}`,
  manaValue,
  ...extra,
})

const starfield = () => enchantment('Starfield of Nyx', 5)

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const applyContinuousEffects = (
  server: ReturnType<typeof createServerGame>,
  state = server.state,
) => ok(server.rules(state, { type: 'advanceStep' }))

const advanceToUpkeep = (
  server: ReturnType<typeof createServerGame>,
  state = server.state,
) => {
  let current = state
  do {
    current = ok(server.rules(current, { type: 'advanceStep' }))
  } while (current.step !== 'upkeep' || current.active !== 'p1')
  return current
}

describe('Starfield of Nyx', () => {
  test('turns animation on at five enchantments and uses mana value for base stats', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          starfield(),
          enchantment('Subject', 3),
          enchantment('Fixture One'),
          enchantment('Fixture Two'),
        ],
      },
      hands: {
        p1: [
          enchantment('Fifth Enchantment'),
          cardTemplate('Growth Test', {
            types: ['Instant'],
            manaCost: '{0}',
            manaValue: 0,
            effects: [
              targetOnResolve(
                'select',
                { zone: 'battlefield', type: 'Creature' },
                pump(2, 2),
              ),
            ],
          }),
        ],
      },
    }, { random: () => 0.5, cardPlugins: [targetedResolve] })

    expect(named(server.state, 'Subject')).toMatchObject({
      types: ['Enchantment'],
      power: null,
      toughness: null,
    })

    const fifth = named(server.state, 'Fifth Enchantment')
    const animated = ok(server.rules(server.state, {
      type: 'move',
      objectId: fifth.id,
      to: 'battlefield',
    }))

    expect(named(animated, 'Subject')).toMatchObject({
      types: ['Enchantment', 'Creature'],
      power: 3,
      toughness: 3,
    })

    const cast = ok(server.rules(animated, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(animated, 'Growth Test').id,
      targets: [{ kind: 'object', objectId: named(animated, 'Subject').id }],
    }))
    const pumped = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(pumped, 'Subject')).toMatchObject({
      power: 5,
      toughness: 5,
    })
  })

  test('excludes itself, Auras, and opponents enchantments', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          starfield(),
          enchantment('Subject', 3),
          enchantment('Pacifism', 2, {
            subtypes: ['Aura'],
            attachedTo: 'p1',
          }),
          enchantment('Fixture One'),
          enchantment('Fixture Two'),
        ],
        p2: [enchantment('Opponent Enchantment', 4)],
      },
    })
    const state = applyContinuousEffects(server)

    expect(named(state, 'Subject').types).toContain('Creature')
    expect(named(state, 'Starfield of Nyx').types).toEqual(['Enchantment'])
    expect(named(state, 'Pacifism').types).toEqual(['Enchantment'])
    expect(named(state, 'Opponent Enchantment').types).toEqual(['Enchantment'])
  })

  test('reverts below five enchantments and when Starfield leaves', () => {
    const makeServer = () => createServerGame(commanderRules, {
      battlefield: {
        p1: [
          starfield(),
          enchantment('Subject', 3),
          enchantment('Fixture One'),
          enchantment('Fixture Two'),
          enchantment('Fixture Three'),
        ],
      },
    })

    const thresholdServer = makeServer()
    let state = applyContinuousEffects(thresholdServer)
    expect(named(state, 'Subject').types).toContain('Creature')
    state = ok(thresholdServer.rules(state, {
      type: 'move',
      objectId: named(state, 'Fixture Three').id,
      to: 'graveyard',
    }))
    expect(named(state, 'Subject')).toMatchObject({
      types: ['Enchantment'],
      power: null,
      toughness: null,
    })

    const sourceServer = makeServer()
    state = applyContinuousEffects(sourceServer)
    state = ok(sourceServer.rules(state, {
      type: 'move',
      objectId: named(state, 'Starfield of Nyx').id,
      to: 'graveyard',
    }))
    expect(named(state, 'Subject')).toMatchObject({
      types: ['Enchantment'],
      power: null,
      toughness: null,
    })
  })

  test('returns a targeted enchantment card from its controller graveyard', () => {
    const withGraveyard = createServerGame(commanderRules, {
      first: 'p2',
      battlefield: { p1: [starfield()] },
      hands: { p1: [enchantment('Returned Enchantment', 2)] },
    })
    let state = ok(withGraveyard.rules(withGraveyard.state, {
      type: 'move',
      objectId: named(withGraveyard.state, 'Returned Enchantment').id,
      to: 'graveyard',
    }))
    state = advanceToUpkeep(withGraveyard, state)

    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection.candidates).toEqual([
      named(state, 'Returned Enchantment').id,
    ])
    state = ok(withGraveyard.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(state, 'Returned Enchantment').id],
    }))
    expect(state.stack[0].targets).toEqual([{
      kind: 'object',
      objectId: named(state, 'Returned Enchantment').id,
    }])

    state = ok(withGraveyard.rules(state, { type: 'resolveTop' }))
    expect(named(state, 'Returned Enchantment').zone).toBe('battlefield')
  })

  test('may decline the upkeep return', () => {
    const server = createServerGame(commanderRules, {
      first: 'p2',
      battlefield: { p1: [starfield()] },
      hands: { p1: [enchantment('Declined Enchantment', 2)] },
    })
    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Declined Enchantment').id,
      to: 'graveyard',
    }))
    state = advanceToUpkeep(server, state)
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))

    expect(state.stack).toHaveLength(0)
    expect(named(state, 'Declined Enchantment').zone).toBe('graveyard')
  })
})
