import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createJournal, restoreJournal } from '../../journal'
import { createServerGame, projectForViewer } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import {
  LIBRARY_VISIBILITY,
  choice,
  choosePlayer,
  inspectTop,
  move,
  partitionPiles,
  players,
  ref,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const libraryCards = (...names: string[]) =>
  names.map((name) => cardTemplate(name, { types: ['Instant'] }))

const setup = () => createServerGame(commanderRules, {
  players: 4,
  hands: { p1: [instructionSpell({ instructions: [
    inspectTop({ player: ref('controller'), count: 5, bindChoice: 'cards', visibility: LIBRARY_VISIBILITY.public }),
    choosePlayer({ chooser: ref('controller'), filter: players({ relation: 'opponent' }), bindChoice: 'opponent' }),
    partitionPiles({
      cards: choice('cards'),
      partitioner: choice('opponent'),
      chooser: ref('controller'),
      bindChosen: 'kept',
      bindOther: 'rest',
    }),
    move({ targets: choice('kept'), to: 'hand' }),
    move({ targets: choice('rest'), to: 'graveyard' }),
  ] })] },
  libraries: { p1: libraryCards('Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Rest') },
}, { random: () => 0.5 })

const begin = (server: ReturnType<typeof setup>) => resolveStack(server.rules, ok(server.rules(server.state, {
  type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
})))

const idsNamed = (state: GameState, ...names: string[]) =>
  names.map((name) => named(state, name).id)

const partition = (state: GameState, faceUp: string[], faceDown: string[]) => ({
  type: 'selectCards' as const,
  seat: 'p2',
  kind: 'partition' as const,
  count: 5,
  choices: [
    ...faceUp.map((name) => ({ objectId: named(state, name).id, destination: 'face-up' as const })),
    ...faceDown.map((name) => ({ objectId: named(state, name).id, destination: 'face-down' as const })),
  ],
})

test('a public opponent split binds the chosen pile and the remainder without leaking later library cards', () => {
  const server = setup()
  let state = begin(server)
  const opponent = pendingPlayerSelectionFor(state, 'p1')!
  expect(opponent.candidates).toEqual(['p2', 'p3', 'p4'])
  expect(projectForViewer(state, 'p3').players.p1.data.revealed_library)
    .toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
  expect(projectForViewer(state, 'p3').objects[named(state, 'Rest').id]).toBeUndefined()

  state = ok(server.rules(state, {
    type: 'selectPlayers', seat: 'p1', selectionId: opponent.id, players: ['p2'],
  }))
  const split = pendingSelectionFor(state, 'p2')!
  expect(split).toMatchObject({ kind: 'partition', pileVisibility: 'public', pileController: 'p1' })
  expect(server.rules(state, { type: 'passPriority', seat: 'p2' }).ok).toBe(false)
  expect(server.rules(state, partition(state, ['Alpha', 'Beta'], ['Gamma'])).ok).toBe(false)

  state = ok(server.rules(JSON.parse(JSON.stringify(state)), partition(state, ['Alpha', 'Beta'], ['Gamma', 'Delta', 'Epsilon'])))
  const pile = pendingSelectionFor(state, 'p1')!
  expect(pile.kind).toBe('choosePile')
  expect(pile.piles!['face-up'].map((id) => state.objects[id].name)).toEqual(['Alpha', 'Beta'])
  expect(server.rules(state, {
    type: 'selectCards', seat: 'p1', kind: 'choosePile', count: 1,
    objectIds: [pile.piles!['face-up'][0]!, pile.piles!['face-down'][0]!],
  }).ok).toBe(false)

  const restored = restoreJournal(createJournal(state), server.rules).current()
  state = ok(server.rules(restored, {
    type: 'selectCards', seat: 'p1', kind: 'choosePile', count: 1,
    objectIds: idsNamed(restored, 'Alpha', 'Beta'),
  }))
  state = resolveStack(server.rules, state)
  expect(named(state, 'Alpha').zone).toBe('hand')
  expect(named(state, 'Beta').zone).toBe('hand')
  expect(named(state, 'Gamma').zone).toBe('graveyard')
  expect(named(state, 'Delta').zone).toBe('graveyard')
  expect(named(state, 'Epsilon').zone).toBe('graveyard')
  expect(named(state, 'Rest').zone).toBe('library')
  expect(state.resolution).toBeUndefined()
})

test('an empty public pile is a legal choice and leaves the other pile as the remainder', () => {
  const server = setup()
  let state = begin(server)
  const opponent = pendingPlayerSelectionFor(state, 'p1')!
  state = ok(server.rules(state, {
    type: 'selectPlayers', seat: 'p1', selectionId: opponent.id, players: ['p2'],
  }))
  state = ok(server.rules(state, partition(state, ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'], [])))
  state = ok(server.rules(state, {
    type: 'selectCards', seat: 'p1', kind: 'choosePile', count: 1, objectIds: [],
  }))
  expect(named(state, 'Alpha').zone).toBe('graveyard')
  expect(named(state, 'Epsilon').zone).toBe('graveyard')
  expect(state.zoneOrder.p1.hand).toHaveLength(0)
  expect(state.resolution).toBeUndefined()
})
