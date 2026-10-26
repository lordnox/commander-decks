import { describe, expect, test } from 'bun:test'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import {
  enters,
  handler,
  linkExile,
  pumpFromLinkedExileStats,
} from './effects'
import { exilePayoffs } from './exilePayoffs'
import { linkedExile } from './linkedExile'
import { createLobby } from '../../../live-runner/src/lobby'
import { applyKernelChoice as applyKernelChoiceImpl, prepareKernelPendingChoice } from '../../../live-runner/src/kernelHost'
import type { KernelHandle } from '../../../live-runner/src/kernelHandle'

const handleFor = (rules: KernelHandle['rules'], initial: GameState, restored?: KernelHandle['journal']): KernelHandle => {
  let journal = restored ?? createJournal(initial)
  const history = restoreJournal(journal, rules)
  return {
    get journal() { return journal }, history, rules,
    dispatch: (event) => {
      const result = history.dispatch(event)
      if (result.ok) journal = recordAccepted(journal, event)
      return result
    },
    save: () => {},
  }
}

const playLobby = () => {
  const lobby = createLobby()
  lobby.phase = 'play'
  return lobby
}

const applyKernelChoice = (
  kernel: Parameters<typeof applyKernelChoiceImpl>[0],
  lobby: Parameters<typeof applyKernelChoiceImpl>[1],
  seat: Parameters<typeof applyKernelChoiceImpl>[2],
  message: Parameters<typeof applyKernelChoiceImpl>[3],
) => applyKernelChoiceImpl(kernel, lobby, seat, {
  ...message,
  ...(message.requestId === undefined && lobby.topdeck?.requestId !== undefined ? { requestId: lobby.topdeck.requestId } : {}),
  ...(message.revision === undefined && lobby.topdeck?.revision !== undefined ? { revision: lobby.topdeck.revision } : {}),
})

const passUntilResolved = (kernel: KernelHandle) => {
  for (let guard = 0; guard < 12; guard += 1) {
    const state = kernel.history.current()
    if (state.stack.length === 0 || state.stack[0].waiting || state.resolution?.phase === 'waiting' || !state.priority) return state
    const result = kernel.dispatch({ type: 'passPriority', seat: state.priority })
    if (!result.ok) throw new Error(result.error)
  }
  throw new Error('stack did not resolve')
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const stats = (state: GameState, name: string) => {
  const { power, toughness } = named(state, name)
  return [power, toughness]
}

// The real card targets a nontoken creature; the nontoken target filter is added by another
// part, so these tests exile any creature an opponent controls.
const ingester = () => cardTemplate('Imprint Ingester', {
  types: ['Creature'],
  power: 3,
  toughness: 4,
  effects: [
    handler('linkedExile'),
    handler('exilePayoffs'),
    pumpFromLinkedExileStats(),
    enters(linkExile({ type: 'Creature', controller: 'opponent' }, { optional: true, max: 1 })),
  ],
})

const prey = (name: string, power: number, toughness: number, counters = 0) =>
  cardTemplate(name, {
    types: ['Creature'],
    power: power + counters,
    toughness: toughness + counters,
    counters: counters ? { '+1/+1': counters } : {},
  })

const game = (...preyCards: ReturnType<typeof prey>[]) => createServerGame(commanderRules, {
  hands: { p1: [ingester()] },
  battlefield: { p2: preyCards },
}, { random: () => 0.5, cardPlugins: [linkedExile, exilePayoffs] })

const enterAndChoose = (
  server: ReturnType<typeof createServerGame>,
  objectIds: string[],
) => {
  const entered = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'move',
    objectId: named(server.state, 'Imprint Ingester').id,
    to: 'battlefield',
  })))
  return resolveStack(server.rules, ok(server.rules(entered, {
    type: 'selectCards',
    seat: 'p1',
    kind: 'choose',
    count: 1,
    objectIds,
  })))
}

describe('imprint power and toughness', () => {
  test('a private Ingester target survives a host restart and resolves through the live chooser', () => {
    const ingesterCard = cardTemplate('Phyrexian Ingester', {
      types: ['Creature'],
      power: 3,
      toughness: 3,
      effects: [
        handler('linkedExile'),
        handler('exilePayoffs'),
        pumpFromLinkedExileStats(),
        enters(linkExile({ type: 'Creature' }, { optional: true, max: 1 })),
      ],
    })
    const ownBear = prey('Own Bear', 2, 2)
    const bigFoe = prey('Big Foe', 4, 6)
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [ingesterCard] },
      battlefield: { p1: [ownBear], p2: [bigFoe] },
    }, { random: () => 0.5, cardPlugins: [linkedExile, exilePayoffs] })
    const ready = structuredClone(server.state)
    // Keep this named-card fixture on the still-active generic handler path.
    delete named(ready, 'Phyrexian Ingester').ruleDefinition
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.step = 'precombatMain'
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 6 }
    const kernel = handleFor(server.rules, ready)
    expect(kernel.dispatch({ type: 'castSpell', seat: 'p1', objectId: named(ready, 'Phyrexian Ingester').id }).ok).toBe(true)
    passUntilResolved(kernel)
    const lobby = playLobby()
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose',
      cards: ['Own Bear', 'Big Foe'],
      destinations: ['skip', 'target'],
      requirements: { target: { min: 0, max: 1 } },
    })
    const open = kernel.history.current()
    expect(pendingSelectionFor(projectForViewer(open, 'p2'), 'p1')).toBeUndefined()
    expect(JSON.stringify(projectForViewer(open, 'p2').players.p1.data)).not.toContain('Big Foe')
    const restartedKernel = handleFor(server.rules, ready, kernel.journal)
    const restarted = playLobby()
    expect(prepareKernelPendingChoice(restartedKernel, restarted)).toBe(true)
    expect(restarted.topdeck).toEqual(lobby.topdeck)
    const answer = (picked: string[]) => ({
      type: 'topdeck' as const,
      choices: (lobby.topdeck!.cards as string[]).map((name, slot) => ({
        card: name, slot, destination: (picked.includes(name) ? 'target' : 'skip') as 'target' | 'skip',
      })),
    })
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', answer(['Own Bear', 'Big Foe']))).toThrow()
    expect(applyKernelChoice(restartedKernel, restarted, 'p2', answer(['Big Foe']))).toBe(false)
    expect(applyKernelChoice(restartedKernel, restarted, 'p1', answer(['Big Foe']))).toBe(true)
    const done = passUntilResolved(restartedKernel)
    expect(named(done, 'Big Foe').zone).toBe('exile')
    expect(stats(done, 'Phyrexian Ingester')).toEqual([7, 9])
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
  })
  test('the effect is clone-safe', () => {
    expect(structuredClone(pumpFromLinkedExileStats())).toEqual(pumpFromLinkedExileStats())
  })

  test('gets +X/+Y from the exiled creature card, ignoring its counters', () => {
    const server = game(prey('Juicy Prey', 4, 5, 2))
    const state = enterAndChoose(server, [named(server.state, 'Juicy Prey').id])
    expect(named(state, 'Juicy Prey').zone).toBe('exile')
    expect(stats(state, 'Imprint Ingester')).toEqual([7, 9])
  })

  test('declining the imprint leaves the base power and toughness', () => {
    const server = game(prey('Juicy Prey', 4, 5))
    const state = enterAndChoose(server, [])
    expect(named(state, 'Juicy Prey').zone).toBe('battlefield')
    expect(stats(state, 'Imprint Ingester')).toEqual([3, 4])
  })

  test('survives a restart and recomputes when the link breaks', () => {
    const server = game(prey('Juicy Prey', 4, 5))
    const state = enterAndChoose(server, [named(server.state, 'Juicy Prey').id])
    const restarted = structuredClone(state)
    expect(stats(restarted, 'Imprint Ingester')).toEqual([7, 9])

    const broken = resolveStack(server.rules, ok(server.rules(restarted, {
      type: 'move',
      objectId: named(restarted, 'Juicy Prey').id,
      to: 'graveyard',
    })))
    expect(named(broken, 'Juicy Prey').zone).toBe('graveyard')
    expect(stats(broken, 'Imprint Ingester')).toEqual([3, 4])
  })

  test('stacks with +1/+1 counters on the imprinting creature and follows a later change', () => {
    const server = game(prey('Juicy Prey', 2, 2))
    const state = enterAndChoose(server, [named(server.state, 'Juicy Prey').id])
    const grown = resolveStack(server.rules, ok(server.rules(state, {
      type: 'putCounters',
      objectId: named(state, 'Imprint Ingester').id,
      counter: '+1/+1',
      count: 1,
    })))
    expect(stats(grown, 'Imprint Ingester')).toEqual([6, 7])
    const broken = resolveStack(server.rules, ok(server.rules(grown, {
      type: 'move',
      objectId: named(grown, 'Juicy Prey').id,
      to: 'graveyard',
    })))
    expect(stats(broken, 'Imprint Ingester')).toEqual([4, 5])
  })
})
