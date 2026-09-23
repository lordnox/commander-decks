import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { enters, onResolve, tapAll } from './effects'
import { onResolve as onResolvePlugin } from './onResolve'
import { ok as okState, resolveStack } from '../testHelpers'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const fixtureCreature = (name: string) => cardTemplate(name, {
  types: ['Creature'],
  power: 2,
  toughness: 2,
})

const resolveFixtureSpell = (
  setup: {
    battlefield?: { p1?: ReturnType<typeof cardTemplate>[]; p2?: ReturnType<typeof cardTemplate>[] }
    filter: Parameters<typeof tapAll>[0]
  },
) => {
  const server = createServerGame(
    commanderRules,
    {
      hands: {
        p1: [cardTemplate('Fixture Opponent Tap Wave', {
          types: ['Instant'],
          manaCost: '{0}',
          manaValue: 0,
          effects: [onResolve(tapAll(setup.filter))],
        })],
      },
      battlefield: setup.battlefield ?? {},
    },
    { random: () => 0.5, cardPlugins: [onResolvePlugin] },
  )
  const ready = {
    ...server.state,
    players: {
      ...server.state.players,
      p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
    },
  }
  const cast = ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(ready, 'Fixture Opponent Tap Wave').id,
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

describe('tapAll', () => {
  test('taps every opponent creature on the battlefield with no choice', () => {
    const state = resolveFixtureSpell({
      battlefield: {
        p1: [fixtureCreature('Fixture Ally Creature')],
        p2: [
          fixtureCreature('Fixture Foe Alpha'),
          fixtureCreature('Fixture Foe Beta'),
        ],
      },
      filter: { zone: 'battlefield', type: 'Creature', controller: 'opponent' },
    })
    expect(named(state, 'Fixture Ally Creature').tapped).toBe(false)
    expect(named(state, 'Fixture Foe Alpha').tapped).toBe(true)
    expect(named(state, 'Fixture Foe Beta').tapped).toBe(true)
  })

  test('notController skips the source permanent but taps other creatures', () => {
    const tapper = {
      ...fixtureCreature('Fixture Psychic Tapper'),
      effects: [enters(tapAll({
        zone: 'battlefield',
        type: 'Creature',
        controller: 'notController',
      }))],
    }
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [tapper] },
        battlefield: {
          p1: [fixtureCreature('Fixture Ally On Board')],
          p2: [fixtureCreature('Fixture Remote Creature')],
        },
      },
      { random: () => 0.5 },
    )
    const objectId = server.state.zoneOrder.p1.hand[0]
    const resolved = resolveStack(server.rules, okState(server.rules(server.state, {
      type: 'move',
      objectId,
      to: 'battlefield',
    })))
    expect(named(resolved, 'Fixture Psychic Tapper').tapped).toBe(false)
    expect(named(resolved, 'Fixture Ally On Board').tapped).toBe(false)
    expect(named(resolved, 'Fixture Remote Creature').tapped).toBe(true)
  })

  test('stamped filter survives structuredClone on the card template', () => {
    const spell = cardTemplate('Fixture Clone Safe Tap', {
      types: ['Instant'],
      effects: [onResolve(tapAll({
        zone: 'battlefield',
        type: 'Creature',
        controller: 'notController',
      }))],
    })
    const cloned = structuredClone(spell)
    expect(cloned.effects[0]).toEqual({
      op: 'trigger',
      on: 'resolve',
      do: [{
        kind: 'tapAll',
        filter: {
          zone: 'battlefield',
          type: 'Creature',
          controller: 'notController',
        },
      }],
    })
  })

  test('taps hexproof opponent creatures because tapAll does not target', () => {
    const state = resolveFixtureSpell({
      battlefield: {
        p2: [cardTemplate('Fixture Hexproof Foe', {
          types: ['Creature'],
          power: 2,
          toughness: 2,
          oracleText: 'Hexproof',
        })],
      },
      filter: { zone: 'battlefield', type: 'Creature', controller: 'opponent' },
    })
    expect(named(state, 'Fixture Hexproof Foe').tapped).toBe(true)
  })

  test('ignores noncreature permanents when the filter requires creatures', () => {
    const state = resolveFixtureSpell({
      battlefield: {
        p2: [
          cardTemplate('Fixture Foe Rock', { types: ['Artifact'] }),
          fixtureCreature('Fixture Foe Creature'),
        ],
      },
      filter: { zone: 'battlefield', type: 'Creature', controller: 'opponent' },
    })
    expect(named(state, 'Fixture Foe Rock').tapped).toBe(false)
    expect(named(state, 'Fixture Foe Creature').tapped).toBe(true)
  })
})
