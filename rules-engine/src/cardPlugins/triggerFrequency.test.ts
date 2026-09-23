import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { draw, gainLife, landfallOnceEachTurn, landfallResolveNth } from './effectBuilders'

const land = (name: string) => cardTemplate(name, { types: ['Land'] })
const fillerLibrary = () => [
  cardTemplate('Filler A', { types: ['Instant'] }),
  cardTemplate('Filler B', { types: ['Instant'] }),
  cardTemplate('Filler C', { types: ['Instant'] }),
]

describe('trigger frequency flags', () => {
  test('onceEachTurn limits how often that ability triggers on one object', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [cardTemplate('Fable Warden', {
          types: ['Creature'],
          effects: [landfallOnceEachTurn(draw(1))],
        })],
      },
      hands: { p1: [land('First'), land('Second')] },
      libraries: { p1: fillerLibrary() },
      players: 2,
    })
    const [firstId, secondId] = server.state.zoneOrder.p1.hand

    const firstLand = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: firstId,
    }))
    expect(firstLand.stack).toHaveLength(1)

    const afterFirst = resolveStack(server.rules, firstLand)
    expect(afterFirst.zoneCounts.p1.hand).toBe(2)

    const secondLand = ok(server.rules(afterFirst, {
      type: 'move',
      objectId: secondId,
      to: 'battlefield',
    }))
    expect(secondLand.stack).toHaveLength(0)
    expect(secondLand.zoneCounts.p1.hand).toBe(1)
  })

  test('onceEachTurn is tracked per object, not per card name', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          cardTemplate('Fable Warden A', {
            types: ['Creature'],
            effects: [landfallOnceEachTurn(draw(1))],
          }),
          cardTemplate('Fable Warden B', {
            types: ['Creature'],
            effects: [landfallOnceEachTurn(draw(1))],
          }),
        ],
      },
      hands: { p1: [land('Shared')] },
      libraries: { p1: fillerLibrary() },
      players: 2,
    })
    const landId = server.state.zoneOrder.p1.hand[0]

    const played = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: landId,
    }))
    expect(played.stack).toHaveLength(2)

    const resolved = resolveStack(server.rules, played)
    expect(resolved.zoneCounts.p1.hand).toBe(2)
  })

  test('whenResolvedNth swaps instructions on the matching resolution this turn', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [cardTemplate('Guild Scribe', {
          types: ['Creature'],
          effects: [landfallResolveNth(2, [gainLife(2)], [draw(1)])],
        })],
      },
      hands: { p1: [land('First'), land('Second')] },
      libraries: { p1: fillerLibrary() },
      players: 2,
    })
    const [firstId, secondId] = server.state.zoneOrder.p1.hand

    const firstLand = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: firstId,
    }))
    const afterFirst = resolveStack(server.rules, firstLand)
    expect(afterFirst.players.p1.life).toBe(42)
    expect(afterFirst.zoneCounts.p1.hand).toBe(1)

    const secondLand = ok(server.rules(afterFirst, {
      type: 'move',
      objectId: secondId,
      to: 'battlefield',
    }))
    const afterSecond = resolveStack(server.rules, secondLand)
    expect(afterSecond.players.p1.life).toBe(42)
    expect(afterSecond.zoneCounts.p1.hand).toBe(1)
  })

  test('resolve counts are separate from onceEachTurn trigger marks', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [cardTemplate('Ledger Keeper', {
          types: ['Creature'],
          effects: [{
            op: 'trigger',
            on: 'landfall',
            do: [gainLife(1)],
            onceEachTurn: true,
            whenResolvedNth: { nth: 1, do: [draw(1)] },
          }],
        })],
      },
      hands: { p1: [land('Only')] },
      libraries: { p1: fillerLibrary() },
      players: 2,
    })
    const landId = server.state.zoneOrder.p1.hand[0]
    const wardenId = server.state.zoneOrder.p1.battlefield[0]

    const played = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: landId,
    }))
    expect(played.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, played)
    expect(resolved.zoneCounts.p1.hand).toBe(1)
    expect(resolved.players.p1.life).toBe(40)
    expect(resolved.objects[wardenId].triggerFrequency?.['landfall@0']?.triggeredTurn).toBe(1)
    expect(resolved.objects[wardenId].triggerFrequency?.['landfall@0']?.resolveCount).toBe(1)

    const bounced = ok(server.rules(resolved, {
      type: 'move',
      objectId: landId,
      to: 'graveyard',
    }))
    const reentered = ok(server.rules(bounced, {
      type: 'move',
      objectId: landId,
      to: 'battlefield',
    }))
    expect(reentered.stack).toHaveLength(0)
  })
})
