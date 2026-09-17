import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { forest } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import {
  activated,
  GHOST_TOWN_RETURN,
  OBORO_RETURN,
} from './activated'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = (name: string) =>
  createServerGame(
    commanderRules,
    {
      battlefield: {
        p1: [{ ...forest(), name, supertypes: name.startsWith('Oboro') ? ['Legendary'] : [] }],
      },
    },
    { random: () => 0.5, cardPlugins: [activated] },
  )

describe('self-bouncing lands', () => {
  test('Ghost Town returns only outside its controller’s turn', () => {
    const server = game('Ghost Town')
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const ownTurn = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: GHOST_TOWN_RETURN,
      seat: 'p1',
      objectId,
    })
    expect(ownTurn.ok).toBe(false)

    const otherTurn = {
      ...server.state,
      active: 'p2',
      priority: 'p1',
    }
    const activated = ok(server.rules(otherTurn, {
      type: 'activateAbility',
      abilityId: GHOST_TOWN_RETURN,
      seat: 'p1',
      objectId,
    }))
    // CR 602.2/608.2 — bounce resolves from the stack, not at activation.
    expect(activated.objects[objectId].zone).toBe('battlefield')
    expect(activated.stack[0]).toMatchObject({ kind: 'ability', abilityId: GHOST_TOWN_RETURN })
    const returned = ok(server.rules(activated, { type: 'resolveTop' }))
    expect(returned.objects[objectId].zone).toBe('hand')
  })

  test('Oboro pays one mana and returns itself', () => {
    const server = game('Oboro, Palace in the Clouds')
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const ready = structuredClone(server.state)
    ready.players.p1.mana.U = 1
    const activated = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: OBORO_RETURN,
      seat: 'p1',
      objectId,
    }))
    expect(activated.players.p1.mana.U).toBe(0)
    expect(activated.objects[objectId].zone).toBe('battlefield')
    expect(activated.stack[0]).toMatchObject({ kind: 'ability', abilityId: OBORO_RETURN })
    const returned = ok(server.rules(activated, { type: 'resolveTop' }))
    expect(returned.objects[objectId].zone).toBe('hand')
  })

  test('Oboro rejects an activation without mana', () => {
    const server = game('Oboro, Palace in the Clouds')
    const result = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: OBORO_RETURN,
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.battlefield[0],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not enough mana')
  })
})
