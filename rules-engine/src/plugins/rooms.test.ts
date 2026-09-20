import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { gainLife } from '../cardPlugins/effects'
import type { CardEffect } from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, roomDoor } from '../testHelpers'
import type { GameState, ManaPool, Plugin, RoomDoorId } from '../types'

const roomFace = (
  name: string,
  manaCost: string,
  oracleText: string,
  effects: CardEffect[] = [],
) => roomDoor(name, manaCost, { oracleText, effects })

const trigger = (on: 'enters' | 'unlock' | 'fullyUnlock', life: number): CardEffect => ({
  op: 'trigger',
  on,
  do: [gainLife(life)],
})

const room = (unlockedDoors?: Array<'left' | 'right'>) =>
  cardTemplate('Funeral Room // Awakening Hall', {
    roomDoors: [
      roomFace('Funeral Room', '{2}{B}', 'When this Room enters and whenever you unlock this door, each opponent loses 1 life and you gain 1 life.', [
        trigger('enters', 1),
        trigger('unlock', 2),
      ]),
      roomFace('Awakening Hall', '{6}{B}{B}', 'When you unlock this door, reanimate.', [
        trigger('unlock', 3),
        trigger('fullyUnlock', 4),
      ]),
    ],
    ...(unlockedDoors ? { unlockedDoors } : {}),
  })

const funded = (
  state: ReturnType<typeof createServerGame>['state'],
  mana: Partial<ManaPool>,
) => ({
  ...state,
  players: {
    ...state.players,
    p1: {
      ...state.players.p1,
      mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...mana },
    },
  },
})

const charredFoyer = () =>
  cardTemplate('Charred Foyer // Warped Space', {
    roomDoors: [
      roomFace('Charred Foyer', '{3}{R}', 'At the beginning of your upkeep, exile the top card of your library. You may play it this turn.'),
      roomFace('Warped Space', '{4}{R}{R}', 'Once each turn, you may pay {0} rather than pay the mana cost for a spell you cast from exile.'),
    ],
  })

const enchantment = (name: string) => cardTemplate(name, {
  types: ['Enchantment'],
  manaCost: '{1}',
  manaValue: 1,
})

const starfield = cardTemplate('Starfield of Nyx', {
  types: ['Enchantment'],
  manaCost: '{4}{W}',
  manaValue: 5,
})

const STARFIELD_ANIMATED = 'test:starfield-animated'

const starfieldOfNyx: Plugin = {
  id: 'testStarfieldOfNyx',
  apply: ({ draft }) => {
    const battlefield = Object.values(draft.objects)
      .filter((object) => object.zone === 'battlefield')
    const activeControllers = new Set(
      battlefield
        .filter((object) => object.name === 'Starfield of Nyx')
        .filter((source) =>
          battlefield.filter((object) =>
            object.controller === source.controller
            && object.types.includes('Enchantment')).length >= 5)
        .map((source) => source.controller),
    )

    for (const object of Object.values(draft.objects)) {
      const animated = object.tags.includes(STARFIELD_ANIMATED)
      const shouldAnimate = object.zone === 'battlefield'
        && activeControllers.has(object.controller)
        && object.name !== 'Starfield of Nyx'
        && object.types.includes('Enchantment')
        && !object.subtypes.includes('Aura')
      if (shouldAnimate) {
        if (!object.types.includes('Creature')) object.types.push('Creature')
        object.power = object.manaValue
        object.toughness = object.manaValue
        if (!animated) object.tags.push(STARFIELD_ANIMATED)
      } else if (animated) {
        object.types = object.types.filter((type) => type !== 'Creature')
        object.power = null
        object.toughness = null
        object.tags = object.tags.filter((tag) => tag !== STARFIELD_ANIMATED)
      }
    }
  },
}

const starfieldGame = () => createServerGame(
  commanderRules,
  {
    hands: { p1: [charredFoyer()] },
    battlefield: {
      p1: [
        starfield,
        ...Array.from({ length: 5 }, (_, index) => enchantment(`Fixture ${index + 1}`)),
      ],
    },
  },
  { random: () => 0.5, cardPlugins: [starfieldOfNyx] },
)

const castRoomDoor = (
  server: ReturnType<typeof starfieldGame>,
  doorId: RoomDoorId,
) => {
  const objectId = server.state.zoneOrder.p1.hand[0]
  const ready = funded(server.state, { R: 3, C: 7 })
  const cast = ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId,
    door: doorId,
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

const roomIn = (state: GameState) =>
  Object.values(state.objects).find((object) =>
    object.roomDoors?.some((door) => door.name === 'Charred Foyer'))!

describe('Room doors', () => {
  test('casts either half and unlocks only the cast door as it enters', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [room()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const state = funded(server.state, { B: 2, C: 6 })

    const actions = legalActsFor(state, 'p1').filter((action) => action.kind === 'castSpell')
    expect(actions.map((action) => action.name)).toEqual([
      'Funeral Room',
      'Awakening Hall',
    ])

    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
      door: 'right',
    }))
    expect(cast.objects[objectId]).toMatchObject({
      zone: 'stack',
      name: 'Awakening Hall',
      manaCost: '{6}{B}{B}',
      oracleText: 'When you unlock this door, reanimate.',
    })

    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[objectId]).toMatchObject({
      zone: 'battlefield',
      name: 'Awakening Hall',
      unlockedDoors: ['right'],
    })
    expect(resolved.stack).toHaveLength(1)

    const triggered = ok(server.rules(resolved, { type: 'resolveTop' }))
    expect(triggered.players.p1.life).toBe(43)
  })

  test('a door naming entering and unlocking is still castable without the judge', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [room()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const state = funded(server.state, { B: 1, C: 2 })
    const cast = legalActsFor(state, 'p1').find(
      (action) => action.kind === 'castSpell' && action.door === 'left',
    )

    expect(cast).toBeDefined()
    expect(eventsForAvailableAction(state, 'p1', cast!)).toEqual([
      { type: 'castSpell', seat: 'p1', objectId, door: 'left' },
    ])
  })

  test('a door without inline effects takes its rules text from the card table', () => {
    const closet = cardTemplate('Walk-In Closet // Forgotten Cellar', {
      roomDoors: [
        roomFace('Walk-In Closet', '{2}{G}', 'You may play lands from your graveyard.'),
        roomFace('Forgotten Cellar', '{3}{G}{G}', 'When you unlock this door, cast from your graveyard.'),
      ],
    })
    const server = createServerGame(commanderRules, { battlefield: { p1: [closet] } })
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const state = funded(server.state, { G: 2, C: 3 })

    const unlocked = ok(server.rules(state, {
      type: 'unlockDoor',
      seat: 'p1',
      objectId,
      door: 'right',
    }))
    expect(unlocked.objects[objectId].effects).toEqual([
      { op: 'static', playLandsFromGraveyard: true },
    ])
  })

  test('the cast door produces both its enter and unlock triggers', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [room()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const state = funded(server.state, { B: 1, C: 2 })
    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
      door: 'left',
    }))
    const entered = ok(server.rules(cast, { type: 'resolveTop' }))

    expect(entered.stack).toHaveLength(2)
    const first = ok(server.rules(entered, { type: 'resolveTop' }))
    const second = ok(server.rules(first, { type: 'resolveTop' }))
    expect(second.players.p1.life).toBe(43)
  })

  test('unlocking is an empty-stack main-phase special action that pays the door cost', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [room(['left'])] },
    })
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const state = funded(server.state, { B: 2, C: 6 })

    expect(legalActsFor(state, 'p1')).toContainEqual(expect.objectContaining({
      kind: 'unlockDoor',
      objectId,
      door: 'right',
      doorName: 'Awakening Hall',
    }))

    const unlocked = ok(server.rules(state, {
      type: 'unlockDoor',
      seat: 'p1',
      objectId,
      door: 'right',
    }))
    expect(unlocked.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    expect(unlocked.objects[objectId]).toMatchObject({
      name: 'Funeral Room // Awakening Hall',
      manaCost: '{2}{B} // {6}{B}{B}',
      unlockedDoors: ['left', 'right'],
    })
    expect(unlocked.stack).toHaveLength(2)
  })

  test('rejects unlocking outside its special-action window', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [room(['left'])] },
    })
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const state = funded(server.state, { B: 2, C: 6 })
    const event = { type: 'unlockDoor', seat: 'p1', objectId, door: 'right' } as const

    expect(server.rules({ ...state, step: 'upkeep' }, event)).toMatchObject({
      ok: false,
      error: 'a door can be unlocked only as a sorcery',
    })
    expect(server.rules({
      ...state,
      stack: [{
        id: 's1',
        kind: 'ability',
        objectId,
        controller: 'p1',
        name: 'waiting',
        targets: [],
      }],
    }, event)).toMatchObject({
      ok: false,
      error: 'a door can be unlocked only as a sorcery',
    })
  })

  test('a Room put onto the battlefield has both doors locked', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [room()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId,
      to: 'battlefield',
    }))

    expect(entered.objects[objectId]).toMatchObject({
      name: '',
      types: ['Enchantment'],
      subtypes: ['Room'],
      manaCost: '',
      manaValue: 0,
      colors: [],
      oracleText: '',
      effects: [],
      unlockedDoors: [],
    })
  })

  test('restores combined split-card characteristics after leaving the battlefield', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [room(['left'])] },
    })
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const moved = ok(server.rules(server.state, {
      type: 'move',
      objectId,
      to: 'graveyard',
    }))

    expect(moved.objects[objectId]).toMatchObject({
      name: 'Funeral Room // Awakening Hall',
      manaCost: '{2}{B} // {6}{B}{B}',
      manaValue: 11,
    })
    expect(moved.objects[objectId].unlockedDoors).toBeUndefined()
  })

  test.each([
    ['left', 'Charred Foyer', 4],
    ['right', 'Warped Space', 6],
  ] as const)('Starfield animates the cast %s door using only %s mana value', (doorId, name, stats) => {
    const server = starfieldGame()
    const resolved = castRoomDoor(server, doorId)
    const foyer = roomIn(resolved)

    expect(foyer).toMatchObject({
      name,
      manaValue: stats,
      types: ['Enchantment', 'Creature'],
      power: stats,
      toughness: stats,
      unlockedDoors: [doorId],
    })
  })

  test.each([
    ['left', 'right'],
    ['right', 'left'],
  ] as const)('Starfield animates a Room with both doors unlocked as 10/10 after casting %s', (
    castDoor,
    unlockDoor,
  ) => {
    const server = starfieldGame()
    const resolved = castRoomDoor(server, castDoor)
    const foyer = roomIn(resolved)
    const unlocked = ok(server.rules(resolved, {
      type: 'unlockDoor',
      seat: 'p1',
      objectId: foyer.id,
      door: unlockDoor,
    }))

    expect(unlocked.objects[foyer.id]).toMatchObject({
      name: 'Charred Foyer // Warped Space',
      manaValue: 10,
      types: ['Enchantment', 'Creature'],
      power: 10,
      toughness: 10,
      unlockedDoors: [castDoor, unlockDoor],
    })
  })

  test('a Room returned by Starfield enters locked, becomes 0/0, and dies to state-based actions', () => {
    let observedLockedZeroZero = false
    const witness: Plugin = {
      id: 'testLockedRoomWitness',
      apply: ({ state, event }) => {
        if (event.type !== 'move' || event.to !== 'graveyard') return
        const object = state.objects[event.objectId]
        observedLockedZeroZero ||= Boolean(
          object?.roomDoors
          && object.zone === 'battlefield'
          && object.unlockedDoors?.length === 0
          && object.types.includes('Creature')
          && object.power === 0
          && object.toughness === 0,
        )
      },
    }
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            starfield,
            ...Array.from({ length: 5 }, (_, index) => enchantment(`Fixture ${index + 1}`)),
            { ...charredFoyer(), zone: 'graveyard' },
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [starfieldOfNyx, witness] },
    )
    const foyer = roomIn(server.state)

    // Resolving Starfield of Nyx's upkeep trigger moves the targeted enchantment
    // directly from the graveyard to the battlefield.
    const returned = ok(server.rules(server.state, {
      type: 'move',
      objectId: foyer.id,
      to: 'battlefield',
    }))

    expect(observedLockedZeroZero).toBe(true)
    expect(returned.objects[foyer.id]).toMatchObject({
      zone: 'graveyard',
      name: 'Charred Foyer // Warped Space',
      manaValue: 10,
    })
    expect(returned.objects[foyer.id].unlockedDoors).toBeUndefined()
  })
})
