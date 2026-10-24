import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { activated } from './activated'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('self-bouncing lands', () => {
  test('Ghost Town returns only outside its controller’s turn', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [cardTemplate('Ghost Town')] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const ownTurn = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId,
    })
    expect(ownTurn.ok).toBe(false)

    const otherTurn = {
      ...server.state,
      active: 'p2',
      priority: 'p1',
    }
    const afterActivate = ok(server.rules(otherTurn, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId,
    }))
    expect(afterActivate.objects[objectId].zone).toBe('battlefield')
    expect(afterActivate.stack[0]).toMatchObject({ kind: 'ability', abilityId: '$.abilities[1]' })
    const returned = ok(server.rules(afterActivate, { type: 'resolveTop' }))
    expect(returned.objects[objectId].zone).toBe('hand')
  })

  test('Oboro pays one mana and returns itself', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [cardTemplate('Oboro, Palace in the Clouds')] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    const ready = structuredClone(server.state)
    ready.players.p1.mana.U = 1
    const afterActivate = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId,
    }))
    expect(afterActivate.players.p1.mana.U).toBe(0)
    expect(afterActivate.objects[objectId].zone).toBe('battlefield')
    expect(afterActivate.stack[0]).toMatchObject({ kind: 'ability', abilityId: '$.abilities[0]' })
    const returned = ok(server.rules(afterActivate, { type: 'resolveTop' }))
    expect(returned.objects[objectId].zone).toBe('hand')
  })

  test('Oboro rejects an activation without mana', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [cardTemplate('Oboro, Palace in the Clouds')] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const result = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.battlefield[0],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('locked total cost')
  })
})
