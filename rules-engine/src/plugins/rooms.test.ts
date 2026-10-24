import { pendingOptionSelection } from '../rules/selectOptions'
import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { activated } from '../cardPlugins/activated'
import { gainLife, type CardEffect } from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack, roomDoor } from '../testHelpers'
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
    const enteredUnordered = ok(server.rules(cast, { type: 'resolveTop' }))
    const order = pendingSelectionFor(enteredUnordered, 'p1')!
    const entered = ok(server.rules(enteredUnordered, {
      type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose',
      count: order.count, objectIds: order.candidates,
    }))

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

    const unlockedUnordered = ok(server.rules(state, {
      type: 'unlockDoor',
      seat: 'p1',
      objectId,
      door: 'right',
    }))
    const order = pendingSelectionFor(unlockedUnordered, 'p1')!
    const unlocked = ok(server.rules(unlockedUnordered, {
      type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose',
      count: order.count, objectIds: order.candidates,
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
    expect(state.stack[0].targets).toEqual([{
      kind: 'object', objectId: foyer.id, incarnation: 2, zone: 'graveyard',
    }])

    state = ok(server.rules(state, { type: 'resolveTop' }))
    const option = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: option.id, optionId: option.options.find(entry => entry.label === 'Accept')!.id }))

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

const marina = () => cardTemplate('Marina Vendrell', {
  types: ['Creature'],
  subtypes: ['Human', 'Warlock'],
  supertypes: ['Legendary'],
  power: 3,
  toughness: 5,
})

const marinaRoom = (unlockedDoors?: Array<'left' | 'right'>) =>
  cardTemplate('Funeral Room // Awakening Hall', {
    roomDoors: [
      roomDoor('Funeral Room', '{2}{B}', {
        oracleText: 'When this Room enters and whenever you unlock this door, gain 1 life.',
        effects: [{ op: 'trigger', on: 'unlock', do: [gainLife(1)] }],
      }),
      roomDoor('Awakening Hall', '{6}{B}{B}', {
        oracleText: 'When you unlock this door, gain 3 life.',
        effects: [{ op: 'trigger', on: 'unlock', do: [gainLife(3)] }],
      }),
    ],
    ...(unlockedDoors ? { unlockedDoors } : {}),
  })

const namedIncludes = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name.includes(name))!

describe('Room lock or unlock activations', () => {
  test('enters by revealing seven, putting enchantments into hand, and the rest on the bottom at random', () => {
    const library = [
      cardTemplate('Aura', { types: ['Enchantment'] }),
      cardTemplate('Bolt', { types: ['Instant'] }),
      cardTemplate('Room Card', { types: ['Enchantment'], subtypes: ['Room'] }),
      cardTemplate('Bear', { types: ['Creature'] }),
      cardTemplate('Forest', { types: ['Land'] }),
      cardTemplate('Seal', { types: ['Enchantment'] }),
      cardTemplate('Counter', { types: ['Instant'] }),
      cardTemplate('Kept', { types: ['Sorcery'] }),
    ]
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [marina()] },
        libraries: { p1: library },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const objectId = server.state.zoneOrder.p1.hand[0]
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId,
      to: 'battlefield',
    })))

    const handNames = entered.zoneOrder.p1.hand.map((id) => entered.objects[id].name)
    const libraryNames = entered.zoneOrder.p1.library.map((id) => entered.objects[id].name)
    expect(handNames.sort()).toEqual(['Aura', 'Room Card', 'Seal'])
    expect(libraryNames).toHaveLength(5)
    expect(libraryNames.slice(0, 1)).toEqual(['Kept'])
    expect(new Set(libraryNames.slice(1))).toEqual(new Set(['Bolt', 'Bear', 'Forest', 'Counter']))
  })

  test('taps as a sorcery to unlock a door without paying its mana cost', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [marina(), marinaRoom(['left'])] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const marinaId = namedIncludes(server.state, 'Marina Vendrell').id
    const roomId = server.state.zoneOrder.p1.battlefield.find((id) => id !== marinaId)!
    server.state.objects[marinaId].summoningSickness = false
    const mana = { ...server.state.players.p1.mana }

    const actions = legalActsFor(server.state, 'p1').filter(
      (action) => action.kind === 'activateAbility' && action.abilityId === '$.abilities[1]',
    )
    expect(actions).toContainEqual(expect.objectContaining({
      door: 'right',
      targetObjectIds: [roomId],
    }))
    const unlock = actions.find((action) => action.kind === 'activateAbility' && action.door === 'right')
    expect(eventsForAvailableAction(server.state, 'p1', unlock!)).toEqual([expect.objectContaining({
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: marinaId,
      targets: [{ kind: 'object', objectId: roomId }],
      door: 'right',
    })])

    const activatedState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: marinaId,
      targets: [{ kind: 'object', objectId: roomId }],
      door: 'right',
    }))
    const resolved = resolveStack(server.rules, activatedState)

    expect(resolved.objects[marinaId].tapped).toBe(true)
    expect(resolved.players.p1.mana).toEqual(mana)
    expect(resolved.objects[roomId].unlockedDoors).toEqual(['left', 'right'])
    expect(resolved.players.p1.life).toBe(43)
  })

  test("generic Room targets do not impose a controller restriction", () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [cardTemplate('Room Observer', {
          types: ['Artifact'],
          effects: [{
            op: 'activate',
            id: 'observeRoom',
            costs: {},
            targets: 'room',
            do: [gainLife(1)],
          }],
        })],
        p2: [marinaRoom(['left'])],
      },
    }, { random: () => 0.5, cardPlugins: [activated] })
    const source = namedIncludes(server.state, 'Room Observer')
    const target = namedIncludes(server.state, 'Funeral Room')
    const state = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: source.id,
      abilityId: 'observeRoom',
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    const resolved = resolveStack(server.rules, state)
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.objects[target.id].controller).toBe('p2')
  })

  test('taps to lock an unlocked door', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [marina(), marinaRoom(['left'])] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const marinaId = namedIncludes(server.state, 'Marina Vendrell').id
    const roomId = server.state.zoneOrder.p1.battlefield.find((id) => id !== marinaId)!
    server.state.objects[marinaId].summoningSickness = false

    const activatedState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: marinaId,
      targets: [{ kind: 'object', objectId: roomId }],
      door: 'left',
    }))
    const resolved = resolveStack(server.rules, activatedState)

    expect(resolved.objects[roomId].unlockedDoors).toEqual([])
    expect(resolved.objects[roomId].oracleText).toBe('')
    expect(resolved.players.p1.life).toBe(40)
  })

  test('rejects the tap except as a sorcery and rejects an opponent Room', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [marina()],
          p2: [marinaRoom(['left'])],
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const marinaId = namedIncludes(server.state, 'Marina Vendrell').id
    const roomId = namedIncludes(server.state, 'Funeral Room').id
    server.state.objects[marinaId].summoningSickness = false

    expect(server.rules({ ...server.state, step: 'upkeep' }, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: marinaId,
      targets: [{ kind: 'object', objectId: roomId }],
      door: 'right',
    })).toMatchObject({
      ok: false,
      error: 'Marina Vendrell can be activated only as a sorcery',
    })
    expect(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: marinaId,
      targets: [{ kind: 'object', objectId: roomId }],
      door: 'right',
    })).toMatchObject({
      ok: false,
      error: 'supplied canonical targets do not satisfy the declared clauses',
    })
  })
})
