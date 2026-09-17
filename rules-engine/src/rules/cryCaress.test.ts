import { expect, test } from 'bun:test'
import { onResolve } from '../cardPlugins/onResolve'
import {
  discardCards,
  loseLife,
  onResolve as onResolveEffect,
  triggerOn,
} from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'

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

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const passAll = (server: ReturnType<typeof createServerGame>, state: GameState) => {
  let current = state
  for (const seat of current.playerOrder) {
    current = ok(server.rules(current, { type: 'passPriority', seat }))
  }
  return current
}

test('scenario A: Cry targeting P2 discards, Caress triggers on stack, then drains', () => {
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
