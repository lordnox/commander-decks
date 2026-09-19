import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { gainLife } from '../cardPlugins/effects'
import type { CardEffect } from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { RoomDoorCharacteristics } from '../types'

const door = (
  name: string,
  manaCost: string,
  oracleText: string,
  effects: CardEffect[] = [],
): RoomDoorCharacteristics => ({
  name,
  types: ['Enchantment'],
  subtypes: ['Room'],
  supertypes: [],
  manaCost,
  manaValue: [...manaCost.matchAll(/\{(\d+|[WUBRGC])\}/g)]
    .reduce((total, match) => total + (/^\d+$/.test(match[1]) ? Number(match[1]) : 1), 0),
  colors: [...new Set([...manaCost.matchAll(/[WUBRG]/g)].map((match) => match[0]))],
  oracleText,
  effects,
})

const trigger = (on: 'enters' | 'unlock' | 'fullyUnlock', life: number): CardEffect => ({
  op: 'trigger',
  on,
  do: [gainLife(life)],
})

const room = (unlockedDoors?: Array<'left' | 'right'>) =>
  cardTemplate('Funeral Room // Awakening Hall', {
    roomDoors: [
      door('Funeral Room', '{2}{B}', 'Whenever a creature you control dies, drain.', [
        trigger('enters', 1),
        trigger('unlock', 2),
      ]),
      door('Awakening Hall', '{6}{B}{B}', 'When you unlock this door, reanimate.', [
        trigger('unlock', 3),
        trigger('fullyUnlock', 4),
      ]),
    ],
    ...(unlockedDoors ? { unlockedDoors } : {}),
  })

const funded = (
  state: ReturnType<typeof createServerGame>['state'],
  mana: { B: number; C: number },
) => ({
  ...state,
  players: {
    ...state.players,
    p1: {
      ...state.players.p1,
      mana: { W: 0, U: 0, B: mana.B, R: 0, G: 0, C: mana.C },
    },
  },
})

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
})
