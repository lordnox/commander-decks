import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack, roomDoor } from '../testHelpers'
import { activated } from './activated'
import { gainLife } from './effects'
import { cardPluginEntry } from './index'

const marina = () => cardTemplate('Marina Vendrell', {
  types: ['Creature'],
  subtypes: ['Human', 'Warlock'],
  supertypes: ['Legendary'],
  power: 3,
  toughness: 5,
})

const room = (unlockedDoors?: Array<'left' | 'right'>) =>
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

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name.includes(name))!

describe('Marina Vendrell', () => {
  test('registers only the generic activated handler', () => {
    expect(cardPluginEntry('Marina Vendrell')?.handlerIds).toEqual(['activated'])
  })

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
      { battlefield: { p1: [marina(), room(['left'])] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const marinaId = named(server.state, 'Marina Vendrell').id
    const roomId = server.state.zoneOrder.p1.battlefield.find((id) => id !== marinaId)!
    server.state.objects[marinaId].summoningSickness = false
    const mana = { ...server.state.players.p1.mana }

    const actions = legalActsFor(server.state, 'p1').filter(
      (action) => action.kind === 'activateAbility' && action.abilityId === 'marina.lockOrUnlock',
    )
    expect(actions).toContainEqual(expect.objectContaining({
      door: 'right',
      targetObjectIds: [roomId],
    }))
    const unlock = actions.find((action) => action.kind === 'activateAbility' && action.door === 'right')
    expect(eventsForAvailableAction(server.state, 'p1', unlock!)).toEqual([{
      type: 'activateAbility',
      abilityId: 'marina.lockOrUnlock',
      seat: 'p1',
      objectId: marinaId,
      targets: [{ kind: 'object', objectId: roomId }],
      door: 'right',
    }])

    const activatedState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'marina.lockOrUnlock',
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

  test('taps to lock an unlocked door', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [marina(), room(['left'])] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const marinaId = named(server.state, 'Marina Vendrell').id
    const roomId = server.state.zoneOrder.p1.battlefield.find((id) => id !== marinaId)!
    server.state.objects[marinaId].summoningSickness = false

    const activatedState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'marina.lockOrUnlock',
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
          p2: [room(['left'])],
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const marinaId = named(server.state, 'Marina Vendrell').id
    const roomId = named(server.state, 'Funeral Room').id
    server.state.objects[marinaId].summoningSickness = false

    expect(server.rules({ ...server.state, step: 'upkeep' }, {
      type: 'activateAbility',
      abilityId: 'marina.lockOrUnlock',
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
      abilityId: 'marina.lockOrUnlock',
      seat: 'p1',
      objectId: marinaId,
      targets: [{ kind: 'object', objectId: roomId }],
      door: 'right',
    })).toMatchObject({
      ok: false,
      error: 'Marina Vendrell needs one room target',
    })
  })
})
