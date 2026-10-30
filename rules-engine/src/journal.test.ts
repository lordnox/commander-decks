import { expect, test } from 'bun:test'
import { commanderRules } from './formats'
import { createJournal, KERNEL_SCHEMA, recordAccepted, restoreJournal } from './journal'
import { cardTemplate, forest, type CardTemplate } from './newGame'
import { replayComparableState } from './replay'
import { createServerGame } from './runtime'
import { ok } from './testHelpers'
import type { GameState } from './types'
import { pendingSelectionFor } from './rules/selectCards'
import {
  card as dslCard,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  discard as dslDiscard,
  players as dslPlayers,
  select as dslSelect,
  spell as dslSpell,
  target as dslTarget,
} from './cardPlugins/dsl/v1'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, ...extra })

const caressCard = () => cardTemplate("Liliana's Caress")

const cryCard = () => card('Cry of Contrition Test', ['Sorcery'], {
  manaCost: '',
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(dslCard([dslSpell({
    decisions: { targets: [dslSelect({ filter: dslPlayers(), count: 1 })] },
    instructions: [dslDiscard({ targets: dslTarget(0), count: 1 })],
  })]))),
})

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

test('a legacy journal schema is rejected with a recreate-game instruction', () => {
  const server = createServerGame(commanderRules)
  const journal = createJournal(server.state)
  const legacy = { ...journal, schema: 'rules-engine/v0' } as unknown as typeof journal
  expect(journal.schema).toBe(KERNEL_SCHEMA)
  expect(() => restoreJournal(legacy, server.rules)).toThrow(
    'Recreate the game to use the current color-set format',
  )
})

test('journal restores a typed discard and its durable source resolution', () => {
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
    { random: () => 0.5 },
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

  const selection = pendingSelectionFor(state, 'p2')!
  expect(selection).toMatchObject({ kind: 'discard', count: 1 })
  expect(state.stack[0]).toMatchObject({ kind: 'spell', name: 'Cry of Contrition Test' })
  expect(state.resolution).toMatchObject({ kind: 'canonicalSpell', phase: 'waiting' })
  expect(replayComparableState(state).stack[0]).toEqual({
    name: 'Cry of Contrition Test',
    kind: 'spell',
    controller: 'p1',
    text: 'targeting p2',
  })

  const continueEvent = {
    type: 'selectCards' as const,
    seat: 'p2' as const,
    kind: 'discard' as const,
    count: 1,
    objectIds: [victimCard],
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
