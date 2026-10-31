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
import type { KernelHandle } from '../../../live-runner/src/kernelHandle'
import {
  card as dslCard,
  choice,
  chooseCards,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  inspectTop,
  move,
  objects,
  orderCards,
  ref,
  remaining,
  spell,
} from './dsl/v1'

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

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const names = (state: GameState, ids: string[]) => ids.map((id) => state.objects[id].name)

const digSpell = () => cardTemplate('Dig Spell', {
  types: ['Instant'],
  manaCost: '{0}',
  manaValue: 0,
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(dslCard([spell({
    instructions: [
      inspectTop({ player: ref('controller'), count: 7, bindChoice: 'top' }),
      chooseCards({
        chooser: ref('controller'),
        bindChoice: 'picked',
        filter: objects({ zone: 'library', among: choice('top') }),
        viewCards: choice('top'),
        count: 2,
      }),
      move({ targets: choice('picked'), to: 'hand' }),
      orderCards({ chooser: ref('controller'), bindChoice: 'rest', cards: remaining(choice('top'), choice('picked')), position: 'bottom' }),
      move({ targets: choice('rest'), to: 'library', position: 'bottom' }),
    ],
  })]))),
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
    { random: () => 0.5 },
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

const pick = (state: GameState, cards: string[], seat = 'p1') => ({
  type: 'selectCards' as const,
  seat,
  kind: 'choose' as const,
  count: cards.length,
  objectIds: cards.map((name) => named(state, name).id),
})

const orderBottom = (state: GameState, order: string[]) => ({
  type: 'selectCards' as const,
  seat: 'p1' as const,
  kind: 'scry' as const,
  count: order.length,
  choices: order.map((name) => ({ objectId: named(state, name).id, destination: 'bottom' as const })),
})

const live = (cards: string[], candidates: string[]) => ({
  type: 'topdeck' as const,
  choices: cards.map((card) => ({ card, slot: candidates.indexOf(card), destination: 'bottom' as const })),
})

const livePick = (cards: string[]) => ({
  type: 'topdeck' as const,
  choices: TOP.map((card, slot) => ({
    card,
    slot,
    destination: cards.includes(card) ? 'target' as const : 'skip' as const,
  })),
})

const finish = (server: ReturnType<typeof createServerGame>, state: GameState, picked: string[], bottom: string[]) => {
  const ordered = ok(server.rules(state, pick(state, picked)))
  const pending = pendingSelectionFor(ordered, 'p1')
  return resolveStack(server.rules, pending ? ok(server.rules(ordered, orderBottom(ordered, bottom))) : ordered)
}

describe('canonical top-library selection', () => {
  test('opens a private choice for exactly the top cards', () => {
    const { server, state } = dig()
    const selection = pendingSelectionFor(state, 'p1')!

    expect(selection).toMatchObject({ kind: 'choose', count: 2, source: 'Dig Spell' })
    expect(names(state, selection.candidates)).toEqual(TOP)
    expect(names(state, selection.visibleCards ?? [])).toEqual(TOP)
    expect(state.priority).toBeNull()
    const opponent = projectForViewer(state, 'p2')
    for (const name of [...TOP, 'Rest A']) expect(JSON.stringify(opponent)).not.toContain(name)
    expect(pendingSelectionFor(opponent, 'p1')).toBeUndefined()
    expect(server.project(state, 'p1').objects[selection.candidates[0]!]).toBeDefined()
  })

  test('puts two chosen cards into hand and orders the rest on the bottom', () => {
    const { server, state: looking } = dig()
    const done = finish(server, looking, ['Top 2', 'Top 5'], ['Top 7', 'Top 1', 'Top 3', 'Top 6', 'Top 4'])

    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(names(done, done.zoneOrder.p1.hand)).toEqual(['Top 2', 'Top 5'])
    expect(names(done, done.zoneOrder.p1.library)).toEqual([
      'Rest A', 'Rest B', 'Top 7', 'Top 1', 'Top 3', 'Top 6', 'Top 4',
    ])
    expect(named(done, 'Dig Spell').zone).toBe('graveyard')
  })

  test('rejects fewer or more than two cards in hand', () => {
    const { server, state } = dig()
    for (const cards of [[], ['Top 1'], ['Top 1', 'Top 2', 'Top 3']]) {
      expect(server.rules(state, pick(state, cards))).toMatchObject({ ok: false })
    }
    expect(pendingSelectionFor(state, 'p1')).toBeDefined()
  })

  test('rejects missing, duplicate, and foreign cards', () => {
    const { server, state } = dig()
    expect(server.rules(state, pick(state, ['Top 1']))).toMatchObject({ ok: false })
    expect(server.rules(state, pick(state, ['Top 1', 'Top 1']))).toMatchObject({ ok: false })
    expect(server.rules(state, pick(state, ['Top 1', 'Rest A']))).toMatchObject({ ok: false })
    expect(server.rules(state, pick(state, ['Top 1', 'Opposing Secret']))).toMatchObject({ ok: false })
  })

  test('rejects another seat or priority passing while the choice is open', () => {
    const { server, state } = dig()
    expect(server.rules(state, pick(state, ['Top 1', 'Top 2'], 'p2'))).toMatchObject({ ok: false })
    expect(server.rules(state, { type: 'passPriority', seat: 'p1' })).toMatchObject({ ok: false })
  })

  test('a short library allows choosing every available card and orders the remainder', () => {
    const { server, state } = resolved(['Only 1', 'Only 2', 'Only 3'])
    const done = finish(server, state, ['Only 1', 'Only 2'], ['Only 3'])
    expect(names(done, done.zoneOrder.p1.hand)).toEqual(['Only 1', 'Only 2'])
    expect(names(done, done.zoneOrder.p1.library)).toEqual(['Only 3'])
  })

  test('one available card is chosen and an empty library skips the choice', () => {
    const { server, state: oneLooking } = resolved(['Lone'])
    const one = ok(server.rules(oneLooking, pick(oneLooking, ['Lone'])))
    expect(names(one, one.zoneOrder.p1.hand)).toEqual(['Lone'])
    expect(one.zoneOrder.p1.library).toEqual([])

    const empty = resolved([]).state
    expect(pendingSelectionFor(empty, 'p1')).toBeUndefined()
    expect(empty.stack).toHaveLength(0)
    expect(named(empty, 'Dig Spell').zone).toBe('graveyard')
  })

  test('private cards stay out of opponent projections and logs', () => {
    const { server, state } = dig()
    const done = finish(server, state, ['Top 2', 'Top 4'], ['Top 1', 'Top 3', 'Top 5', 'Top 6', 'Top 7'])
    expect(done.log.join('\n')).not.toMatch(/Top \d/)
    const opponent = projectForViewer(done, 'p2')
    for (const name of TOP) expect(JSON.stringify(opponent)).not.toContain(name)
  })

  test('a host restart restores the private pick and ordered-bottom choices', () => {
    const { server, cast } = setup([...TOP, 'Rest A', 'Rest B'])
    const kernel = handleFor(server.rules, server.state)
    for (const event of [cast, { type: 'resolveTop' } as const]) expect(kernel.dispatch(event).ok).toBe(true)

    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose',
      cards: TOP,
      destinations: ['target', 'skip'],
      requirements: { target: { min: 2, max: 2 } },
    })

    const restartedKernel = handleFor(server.rules, server.state, kernel.journal)
    expect(restartedKernel.history.current()).toEqual(kernel.history.current())
    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(restartedKernel, restarted)).toBe(true)
    expect(restarted.topdeck).toMatchObject({
      cards: TOP,
      destinations: ['target', 'skip'],
      requirements: { target: { min: 2, max: 2 } },
    })

    expect(applyKernelChoice(restartedKernel, restarted, 'p1', livePick(['Top 2', 'Top 4']))).toBe(true)

    const ordered = restartedKernel.history.current()
    expect(pendingSelectionFor(ordered, 'p1')).toMatchObject({ kind: 'scry', count: 5 })
    const orderRestartedKernel = handleFor(server.rules, server.state, restartedKernel.journal)
    const orderLobby = createLobby()
    orderLobby.phase = 'play'
    expect(prepareKernelPendingChoice(orderRestartedKernel, orderLobby)).toBe(true)
    expect(orderLobby.topdeck).toMatchObject({ seat: 'p1', kind: 'scry', cards: ['Top 1', 'Top 3', 'Top 5', 'Top 6', 'Top 7'] })
    expect(applyKernelChoice(orderRestartedKernel, orderLobby, 'p1', live(
      ['Top 7', 'Top 1', 'Top 3', 'Top 6', 'Top 5'],
      ['Top 1', 'Top 3', 'Top 5', 'Top 6', 'Top 7'],
    ))).toBe(true)
    const done = orderRestartedKernel.history.current()
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(orderLobby.topdeck).toBeUndefined()
    expect(names(done, done.zoneOrder.p1.hand)).toEqual(['Top 2', 'Top 4'])
    expect(names(done, done.zoneOrder.p1.library).slice(-5)).toEqual(['Top 7', 'Top 1', 'Top 3', 'Top 6', 'Top 5'])
    expect(done.stack).toHaveLength(0)
  })
})
