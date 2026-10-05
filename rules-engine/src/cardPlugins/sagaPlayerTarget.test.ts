import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { createServerGame, projectForViewer } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { createLobby } from '../../../live-runner/src/lobby'
import {
  applyKernelChoice,
  prepareKernelPendingChoice,
} from '../../../live-runner/src/kernelHost'
import type { KernelHandle } from '../../../live-runner/src/kernelHandle'
import {
  gainControlPermanent,
  sagaChapters,
  tapAll,
} from './effectBuilders'
import { serializableEffects } from './effectRuntime'
import { permanentControl } from './permanentControl'
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

const creature = (name: string, oracleText = '') =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, oracleText })

/** Chapter II targets an opponent; chapter III targets an opponent permanent. */
const chronicle = (lore: number) => ({
  ...cardTemplate('Fixture Tide Chronicle', {
    types: ['Enchantment'],
    subtypes: ['Saga'],
    oracleText: [
      'I — Nothing.',
      "II — Tap all nonland permanents target opponent controls. They don't untap during their controller's next untap step.",
      'III — Gain control of target permanent an opponent controls. Untap it.',
    ].join('\n'),
    effects: serializableEffects([sagaChapters(
      { numbers: [1], do: [] },
      {
        numbers: [2],
        targets: { filter: { players: 'opponent' } },
        do: [tapAll(
          { zone: 'battlefield', nonland: true },
          { ofTargetPlayer: true, skipNextUntap: true },
        )],
      },
      {
        numbers: [3],
        targets: { filter: { zone: 'battlefield', permanent: true, controller: 'opponent' } },
        do: [gainControlPermanent(true)],
      },
    )]),
  }),
  counters: { lore },
})

const setup = (lore: number) => {
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: {
      p1: [chronicle(lore), creature('Fixture Mine')],
      p2: [
        creature('Fixture Foe Alpha'),
        creature('Fixture Foe Beta'),
        cardTemplate('Fixture Foe Land', { types: ['Land'] }),
      ],
      p3: [
        creature('Fixture Bystander'),
        creature('Fixture Shrouded', 'Hexproof'),
      ],
    },
  }, { random: () => 0.5, cardPlugins: [targetedResolve, permanentControl] })
  const loreEvent = {
    type: 'putCounters' as const,
    objectId: named(server.state, 'Fixture Tide Chronicle').id,
    counter: 'lore',
    count: 1,
  }
  return { server, loreEvent, open: ok(server.rules(server.state, loreEvent)) }
}

describe('Saga chapter with a player target', () => {
  test('opens a typed player selection for the controller with opponent candidates only', () => {
    const { open } = setup(1)
    const selection = pendingPlayerSelectionFor(open, 'p1')!
    expect(selection.candidates).toEqual(['p2', 'p3'])
    expect(selection).toMatchObject({
      min: 1,
      max: 1,
      sourceId: named(open, 'Fixture Tide Chronicle').id,
    })
    expect(open.stack).toHaveLength(0)
    expect(open.priority).toBe('p1')
  })

  test('only the chooser sees the open selection', () => {
    const { open } = setup(1)
    expect(projectForViewer(open, 'p1').players.p1.data['kernel.pendingPlayerSelection'])
      .toBeDefined()
    expect(projectForViewer(open, 'p2').players.p1.data['kernel.pendingPlayerSelection'])
      .toBeUndefined()
  })

  test('rejects illegal choices and refuses to pass priority around the choice', () => {
    const { server, open } = setup(1)
    const selection = pendingPlayerSelectionFor(open, 'p1')!
    const choose = (seat: 'p1' | 'p2', players: ('p1' | 'p2' | 'p3')[]) =>
      server.rules(open, { type: 'selectPlayers', selectionId: selection.id, seat, players })
    expect(choose('p1', ['p1']).ok).toBe(false)
    expect(choose('p1', []).ok).toBe(false)
    expect(choose('p1', ['p2', 'p3']).ok).toBe(false)
    expect(choose('p2', ['p2']).ok).toBe(false)
    expect(server.rules(open, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
  })

  test('the chosen opponent is tapped down and skips exactly one untap step', () => {
    const { server, open } = setup(1)
    const selection = pendingPlayerSelectionFor(open, 'p1')!
    const stacked = ok(server.rules(open, {
      type: 'selectPlayers',
      selectionId: selection.id,
      seat: 'p1',
      players: ['p2'],
    }))
    expect(pendingPlayerSelectionFor(stacked, 'p1')).toBeUndefined()
    expect(stacked.stack[0]).toMatchObject({
      kind: 'ability',
      targets: [{ kind: 'player', player: 'p2' }],
    })
    expect(stacked.stack[0].payload?.sagaChapter).toBe(2)

    const resolved = resolveStack(server.rules, stacked)
    expect(named(resolved, 'Fixture Foe Alpha').tapped).toBe(true)
    expect(named(resolved, 'Fixture Foe Beta').skipNextUntap).toBe(true)
    expect(named(resolved, 'Fixture Foe Land').tapped).toBe(false)
    expect(named(resolved, 'Fixture Bystander').tapped).toBe(false)
    expect(named(resolved, 'Fixture Mine').tapped).toBe(false)

    const p2Untap = ok(server.rules(
      { ...resolved, step: 'cleanup' },
      { type: 'advanceStep' },
    ))
    expect(p2Untap.active).toBe('p2')
    expect(named(p2Untap, 'Fixture Foe Alpha').tapped).toBe(true)
  })

  test('the choice survives a host restart and resumes the chapter', () => {
    const { server, loreEvent } = setup(1)
    const kernel = handleFor(server.rules, server.state)
    const added = kernel.dispatch(loreEvent)
    if (!added.ok) throw new Error(added.error)

    const firstLobby = createLobby()
    firstLobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, firstLobby)).toBe(true)
    expect(firstLobby.topdeck).toMatchObject({
      kind: 'target-players',
      cards: ['p2', 'p3'],
      kernel: { stage: 'select-players' },
    })

    // A restarted host rebuilds the same choice from the journal alone.
    const restarted = handleFor(
      server.rules,
      restoreJournal(kernel.journal, server.rules).current(),
    )
    const restartedLobby = createLobby()
    restartedLobby.phase = 'play'
    expect(prepareKernelPendingChoice(restarted, restartedLobby)).toBe(true)
    expect(restartedLobby.topdeck).toEqual(firstLobby.topdeck)

    expect(applyKernelChoice(restarted, restartedLobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'p2', destination: 'skip' },
        { card: 'p3', destination: 'target' },
      ],
    })).toBe(true)
    const selection = pendingPlayerSelectionFor(kernel.history.current(), 'p1')!
    expect(restarted.journal.events).toContainEqual({
      type: 'selectPlayers',
      selectionId: selection.id,
      seat: 'p1',
      players: ['p3'],
    })
    // Priority settles on its own, so the chapter has already resolved.
    const current = restarted.history.current()
    expect(pendingPlayerSelectionFor(current, 'p1')).toBeUndefined()
    expect(named(current, 'Fixture Bystander').tapped).toBe(true)
    expect(named(current, 'Fixture Foe Alpha').tapped).toBe(false)
  })
})

describe('Saga chapter that gains control of an opponent permanent', () => {
  test('offers only legal permanents, and keeps the Saga until the chapter resolves', () => {
    const { open } = setup(2)
    const selection = pendingSelectionFor(open, 'p1')!
    const candidates = selection.candidates.map((id) => open.objects[id].name).sort()
    expect(candidates).toEqual([
      'Fixture Bystander',
      'Fixture Foe Alpha',
      'Fixture Foe Beta',
      'Fixture Foe Land',
    ])
    expect(named(open, 'Fixture Tide Chronicle').zone).toBe('battlefield')
  })

  test('steals the chosen permanent for good and untaps it, then sacrifices the Saga', () => {
    const { server, open } = setup(2)
    const target = named(open, 'Fixture Foe Alpha')
    const tappedTarget = {
      ...open,
      objects: { ...open.objects, [target.id]: { ...target, tapped: true } },
    }
    const stacked = ok(server.rules(tappedTarget, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [target.id],
    }))
    expect(named(stacked, 'Fixture Tide Chronicle').zone).toBe('battlefield')

    const resolved = resolveStack(server.rules, stacked)
    const stolen = named(resolved, 'Fixture Foe Alpha')
    expect(stolen.controller).toBe('p1')
    expect(stolen.owner).toBe('p2')
    expect(stolen.tapped).toBe(false)
    expect(stolen.summoningSickness).toBe(true)
    expect(named(resolved, 'Fixture Tide Chronicle').zone).toBe('graveyard')

    const later = ok(server.rules(
      { ...resolved, step: 'cleanup' },
      { type: 'advanceStep' },
    ))
    expect(named(later, 'Fixture Foe Alpha').controller).toBe('p1')
  })

  test('rejects your own permanent and a hexproof permanent as targets', () => {
    const { server, open } = setup(2)
    for (const name of ['Fixture Mine', 'Fixture Shrouded']) {
      const result = server.rules(open, {
        type: 'selectCards',
        seat: 'p1',
        kind: 'choose',
        count: 1,
        objectIds: [named(open, name).id],
      })
      expect(result.ok).toBe(false)
    }
  })
})
