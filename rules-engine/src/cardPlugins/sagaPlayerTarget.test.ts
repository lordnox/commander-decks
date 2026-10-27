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

const setupKiora = (lore: number) => {
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: {
      p1: [
        cardTemplate('Own Island', { types: ['Land'], subtypes: ['Island'] }),
        cardTemplate('Kiora Bests the Sea God', { counters: { lore } }),
      ],
      p2: [
        creature('Foe Alpha'),
        creature('Foe Beta'),
        cardTemplate('Foe Relic', { types: ['Artifact'] }),
        cardTemplate('Foe Forest', { types: ['Land'], subtypes: ['Forest'] }),
      ],
      p3: [
        creature('Bystander'),
        creature('Shrouded Mage', 'Hexproof'),
      ],
    },
    libraries: Object.fromEntries(['p1', 'p2', 'p3'].map((seat) => [
      seat,
      Array.from({ length: 12 }, (_, index) => cardTemplate(`${seat} Card ${index + 1}`, { types: ['Sorcery'] })),
    ])),
  }, { random: () => 0.5 })
  return { server, state: server.state }
}

const advanceKioraChapter = (kernel: KernelHandle, state: GameState) => {
  const result = kernel.dispatch({
    type: 'putCounters',
    objectId: named(state, 'Kiora Bests the Sea God').id,
    counter: 'lore',
    count: 1,
  })
  if (!result.ok) throw new Error(result.error)
}

const passUntilResolved = (kernel: KernelHandle) => {
  for (let guard = 0; guard < 12; guard += 1) {
    const state = kernel.history.current()
    if (state.stack.length === 0 || state.stack[0].waiting || state.resolution?.phase === 'waiting' || !state.priority) {
      return state
    }
    const result = kernel.dispatch({ type: 'passPriority', seat: state.priority })
    if (!result.ok) throw new Error(result.error)
  }
  throw new Error('stack did not resolve')
}

const kioraStealAnswer = (cards: string[], picked: string[]) => ({
  type: 'topdeck' as const,
  choices: cards.map((card, slot) => ({
    card,
    slot,
    destination: (picked.includes(card) ? 'target' : 'skip') as 'target' | 'skip',
  })),
})

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
        { card: 'p2', slot: 0, destination: 'skip' },
        { card: 'p3', slot: 1, destination: 'target' },
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

  test('offers "not targeted" so exactly one of several candidates can be marked', () => {
    const { open } = setup(2)
    expect(pendingSelectionFor(open, 'p1')).toMatchObject({
      count: 1,
      min: 1,
      destinations: ['skip', 'target'],
    })
  })

  test('rejects choosing no permanent or two permanents', () => {
    const { server, open } = setup(2)
    const [first, second] = pendingSelectionFor(open, 'p1')!.candidates
    for (const objectIds of [[], [first, second]]) {
      expect(server.rules(open, {
        type: 'selectCards',
        seat: 'p1',
        kind: 'choose',
        count: 1,
        objectIds,
      }).ok).toBe(false)
    }
  })

  test('a live host takes exactly one marked card, survives restart, and rejects 0 or 2', () => {
    const { server, loreEvent } = setup(2)
    const kernel = handleFor(server.rules, server.state)
    const added = kernel.dispatch(loreEvent)
    if (!added.ok) throw new Error(added.error)

    const firstLobby = createLobby()
    firstLobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, firstLobby)).toBe(true)
    expect(firstLobby.topdeck).toMatchObject({
      destinations: ['skip', 'target'],
      requirements: { target: { min: 1, max: 1 } },
    })
    const offered = (firstLobby.topdeck?.cards ?? []).map(String)
    expect(offered).toHaveLength(4)

    const restarted = handleFor(
      server.rules,
      restoreJournal(kernel.journal, server.rules).current(),
    )
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(restarted, lobby)).toBe(true)
    expect(lobby.topdeck).toEqual(firstLobby.topdeck)

    const answer = (targeted: number[]) => ({
      type: 'topdeck' as const,
      choices: offered.map((card, slot) => ({
        card,
        slot,
        destination: targeted.includes(slot) ? 'target' as const : 'skip' as const,
      })),
    })
    expect(() => applyKernelChoice(restarted, lobby, 'p1', answer([]))).toThrow()
    expect(() => applyKernelChoice(restarted, lobby, 'p1', answer([0, 1]))).toThrow()
    expect(pendingSelectionFor(restarted.history.current(), 'p1')).toBeDefined()

    const pick = offered.indexOf('Fixture Foe Beta')
    expect(applyKernelChoice(restarted, lobby, 'p1', answer([pick]))).toBe(true)
    const current = restarted.history.current()
    expect(pendingSelectionFor(current, 'p1')).toBeUndefined()
    expect(named(current, 'Fixture Foe Beta').controller).toBe('p1')
    expect(named(current, 'Fixture Foe Alpha').controller).toBe('p2')
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

describe('catalog Kiora Bests the Sea God target lifecycle', () => {
  test('chapter II privately targets an opponent and survives a live-host restart', () => {
    const { server, state } = setupKiora(1)
    const kernel = handleFor(server.rules, state)
    advanceKioraChapter(kernel, state)
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({ seat: 'p1', kind: 'target-players', cards: ['p2', 'p3'] })
    const open = kernel.history.current()
    expect(pendingPlayerSelectionFor(projectForViewer(open, 'p2'), 'p1')).toBeUndefined()
    expect(kernel.dispatch({ type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    const restartedKernel = handleFor(server.rules, state, kernel.journal)
    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(restartedKernel, restarted)).toBe(true)
    expect(restarted.topdeck).toEqual(lobby.topdeck)
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', {
      type: 'topdeck',
      choices: [],
    })).toThrow()
    expect(applyKernelChoice(restartedKernel, restarted, 'p2', {
      type: 'topdeck',
      choices: [{ card: 'p3', slot: 0, destination: 'target' }],
    })).toBe(false)
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'p2', slot: 0, destination: 'target' },
        { card: 'p3', slot: 1, destination: 'target' },
      ],
    })).toThrow()
    expect(pendingPlayerSelectionFor(restartedKernel.history.current(), 'p1')).toBeDefined()
    expect(applyKernelChoice(restartedKernel, restarted, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'p2', slot: 0, destination: 'skip' },
        { card: 'p3', slot: 1, destination: 'target' },
      ],
    })).toBe(true)
    const done = passUntilResolved(restartedKernel)
    expect(pendingPlayerSelectionFor(done, 'p1')).toBeUndefined()
    expect(named(done, 'Bystander').tapped).toBe(true)
    expect(named(done, 'Shrouded Mage')).toMatchObject({ tapped: true, skipNextUntap: true })
    expect(named(done, 'Foe Alpha').tapped).toBe(false)
  })

  test('chapter III offers exactly the legal opponent permanents to its private chooser', () => {
    const { server, state } = setupKiora(2)
    const kernel = handleFor(server.rules, state)
    advanceKioraChapter(kernel, state)
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose',
      cards: ['Foe Alpha', 'Foe Beta', 'Foe Relic', 'Foe Forest', 'Bystander'],
      destinations: ['skip', 'target'],
      requirements: { target: { min: 1, max: 1 } },
    })
    const open = kernel.history.current()
    expect(pendingSelectionFor(projectForViewer(open, 'p3'), 'p1')).toBeUndefined()
    expect(kernel.dispatch({ type: 'passPriority', seat: 'p1' }).ok).toBe(false)
    expect(named(open, 'Kiora Bests the Sea God').zone).toBe('battlefield')

    const restartedKernel = handleFor(server.rules, state, kernel.journal)
    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(restartedKernel, restarted)).toBe(true)
    expect(restarted.topdeck).toEqual(lobby.topdeck)
    const cards = lobby.topdeck!.cards as string[]
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', kioraStealAnswer(cards, cards)))
      .toThrow('Choose exactly 1 card(s).')
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', kioraStealAnswer(cards, [])))
      .toThrow('Choose exactly 1 card(s).')
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', kioraStealAnswer(cards, ['Foe Alpha', 'Foe Beta'])))
      .toThrow('Choose exactly 1 card(s).')
    expect(applyKernelChoice(restartedKernel, restarted, 'p2', kioraStealAnswer(cards, ['Foe Alpha'])))
      .toBe(false)
    expect(pendingSelectionFor(restartedKernel.history.current(), 'p1')).toBeDefined()

    expect(applyKernelChoice(restartedKernel, restarted, 'p1', kioraStealAnswer(cards, ['Foe Relic'])))
      .toBe(true)
    const done = passUntilResolved(restartedKernel)
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(done.stack).toHaveLength(0)
    expect(named(done, 'Foe Relic')).toMatchObject({ controller: 'p1', owner: 'p2', zone: 'battlefield' })
    for (const name of ['Foe Alpha', 'Foe Beta', 'Foe Forest', 'Bystander']) {
      expect(named(done, name).controller).not.toBe('p1')
    }
    expect(named(done, 'Kiora Bests the Sea God').zone).toBe('graveyard')
  })

  test('chapter III rejects noncandidates and keeps its choice open', () => {
    const { server, state } = setupKiora(2)
    const kernel = handleFor(server.rules, state)
    advanceKioraChapter(kernel, state)
    const selection = pendingSelectionFor(kernel.history.current(), 'p1')!
    for (const name of ['Shrouded Mage', 'Own Island']) {
      const objectId = named(state, name).id
      expect(selection.candidates).not.toContain(objectId)
      expect(kernel.dispatch({
        type: 'selectCards',
        seat: 'p1',
        selectionId: selection.id,
        kind: 'choose',
        count: 1,
        objectIds: [objectId],
      }).ok).toBe(false)
    }
    expect(pendingSelectionFor(kernel.history.current(), 'p1')).toBeDefined()
  })

  test('chapter III takes a lone target, or sacrifices the Saga when none qualifies', () => {
    const { server, state } = setupKiora(2)
    const targetOnly = structuredClone(state)
    for (const name of ['Foe Alpha', 'Foe Beta', 'Foe Forest', 'Bystander']) {
      delete targetOnly.objects[named(targetOnly, name).id]
    }
    for (const seat of ['p2', 'p3']) {
      targetOnly.zoneOrder[seat].battlefield = targetOnly.zoneOrder[seat].battlefield
        .filter((id) => targetOnly.objects[id])
    }
    const kernel = handleFor(server.rules, targetOnly)
    advanceKioraChapter(kernel, targetOnly)
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({ kind: 'choose', cards: ['Foe Relic'] })
    expect(applyKernelChoice(kernel, lobby, 'p1', kioraStealAnswer(['Foe Relic'], ['Foe Relic'])))
      .toBe(true)
    const done = passUntilResolved(kernel)
    expect(named(done, 'Foe Relic').controller).toBe('p1')
    expect(named(done, 'Kiora Bests the Sea God').zone).toBe('graveyard')

    const noTarget = structuredClone(targetOnly)
    delete noTarget.objects[named(noTarget, 'Foe Relic').id]
    noTarget.zoneOrder.p2.battlefield = noTarget.zoneOrder.p2.battlefield
      .filter((id) => noTarget.objects[id])
    const emptyKernel = handleFor(server.rules, noTarget)
    advanceKioraChapter(emptyKernel, noTarget)
    const emptied = resolveStack(server.rules, emptyKernel.history.current())
    expect(pendingSelectionFor(emptied, 'p1')).toBeUndefined()
    expect(emptied.stack).toHaveLength(0)
    expect(named(emptied, 'Kiora Bests the Sea God').zone).toBe('graveyard')
  })

  test('chapter III rechecks a target that gains hexproof in response', () => {
    const { server, state } = setupKiora(2)
    const kernel = handleFor(server.rules, state)
    advanceKioraChapter(kernel, state)
    const target = named(kernel.history.current(), 'Foe Alpha')
    const stacked = ok(server.rules(kernel.history.current(), {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [target.id],
    }))
    expect(stacked.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Kiora Bests the Sea God',
      payload: { sagaChapter: 3 },
      targets: [{ kind: 'object', objectId: target.id }],
    })
    expect(named(stacked, 'Kiora Bests the Sea God').zone).toBe('battlefield')
    named(stacked, 'Foe Alpha').oracleText = 'Hexproof'
    const done = resolveStack(server.rules, stacked)
    expect(named(done, 'Foe Alpha')).toMatchObject({ controller: 'p2', zone: 'battlefield' })
    expect(named(done, 'Kiora Bests the Sea God').zone).toBe('graveyard')
  })

  test('chapter III fizzles if its target leaves before resolution', () => {
    const { server, state } = setupKiora(2)
    const kernel = handleFor(server.rules, state)
    advanceKioraChapter(kernel, state)
    const target = named(kernel.history.current(), 'Foe Beta')
    const stacked = ok(server.rules(kernel.history.current(), {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [target.id],
    }))
    expect(stacked.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Kiora Bests the Sea God',
      payload: { sagaChapter: 3 },
      targets: [{ kind: 'object', objectId: target.id }],
    })
    const gone = ok(server.rules(stacked, { type: 'move', objectId: target.id, to: 'graveyard' }))
    const done = resolveStack(server.rules, gone)
    expect(named(done, 'Foe Beta')).toMatchObject({ zone: 'graveyard', controller: 'p2' })
    expect(Object.values(done.objects)
      .filter((object) => object.controller === 'p1' && object.zone === 'battlefield')
      .map((object) => object.name)).toEqual(['Own Island'])
    expect(named(done, 'Kiora Bests the Sea God').zone).toBe('graveyard')
  })
})
