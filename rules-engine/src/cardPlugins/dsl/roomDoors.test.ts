import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../../actions'
import { snapshotFor } from '../../cards/snapshot'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack, roomDoor } from '../../testHelpers'
import type { GameState, ManaPool, RoomDoorId } from '../../types'
import {
  fullyUnlock,
  gainLife,
  ref,
  self,
  unlockDoor,
  whenever,
} from './v1'

const doorProgram = (...abilities: Parameters<typeof snapshotFor>[0]) => snapshotFor(abilities)

const canonicalRoom = (unlockedDoors?: RoomDoorId[]) =>
  cardTemplate('Funeral Room // Awakening Hall', {
    roomDoors: [
      roomDoor('Funeral Room', '{2}{B}', {
        oracleText: 'When this Room enters and whenever you unlock this door, you gain 1 and 2 life.',
        ruleDefinition: doorProgram(
          whenever(self.enters, { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] }),
          whenever(unlockDoor(), { instructions: [gainLife({ targets: ref('controller'), amount: 2 })] }),
        ),
      }),
      roomDoor('Awakening Hall', '{6}{B}{B}', {
        oracleText: 'When you unlock this door, you gain 3 life. When you fully unlock, you gain 4 life.',
        ruleDefinition: doorProgram(
          whenever(unlockDoor(), { instructions: [gainLife({ targets: ref('controller'), amount: 3 })] }),
          whenever(fullyUnlock(), { instructions: [gainLife({ targets: ref('controller'), amount: 4 })] }),
        ),
      }),
    ],
    ...(unlockedDoors ? { unlockedDoors } : {}),
  })

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

const choosePending = (server: ReturnType<typeof createServerGame>, state: GameState) => {
  const order = pendingSelectionFor(state, 'p1')
  if (!order) return state
  return ok(server.rules(state, {
    type: 'selectCards',
    seat: 'p1',
    selectionId: order.id,
    kind: 'choose',
    count: order.count,
    objectIds: order.candidates,
  }))
}

describe('canonical Room door programs', () => {
  test('enumerates a canonical trigger door as a cast action without the judge', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [canonicalRoom()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const state = funded(server.state, { B: 1, C: 2 })
    const cast = legalActsFor(state, 'p1').find(
      action => action.kind === 'castSpell' && action.objectId === objectId && action.door === 'left',
    )

    expect(cast).toBeDefined()
    expect(eventsForAvailableAction(state, 'p1', cast!)).toEqual([
      { type: 'castSpell', seat: 'p1', objectId, door: 'left' },
    ])
  })

  test('the cast door runs its enter and this-door unlock programs, not the other door', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [canonicalRoom()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const state = funded(server.state, { B: 1, C: 2 })
    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
      door: 'left',
    }))
    const entered = choosePending(server, ok(server.rules(cast, { type: 'resolveTop' })))
    expect(entered.stack).toHaveLength(2)
    const first = ok(server.rules(entered, { type: 'resolveTop' }))
    const second = ok(server.rules(first, { type: 'resolveTop' }))
    expect(second.players.p1.life).toBe(43)
    expect(second.objects[objectId]).toMatchObject({
      name: 'Funeral Room',
      unlockedDoors: ['left'],
    })
    expect(second.objects[objectId].ruleDefinition).toBeDefined()
  })

  test('unlocking the second door as a sorcery fires that door and fullyUnlock', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [canonicalRoom(['left'])] },
    })
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const state = funded(server.state, { B: 2, C: 6 })
    expect(legalActsFor(state, 'p1')).toContainEqual(expect.objectContaining({
      kind: 'unlockDoor',
      objectId,
      door: 'right',
    }))
    const unlocked = choosePending(server, ok(server.rules(state, {
      type: 'unlockDoor',
      seat: 'p1',
      objectId,
      door: 'right',
    })))
    expect(unlocked.stack).toHaveLength(2)
    const first = ok(server.rules(unlocked, { type: 'resolveTop' }))
    const second = ok(server.rules(first, { type: 'resolveTop' }))
    expect(second.players.p1.life).toBe(47)
    expect(second.objects[objectId].unlockedDoors).toEqual(['left', 'right'])
  })

  test('a Room put onto the battlefield has both doors locked and no door programs', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [canonicalRoom()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId,
      to: 'battlefield',
    }))
    expect(entered.objects[objectId]).toMatchObject({
      name: '',
      unlockedDoors: [],
      effects: [],
    })
    expect(entered.objects[objectId].ruleDefinition).toBeUndefined()
  })

  test('canonical lock-or-unlock acts are one flattened action per room door', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Marina Vendrell'), canonicalRoom(['left'])] },
    })
    const marinaId = Object.values(server.state.objects).find(object => object.name === 'Marina Vendrell')!.id
    const roomId = server.state.zoneOrder.p1.battlefield.find(id => id !== marinaId)!
    server.state.objects[marinaId].summoningSickness = false
    const actions = legalActsFor(server.state, 'p1').filter(
      action => action.kind === 'activateAbility' && action.objectId === marinaId,
    )
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ door: 'left', targetObjectIds: [roomId], text: 'Lock or unlock Funeral Room' }),
      expect.objectContaining({ door: 'right', targetObjectIds: [roomId], text: 'Lock or unlock Awakening Hall' }),
    ]))
    const lock = actions.find(action => action.kind === 'activateAbility' && action.door === 'left')!
    expect(eventsForAvailableAction(server.state, 'p1', lock)).toEqual([
      expect.objectContaining({ type: 'activateAbility', door: 'left', objectId: marinaId }),
    ])
  })
})


test('a catalog Room unlock grants source-independent rules after the Room leaves', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Walk-In Closet // Forgotten Cellar', { unlockedDoors: ['left'] })] },
    hands: { p1: [cardTemplate('Spell fixture', { types: ['Instant'], manaCost: '{0}' }),
      cardTemplate('Land fixture', { types: ['Land'] })] },
  })
  const roomId = server.state.zoneOrder.p1.battlefield[0]
  const [spellId, landId] = server.state.zoneOrder.p1.hand
  let state = ok(server.rules(server.state, { type: 'move', objectId: spellId, to: 'graveyard' }))
  state = ok(server.rules(state, { type: 'move', objectId: landId, to: 'graveyard' }))
  expect(legalActsFor(state, 'p1')).toContainEqual(expect.objectContaining({ kind: 'playLand', objectId: landId }))
  state = ok(server.rules(funded(state, { G: 2, C: 3 }), { type: 'unlockDoor', seat: 'p1', objectId: roomId, door: 'right' }))
  expect(state.stack).toHaveLength(1)
  state = ok(server.rules(state, { type: 'move', objectId: roomId, to: 'hand' }))
  state = resolveStack(server.rules, state)
  expect(legalActsFor(state, 'p1')).not.toContainEqual(expect.objectContaining({ kind: 'playLand', objectId: landId }))
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId })))
  expect(state.objects[spellId].zone).toBe('exile')
  state = ok(server.rules(state, { type: 'move', objectId: landId, to: 'hand' }))
  state = ok(server.rules(state, { type: 'move', objectId: landId, to: 'graveyard' }))
  expect(state.objects[landId].zone).toBe('exile')
})
