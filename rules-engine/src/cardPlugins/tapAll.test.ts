import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import {
  card as dslCard,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  forEach,
  objects,
  players,
  ref,
  self,
  select,
  spell,
  tap,
  target,
  whenever,
} from './dsl/v1'
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

const tapDefinition = (
  filter: Parameters<typeof objects>[0],
  options: { skipNextUntap?: true } = {},
) => createDefinitionSnapshot(compileCardRuleDefinition(dslCard([spell({
  instructions: [forEach({
    of: objects(filter),
    instructions: [tap(ref('triggering.object.after'), options)],
  })],
})])))

const tapperDefinition = (filter: Parameters<typeof objects>[0], options: { skipNextUntap?: true } = {}) =>
  createDefinitionSnapshot(compileCardRuleDefinition(dslCard([whenever(self.enters, {
    instructions: [forEach({
      of: objects(filter),
      instructions: [tap(ref('triggering.object.after'), options)],
    })],
  })])))

const resolveFixtureSpell = (
  setup: {
    battlefield?: { p1?: ReturnType<typeof cardTemplate>[]; p2?: ReturnType<typeof cardTemplate>[] }
    filter: Parameters<typeof objects>[0]
    extra?: { skipNextUntap?: true }
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
          ruleDefinition: tapDefinition(setup.filter, setup.extra),
        })],
      },
      battlefield: setup.battlefield ?? {},
    },
    { random: () => 0.5 },
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
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(dslCard([spell({
    decisions: { targets: [select({ filter: players({ relation: 'opponent' }), min: 0, max: 1 })] },
    instructions: [forEach({
      of: objects({ zone: 'battlefield', not: { type: 'Land' }, controller: target(0) }),
      instructions: [tap(ref('triggering.object.after'), { skipNextUntap: true })],
    })],
  })]))),
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
      ruleDefinition: tapperDefinition({
        zone: 'battlefield',
        type: 'Creature',
        controller: 'opponent',
      }),
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

  test('enters tapAll with opponent filter leaves controlled creatures untapped', () => {
    const tapper = {
      ...fixtureCreature('Fixture Subjugating Angel'),
      ruleDefinition: tapperDefinition({
        zone: 'battlefield',
        type: 'Creature',
        controller: 'opponent',
      }),
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
    const entered = resolveStack(server.rules, okState(server.rules(server.state, {
      type: 'move',
      objectId: server.state.zoneOrder.p1.hand[0],
      to: 'battlefield',
    })))
    expect(named(entered, 'Fixture Ally On Board').tapped).toBe(false)
    expect(named(entered, 'Fixture Remote Creature').tapped).toBe(true)
  })

  test('canonical tap instructions survive structuredClone on the card template', () => {
    const tapSpell = cardTemplate('Fixture Clone Safe Tap', {
      types: ['Instant'],
      ruleDefinition: tapDefinition({
        zone: 'battlefield',
        type: 'Creature',
        controller: 'opponent',
      }),
    })
    const cloned = structuredClone(tapSpell)
    expect(cloned.ruleDefinition).toEqual(tapSpell.ruleDefinition)
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
        { random: () => 0.5 },
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

    test('taps nothing when there is no player target', () => {
      const { server, cast } = castAt(undefined)
      const state = resolveStack(server.rules, ok(cast))
      expect(named(state, 'Fixture Foe Alpha').tapped).toBe(false)
      expect(named(state, 'Fixture Foe Alpha').skipNextUntap).toBeUndefined()
    })

  })
})
