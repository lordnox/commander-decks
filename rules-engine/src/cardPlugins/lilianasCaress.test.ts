import { expect, test } from 'bun:test'
import {
  discardCards,
  loseLife,
  onResolve as onResolveEffect,
  triggerOn,
} from './effects'
import { commanderRules } from '../formats'
import { bolt, cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { onResolve } from './onResolve'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, ...extra })

const caressCard = () => card("Liliana's Caress", ['Enchantment'], {
  manaCost: '{1}{B}',
  oracleText: 'Whenever an opponent discards a card, that player loses 2 life.',
  effects: [
    triggerOn('discard', {
      if: { seat: 'opponent' },
      do: [loseLife(2, 'triggeringPlayer')],
    }),
  ],
})

const cryCard = () => card('Cry of Contrition Test', ['Sorcery'], {
  manaCost: '',
  effects: [onResolveEffect(discardCards(1, 'target'))],
})

const passAll = (server: ReturnType<typeof createServerGame>, state: GameState) => {
  let current = state
  for (const seat of current.playerOrder) {
    current = ok(server.rules(current, { type: 'passPriority', seat }))
  }
  return current
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
  { random: () => 0.5, cardPlugins: [onResolve] },
)

const discard = (state: GameState, seat: string, objectId: string) => ({
  type: 'discard' as const,
  seat,
  objectId,
})

test('Cry on stack, waiting discard, continueAction, then Caress drains', () => {
  const server = createServerGame(
    commanderRules,
    {
      battlefield: { p3: [caressCard()] },
      hands: {
        p1: [cryCard()],
        p2: [card('Victim Card', ['Instant'])],
      },
      players: 4,
    },
    { random: () => 0.5, cardPlugins: [onResolve] },
  )
  const spellId = server.state.zoneOrder.p1.hand[0]
  const victimCard = server.state.zoneOrder.p2.hand[0]

  const cast = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: spellId,
    targets: [{ kind: 'player', player: 'p2' }],
  }))
  expect(cast.stack).toHaveLength(1)
  expect(cast.stack[0].name).toBe('Cry of Contrition Test')

  const afterSpell = passAll(server, cast)
  expect(afterSpell.stack).toHaveLength(1)
  expect(afterSpell.stack[0]).toMatchObject({ actionId: 'discard' })

  const afterPasses = passAll(server, afterSpell)
  expect(afterPasses.stack).toHaveLength(1)
  expect(afterPasses.stack[0]).toMatchObject({ actionId: 'discard', waiting: 'choice' })
  expect(afterPasses.players.p2.life).toBe(commanderRules.startingLife)
  expect(afterPasses.priority).toBe('p2')

  const continued = ok(server.rules(afterPasses, {
    type: 'continueAction',
    stackId: afterPasses.stack[0].id,
    seat: 'p2',
    payload: { objectIds: [victimCard] },
  }))
  expect(continued.objects[victimCard].zone).toBe('graveyard')
  expect(continued.players.p2.life).toBe(commanderRules.startingLife)
  expect(continued.stack).toHaveLength(1)
  expect(continued.stack[0]).toMatchObject({
    kind: 'ability',
    controller: 'p3',
    name: "Liliana's Caress",
  })

  const drained = ok(server.rules(continued, { type: 'resolveTop' }))
  expect(drained.players.p2.life).toBe(commanderRules.startingLife - 2)
  expect(drained.stack).toHaveLength(0)
})

test('an opponent discarding puts Caress on the stack before life loss', () => {
  const server = game()
  const objectId = server.state.zoneOrder.p1.hand[0]
  const afterDiscard = ok(server.rules(server.state, discard(server.state, 'p1', objectId)))

  expect(afterDiscard.players.p1.life).toBe(commanderRules.startingLife)
  expect(afterDiscard.stack).toHaveLength(1)
  expect(afterDiscard.stack[0]).toMatchObject({
    kind: 'ability',
    controller: 'p3',
    name: "Liliana's Caress",
  })
  expect(afterDiscard.objects[objectId].zone).toBe('graveyard')

  const resolved = ok(server.rules(afterDiscard, { type: 'resolveTop' }))
  expect(resolved.players.p1.life).toBe(commanderRules.startingLife - 2)
  expect(resolved.stack).toHaveLength(0)
})

test('each discarded card triggers separately', () => {
  const server = game()
  let current = server.state
  for (const objectId of server.state.zoneOrder.p1.hand) {
    current = ok(server.rules(current, discard(current, 'p1', objectId)))
    expect(current.stack.length).toBeGreaterThan(0)
    current = ok(server.rules(current, { type: 'resolveTop' }))
  }

  expect(current.players.p1.life).toBe(commanderRules.startingLife - 4)
})

test('the controller discarding is not an opponent', () => {
  const server = game()
  const objectId = server.state.zoneOrder.p3.hand[0]
  const discarded = ok(server.rules(server.state, discard(server.state, 'p3', objectId)))

  expect(discarded.stack).toHaveLength(0)
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
  const objectId = server.state.zoneOrder.p1.hand[0]
  const discarded = ok(server.rules(gone, discard(gone, 'p1', objectId)))

  expect(discarded.stack).toHaveLength(0)
  expect(discarded.players.p1.life).toBe(commanderRules.startingLife)
})

test('players can respond to the Caress trigger before life loss', () => {
  const server = createServerGame(
    commanderRules,
    {
      battlefield: { p3: [caressCard()] },
      hands: {
        p1: [card('Island', ['Land'])],
        p3: [bolt()],
      },
    },
    { random: () => 0.5, cardPlugins: [onResolve] },
  )
  const discardedId = server.state.zoneOrder.p1.hand[0]
  const boltId = server.state.zoneOrder.p3.hand[0]
  const afterDiscard = ok(server.rules(server.state, discard(server.state, 'p1', discardedId)))

  expect(afterDiscard.players.p1.life).toBe(commanderRules.startingLife)
  expect(afterDiscard.stack).toHaveLength(1)

  const ready = structuredClone(afterDiscard)
  ready.priority = 'p3'
  ready.players.p3.mana.R = 1
  const bolted = ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p3',
    objectId: boltId,
    targets: [{ kind: 'player', player: 'p1' }],
  }))

  expect(bolted.stack).toHaveLength(2)
  expect(bolted.stack[0].name).toBe('Lightning Bolt')
  expect(bolted.players.p1.life).toBe(commanderRules.startingLife)

  const afterBolt = ok(server.rules(bolted, { type: 'resolveTop' }))
  expect(afterBolt.players.p1.life).toBe(commanderRules.startingLife - 3)
  expect(afterBolt.stack).toHaveLength(1)

  const afterCaress = ok(server.rules(afterBolt, { type: 'resolveTop' }))
  expect(afterCaress.players.p1.life).toBe(commanderRules.startingLife - 5)
})

test('two Caresses trigger in APNAP order', () => {
  const server = createServerGame(
    commanderRules,
    {
      battlefield: {
        p2: [caressCard()],
        p3: [caressCard()],
      },
      hands: {
        p1: [card('Island', ['Land'])],
      },
    },
    { random: () => 0.5, cardPlugins: [onResolve] },
  )
  const objectId = server.state.zoneOrder.p1.hand[0]
  const afterDiscard = ok(server.rules(server.state, discard(server.state, 'p1', objectId)))

  expect(afterDiscard.stack).toHaveLength(2)
  expect(afterDiscard.stack[0].controller).toBe('p3')
  expect(afterDiscard.stack[1].controller).toBe('p2')

  const once = ok(server.rules(afterDiscard, { type: 'resolveTop' }))
  expect(once.players.p1.life).toBe(commanderRules.startingLife - 2)

  const twice = ok(server.rules(once, { type: 'resolveTop' }))
  expect(twice.players.p1.life).toBe(commanderRules.startingLife - 4)
})
