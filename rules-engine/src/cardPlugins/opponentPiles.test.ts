import { describe, expect, test } from 'bun:test'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer, createClientGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { createLobby } from '../../../live-runner/src/lobby'
import {
  applyKernelChoice,
  prepareKernelPendingChoice,
} from '../../../live-runner/src/kernelHost'
import type { KernelHandle } from '../../../live-runner/src/kernelHandle'
import {
  onResolve as onResolveEffect,
  opponentPiles,
  targetOnResolve,
} from './effects'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'

const handleFor = (
  rules: KernelHandle['rules'],
  initial: GameState,
): KernelHandle => {
  let journal = createJournal(initial)
  const history = restoreJournal(journal, rules)
  return {
    get journal() {
      return journal
    },
    history,
    rules,
    dispatch: (event) => {
      const result = history.dispatch(event)
      if (result.ok) journal = recordAccepted(journal, event)
      return result
    },
    save: () => {},
  }
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const topNames = (state: GameState, seat: 'p1' | 'p2' | 'p3' | 'p4', count: number) =>
  state.zoneOrder[seat].library.slice(0, count).map((id) => state.objects[id].name)

const withMana = (state: GameState) => ({
  ...state,
  players: {
    ...state.players,
    p1: {
      ...state.players.p1,
      mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
    },
  },
})

const libraryCards = (...names: string[]) =>
  names.map((name) => cardTemplate(name, { types: ['Instant'] }))

const publicPileSpell = () => cardTemplate('Public Pile Instant', {
  types: ['Instant'],
  manaCost: '{0}',
  manaValue: 0,
  effects: [onResolveEffect(opponentPiles(5, { reveal: 'public', piles: 'public' }))],
})

const lookPileSpell = () => cardTemplate('Look Pile Instant', {
  types: ['Instant'],
  manaCost: '{0}',
  manaValue: 0,
  effects: [
    targetOnResolve(
      'select',
      { players: 'opponent' },
      opponentPiles(4, { reveal: 'look', piles: 'facedown-faceup' }),
    ),
  ],
})

const castPublic = () => {
  const server = createServerGame(
    commanderRules,
    {
      players: 4,
      hands: { p1: [publicPileSpell()] },
      libraries: {
        p1: libraryCards('Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Rest'),
      },
    },
    { random: () => 0.5, cardPlugins: [onResolve] },
  )
  const cast = ok(server.rules(withMana(server.state), {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Public Pile Instant').id,
  }))
  return { server, state: ok(server.rules(cast, { type: 'resolveTop' })) }
}

const castLook = () => {
  const server = createServerGame(
    commanderRules,
    {
      players: 4,
      hands: { p1: [lookPileSpell()] },
      libraries: {
        p1: libraryCards('Look A', 'Look B', 'Look C', 'Look D', 'Look Rest'),
      },
    },
    { random: () => 0.5, cardPlugins: [targetedResolve] },
  )
  const cast = ok(server.rules(withMana(server.state), {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Look Pile Instant').id,
    targets: [{ kind: 'player', player: 'p2' }],
  }))
  return { server, state: ok(server.rules(cast, { type: 'resolveTop' })) }
}

const partitionChoices = (
  state: GameState,
  faceUp: string[],
  faceDown: string[],
) => {
  const byName = new Map(
    state.zoneOrder.p1.library.map((id) => [state.objects[id].name, id]),
  )
  return [
    ...faceUp.map((name) => ({ objectId: byName.get(name)!, destination: 'face-up' as const })),
    ...faceDown.map((name) => ({ objectId: byName.get(name)!, destination: 'face-down' as const })),
  ]
}

describe('opponentPiles', () => {
  test('opponentPiles() is clone-safe', () => {
    const instruction = opponentPiles(5, { reveal: 'public', piles: 'public' })
    expect(structuredClone(instruction)).toEqual(instruction)
  })

  test('an untargeted public split asks an opponent, then the controller picks a pile', () => {
    const { server, state: resolved } = castPublic()
    const opponentChoice = pendingPlayerSelectionFor(resolved, 'p1')!
    expect(opponentChoice).toMatchObject({
      candidates: ['p2', 'p3', 'p4'],
      action: { kind: 'opponentPiles', count: 5, reveal: 'public', piles: 'public' },
    })

    let state = ok(server.rules(resolved, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: opponentChoice.id,
      players: ['p2'],
    }))
    const partition = pendingSelectionFor(state, 'p2')!
    expect(partition).toMatchObject({
      kind: 'partition',
      count: 5,
      pileController: 'p1',
      pileVisibility: 'public',
    })
    expect(topNames(state, 'p1', 5)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
    expect(projectForViewer(state, 'p3').players.p1.data.revealed_library)
      .toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])

    const rejected = server.rules(state, { type: 'passPriority', seat: 'p2' })
    expect(rejected.ok).toBe(false)

    const mixed = server.rules(state, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'partition',
      count: 5,
      choices: partitionChoices(state, ['Alpha', 'Beta'], ['Gamma']),
    })
    expect(mixed.ok).toBe(false)

    const wrongSeat = server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'partition',
      count: 5,
      choices: partitionChoices(state, ['Alpha', 'Beta'], ['Gamma', 'Delta', 'Epsilon']),
    })
    expect(wrongSeat.ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'partition',
      count: 5,
      choices: partitionChoices(state, ['Alpha', 'Beta'], ['Gamma', 'Delta', 'Epsilon']),
    }))
    const pileChoice = pendingSelectionFor(state, 'p1')!
    expect(pileChoice.kind).toBe('choosePile')
    const faceUp = pileChoice.piles!['face-up']
    const faceDown = pileChoice.piles!['face-down']
    expect(faceUp.map((id) => state.objects[id].name)).toEqual(['Alpha', 'Beta'])
    expect(faceDown.map((id) => state.objects[id].name)).toEqual(['Gamma', 'Delta', 'Epsilon'])

    const mixedPile = server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choosePile',
      count: 1,
      objectIds: [faceUp[0], faceDown[0]],
    })
    expect(mixedPile.ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choosePile',
      count: 1,
      objectIds: faceUp,
    }))
    state = resolveStack(server.rules, state)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(named(state, 'Alpha').zone).toBe('hand')
    expect(named(state, 'Beta').zone).toBe('hand')
    expect(named(state, 'Gamma').zone).toBe('graveyard')
    expect(named(state, 'Delta').zone).toBe('graveyard')
    expect(named(state, 'Epsilon').zone).toBe('graveyard')
    expect(named(state, 'Rest').zone).toBe('library')
  })

  test('an empty public pile is a legal choice', () => {
    const { server, state: resolved } = castPublic()
    const opponentChoice = pendingPlayerSelectionFor(resolved, 'p1')!
    let state = ok(server.rules(resolved, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: opponentChoice.id,
      players: ['p2'],
    }))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'partition',
      count: 5,
      choices: partitionChoices(state, ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'], []),
    }))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choosePile',
      count: 1,
      objectIds: [],
    }))
    expect(named(state, 'Alpha').zone).toBe('graveyard')
    expect(named(state, 'Epsilon').zone).toBe('graveyard')
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('a targeted look split hides library identities from other seats', () => {
    const { server, state: looking } = castLook()
    const partition = pendingSelectionFor(looking, 'p2')!
    expect(partition.kind).toBe('partition')
    expect(pendingPlayerSelectionFor(looking, 'p1')).toBeUndefined()

    const opponentView = projectForViewer(looking, 'p2')
    const controllerView = projectForViewer(looking, 'p1')
    const otherView = projectForViewer(looking, 'p3')
    expect(opponentView.players.p1.data.revealed_library)
      .toEqual(['Look A', 'Look B', 'Look C', 'Look D'])
    expect(controllerView.players.p1.data.revealed_library).toBeUndefined()
    expect(otherView.players.p1.data.revealed_library).toBeUndefined()
    expect(pendingSelectionFor(otherView, 'p2')).toBeUndefined()
    expect(Object.values(controllerView.objects).some((object) =>
      object.name.startsWith('Look A'))).toBe(false)

    let state = ok(server.rules(looking, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'partition',
      count: 4,
      choices: partitionChoices(looking, ['Look A', 'Look B'], ['Look C', 'Look D']),
    }))
    const pileChoice = pendingSelectionFor(state, 'p1')!
    expect(pileChoice.kind).toBe('choosePile')

    const afterController = projectForViewer(state, 'p1')
    const afterOther = projectForViewer(state, 'p3')
    const afterOpponent = projectForViewer(state, 'p2')
    expect(afterController.players.p1.data.revealed_library).toEqual(['Look A', 'Look B'])
    expect(afterOther.players.p1.data.revealed_library).toEqual(['Look A', 'Look B'])
    expect(afterOpponent.players.p1.data.revealed_library)
      .toEqual(['Look A', 'Look B', 'Look C', 'Look D'])
    expect(JSON.stringify(afterController)).not.toContain('Look C')
    expect(JSON.stringify(afterOther)).not.toContain('Look D')

    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choosePile',
      count: 1,
      objectIds: pileChoice.piles!['face-down'],
    }))
    expect(named(state, 'Look C').zone).toBe('hand')
    expect(named(state, 'Look D').zone).toBe('hand')
    expect(named(state, 'Look A').zone).toBe('graveyard')
    expect(named(state, 'Look B').zone).toBe('graveyard')
  })

  test('a pile chooser replica is accepted by createClientGame', () => {
    const { server, state: looking } = castLook()
    expect(() => createClientGame(commanderRules, projectForViewer(looking, 'p2')))
      .not.toThrow()

    const partitioned = ok(server.rules(looking, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'partition',
      count: 4,
      choices: partitionChoices(looking, ['Look A', 'Look B'], ['Look C', 'Look D']),
    }))
    expect(() => createClientGame(commanderRules, projectForViewer(partitioned, 'p1')))
      .not.toThrow()
  })

  test('a host restart restores an open partition without passing through it', () => {
    const { server, state: looking } = castLook()
    const kernel = handleFor(server.rules, looking)
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p2',
      kind: 'partition',
      cards: ['Look A', 'Look B', 'Look C', 'Look D'],
      destinations: ['face-up', 'face-down'],
    })
    const selectionId = pendingSelectionFor(kernel.history.current(), 'p2')!.id

    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, restarted)).toBe(true)
    expect(restarted.topdeck?.kernel?.selectionId).toBe(selectionId)
    expect(restarted.topdeck?.cards).toEqual(['Look A', 'Look B', 'Look C', 'Look D'])
  })

  test('live host partition and pile pick move the cards', () => {
    const { server, state: looking } = castLook()
    const kernel = handleFor(server.rules, looking)
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(applyKernelChoice(kernel, lobby, 'p2', {
      type: 'topdeck',
      choices: [
        { card: 'Look A', destination: 'face-up' },
        { card: 'Look B', destination: 'face-up' },
        { card: 'Look C', destination: 'face-down' },
        { card: 'Look D', destination: 'face-down' },
      ],
    })).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choosePile',
    })
    expect(lobby.topdeck?.cards[1]).toBe('Face-down pile (2 cards)')
    expect(JSON.stringify(lobby.topdeck)).not.toContain('Look C')

    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, restarted)).toBe(true)
    expect(restarted.topdeck?.kind).toBe('choosePile')

    expect(applyKernelChoice(kernel, restarted, 'p1', {
      type: 'topdeck',
      choices: [
        { card: restarted.topdeck!.cards[0], destination: 'hand' },
        { card: restarted.topdeck!.cards[1], destination: 'graveyard' },
      ],
    })).toBe(true)
    const finished = kernel.history.current()
    expect(named(finished, 'Look A').zone).toBe('hand')
    expect(named(finished, 'Look B').zone).toBe('hand')
    expect(named(finished, 'Look C').zone).toBe('graveyard')
    expect(named(finished, 'Look D').zone).toBe('graveyard')
  })
})
