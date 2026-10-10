import { describe, expect, test } from 'bun:test'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { createLobby } from '../../../live-runner/src/lobby'
import {
  applyKernelChoice as applyKernelChoiceImpl,
  prepareKernelPendingChoice,
} from '../../../live-runner/src/kernelHost'

const applyKernelChoice = (
  kernel: Parameters<typeof applyKernelChoiceImpl>[0],
  lobby: Parameters<typeof applyKernelChoiceImpl>[1],
  seat: Parameters<typeof applyKernelChoiceImpl>[2],
  message: Parameters<typeof applyKernelChoiceImpl>[3],
) => applyKernelChoiceImpl(kernel, lobby, seat, {
  ...message,
  ...(message.requestId === undefined && lobby.topdeck?.requestId !== undefined
    ? { requestId: lobby.topdeck.requestId }
    : {}),
  ...(message.revision === undefined && lobby.topdeck?.revision !== undefined
    ? { revision: lobby.topdeck.revision }
    : {}),
})
import type { KernelHandle } from '../../../live-runner/src/kernelHandle'
import { lookTopPick, onResolve as onResolveEffect } from './effects'
import { onResolve } from './onResolve'

const TOP = ['Top 1', 'Top 2', 'Top 3', 'Top 4', 'Top 5', 'Top 6', 'Top 7']

const handleFor = (
  rules: KernelHandle['rules'],
  initial: GameState,
  restored?: KernelHandle['journal'],
): KernelHandle => {
  let journal = restored ?? createJournal(initial)
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

const names = (state: GameState, ids: string[]) => ids.map((id) => state.objects[id].name)

const digSpell = () => cardTemplate('Dig Spell', {
  types: ['Instant'],
  manaCost: '{0}',
  manaValue: 0,
  effects: [onResolveEffect(lookTopPick(7, 2))],
})

const setup = (library: string[]) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      hands: { p1: [digSpell()] },
      libraries: {
        p1: library.map((name) => cardTemplate(name, { types: ['Sorcery'] })),
        p2: [cardTemplate('Opposing Secret', { types: ['Sorcery'] })],
      },
    },
    { random: () => 0.5, cardPlugins: [onResolve] },
  )
  const cast: GameEvent = {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Dig Spell').id,
  }
  return { server, cast }
}

const resolved = (library: string[]) => {
  const { server, cast } = setup(library)
  return {
    server,
    state: ok(server.rules(ok(server.rules(server.state, cast)), { type: 'resolveTop' })),
  }
}

const dig = () => resolved([...TOP, 'Rest A', 'Rest B'])

const pick = (
  state: GameState,
  assignments: Array<[string, 'hand' | 'bottom' | 'top' | 'graveyard']>,
  overrides: Partial<Extract<GameEvent, { type: 'selectCards' }>> = {},
): GameEvent => ({
  type: 'selectCards',
  seat: 'p1',
  kind: 'scry',
  count: 7,
  choices: assignments.map(([name, destination]) => ({
    objectId: named(state, name).id,
    destination,
  })),
  ...overrides,
})

const live = (assignments: Array<[string, string]>) => ({
  type: 'topdeck' as const,
  choices: assignments.map(([card, destination], slot) => ({
    card,
    slot,
    destination: destination as 'hand' | 'bottom',
  })),
})

const VALID: Array<[string, 'hand' | 'bottom']> = [
  ['Top 1', 'bottom'],
  ['Top 2', 'hand'],
  ['Top 3', 'bottom'],
  ['Top 4', 'hand'],
  ['Top 5', 'bottom'],
  ['Top 6', 'bottom'],
  ['Top 7', 'bottom'],
]

describe('lookTopPick', () => {
  test('lookTopPick() is clone-safe', () => {
    const instruction = lookTopPick(7, 2)
    expect(structuredClone(instruction)).toEqual(instruction)
  })

  test('opens a private typed look at exactly the top cards', () => {
    const { state } = dig()
    const selection = pendingSelectionFor(state, 'p1')!

    expect(selection).toMatchObject({
      kind: 'scry',
      count: 7,
      handQuota: 2,
      destinations: ['bottom', 'hand'],
      source: 'Dig Spell',
    })
    expect(names(state, selection.candidates)).toEqual(TOP)
    expect(state.priority).toBe('p1')
  })

  test('puts the chosen cards into hand and the rest on the bottom in the chosen order', () => {
    const { server, state: looking } = dig()
    const done = resolveStack(server.rules, ok(server.rules(looking, pick(looking, [
      ['Top 7', 'bottom'],
      ['Top 2', 'hand'],
      ['Top 1', 'bottom'],
      ['Top 5', 'hand'],
      ['Top 3', 'bottom'],
      ['Top 6', 'bottom'],
      ['Top 4', 'bottom'],
    ]))))

    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(names(done, done.zoneOrder.p1.hand)).toEqual(['Top 2', 'Top 5'])
    expect(names(done, done.zoneOrder.p1.library)).toEqual([
      'Rest A',
      'Rest B',
      'Top 7',
      'Top 1',
      'Top 3',
      'Top 6',
      'Top 4',
    ])
    expect(named(done, 'Dig Spell').zone).toBe('graveyard')
  })

  test('rejects the wrong number of cards in hand', () => {
    const { server, state } = dig()
    const none = VALID.map(([name]): [string, 'bottom'] => [name, 'bottom'])
    const one = VALID.map(([name], index): [string, 'hand' | 'bottom'] => [
      name,
      index === 1 ? 'hand' : 'bottom',
    ])
    const three = VALID.map(([name], index): [string, 'hand' | 'bottom'] => [
      name,
      index < 3 ? 'hand' : 'bottom',
    ])

    for (const assignments of [none, one, three]) {
      expect(server.rules(state, pick(state, assignments)))
        .toMatchObject({ ok: false, error: 'must put exactly 2 card(s) into hand' })
    }
    expect(pendingSelectionFor(state, 'p1')).toBeDefined()
  })

  test('rejects destinations the look does not allow', () => {
    const { server, state } = dig()
    for (const destination of ['top', 'graveyard'] as const) {
      const assignments = VALID.map(([name, base], index): [string, typeof base | typeof destination] =>
        [name, index === 0 ? destination : base])
      expect(server.rules(state, pick(state, assignments)))
        .toMatchObject({ ok: false, error: `invalid destination ${destination}` })
    }
  })

  test('rejects missing, duplicate, and foreign cards', () => {
    const { server, state } = dig()
    expect(server.rules(state, pick(state, VALID.slice(0, 6))))
      .toMatchObject({ ok: false, error: 'must assign exactly 7 card(s)' })

    const duplicated = VALID.map(([name, destination], index): [string, typeof destination] =>
      [index === 6 ? 'Top 1' : name, index === 6 ? 'bottom' : destination])
    expect(server.rules(state, pick(state, duplicated)))
      .toMatchObject({ ok: false, error: 'each card may only be assigned once' })

    const deeper = VALID.map(([name, destination], index): [string, typeof destination] =>
      [index === 6 ? 'Rest A' : name, destination])
    expect(server.rules(state, pick(state, deeper)))
      .toMatchObject({ ok: false, error: 'card was not offered for this selection' })
  })

  test('rejects another seat, another kind, and another count', () => {
    const { server, state } = dig()
    expect(server.rules(state, pick(state, VALID, { seat: 'p2' }))).toMatchObject({ ok: false })
    expect(server.rules(state, pick(state, VALID, { kind: 'surveil' })))
      .toMatchObject({ ok: false, error: 'expected a scry selection' })
    expect(server.rules(state, pick(state, VALID, { count: 6 })))
      .toMatchObject({ ok: false, error: 'expected count 7' })
    expect(server.rules(state, { type: 'passPriority', seat: 'p1' })).toMatchObject({ ok: false })
  })

  test('a library smaller than the look still gets its full quota of cards', () => {
    const { server, state } = resolved(['Only 1', 'Only 2', 'Only 3'])
    expect(pendingSelectionFor(state, 'p1')).toMatchObject({ count: 7, handQuota: 2 })

    expect(server.rules(state, pick(state, [
      ['Only 1', 'hand'],
      ['Only 2', 'hand'],
      ['Only 3', 'hand'],
    ]))).toMatchObject({ ok: false, error: 'must put exactly 2 card(s) into hand' })
    const done = ok(server.rules(state, pick(state, [
      ['Only 3', 'bottom'],
      ['Only 1', 'hand'],
      ['Only 2', 'hand'],
    ])))
    expect(names(done, done.zoneOrder.p1.hand)).toEqual(['Only 1', 'Only 2'])
    expect(names(done, done.zoneOrder.p1.library)).toEqual(['Only 3'])
  })

  test('a one-card library puts that card into hand, and an empty library skips the look', () => {
    const { server, state } = resolved(['Lone'])
    const done = ok(server.rules(state, pick(state, [['Lone', 'hand']])))
    expect(names(done, done.zoneOrder.p1.hand)).toEqual(['Lone'])
    expect(done.zoneOrder.p1.library).toEqual([])

    const empty = resolved([]).state
    expect(pendingSelectionFor(empty, 'p1')).toBeUndefined()
    expect(empty.stack).toHaveLength(0)
    expect(named(empty, 'Dig Spell').zone).toBe('graveyard')
  })

  test('only the looking seat sees the cards, before and after the choice', () => {
    const { server, state: looking } = dig()
    const chooser = projectForViewer(looking, 'p1')
    const opponent = projectForViewer(looking, 'p2')

    expect(TOP.every((name) => Object.values(chooser.objects).some((object) => object.name === name)))
      .toBe(true)
    for (const name of [...TOP, 'Rest A']) {
      expect(JSON.stringify(opponent)).not.toContain(name)
    }
    expect(JSON.stringify(opponent)).not.toContain('"candidates":["')
    expect(pendingSelectionFor(opponent, 'p1')).toBeUndefined()

    const done = ok(server.rules(looking, pick(looking, VALID)))
    expect(done.log.join('\n')).not.toMatch(/Top \d/)
    const afterOpponent = projectForViewer(done, 'p2')
    for (const name of ['Top 1', 'Top 3', 'Top 5', 'Top 6', 'Top 7']) {
      expect(JSON.stringify(afterOpponent)).not.toContain(name)
    }
  })

  test('a host restart rebuilds the open look and the live choice finishes it', () => {
    const { server, cast } = setup([...TOP, 'Rest A', 'Rest B'])
    const kernel = handleFor(server.rules, server.state)
    for (const event of [cast, { type: 'resolveTop' } as const]) {
      expect(kernel.dispatch(event).ok).toBe(true)
    }
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'look-top',
      cards: TOP,
      destinations: ['bottom', 'hand'],
      requirements: { hand: { min: 2, max: 2 } },
    })

    const restartedKernel = handleFor(server.rules, server.state, kernel.journal)
    expect(restartedKernel.history.current()).toEqual(kernel.history.current())
    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(restartedKernel, restarted)).toBe(true)
    expect(restarted.topdeck?.cards).toEqual(TOP)
    expect(pendingSelectionFor(restartedKernel.history.current(), 'p1')?.id)
      .toBe(pendingSelectionFor(kernel.history.current(), 'p1')?.id)

    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', live(
      VALID.map(([name], index) => [name, index === 1 ? 'hand' : 'bottom']),
    ))).toThrow()
    expect(pendingSelectionFor(restartedKernel.history.current(), 'p1')).toBeDefined()

    expect(applyKernelChoice(restartedKernel, restarted, 'p1', live(VALID))).toBe(true)
    const done = restartedKernel.history.current()
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(restarted.topdeck).toBeUndefined()
    expect(names(done, done.zoneOrder.p1.hand)).toEqual(['Top 2', 'Top 4'])
    expect(names(done, done.zoneOrder.p1.library).slice(-5))
      .toEqual(['Top 1', 'Top 3', 'Top 5', 'Top 6', 'Top 7'])
    expect(done.stack).toHaveLength(0)
  })
})
