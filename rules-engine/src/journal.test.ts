import { expect, test } from 'bun:test'
import { onResolve } from './cardPlugins/onResolve'
import {
  discardCards,
  loseLife,
  onResolve as onResolveEffect,
  triggerOn,
} from './cardPlugins/effects'
import { commanderRules } from './formats'
import { createJournal, recordAccepted, restoreJournal } from './journal'
import { cardTemplate, forest, type CardTemplate } from './newGame'
import { replayComparableState } from './replay'
import { createServerGame } from './runtime'
import type { GameState, ReduceResult } from './types'

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

test('a kernel journal restores accepted events without storing before/after trees', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [forest()] },
  })
  const land = Object.values(server.state.objects)[0]
  let journal = createJournal(server.state)
  const played = server.rules(server.state, {
    type: 'playLand',
    seat: 'p1',
    objectId: land.id,
  })
  expect(played.ok).toBe(true)
  if (!played.ok) return
  journal = recordAccepted(journal, {
    type: 'playLand',
    seat: 'p1',
    objectId: land.id,
  })

  const restored = restoreJournal(journal, server.rules)
  expect(restored.current().objects[land.id].zone).toBe('battlefield')
  expect(journal.initial.objects[land.id].zone).toBe('hand')
})

test('journal restores continueAction with stable stack id through waiting discard', () => {
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

  let journal = createJournal(server.state)
  let state = server.state

  const castEvent = {
    type: 'castSpell' as const,
    seat: 'p1' as const,
    objectId: spellId,
    targets: [{ kind: 'player' as const, player: 'p2' as const }],
  }
  state = ok(server.rules(state, castEvent))
  journal = recordAccepted(journal, castEvent)

  state = passAll(server, state)
  for (const seat of state.playerOrder) {
    journal = recordAccepted(journal, { type: 'passPriority', seat })
  }

  const discardId = state.stack[0].id
  expect(state.stack[0]).toMatchObject({ actionId: 'discard' })

  state = passAll(server, state)
  for (const seat of state.playerOrder) {
    journal = recordAccepted(journal, { type: 'passPriority', seat })
  }

  expect(state.stack[0].id).toBe(discardId)
  expect(state.stack[0]).toMatchObject({ actionId: 'discard', waiting: 'choice' })
  expect(replayComparableState(state).stack[0]).toEqual({
    name: 'Cry of Contrition Test',
    kind: 'action',
    controller: 'p2',
    waiting: 'choice',
    text: 'discard · waiting',
  })

  const continueEvent = {
    type: 'continueAction' as const,
    stackId: discardId,
    seat: 'p2' as const,
    payload: { objectIds: [victimCard] },
  }
  state = ok(server.rules(state, continueEvent))
  journal = recordAccepted(journal, continueEvent)

  expect(state.objects[victimCard].zone).toBe('graveyard')
  expect(state.players.p2.life).toBe(commanderRules.startingLife)
  expect(state.stack[0]).toMatchObject({
    kind: 'ability',
    controller: 'p3',
    name: "Liliana's Caress",
  })

  const restored = restoreJournal(structuredClone(journal), server.rules)
  const replayed = restored.current()
  expect(replayed.objects[victimCard].zone).toBe('graveyard')
  expect(replayed.players.p2.life).toBe(commanderRules.startingLife)
  expect(replayed.stack[0]).toMatchObject({
    kind: 'ability',
    controller: 'p3',
    name: "Liliana's Caress",
  })

  const drained = ok(server.rules(replayed, { type: 'resolveTop' }))
  expect(drained.players.p2.life).toBe(commanderRules.startingLife - 2)
  expect(drained.stack).toHaveLength(0)
})
