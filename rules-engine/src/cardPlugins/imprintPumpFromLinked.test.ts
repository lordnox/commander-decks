import { describe, expect, test } from 'bun:test'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, linkExile, modifyStats, objects, ref, select, self, staticAbility, sumCharacteristics, target, whenever } from './dsl/v1'
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

const linked = objects({ zone: 'exile', exiledWith: ref('source') })

// The real card targets a nontoken creature; this exchangeable fixture keeps its target rule
// broad while exercising the canonical linked-exile selector and characteristic modifier.
const ingester = () => cardTemplate('Imprint Ingester', {
  types: ['Creature'],
  power: 3,
  toughness: 4,
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }), min: 0, max: 1 })] },
      instructions: [linkExile({ targets: target(0) })],
    }),
    staticAbility(modifyStats({
      targets: objects({ among: ref('source') }),
      power: sumCharacteristics(linked, 'power'),
      toughness: sumCharacteristics(linked, 'toughness'),
    })),
  ]))),
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
}, { random: () => 0.5, cardPlugins: [] })

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
  test('catalog Phyrexian Ingester offers itself and other legal creatures but no token, artifact, or hexproof creature', () => {
    const ingesterCard = cardTemplate('Phyrexian Ingester')
    const ownBear = prey('Own Bear', 2, 2)
    const bigFoe = prey('Big Foe', 4, 6)
    const foeToken = prey('Foe Token', 9, 9)
    foeToken.token = true
    const foeRelic = cardTemplate('Foe Relic', { types: ['Artifact'] })
    const shroudedFoe = cardTemplate('Shrouded Foe', {
      types: ['Creature'], power: 5, toughness: 5, oracleText: 'Hexproof',
    })
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: { p1: [ingesterCard] },
      battlefield: { p1: [ownBear], p2: [bigFoe, foeToken, foeRelic], p3: [shroudedFoe] },
    }, { random: () => 0.5 })
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move', objectId: named(server.state, 'Phyrexian Ingester').id, to: 'battlefield',
    })))
    const selection = pendingSelectionFor(entered, 'p1')!
    expect(selection.candidates.map((id) => entered.objects[id]!.name).toSorted())
      .toEqual(['Big Foe', 'Own Bear', 'Phyrexian Ingester'])
    expect(selection).toMatchObject({ kind: 'choose', min: 1, count: 1, destinations: ['skip', 'target'] })
    for (const name of ['Foe Token', 'Foe Relic', 'Shrouded Foe']) {
      expect(server.rules(entered, {
        type: 'selectCards', seat: 'p1', kind: 'choose', count: 1,
        objectIds: [named(entered, name).id],
      }).ok).toBe(false)
    }
    expect(server.rules(entered, {
      type: 'selectCards', seat: 'p2', kind: 'choose', count: 1,
      objectIds: [named(entered, 'Big Foe').id],
    }).ok).toBe(false)
    const chosenSelf = ok(server.rules(entered, {
      type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1,
      objectIds: [named(entered, 'Phyrexian Ingester').id],
    }))
    expect(chosenSelf.stack[0]?.targets).toContainEqual({
      kind: 'object', objectId: named(entered, 'Phyrexian Ingester').id,
      incarnation: named(entered, 'Phyrexian Ingester').incarnation, zone: 'battlefield',
    })
  })

  test('a private Ingester target survives a host restart and resolves through the live chooser', () => {
    const ingesterCard = cardTemplate('Imprint Ingester', {
      types: ['Creature'],
      power: 3,
      toughness: 3,
      ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
        whenever(self.enters, {
          decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', other: true }), min: 0, max: 1 })] },
          instructions: [linkExile({ targets: target(0) })],
        }),
        staticAbility(modifyStats({
          targets: objects({ among: ref('source') }),
          power: sumCharacteristics(linked, 'power'),
          toughness: sumCharacteristics(linked, 'toughness'),
        })),
      ]))),
    })
    const ownBear = prey('Own Bear', 2, 2)
    const bigFoe = prey('Big Foe', 4, 6)
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [ingesterCard] },
      battlefield: { p1: [ownBear], p2: [bigFoe] },
    }, { random: () => 0.5, cardPlugins: [] })
    const ready = structuredClone(server.state)
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.step = 'precombatMain'
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 6 }
    const kernel = handleFor(server.rules, ready)
    expect(kernel.dispatch({ type: 'castSpell', seat: 'p1', objectId: named(ready, 'Imprint Ingester').id }).ok).toBe(true)
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
    expect(stats(done, 'Imprint Ingester')).toEqual([7, 9])
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
  })

  test('catalog Ingester keeps its private self-inclusive target choice through host restart', () => {
    const ingesterCard = cardTemplate('Phyrexian Ingester', { power: 3, toughness: 3 })
    const ownBear = prey('Own Bear', 2, 2)
    const bigFoe = prey('Big Foe', 4, 6)
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [ingesterCard] },
      battlefield: { p1: [ownBear], p2: [bigFoe] },
    }, { random: () => 0.5 })
    const ready = structuredClone(server.state)
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.step = 'precombatMain'
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 6 }
    const kernel = handleFor(server.rules, ready)
    expect(kernel.dispatch({
      type: 'castSpell', seat: 'p1', objectId: named(ready, 'Phyrexian Ingester').id,
    }).ok).toBe(true)
    passUntilResolved(kernel)
    const lobby = playLobby()
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose',
      cards: ['Phyrexian Ingester', 'Own Bear', 'Big Foe'],
      destinations: ['skip', 'target'],
      requirements: { target: { min: 1, max: 1 } },
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
    expect(applyKernelChoice(restartedKernel, restarted, 'p2', answer(['Big Foe']))).toBe(false)
    expect(applyKernelChoice(restartedKernel, restarted, 'p1', answer(['Big Foe']))).toBe(true)
    const afterTarget = playLobby()
    expect(prepareKernelPendingChoice(restartedKernel, afterTarget)).toBe(true)
    const accept = {
      type: 'topdeck' as const,
      choices: [
        { card: 'Accept', slot: 0, destination: 'target' as const },
        { card: 'Decline', slot: 1, destination: 'skip' as const },
      ],
    }
    expect(applyKernelChoice(restartedKernel, afterTarget, 'p2', accept)).toBe(false)
    expect(applyKernelChoice(restartedKernel, afterTarget, 'p1', accept)).toBe(true)
    const done = passUntilResolved(restartedKernel)
    expect(named(done, 'Big Foe').zone).toBe('exile')
    expect(stats(done, 'Phyrexian Ingester')).toEqual([7, 9])
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
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
