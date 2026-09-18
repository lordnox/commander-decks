import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog, pendingDialogFor } from '../pendingDialog'
import { pendingSelection, pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { choiceEffects } from './choiceEffects'
import { modalSpell } from './modalSpell'

const RANKLE_MODES = {
  discard: 'Each player discards a card',
  drain: 'Each player loses 1 life and draws a card',
  sacrifice: 'Each player sacrifices a creature',
} as const

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
})

const game = (extra: { caress?: boolean } = {}) => createServerGame(
  commanderRules,
  {
    battlefield: {
      p1: [rankleCard(), creature('Gravedigger'), ...(extra.caress
        ? [card("Liliana's Caress", ['Enchantment'])]
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
  { random: () => 0.5, cardPlugins: [modalSpell, choiceEffects] },
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

const resolveRankleTrigger = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => resolveStack(server.rules, state)

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

test('combat damage puts Rankle on the stack before its modes are chosen', () => {
  const server = game()
  const triggered = connect(server)

  expect(pendingDialog(triggered)).toBeUndefined()
  expect(triggered.stack[0]).toMatchObject({
    kind: 'ability',
    name: 'Rankle, Master of Pranks',
    controller: 'p1',
  })

  const asked = resolveRankleTrigger(server, triggered)
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
  const settled = chooseModes(server, resolveRankleTrigger(server, connect(server)), [])

  expect(pendingDialog(settled)).toBeUndefined()
  expect(settled.players.p2.life).toBe(commanderRules.startingLife - 3)
})

test('the sacrifice mode asks every player with a creature', () => {
  const server = game()
  const asked = chooseModes(
    server,
    resolveRankleTrigger(server, connect(server)),
    [RANKLE_MODES.sacrifice],
  )
  const hydra = Object.values(asked.objects).find((object) => object.name === 'Lone Hydra')!

  expect(pendingSelectionFor(asked, 'p2')).toMatchObject({ kind: 'sacrifice', count: 1 })
  const sacrificed = ok(server.rules(asked, {
    type: 'selectCards',
    seat: 'p2',
    kind: 'sacrifice',
    count: 1,
    objectIds: [hydra.id],
  }))

  expect(sacrificed.objects[hydra.id].zone).toBe('graveyard')
  expect(pendingSelectionFor(sacrificed, 'p2')).toBeUndefined()
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
  const asked = chooseModes(
    server,
    resolveRankleTrigger(server, connect(server, empty)),
    [RANKLE_MODES.sacrifice],
  )

  expect(pendingSelectionFor(asked, 'p2')).toBeUndefined()
  expect(pendingSelectionFor(asked, 'p1')).toMatchObject({ kind: 'sacrifice', count: 1 })
})

test('the drain mode costs each player a life and draws them a card', () => {
  const server = game()
  const drained = chooseModes(
    server,
    resolveRankleTrigger(server, connect(server)),
    [RANKLE_MODES.drain],
  )

  expect(drained.players.p1.life).toBe(commanderRules.startingLife - 1)
  expect(drained.players.p2.life).toBe(commanderRules.startingLife - 4)
  expect(drained.zoneOrder.p2.hand.length).toBe(3)
})

test('the discard mode drains through Liliana\'s Caress', () => {
  const server = game({ caress: true })
  const asked = chooseModes(
    server,
    resolveRankleTrigger(server, connect(server)),
    [RANKLE_MODES.discard],
  )
  const island = Object.values(asked.objects).find((object) => object.name === 'Island')!
  const discarded = ok(server.rules(asked, {
    type: 'selectCards',
    seat: 'p2',
    kind: 'discard',
    count: 1,
    objectIds: [island.id],
  }))

  expect(discarded.objects[island.id].zone).toBe('graveyard')
  // CR 603: Caress triggers on the stack; life loss waits for resolution after combat damage.
  expect(discarded.players.p2.life).toBe(commanderRules.startingLife - 3)
  expect(discarded.stack[0]).toMatchObject({
    kind: 'ability',
    name: "Liliana's Caress",
  })

  const resolved = ok(server.rules(discarded, { type: 'resolveTop' }))
  expect(resolved.players.p2.life).toBe(commanderRules.startingLife - 5)
})

test('choosing every mode queues discards before sacrifices', () => {
  const server = game()
  const asked = chooseModes(server, resolveRankleTrigger(server, connect(server)), [
    RANKLE_MODES.sacrifice,
    RANKLE_MODES.discard,
    RANKLE_MODES.drain,
  ])

  expect(pendingSelectionFor(asked, 'p2')).toMatchObject({ kind: 'discard', count: 1 })
  expect(asked.players.p2.life).toBe(commanderRules.startingLife - 4)
})

test('each-player discard opens dialogs in APNAP order', () => {
  const server = createServerGame(
    commanderRules,
    {
      players: 4,
      battlefield: {
        p1: [rankleCard(), creature('Gravedigger')],
        p2: [creature('Lone Hydra', { power: 9, toughness: 9 })],
      },
      hands: {
        p1: [card('Swamp', ['Land'])],
        p2: [card('Island', ['Land']), card('Forest', ['Land'])],
        p3: [card('Mountain', ['Land'])],
        p4: [card('Plains', ['Land'])],
      },
    },
    { random: () => 0.5, cardPlugins: [modalSpell, choiceEffects] },
  )
  const activeP3 = { ...server.state, active: 'p3', priority: 'p3' }
  const asked = chooseModes(
    server,
    resolveRankleTrigger(server, connect(server, activeP3)),
    [RANKLE_MODES.discard],
  )

  expect(pendingSelection(asked)).toMatchObject({ kind: 'discard', seat: 'p3', count: 1 })

  const mountain = Object.values(asked.objects).find((object) => object.name === 'Mountain')!
  const afterP3 = ok(server.rules(asked, {
    type: 'selectCards',
    seat: 'p3',
    kind: 'discard',
    count: 1,
    objectIds: [mountain.id],
  }))
  expect(pendingSelection(afterP3)).toMatchObject({ kind: 'discard', seat: 'p4', count: 1 })
})
