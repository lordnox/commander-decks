import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'

const land = (name: string) => cardTemplate(name, { types: ['Land'] })

describe('landToGraveyard triggers', () => {
  test('Hedge Shredder mills a land onto the stack before it enters tapped', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Hedge Shredder', { types: ['Creature'] })] },
      libraries: { p1: [land('Milled Forest')] },
      players: 2,
    })
    const shredderId = server.state.zoneOrder.p1.battlefield[0]
    const landId = server.state.zoneOrder.p1.library[0]

    const milled = ok(server.rules(server.state, {
      type: 'move',
      objectId: landId,
      to: 'graveyard',
    }))

    expect(milled.objects[landId].zone).toBe('graveyard')
    expect(milled.stack).toHaveLength(1)
    expect(milled.stack[0]).toMatchObject({
      kind: 'ability',
      objectId: shredderId,
      name: 'Hedge Shredder',
      payload: {
        triggeringObjectId: landId,
      },
    })

    const resolved = resolveStack(server.rules, milled)

    expect(resolved.objects[landId].zone).toBe('battlefield')
    expect(resolved.objects[landId].tapped).toBe(true)
    expect(resolved.stack).toHaveLength(0)
  })

  test('Hedge Shredder does not trigger when a land is discarded to the graveyard', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Hedge Shredder', { types: ['Creature'] })] },
      hands: { p1: [land('Hand Forest')] },
      players: 2,
    })
    const landId = server.state.zoneOrder.p1.hand[0]

    const discarded = ok(server.rules(server.state, {
      type: 'move',
      objectId: landId,
      to: 'graveyard',
    }))

    expect(discarded.objects[landId].zone).toBe('graveyard')
    expect(discarded.stack).toHaveLength(0)
  })
})
