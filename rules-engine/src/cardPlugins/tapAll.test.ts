import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { enters, onResolve, tapAll, targetOnResolve } from './effects'
import { targetedResolve } from './targetedResolve'
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
    extra?: Parameters<typeof tapAll>[1]
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
          effects: [onResolve(tapAll(setup.filter, setup.extra))],
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

const targetedFreeze = () => cardTemplate('Fixture Targeted Freeze', {
  types: ['Instant'],
  manaCost: '{0}',
  manaValue: 0,
  effects: [targetOnResolve(
    'select',
    { players: 'opponent' },
    tapAll({ zone: 'battlefield', nonland: true }, { ofTargetPlayer: true, skipNextUntap: true }),
  )],
})

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
    expect(cloned.effects?.[0]).toEqual({
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

  describe('targeting a player', () => {
    const castAt = (target: 'p1' | 'p2' | undefined) => {
      const server = createServerGame(
        commanderRules,
        {
          players: 3,
          hands: { p1: [targetedFreeze()] },
          battlefield: {
            p1: [fixtureCreature('Fixture Ally Creature')],
            p2: [
              fixtureCreature('Fixture Foe Alpha'),
              cardTemplate('Fixture Foe Rock', { types: ['Artifact'] }),
              cardTemplate('Fixture Foe Land', { types: ['Land'] }),
            ],
            p3: [fixtureCreature('Fixture Bystander')],
          },
        },
        { random: () => 0.5, cardPlugins: [targetedResolve] },
      )
      const cast = server.rules(server.state, {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(server.state, 'Fixture Targeted Freeze').id,
        ...(target ? { targets: [{ kind: 'player' as const, player: target }] } : {}),
      })
      return { server, cast }
    }

    test('taps only the target player nonland permanents and marks them to skip untap', () => {
      const { server, cast } = castAt('p2')
      const state = resolveStack(server.rules, ok(cast))
      expect(named(state, 'Fixture Foe Alpha').tapped).toBe(true)
      expect(named(state, 'Fixture Foe Rock').tapped).toBe(true)
      expect(named(state, 'Fixture Foe Land').tapped).toBe(false)
      expect(named(state, 'Fixture Foe Land').skipNextUntap).toBeUndefined()
      expect(named(state, 'Fixture Ally Creature').tapped).toBe(false)
      expect(named(state, 'Fixture Bystander').tapped).toBe(false)
      expect(named(state, 'Fixture Foe Alpha').skipNextUntap).toBe(true)
    })

    test('the tapped permanents miss exactly one untap step', () => {
      const { server, cast } = castAt('p2')
      const resolved = resolveStack(server.rules, ok(cast))
      const next = (state: GameState) => ok(server.rules(
        { ...state, step: 'cleanup', active: state.active },
        { type: 'advanceStep' },
      ))
      const p2Untap = next(resolved)
      expect(p2Untap.active).toBe('p2')
      expect(named(p2Untap, 'Fixture Foe Alpha').tapped).toBe(true)
      expect(named(p2Untap, 'Fixture Foe Alpha').skipNextUntap).toBeUndefined()

      const p3Untap = next(p2Untap)
      expect(p3Untap.active).toBe('p3')
      const p1Untap = next(p3Untap)
      const p2Again = next(p1Untap)
      expect(p2Again.active).toBe('p2')
      expect(named(p2Again, 'Fixture Foe Alpha').tapped).toBe(false)
    })

    test('the caster cannot target themselves', () => {
      const { cast } = castAt('p1')
      expect(cast.ok).toBe(false)
    })

    test('taps nothing when the instruction runs without a player target', () => {
      const state = resolveFixtureSpell({
        battlefield: { p2: [fixtureCreature('Fixture Foe Alpha')] },
        filter: { zone: 'battlefield', nonland: true },
        extra: { ofTargetPlayer: true, skipNextUntap: true },
      })
      expect(named(state, 'Fixture Foe Alpha').tapped).toBe(false)
      expect(named(state, 'Fixture Foe Alpha').skipNextUntap).toBeUndefined()
    })
  })
})
