import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog, pendingDialogFor } from '../pendingDialog'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { lilianasCaress } from './lilianasCaress'
import { RANKLE_MODES, rankle } from './rankle'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, ...extra })

const creature = (name: string, extra: Partial<CardTemplate> = {}) =>
  card(name, ['Creature'], { power: 1, toughness: 1, ...extra })

const rankleCard = () => creature('Rankle, Master of Pranks', {
  supertypes: ['Legendary'],
  subtypes: ['Faerie', 'Rogue'],
  power: 3,
  toughness: 3,
  oracleText:
    'Flying, haste\nWhenever Rankle deals combat damage to a player, choose any number —\n'
    + '• Each player discards a card.\n• Each player loses 1 life and draws a card.\n'
    + '• Each player sacrifices a creature of their choice.',
  grantedRules: ['rankle'],
})

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = (extra: { caress?: boolean } = {}) => createServerGame(
  commanderRules,
  {
    battlefield: {
      p1: [rankleCard(), creature('Gravedigger'), ...(extra.caress
        ? [card("Liliana's Caress", ['Enchantment'], { grantedRules: ['lilianasCaress'] })]
        : [])],
      p2: [creature('Lone Hydra', { power: 9, toughness: 9 })],
    },
    hands: {
      p1: [card('Swamp', ['Land'])],
      p2: [card('Island', ['Land']), card('Forest', ['Land'])],
    },
    libraries: {
      p1: [card('Mountain', ['Land'])],
      p2: [card('Plains', ['Land'])],
    },
  },
  { random: () => 0.5, cardPlugins: [rankle, lilianasCaress] },
)

const connect = (server: ReturnType<typeof createServerGame>, state = server.state) => {
  const source = Object.values(state.objects)
    .find((object) => object.name === 'Rankle, Master of Pranks')!
  return ok(server.rules(state, {
    type: 'combatDamage',
    sourceId: source.id,
    target: { kind: 'player', player: 'p2' },
    amount: 3,
  }))
}

const chooseModes = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  modes: string[],
) => ok(server.rules(state, {
  type: 'custom',
  name: DIALOG_CHOSEN,
  seat: 'p1',
  payload: { modes },
}))

test('combat damage asks Rankle for its modes', () => {
  const asked = connect(game())

  expect(pendingDialog(asked)).toMatchObject({
    kind: 'choose-modes',
    seat: 'p1',
    options: [
      RANKLE_MODES.discard,
      RANKLE_MODES.drain,
      RANKLE_MODES.sacrifice,
    ],
  })
})

test('choosing no modes leaves the table alone', () => {
  const server = game()
  const settled = chooseModes(server, connect(server), [])

  expect(pendingDialog(settled)).toBeUndefined()
  expect(settled.players.p2.life).toBe(commanderRules.startingLife - 3)
})

test('the sacrifice mode asks every player with a creature', () => {
  const server = game()
  const asked = chooseModes(server, connect(server), [RANKLE_MODES.sacrifice])
  const hydra = Object.values(asked.objects).find((object) => object.name === 'Lone Hydra')!

  expect(pendingDialogFor(asked, 'p2')).toMatchObject({ kind: 'sacrifice-creature' })
  const sacrificed = ok(server.rules(asked, {
    type: 'custom',
    name: DIALOG_CHOSEN,
    seat: 'p2',
    payload: { objectIds: [hydra.id] },
  }))

  expect(sacrificed.objects[hydra.id].zone).toBe('graveyard')
  expect(pendingDialogFor(sacrificed, 'p2')).toBeUndefined()
})

test('a player with no creature is not asked to sacrifice', () => {
  const server = game()
  const hydra = Object.values(server.state.objects)
    .find((object) => object.name === 'Lone Hydra')!
  const empty = ok(server.rules(server.state, {
    type: 'move',
    objectId: hydra.id,
    to: 'graveyard',
  }))
  const asked = chooseModes(server, connect(server, empty), [RANKLE_MODES.sacrifice])

  expect(pendingDialogFor(asked, 'p2')).toBeUndefined()
  expect(pendingDialogFor(asked, 'p1')).toMatchObject({ kind: 'sacrifice-creature' })
})

test('the drain mode costs each player a life and draws them a card', () => {
  const server = game()
  const drained = chooseModes(server, connect(server), [RANKLE_MODES.drain])

  expect(drained.players.p1.life).toBe(commanderRules.startingLife - 1)
  expect(drained.players.p2.life).toBe(commanderRules.startingLife - 4)
  expect(drained.zoneOrder.p2.hand.length).toBe(3)
})

test('the discard mode drains through Liliana\'s Caress', () => {
  const server = game({ caress: true })
  const asked = chooseModes(server, connect(server), [RANKLE_MODES.discard])
  const island = Object.values(asked.objects).find((object) => object.name === 'Island')!
  const discarded = ok(server.rules(asked, {
    type: 'custom',
    name: DIALOG_CHOSEN,
    seat: 'p2',
    payload: { objectIds: [island.id] },
  }))

  expect(discarded.objects[island.id].zone).toBe('graveyard')
  expect(discarded.players.p2.life).toBe(commanderRules.startingLife - 5)
})

test('choosing every mode queues discards before sacrifices', () => {
  const server = game()
  const asked = chooseModes(server, connect(server), [
    RANKLE_MODES.sacrifice,
    RANKLE_MODES.discard,
    RANKLE_MODES.drain,
  ])

  expect(pendingDialogFor(asked, 'p2')).toMatchObject({ kind: 'discard-card' })
  expect(asked.players.p2.life).toBe(commanderRules.startingLife - 4)
})
