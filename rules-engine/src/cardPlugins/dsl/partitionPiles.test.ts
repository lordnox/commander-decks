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
  choosePile,
  lookAt,
  loseLife,
  reveal,
  select,
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

const answerPartition = (game: ReturnType<typeof setup>, state: GameState, seat: string, up: string[], down: string[]) => ok(game.rules(state, {
  type: 'selectCards', seat, selectionId: pendingSelectionFor(state, seat)!.id, kind: 'partition', count: up.length + down.length,
  choices: [...up.map(objectId => ({ objectId, destination: 'face-up' as const })), ...down.map(objectId => ({ objectId, destination: 'face-down' as const }))],
}))

test.each([true, false])('a private partition exposes only its face-up pile to the chooser and spectators (keep hidden=%s)', keepHidden => {
  const game = createServerGame(commanderRules, { players: 4,
    hands: { p1: [instructionSpell({ instructions: [inspectTop({ player: ref('controller'), count: 4, bindChoice: 'cards', visibility: LIBRARY_VISIBILITY.private }), partitionPiles({ cards: choice('cards'), partitioner: { kind: 'targetRef', clauseIndex: 0 }, chooser: ref('controller'), visibility: 'facedown-faceup', bindChosen: 'kept', bindOther: 'rest' }), move({ targets: choice('kept'), to: 'hand' }), move({ targets: choice('rest'), to: 'graveyard' })], decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] } })] },
    libraries: { p1: libraryCards('Public A', 'Secret A', 'Secret B', 'Public B', 'Uninspected') },
  }, { random: () => 0 })
  let state = resolveStack(game.rules, ok(game.rules(game.state, { type: 'castSpell', seat: 'p1', objectId: game.state.zoneOrder.p1.hand[0]!, targets: [{ kind: 'player', player: 'p2' }] })))
  const ids = state.zoneOrder.p1.library.slice(0, 4), up = [ids[0]!, ids[3]!], down = [ids[1]!, ids[2]!]
  expect(projectForViewer(state, 'p1').objects[down[0]!]).toBeUndefined()
  expect(projectForViewer(state, 'p2').objects[down[0]!]).toBeDefined()
  expect(projectForViewer(state, 'p3').objects[down[0]!]).toBeUndefined()
  state = answerPartition(game, state, 'p2', up, down)
  const mine = projectForViewer(state, 'p1'), spectator = projectForViewer(state, null)
  expect(mine.objects[down[0]!]).toBeUndefined()
  expect(spectator.players.p1.data.revealed_library).toEqual(['Public A', 'Public B'])
  expect(JSON.stringify(spectator)).not.toContain('Secret A')
  expect(state.log.join(' ')).not.toContain('Secret A')
  state = ok(game.rules(restoreJournal(createJournal(state), game.rules).current(), { type: 'selectCards', seat: 'p1', selectionId: pendingSelectionFor(state, 'p1')!.id, kind: 'choosePile', count: 1, objectIds: keepHidden ? down : up }))
  expect(state.zoneOrder.p1.hand).toEqual(keepHidden ? down : up)
  expect(state.zoneOrder.p1.graveyard).toEqual(expect.arrayContaining(keepHidden ? up : down))
  const projected = projectForViewer(state, null)
  if (keepHidden) expect(projected.objects[down[0]!]).toBeUndefined()
  else expect(projected.objects[down[0]!]).toBeDefined()
})

test.each([0, 2, 4, 6])('fixed private exile piles preserve short-library sizes and reveal only the chosen pile (%s cards)', size => {
  const game = createServerGame(commanderRules, { players: 4, hands: { p1: [instructionSpell({ instructions: [
    inspectTop({ player: ref('controller'), count: 3, bindChoice: 'top1', visibility: LIBRARY_VISIBILITY.private }), move({ targets: choice('top1'), to: 'exile', faceDown: true, bindChoice: 'first' }),
    inspectTop({ player: ref('controller'), count: 3, bindChoice: 'top2', visibility: LIBRARY_VISIBILITY.private }), move({ targets: choice('top2'), to: 'exile', faceDown: true, bindChoice: 'second' }),
    lookAt({ cards: choice('first'), viewers: ref('controller') }), lookAt({ cards: choice('second'), viewers: ref('controller') }),
    choosePile({ piles: [choice('first'), choice('second')], chooser: ref('controller'), bindChosen: 'revealed', bindOther: 'hidden' }), reveal(choice('revealed'), { turnFaceUp: true }),
    choosePlayer({ chooser: ref('controller'), filter: players({ relation: 'opponent' }), bindChoice: 'opponent' }),
    choosePile({ piles: [choice('revealed'), choice('hidden')], chooser: choice('opponent'), bindChosen: 'kept', bindOther: 'rest' }),
    move({ targets: choice('kept'), to: 'hand' }), move({ targets: choice('rest'), to: 'graveyard' }), loseLife({ targets: ref('controller'), amount: 3 }),
  ] })] }, libraries: { p1: Array.from({ length: size }, (_, index) => cardTemplate(`Private ${index}`)) } }, { random: () => 0 })
  const first = game.state.zoneOrder.p1.library.slice(0, 3), second = game.state.zoneOrder.p1.library.slice(3, 6)
  let state = begin(game)
  expect(pendingSelectionFor(state, 'p1')!.piles).toEqual({ 'face-up': first, 'face-down': second })
  for (const id of [...first, ...second]) {
    expect(projectForViewer(state, 'p1').objects[id]).toBeDefined()
    expect(projectForViewer(state, 'p2').objects[id]).toBeUndefined()
    expect(projectForViewer(state, null).objects[id]).toBeUndefined()
  }
  // Choose the second pile to reveal, including when it is empty.
  state = ok(game.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p1', selectionId: pendingSelectionFor(state, 'p1')!.id, kind: 'choosePile', count: 1, objectIds: second }))
  for (const id of second) expect(state.objects[id]!.faceDown).not.toBe(true)
  const opponent = pendingPlayerSelectionFor(state, 'p1')!
  state = ok(game.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: opponent.id, players: ['p2'] }))
  const replica = projectForViewer(state, 'p2')
  for (const id of first) expect(replica.objects[id]).toBeUndefined()
  for (const id of second) expect(replica.objects[id]).toBeDefined()
  state = ok(game.rules(restoreJournal(createJournal(state), game.rules).current(), { type: 'selectCards', seat: 'p2', selectionId: pendingSelectionFor(state, 'p2')!.id, kind: 'choosePile', count: 1, objectIds: first }))
  expect(state.players.p1.life).toBe(37)
  expect(state.zoneOrder.p1.hand).toEqual(first)
  for (const id of first) {
    expect(state.objects[id]!.faceDown).not.toBe(true)
    expect(projectForViewer(state, 'p2').objects[id]).toBeUndefined()
  }
  for (const id of second) expect(state.objects[id]!.zone).toBe('graveyard')
  expect(state.zoneOrder.p1.exile).toHaveLength(0)
})
