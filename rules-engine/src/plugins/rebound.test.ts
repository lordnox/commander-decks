import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState, PlayerId } from '../types'

const reboundSpell = () => cardTemplate('Test Rebound', {
  types: ['Sorcery'],
  manaCost: '{4}{U}',
  oracleText: 'Rebound (If you cast this spell from your hand, exile it as it resolves.)',
  effects: [{
    op: 'trigger',
    on: 'resolve',
    do: [{ kind: 'gainLife', count: 1 }],
  }],
})

const setup = () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [
        reboundSpell(),
        cardTemplate('Other Instant', { types: ['Instant'], manaCost: '{0}' }),
      ],
    },
    battlefield: {
      p1: [cardTemplate('Mana Rock', {
        types: ['Artifact'],
        tapProduces: { C: 1 },
      })],
    },
  })
  const objectId = server.state.zoneOrder.p1.hand[0]
  const otherId = server.state.zoneOrder.p1.hand[1]
  const manaId = server.state.zoneOrder.p1.battlefield[0]
  server.state.players.p1.mana.U = 1
  server.state.players.p1.mana.C = 4
  return { server, objectId, otherId, manaId }
}

const castAndResolve = () => {
  const { server, objectId, otherId, manaId } = setup()
  const cast = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId,
  }))
  return {
    server,
    objectId,
    otherId,
    manaId,
    state: ok(server.rules(cast, { type: 'resolveTop' })),
  }
}

const beginUpkeep = (server: ReturnType<typeof setup>['server'], state: GameState, active: PlayerId) => {
  const before = structuredClone(state)
  before.active = active
  before.priority = active
  before.step = 'untap'
  return ok(server.rules(before, { type: 'advanceStep' }))
}

describe('rebound', () => {
  test('exiles a hand-cast spell and schedules only its controller next upkeep', () => {
    const { server, objectId, state } = castAndResolve()

    expect(state.objects[objectId].zone).toBe('exile')
    expect(state.zoneOrder.p1.graveyard).not.toContain(objectId)
    expect(state.delayedTriggers).toHaveLength(1)
    expect(state.delayedTriggers[0].condition).toEqual({
      kind: 'step',
      step: 'upkeep',
      active: 'p1',
    })

    const opponentUpkeep = beginUpkeep(server, state, 'p2')
    expect(opponentUpkeep.stack).toHaveLength(0)
    expect(opponentUpkeep.delayedTriggers).toHaveLength(1)

    const controllerUpkeep = beginUpkeep(server, opponentUpkeep, 'p1')
    expect(controllerUpkeep.stack[0]).toMatchObject({
      kind: 'ability',
      objectId,
      controller: 'p1',
    })
    expect(controllerUpkeep.delayedTriggers).toHaveLength(0)
  })

  test('optionally casts the exiled card for free and does not rebound it again', () => {
    const { server, objectId, state } = castAndResolve()
    const upkeep = beginUpkeep(server, state, 'p1')
    const offered = ok(server.rules(upkeep, { type: 'resolveTop' }))

    expect(server.rules(offered, {
      type: 'passPriority',
      seat: 'p1',
    }).ok).toBe(false)

    const actions = legalActsFor(offered, 'p1')
    const accept = actions.find((action) =>
      action.kind === 'castSpell' && action.objectId === objectId)
    const decline = actions.find((action) => action.kind === 'declineFreeCast')
    expect(accept).toMatchObject({
      kind: 'castSpell',
      objectId,
      alternativeCost: 'withoutPayingMana',
    })
    expect(decline).toMatchObject({ kind: 'declineFreeCast', objectId })
    expect(accept && eventsForAvailableAction(offered, 'p1', accept)).toEqual([{
      type: 'castSpell',
      seat: 'p1',
      objectId,
      alternativeCost: 'withoutPayingMana',
    }])
    expect(decline && eventsForAvailableAction(offered, 'p1', decline)).toEqual([{
      type: 'declineFreeCast',
      seat: 'p1',
      objectId,
    }])

    const recast = ok(server.rules(offered, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
      alternativeCost: 'withoutPayingMana',
    }))
    expect(recast.objects[objectId].zone).toBe('stack')
    expect(recast.players.p1.mana).toEqual(offered.players.p1.mana)
    expect(recast.stack[0]).toMatchObject({
      kind: 'spell',
      objectId,
      castFrom: 'exile',
    })

    const resolvedAgain = ok(server.rules(recast, { type: 'resolveTop' }))
    expect(resolvedAgain.objects[objectId].zone).toBe('graveyard')
    expect(resolvedAgain.delayedTriggers).toHaveLength(0)

    const laterUpkeep = beginUpkeep(server, resolvedAgain, 'p1')
    expect(laterUpkeep.stack).toHaveLength(0)
  })

  test('may decline the one-shot cast and leave the card in exile', () => {
    const { server, objectId, state } = castAndResolve()
    const upkeep = beginUpkeep(server, state, 'p1')
    const offered = ok(server.rules(upkeep, { type: 'resolveTop' }))
    const declined = ok(server.rules(offered, {
      type: 'declineFreeCast',
      seat: 'p1',
      objectId,
    }))

    expect(declined.objects[objectId].zone).toBe('exile')
    expect(declined.delayedTriggers).toHaveLength(0)
    expect(server.rules(declined, { type: 'passPriority', seat: 'p1' }).ok).toBe(true)
  })

  test('allows mana abilities but no other priority actions while the choice is pending', () => {
    const { server, objectId, otherId, manaId, state } = castAndResolve()
    const upkeep = beginUpkeep(server, state, 'p1')
    const offered = ok(server.rules(upkeep, { type: 'resolveTop' }))

    expect(server.rules(offered, {
      type: 'castSpell',
      seat: 'p1',
      objectId: otherId,
    }).ok).toBe(false)

    const withMana = ok(server.rules(offered, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: manaId,
    }))
    expect(withMana.players.p1.mana.C).toBe(1)

    expect(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
      alternativeCost: 'withoutPayingMana',
    }).ok).toBe(true)
  })

  test('does not rebound when cast from outside the hand', () => {
    const { server, objectId } = setup()
    const state = structuredClone(server.state)
    state.castableZones = [...state.castableZones, 'graveyard']
    state.objects[objectId].zone = 'graveyard'
    state.zoneOrder.p1.hand = []
    state.zoneOrder.p1.graveyard = [objectId]
    state.zoneCounts.p1.hand = 0
    state.zoneCounts.p1.graveyard = 1

    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))

    expect(resolved.objects[objectId].zone).toBe('graveyard')
    expect(resolved.delayedTriggers).toHaveLength(0)
  })
})
