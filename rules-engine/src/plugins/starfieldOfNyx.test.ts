import { describe, expect, test } from 'bun:test'
import {
  addPlusCountersInstruction,
  pump,
  targetOnResolve,
} from '../cardPlugins/effects'
import { targetedResolve } from '../cardPlugins/targetedResolve'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, roomDoor } from '../testHelpers'
import type { CardInstruction } from '../cardPlugins/effects'
import type { GameState, ManaPool, RoomDoorId } from '../types'

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

/** Charred Foyer is mana value 4, Warped Space 6, so both doors are 10. */
const room = (unlockedDoors?: RoomDoorId[]) =>
  cardTemplate('Charred Foyer // Warped Space', {
    roomDoors: [
      roomDoor('Charred Foyer', '{3}{R}'),
      roomDoor('Warped Space', '{4}{R}{R}'),
    ],
    ...(unlockedDoors ? { unlockedDoors } : {}),
  })

/** A printed enchantment creature, so ending the animation restores 2/2. */
const enchantmentCreature = () => cardTemplate('Living Relic', {
  types: ['Enchantment', 'Creature'],
  manaCost: '{3}',
  manaValue: 3,
  power: 2,
  toughness: 2,
})

const modifierSpell = (name: string, ...instructions: CardInstruction[]) =>
  cardTemplate(name, {
    types: ['Instant'],
    manaCost: '{0}',
    manaValue: 0,
    effects: [
      targetOnResolve('select', { zone: 'battlefield', type: 'Creature' }, ...instructions),
    ],
  })

const growthSpell = () => modifierSpell('Growth Test', pump(2, 2), addPlusCountersInstruction(1))

/** Uses the eager addPlusCounters path, which also moves power and toughness. */
const counterSpell = () => modifierSpell('Counter Test', addPlusCountersInstruction(1))

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const funded = (state: GameState, mana: Partial<ManaPool>) => ({
  ...state,
  players: {
    ...state.players,
    p1: {
      ...state.players.p1,
      mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...mana },
    },
  },
})

/** One reducer pass; Starfield is never tapped here, so untapping it is inert. */
const settle = (
  server: ReturnType<typeof createServerGame>,
  state = server.state,
) => ok(server.rules(state, {
  type: 'untap',
  objectId: named(state, 'Starfield of Nyx').id,
}))

const castAt = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  spell: string,
  objectId: string,
) => {
  const cast = ok(server.rules(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, spell).id,
    targets: [{ kind: 'object', objectId }],
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

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
      hands: { p1: [enchantment('Fifth Enchantment'), growthSpell()] },
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

    const pumped = castAt(server, animated, 'Growth Test', named(animated, 'Subject').id)
    expect(named(pumped, 'Subject')).toMatchObject({
      power: 6,
      toughness: 6,
      counters: { '+1/+1': 1 },
    })
  })

  test('recomputes base stats when unlocking a door changes the Room mana value', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          starfield(),
          room(['left']),
          enchantment('Fixture One'),
          enchantment('Fixture Two'),
          enchantment('Fixture Three'),
        ],
      },
      hands: { p1: [growthSpell()] },
    }, { random: () => 0.5, cardPlugins: [targetedResolve] })

    let state = settle(server)
    const roomId = named(state, 'Charred Foyer').id
    expect(state.objects[roomId]).toMatchObject({
      manaValue: 4,
      power: 4,
      toughness: 4,
    })

    state = castAt(server, state, 'Growth Test', roomId)
    expect(state.objects[roomId]).toMatchObject({ power: 7, toughness: 7 })

    state = ok(server.rules(funded(state, { R: 2, C: 4 }), {
      type: 'unlockDoor',
      seat: 'p1',
      objectId: roomId,
      door: 'right',
    }))

    // The new base set is 10/10, with the +2/+2 and the counter still on top.
    expect(state.objects[roomId]).toMatchObject({
      manaValue: 10,
      power: 13,
      toughness: 13,
    })
  })

  test('keeps a +1/+1 counter when the animated mana value changes', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          starfield(),
          room(['left']),
          enchantment('Fixture One'),
          enchantment('Fixture Two'),
          enchantment('Fixture Three'),
        ],
      },
    })

    let state = settle(server)
    const roomId = named(state, 'Charred Foyer').id
    // putCounters only records the counter, so 11/11 below can only come from
    // the recompute re-deriving it rather than from an eager power change.
    state = ok(server.rules(state, {
      type: 'putCounters',
      objectId: roomId,
      counter: '+1/+1',
      count: 1,
    }))
    state = ok(server.rules(funded(state, { R: 2, C: 4 }), {
      type: 'unlockDoor',
      seat: 'p1',
      objectId: roomId,
      door: 'right',
    }))

    expect(state.objects[roomId]).toMatchObject({
      manaValue: 10,
      power: 11,
      toughness: 11,
    })
  })

  test('a Room put onto the battlefield locked is 0/0 and dies to state-based actions', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          starfield(),
          enchantment('Fixture One'),
          enchantment('Fixture Two'),
          enchantment('Fixture Three'),
          enchantment('Fixture Four'),
        ],
      },
      hands: { p1: [room()] },
    })

    let state = settle(server)
    const roomId = named(state, 'Charred Foyer // Warped Space').id
    state = ok(server.rules(state, {
      type: 'move',
      objectId: roomId,
      to: 'battlefield',
    }))

    // CR 709.5: both doors locked means mana value 0, so CR 704.5f applies.
    expect(state.objects[roomId].zone).toBe('graveyard')
    expect(state.objects[roomId].types).not.toContain('Creature')
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
    const state = settle(server)

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
    let state = settle(thresholdServer)
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
    state = settle(sourceServer)
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

  test('restores an enchantment creature to its printed stats plus its counters', () => {
    const makeServer = () => createServerGame(commanderRules, {
      battlefield: {
        p1: [
          starfield(),
          enchantmentCreature(),
          enchantment('Fixture One'),
          enchantment('Fixture Two'),
          enchantment('Fixture Three'),
        ],
      },
      hands: { p1: [counterSpell()] },
    }, { random: () => 0.5, cardPlugins: [targetedResolve] })

    const counteredWhileAnimated = (server: ReturnType<typeof makeServer>) => {
      const animated = settle(server)
      const relicId = named(animated, 'Living Relic').id
      expect(animated.objects[relicId]).toMatchObject({ power: 3, toughness: 3 })
      const state = castAt(server, animated, 'Counter Test', relicId)
      expect(state.objects[relicId]).toMatchObject({ power: 4, toughness: 4 })
      return { state, relicId }
    }

    const thresholdServer = makeServer()
    const dropped = counteredWhileAnimated(thresholdServer)
    const belowFive = ok(thresholdServer.rules(dropped.state, {
      type: 'move',
      objectId: named(dropped.state, 'Fixture Three').id,
      to: 'graveyard',
    }))
    expect(belowFive.objects[dropped.relicId]).toMatchObject({
      power: 3,
      toughness: 3,
      counters: { '+1/+1': 1 },
    })

    const sourceServer = makeServer()
    const left = counteredWhileAnimated(sourceServer)
    const withoutStarfield = ok(sourceServer.rules(left.state, {
      type: 'move',
      objectId: named(left.state, 'Starfield of Nyx').id,
      to: 'graveyard',
    }))
    expect(withoutStarfield.objects[left.relicId]).toMatchObject({
      power: 3,
      toughness: 3,
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
    state = ok(withGraveyard.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(state, 'Returned Enchantment').id],
    }))
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
      objectIds: [named(state, 'Declined Enchantment').id],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
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
