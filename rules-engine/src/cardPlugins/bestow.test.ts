import { describe, expect, test } from 'bun:test'
import {
  eventsForAvailableAction,
  legalActsFor,
} from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate, forest, type CardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { bestow } from './bestow'

const creature = (name = 'Grizzly Bears') => cardTemplate(name, {
  types: ['Creature'],
  power: 2,
  toughness: 2,
})

const springheart = (extra: Partial<CardTemplate> = {}) => cardTemplate(
  'Springheart Nantuko',
  {
    types: ['Enchantment', 'Creature'],
    subtypes: ['Insect', 'Monk'],
    manaCost: '{1}{G}',
    power: 1,
    toughness: 1,
    ...extra,
  },
)

const game = (options: {
  hand?: CardTemplate[]
  battlefield?: CardTemplate[]
}) => createServerGame(
  commanderRules,
  {
    hands: { p1: options.hand ?? [] },
    battlefield: { p1: options.battlefield ?? [] },
  },
  { random: () => 0.5, cardPlugins: [bestow] },
)

const objectsNamed = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name)

const attachedGame = () => {
  const server = game({ battlefield: [springheart(), creature()] })
  const spring = objectsNamed(server.state, 'Springheart Nantuko')[0]
  const bear = objectsNamed(server.state, 'Grizzly Bears')[0]
  spring.types = ['Enchantment']
  spring.subtypes = ['Aura']
  spring.power = null
  spring.toughness = null
  spring.attachedTo = bear.id
  bear.power = 3
  bear.toughness = 3
  return { server, spring, bear }
}

describe('bestow', () => {
  test('legalActsFor offers creature and bestowed casts and pays the bestow cost', () => {
    const bestowed = cardTemplate('Test Bestower', {
      types: ['Enchantment', 'Creature'],
      manaCost: '{5}',
      power: 2,
      toughness: 2,
      effects: [{ op: 'bestow', cost: '{1}{G}', power: 2, toughness: 2 }],
    })
    const server = game({ hand: [bestowed], battlefield: [creature()] })
    server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 5 }
    const sourceId = server.state.zoneOrder.p1.hand[0]
    const target = objectsNamed(server.state, 'Grizzly Bears')[0]
    const casts = legalActsFor(server.state, 'p1').filter(
      (action) => action.kind === 'castSpell' && action.objectId === sourceId,
    )

    expect(casts.some((action) => action.kind === 'castSpell' && !action.castOption)).toBe(true)
    const bestowedAction = casts.find(
      (action) => action.kind === 'castSpell'
        && action.castOption === 'bestow'
        && action.targetObjectId === target.id,
    )
    expect(bestowedAction).toBeDefined()
    if (!bestowedAction) return

    const events = eventsForAvailableAction(server.state, 'p1', bestowedAction)
    expect(events).toHaveLength(1)
    const cast = ok(server.rules(server.state, events![0]))
    expect(cast.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 4 })

    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[sourceId]).toMatchObject({
      zone: 'battlefield',
      types: ['Enchantment'],
      subtypes: ['Aura'],
      attachedTo: target.id,
      power: null,
      toughness: null,
    })
    expect(resolved.objects[target.id]).toMatchObject({ power: 4, toughness: 4 })
  })

  test('an illegal bestow target makes the spell enter as a creature', () => {
    const server = game({ hand: [springheart()], battlefield: [creature()] })
    server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
    const sourceId = server.state.zoneOrder.p1.hand[0]
    const target = objectsNamed(server.state, 'Grizzly Bears')[0]
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: sourceId,
      castOption: 'bestow',
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    const removed = ok(server.rules(cast, {
      type: 'move',
      objectId: target.id,
      to: 'graveyard',
    }))
    const resolved = ok(server.rules(removed, { type: 'resolveTop' }))

    expect(resolved.objects[sourceId]).toMatchObject({
      zone: 'battlefield',
      types: ['Enchantment', 'Creature'],
      subtypes: ['Insect', 'Monk'],
      attachedTo: null,
      power: 1,
      toughness: 1,
    })
  })

  test('landfall copies the attached creature when paid and makes an Insect otherwise', () => {
    const paid = attachedGame()
    paid.server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
    paid.server.state.zoneOrder.p1.hand.push('land')
    paid.server.state.zoneCounts.p1.hand += 1
    paid.server.state.objects.land = {
      ...forest(),
      id: 'land',
      owner: 'p1',
      controller: 'p1',
      zone: 'hand',
    }
    const triggered = ok(paid.server.rules(paid.server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: 'land',
    }))
    const choosing = ok(paid.server.rules(triggered, { type: 'resolveTop' }))
    expect(pendingDialog(choosing)).toMatchObject({
      kind: 'may-pay-mana',
      cost: '{1}{G}',
      sourceId: paid.spring.id,
    })
    const copied = ok(paid.server.rules(choosing, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(objectsNamed(copied, 'Grizzly Bears')).toHaveLength(2)
    expect(objectsNamed(copied, 'Insect')).toHaveLength(0)
    expect(copied.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })

    const declined = attachedGame()
    declined.server.state.zoneOrder.p1.hand.push('land')
    declined.server.state.zoneCounts.p1.hand += 1
    declined.server.state.objects.land = {
      ...forest(),
      id: 'land',
      owner: 'p1',
      controller: 'p1',
      zone: 'hand',
    }
    const declinedTrigger = ok(declined.server.rules(declined.server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: 'land',
    }))
    const declinedChoice = ok(declined.server.rules(
      declinedTrigger,
      { type: 'resolveTop' },
    ))
    const insect = ok(declined.server.rules(declinedChoice, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: false },
    }))
    expect(objectsNamed(insect, 'Grizzly Bears')).toHaveLength(1)
    expect(objectsNamed(insect, 'Insect')).toHaveLength(1)
  })

  test('an Aura whose creature leaves is put into the graveyard by SBA', () => {
    const { server, spring, bear } = attachedGame()
    const moved = ok(server.rules(server.state, {
      type: 'move',
      objectId: bear.id,
      to: 'graveyard',
    }))

    expect(moved.objects[spring.id].zone).toBe('graveyard')
    expect(moved.objects[spring.id].attachedTo).toBeNull()
    expect(moved.objects[bear.id]).toMatchObject({
      zone: 'graveyard',
      power: 2,
      toughness: 2,
    })
  })
})
