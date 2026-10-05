import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { activate, grantUntilEot } from './effects'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const creature = (name: string, power: number) =>
  cardTemplate(name, { types: ['Creature'], power, toughness: 5 })

/** "{0}: Target creature with power 5 or greater gains indestructible until end of turn." */
const granter = (bare: boolean) => {
  const filter = { zone: 'battlefield', type: 'Creature', powerAtLeast: 5 } as const
  return cardTemplate('Fixture Granter', {
    types: ['Creature'],
    effects: [activate({
      id: 'granter.grant',
      costs: {},
      targets: bare ? filter : { filter },
      do: [grantUntilEot('indestructible')],
    })],
  })
}

const setup = (bare = false) => {
  const server = createServerGame(
    commanderRules,
    {
      battlefield: {
        p1: [granter(bare), creature('Fixture Giant', 6)],
        p2: [creature('Fixture Foe Giant', 7)],
      },
      players: 2,
    },
    { random: () => 0.5, cardPlugins: [activated] },
  )
  const activateOn = (name: string) => ok(server.rules(server.state, {
    type: 'activateAbility',
    abilityId: 'granter.grant',
    seat: 'p1',
    objectId: named(server.state, 'Fixture Granter').id,
    targets: [{ kind: 'object', objectId: named(server.state, name).id }],
  }))
  const edit = (state: GameState, name: string, patch: Partial<GameState['objects'][string]>) => ({
    ...state,
    objects: {
      ...state.objects,
      [named(state, name).id]: { ...named(state, name), ...patch },
    },
  })
  return { server, activateOn, edit }
}

const indestructible = (state: GameState, name: string) =>
  hasKeyword(named(state, name), 'indestructible')

describe('activated ability target re-check on resolution (CR 608.2b)', () => {
  for (const bare of [false, true]) {
    const form = bare ? 'bare filter' : '{ filter }'

    test(`${form}: a target that is still legal receives the effect`, () => {
      const { server, activateOn } = setup(bare)
      const stacked = activateOn('Fixture Giant')
      expect(stacked.stack[0].payload?.targetFilter).toMatchObject({ powerAtLeast: 5 })
      const done = resolveStack(server.rules, stacked)
      expect(indestructible(done, 'Fixture Giant')).toBe(true)
    })

    test(`${form}: a target whose power drops below the filter in response is not affected`, () => {
      const { server, activateOn, edit } = setup(bare)
      const shrunk = edit(activateOn('Fixture Giant'), 'Fixture Giant', { power: 4 })
      const done = resolveStack(server.rules, shrunk)
      expect(done.stack).toHaveLength(0)
      expect(indestructible(done, 'Fixture Giant')).toBe(false)
    })
  }

  test('a target that left the battlefield fizzles the ability', () => {
    const { server, activateOn } = setup()
    const stacked = activateOn('Fixture Giant')
    const gone = ok(server.rules(stacked, {
      type: 'move',
      objectId: named(stacked, 'Fixture Giant').id,
      to: 'graveyard',
    }))
    const done = resolveStack(server.rules, gone)
    expect(done.stack).toHaveLength(0)
    expect(indestructible(done, 'Fixture Giant')).toBe(false)
  })

  test("an opponent's creature that gains hexproof in response is no longer a legal target", () => {
    const { server, activateOn, edit } = setup()
    const hidden = edit(activateOn('Fixture Foe Giant'), 'Fixture Foe Giant', {
      oracleText: 'Hexproof',
    })
    const done = resolveStack(server.rules, hidden)
    expect(indestructible(done, 'Fixture Foe Giant')).toBe(false)
  })

  test('the controller may keep targeting its own hexproof creature', () => {
    const { server, activateOn, edit } = setup()
    const hexproof = edit(activateOn('Fixture Giant'), 'Fixture Giant', {
      oracleText: 'Hexproof',
    })
    const done = resolveStack(server.rules, hexproof)
    expect(indestructible(done, 'Fixture Giant')).toBe(true)
  })

  test('an activated ability without a filtered target keeps no target filter', () => {
    const plain = cardTemplate('Fixture Plain', {
      types: ['Creature'],
      effects: [activate({ id: 'plain.go', costs: {}, do: [] })],
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [plain] }, players: 2 },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const stacked = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'plain.go',
      seat: 'p1',
      objectId: named(server.state, 'Fixture Plain').id,
    }))
    expect(stacked.stack[0].payload).toBeUndefined()
  })
})
