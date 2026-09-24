import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import {
  gainLife,
  loseLifeTargetPlayer,
  secondCardDrawn,
  triggerOn,
  yourFirstMain,
} from '../cardPlugins/effects'
import { pendingPlayerSelectionFor } from './selectPlayers'

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

const secondDrawMage = () => cardTemplate('Second Draw Mage', {
  types: ['Creature'],
  effects: [
    triggerOn('draw', {
      if: secondCardDrawn(),
      targets: 'opponent',
      do: [loseLifeTargetPlayer(2), gainLife(2)],
    }),
  ],
})

describe('second-card-drawn triggers', () => {
  test('triggers only on the controller\'s second draw, not the first or third', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [secondDrawMage()] },
      libraries: {
        p1: ['One', 'Two', 'Three'].map((name) => cardTemplate(name, { types: ['Instant'] })),
      },
      players: 2,
    })

    const first = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(pendingPlayerSelectionFor(first, 'p1')).toBeUndefined()
    expect(first.stack).toHaveLength(0)

    const second = ok(server.rules(first, { type: 'draw', seat: 'p1' }))
    const selection = pendingPlayerSelectionFor(second, 'p1')
    expect(selection).toMatchObject({
      seat: 'p1',
      min: 1,
      max: 1,
      candidates: ['p2'],
    })

    const targeted = ok(server.rules(second, {
      type: 'selectPlayers',
      selectionId: selection!.id,
      seat: 'p1',
      players: ['p2'],
    }))
    expect(targeted.stack).toHaveLength(1)

    const third = ok(server.rules(targeted, { type: 'draw', seat: 'p1' }))
    expect(pendingPlayerSelectionFor(third, 'p1')).toBeUndefined()
    expect(third.stack).toHaveLength(1)

    const resolved = resolveStack(server.rules, third)
    expect(resolved.players.p2.life).toBe(commanderRules.startingLife - 2)
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife + 2)
  })

  test('does not trigger when an opponent draws their second card', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [secondDrawMage()] },
      libraries: {
        p2: ['Opp One', 'Opp Two'].map((name) => cardTemplate(name, { types: ['Instant'] })),
      },
      players: 2,
    })

    const first = ok(server.rules(server.state, { type: 'draw', seat: 'p2' }))
    const second = ok(server.rules(first, { type: 'draw', seat: 'p2' }))
    expect(pendingPlayerSelectionFor(second, 'p1')).toBeUndefined()
    expect(second.stack).toHaveLength(0)
  })
})

describe('first-main triggers', () => {
  test('fires on precombatMain for the controller only', () => {
    const beacon = (name: string) => cardTemplate(name, {
      types: ['Enchantment'],
      effects: [yourFirstMain(gainLife(3))],
    })
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [beacon('First Main Beacon')],
        p2: [beacon('Other Main Beacon')],
      },
      players: 2,
    })

    const atDraw = { ...server.state, step: 'draw' as const }
    const entered = ok(server.rules(atDraw, { type: 'advanceStep' }))
    expect(entered.step).toBe('precombatMain')
    expect(entered.stack.map((item) => item.name)).toEqual(['First Main Beacon'])

    const resolved = resolveStack(server.rules, entered)
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife + 3)
    expect(resolved.players.p2.life).toBe(commanderRules.startingLife)
  })

  test('does not fire when leaving precombatMain', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [cardTemplate('First Main Beacon', {
          types: ['Enchantment'],
          effects: [yourFirstMain(gainLife(3))],
        })],
      },
      players: 2,
    })
    expect(server.state.step).toBe('precombatMain')
    const left = ok(server.rules(server.state, { type: 'advanceStep' }))
    expect(left.step).toBe('beginCombat')
    expect(left.stack).toHaveLength(0)
  })
})
