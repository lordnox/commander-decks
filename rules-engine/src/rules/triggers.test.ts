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

  test('Crawling Sensation triggers only for the first land each turn', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Crawling Sensation', { types: ['Enchantment'] })] },
      hands: { p1: [land('First land'), land('Second land')] },
      players: 2,
    })
    const [firstId, secondId] = server.state.zoneOrder.p1.hand
    const first = ok(server.rules(server.state, {
      type: 'move',
      objectId: firstId,
      to: 'graveyard',
    }))
    const second = ok(server.rules(first, {
      type: 'move',
      objectId: secondId,
      to: 'graveyard',
    }))

    expect(second.stack.map((item) => item.name)).toEqual(['Crawling Sensation'])
    const resolved = resolveStack(server.rules, second)
    expect(Object.values(resolved.objects).filter((object) =>
      object.zone === 'battlefield' && object.name === 'Insect')).toHaveLength(1)
  })

  test('Crawling Sensation misses a turn whose first land hit the graveyard before it', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [
          land('First land'),
          cardTemplate('Crawling Sensation', { types: ['Enchantment'] }),
          land('Second land'),
        ],
      },
      players: 2,
    })
    const [firstId, sensationId, secondId] = server.state.zoneOrder.p1.hand

    const milled = ok(server.rules(server.state, {
      type: 'move',
      objectId: firstId,
      to: 'graveyard',
    }))
    const played = ok(server.rules(milled, {
      type: 'move',
      objectId: sensationId,
      to: 'battlefield',
    }))
    const second = ok(server.rules(played, {
      type: 'move',
      objectId: secondId,
      to: 'graveyard',
    }))

    expect(played.objects[sensationId].zone).toBe('battlefield')
    expect(second.stack).toHaveLength(0)
  })
})
