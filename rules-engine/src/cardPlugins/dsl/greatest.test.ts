import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { hasKeyword } from '../../keywords'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  card,
  compileCardRuleDefinition,
  draw,
  evaluateAmount,
  greatest,
  objects,
  ref,
  spell,
} from './v1'

const creature = (name: string, power: number, extra: { subtypes?: string[] } = {}) =>
  cardTemplate(name, {
    types: ['Creature'],
    power,
    toughness: power,
    summoningSickness: false,
    ...(extra.subtypes ? { subtypes: extra.subtypes } : {}),
  })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const wildspeaker = () => cardTemplate('Return of the Wildspeaker', { manaCost: '{0}' })

test('greatest rejects player life and evaluates through the amount context', () => {
  expect(evaluateAmount(greatest({
    of: objects({ zone: 'battlefield', type: 'Creature' }),
    characteristic: 'power',
    information: 'current',
  }), { count: () => 0, greatest: () => 4, characteristic: () => 0 })).toBe(4)
  expect(() => compileCardRuleDefinition(card([spell({ instructions: [draw({
    count: { kind: 'greatest', of: objects({ zone: 'battlefield' }), characteristic: 'life' as 'power', information: 'current' },
    targets: ref('controller'),
  })] })]))).toThrow('numeric characteristic')
})

test('Overwhelming Stampede snapshots the greatest controlled power for a trample pump', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [creature('Small', 2), creature('Large', 5)],
      p2: [creature('Ignored', 9)],
    },
    hands: { p1: [cardTemplate('Overwhelming Stampede', { manaCost: '{0}' })] },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
  })))
  expect(named(resolved, 'Small')).toMatchObject({ power: 7, toughness: 7 })
  expect(named(resolved, 'Large')).toMatchObject({ power: 10, toughness: 10 })
  expect(hasKeyword(named(resolved, 'Small'), 'trample')).toBe(true)
  expect(hasKeyword(named(resolved, 'Large'), 'trample')).toBe(true)
  expect(named(resolved, 'Ignored')).toMatchObject({ power: 9, toughness: 9 })
  expect(hasKeyword(named(resolved, 'Ignored'), 'trample')).toBe(false)
})

test('Pathbreaker Ibex grants the same overrun when it attacks', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [
        cardTemplate('Pathbreaker Ibex', { types: ['Creature'], power: 3, toughness: 3, summoningSickness: false }),
        creature('Large', 5),
      ],
      p2: [creature('Ignored', 9)],
    },
  }, { random: () => 0 })
  const ibex = server.state.zoneOrder.p1.battlefield[0]!
  let state = structuredClone(server.state)
  state.step = 'declareAttackers'
  state.active = 'p1'
  state.priority = 'p1'
  state = ok(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: ibex, defender: 'p2' }] }))
  expect(state.stack).toHaveLength(1)
  state = resolveStack(server.rules, state)
  expect(named(state, 'Pathbreaker Ibex')).toMatchObject({ power: 8, toughness: 8 })
  expect(named(state, 'Large')).toMatchObject({ power: 10, toughness: 10 })
  expect(hasKeyword(named(state, 'Pathbreaker Ibex'), 'trample')).toBe(true)
  expect(hasKeyword(named(state, 'Large'), 'trample')).toBe(true)
  expect(named(state, 'Ignored')).toMatchObject({ power: 9, toughness: 9 })
})

test('Return of the Wildspeaker draws or pumps from non-Human creatures only', () => {
  const empty = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [creature('Human', 4, { subtypes: ['Human'] })], p2: [creature('Beast', 6)] },
    hands: { p1: [wildspeaker()] },
    libraries: { p1: [cardTemplate('Would draw')] },
  }, { random: () => 0 })
  const drawnNone = resolveStack(empty.rules, ok(empty.rules(empty.state, {
    type: 'castSpell', seat: 'p1', objectId: empty.state.zoneOrder.p1.hand[0]!, modeIndices: [0],
  })))
  expect(drawnNone.zoneOrder.p1.hand).toHaveLength(0)
  expect(named(drawnNone, 'Human')).toMatchObject({ power: 4, toughness: 4 })

  const drawGame = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [creature('Human', 8, { subtypes: ['Human'] }), creature('Beast', 3)] },
    hands: { p1: [wildspeaker()] },
    libraries: { p1: Array.from({ length: 4 }, (_, index) => cardTemplate(`Draw fixture ${index}`)) },
  }, { random: () => 0 })
  const drawn = resolveStack(drawGame.rules, ok(drawGame.rules(drawGame.state, {
    type: 'castSpell', seat: 'p1', objectId: drawGame.state.zoneOrder.p1.hand[0]!, modeIndices: [0],
  })))
  expect(drawn.zoneOrder.p1.hand).toHaveLength(3)

  const pump = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [creature('Human', 4, { subtypes: ['Human'] }), creature('Beast', 2)],
      p2: [creature('Ignored', 6)],
    },
    hands: { p1: [wildspeaker()] },
  }, { random: () => 0 })
  const pumped = resolveStack(pump.rules, ok(pump.rules(pump.state, {
    type: 'castSpell', seat: 'p1', objectId: pump.state.zoneOrder.p1.hand[0]!, modeIndices: [1],
  })))
  expect(named(pumped, 'Beast')).toMatchObject({ power: 5, toughness: 5 })
  expect(named(pumped, 'Human')).toMatchObject({ power: 4, toughness: 4 })
  expect(named(pumped, 'Ignored')).toMatchObject({ power: 6, toughness: 6 })
})
