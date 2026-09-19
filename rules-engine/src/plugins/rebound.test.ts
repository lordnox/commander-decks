import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState, PlayerId } from '../types'

const reboundSpell = () => cardTemplate('Test Rebound', {
  types: ['Sorcery'],
  manaCost: '{4}{U}',
  oracleText: 'Rebound (If you cast this spell from your hand, exile it as it resolves.)',
})

const setup = () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [reboundSpell()] },
  })
  const objectId = server.state.zoneOrder.p1.hand[0]
  server.state.players.p1.mana.U = 1
  server.state.players.p1.mana.C = 4
  return { server, objectId }
}

const castAndResolve = () => {
  const { server, objectId } = setup()
  const cast = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId,
  }))
  return {
    server,
    objectId,
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

    const recast = ok(server.rules(offered, {
      type: 'castWithoutPayingMana',
      seat: 'p1',
      objectId,
      accept: true,
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
      type: 'castWithoutPayingMana',
      seat: 'p1',
      objectId,
      accept: false,
    }))

    expect(declined.objects[objectId].zone).toBe('exile')
    expect(declined.delayedTriggers).toHaveLength(0)
    expect(server.rules(declined, { type: 'passPriority', seat: 'p1' }).ok).toBe(true)
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
