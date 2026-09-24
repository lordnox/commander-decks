import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { gainLife } from '../cardPlugins/effects'
import type { CardEffect } from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
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

/** Functional fixture: only Room door costs and mana values matter. */
const testRoom = () =>
  cardTemplate('Fixture Room Left // Fixture Room Right', {
    roomDoors: [
      roomDoor('Fixture Room Left', '{3}{R}'),
      roomDoor('Fixture Room Right', '{4}{R}{R}'),
    ],
  })

const starfield = () => cardTemplate('Starfield of Nyx', {
  types: ['Enchantment'],
  manaCost: '{4}{W}',
  manaValue: 5,
  oracleText: 'At the beginning of your upkeep, you may return target enchantment card from your graveyard to the battlefield.\nAs long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.',
})

// Five inert enchantments reach Starfield's threshold. Every mana value is at least
// 1 so animating them never makes a 0/0 that state-based actions would remove.
const plainEnchantments = () => [1, 2, 3, 4, 5].map((manaValue) =>
  cardTemplate(`Fixture Enchantment ${manaValue}`, {
    types: ['Enchantment'],
    manaCost: `{${manaValue}}`,
    manaValue,
    oracleText: 'Fixture: no abilities.',
  }))

const starfieldGame = () => createServerGame(
  commanderRules,
  {
    hands: { p1: [testRoom()] },
    battlefield: {
      p1: [
        starfield(),
        ...plainEnchantments(),
      ],
    },
  },
  { random: () => 0.5 },
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
    object.roomDoors?.some((door) => door.name === 'Fixture Room Left'))!

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
      { op: 'trigger', on: 'unlock', do: [] },
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

  test('an ability can lock a door without paying its mana cost', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [room(['left', 'right'])] },
    })
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const locked = ok(server.rules(server.state, {
      type: 'lockDoor',
      seat: 'p1',
      objectId,
      door: 'right',
    }))

    expect(locked.objects[objectId]).toMatchObject({
      name: 'Funeral Room',
      unlockedDoors: ['left'],
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
    ['left', 'Fixture Room Left', 4],
    ['right', 'Fixture Room Right', 6],
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
      name: 'Fixture Room Left // Fixture Room Right',
      manaValue: 10,
      types: ['Enchantment', 'Creature'],
      power: 10,
      toughness: 10,
      unlockedDoors: [castDoor, unlockDoor],
    })
  })

  test('a Room returned by Starfield enters locked, becomes 0/0, and dies to state-based actions', () => {
    let observedLockedZeroZero = false
    // The public reducer completes state-based actions before returning, so this
    // observer is the only view of the transient locked 0/0 battlefield state.
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
        first: 'p2',
        battlefield: {
          p1: [
            starfield(),
            ...plainEnchantments(),
          ],
        },
        hands: { p1: [testRoom()] },
      },
      { random: () => 0.5, cardPlugins: [witness] },
    )
    const foyer = roomIn(server.state)
    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: foyer.id,
      to: 'graveyard',
    }))
    state = advanceToUpkeep(server, state)

    const targetSelection = pendingSelectionFor(state, 'p1')!
    expect(targetSelection.candidates).toEqual([foyer.id])
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [foyer.id],
    }))
    expect(state.stack[0].targets).toEqual([{ kind: 'object', objectId: foyer.id }])

    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [foyer.id],
    }))

    // CR 709.5d gives the returned Room no unlocked designation; its resulting
    // 0 toughness makes CR 704.5f apply before the reducer returns.
    expect(observedLockedZeroZero).toBe(true)
    expect(state.objects[foyer.id]).toMatchObject({
      zone: 'graveyard',
      name: 'Fixture Room Left // Fixture Room Right',
      manaValue: 10,
    })
    expect(state.objects[foyer.id].types).not.toContain('Creature')
    expect(state.objects[foyer.id].unlockedDoors).toBeUndefined()
  })
})
