import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { lilianasCaress } from './lilianasCaress'
import { onResolve } from './onResolve'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, ...extra })

const caressCard = () => card("Liliana's Caress", ['Enchantment'], {
  manaCost: '{1}{B}',
  oracleText: 'Whenever an opponent discards a card, that player loses 2 life.',
  grantedRules: ['lilianasCaress'],
})

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = () => createServerGame(
  commanderRules,
  {
    battlefield: { p3: [caressCard()] },
    hands: {
      p1: [card('Island', ['Land']), card('Swamp', ['Land'])],
      p3: [card('Forest', ['Land'])],
    },
  },
  { random: () => 0.5, cardPlugins: [lilianasCaress, onResolve] },
)

test('an opponent discarding loses two life', () => {
  const server = game()
  const discarded = ok(server.rules(server.state, {
    type: 'discard',
    seat: 'p1',
    objectId: server.state.zoneOrder.p1.hand[0],
  }))

  expect(discarded.players.p1.life).toBe(commanderRules.startingLife - 2)
  expect(discarded.objects[server.state.zoneOrder.p1.hand[0]].zone).toBe('graveyard')
})

test('each discarded card drains separately', () => {
  const server = game()
  let current = server.state
  for (const objectId of [...server.state.zoneOrder.p1.hand]) {
    current = ok(server.rules(current, { type: 'discard', seat: 'p1', objectId }))
  }

  expect(current.players.p1.life).toBe(commanderRules.startingLife - 4)
})

test('the controller discarding is not an opponent', () => {
  const server = game()
  const discarded = ok(server.rules(server.state, {
    type: 'discard',
    seat: 'p3',
    objectId: server.state.zoneOrder.p3.hand[0],
  }))

  expect(discarded.players.p3.life).toBe(commanderRules.startingLife)
})

test('a Caress that has left the battlefield drains nobody', () => {
  const server = game()
  const caress = Object.values(server.state.objects)
    .find((object) => object.name === "Liliana's Caress")!
  const gone = ok(server.rules(server.state, {
    type: 'move',
    objectId: caress.id,
    to: 'graveyard',
  }))
  const discarded = ok(server.rules(gone, {
    type: 'discard',
    seat: 'p1',
    objectId: server.state.zoneOrder.p1.hand[0],
  }))

  expect(discarded.players.p1.life).toBe(commanderRules.startingLife)
})
