import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  commanderRules,
  createJournal,
  createServerGame,
  forest,
  projectForViewer,
  recordAccepted,
  restoreJournal,
  type GameState,
} from '../../rules-engine/src/index'
import {
  librarySearch,
  pendingSearch,
  SEARCH_FETCH,
  searchingSeat,
} from '../../rules-engine/src/cardPlugins/librarySearch'
import { HOMER_NAME, homer } from '../../rules-engine/src/cardPlugins/homer'
import { activated as activatedPlugin } from '../../rules-engine/src/cardPlugins/activated'
import { choiceEffects } from '../../rules-engine/src/cardPlugins/choiceEffects'
import { dredge } from '../../rules-engine/src/cardPlugins/dredge'
import { abundance } from '../../rules-engine/src/cardPlugins/abundance'
import { hiddenPiles } from '../../rules-engine/src/cardPlugins/hiddenPiles'
import { alternateCosts } from '../../rules-engine/src/cardPlugins/alternateCosts'
import { targetedResolve } from '../../rules-engine/src/cardPlugins/targetedResolve'
import { creatureTypeChoice } from '../../rules-engine/src/cardPlugins/creatureTypeChoice'
import { combatTax } from '../../rules-engine/src/cardPlugins/combatTax'
import { modalSpell } from '../../rules-engine/src/cardPlugins/modalSpell'
import { jointExploration } from '../../rules-engine/src/cardPlugins/jointExploration'
import { onResolve } from '../../rules-engine/src/cardPlugins/onResolve'
import {
  CUMULATIVE_UPKEEP_PENDING,
  cumulativeUpkeep,
} from '../../rules-engine/src/cardPlugins/cumulativeUpkeep'
import { planeswalker as planeswalkerPlugin } from '../../rules-engine/src/cardPlugins/planeswalker'
import { extort } from '../../rules-engine/src/cardPlugins/extort'
import { combatPreventionCards } from '../../rules-engine/src/cardPlugins/combatPreventionCards'
import {
  DIALOG_CHOSEN,
  PENDING_DIALOG,
  pendingDialogLock,
} from '../../rules-engine/src/pendingDialog'
import { cardTemplate, planeswalker } from '../../rules-engine/src/newGame'
import { roomDoor } from '../../rules-engine/src/testHelpers'
import {
  PENDING_PLAYER_SELECTION,
  type PendingPlayerSelection,
} from '../../rules-engine/src/rules/selectPlayers'
import { createLobby } from './lobby'
import {
  applyKernelAct,
  applyKernelAdvance,
  applyKernelChoice,
  assertAgentKernelBoundary,
  kernelActions,
  kernelPath,
  kernelPriority,
  historyForViewer,
  loadHostCardPlugins,
  openKernel,
  prepareKernelPendingChoice,
  rollbackState,
  settleKernelHolds,
  settleKernelPriority,
  type KernelHandle,
} from './kernelHost'
import { liveSnapshotFromState } from './kernelView'
import type { SeatId } from './protocol'
import { pendingOptionSelection } from '../../rules-engine/src/rules/selectOptions'

const RANKLE_MODES = {
  discard: 'Each player discards a card',
  drain: 'Each player loses 1 life and draws a card',
  sacrifice: 'Each player sacrifices a creature',
} as const

const mkdirGames = (root: string) => {
  writeFileSync(join(root, 'package.json'), '{}\n')
  mkdirSync(join(root, 'table-games'), { recursive: true })
}

/** A stand-in card table: the host reads handler ids from cardRules.ts, not from JSON. */
const writeCardRules = (root: string, handlerIds: string[]) => {
  writeFileSync(
    join(root, 'rules-engine', 'src', 'cardPlugins', 'cardRules.ts'),
    `export const allHandlerIds = () => ${JSON.stringify(handlerIds)}\n`,
  )
}

const seedKernel = (
  root: string,
  slug = 'pod',
  adjust?: (state: ReturnType<typeof createServerGame>['state']) => void,
  stocked = false,
) => {
  const server = createServerGame(
    commanderRules,
    stocked
      ? {
          libraries: Object.fromEntries(
            (['p1', 'p2', 'p3', 'p4'] as const).map((seat) => [
              seat,
              Array.from({ length: 40 }, forest),
            ]),
          ),
        }
      : undefined,
    { random: () => 0.5, cardPlugins: [] },
  )
  const journal = createJournal(server.state)
  adjust?.(journal.initial)
  writeFileSync(kernelPath(slug, root), JSON.stringify(journal))
}

const handleFor = (
  rules: (state: GameState, event: Parameters<KernelHandle['dispatch']>[0]) => ReturnType<KernelHandle['dispatch']>,
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

/** A live game stopped mid-resolution on Nature's Lore, with no files involved. */
const searchGame = (options: { library?: string[] } = {}) => {
  const libraryNames = options.library ?? ['Taiga', 'Forest']
  const subtypes: Record<string, string[]> = {
    Taiga: ['Mountain', 'Forest'],
    Forest: ['Forest'],
    Mountain: ['Mountain'],
  }
  const server = createServerGame(
    commanderRules,
    {
      first: 'p1',
      hands: {
        p1: [{
          ...forest(),
          name: "Nature's Lore",
          types: ['Sorcery'],
          subtypes: [],
          supertypes: [],
          manaCost: '{1}{G}',
          tapProduces: undefined,
        }],
      },
      libraries: {
        p1: libraryNames.map((name) => ({
          ...forest(),
          name,
          subtypes: subtypes[name] ?? [],
        })),
      },
    },
    { random: () => 0.5, cardPlugins: [librarySearch] },
  )
  const initial = {
    ...server.state,
    players: {
      ...server.state.players,
      p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 } },
    },
  }
  const spellId = initial.zoneOrder.p1.hand[0]
  const kernel = handleFor(server.rules, initial)
  for (const event of [
    { type: 'castSpell', seat: 'p1', objectId: spellId } as const,
    { type: 'resolveTop' } as const,
  ]) {
    const result = kernel.dispatch(event)
    if (!result.ok) throw new Error(result.error)
  }
  const lobby = createLobby()
  lobby.phase = 'play'
  return { kernel, lobby, spellId }
}

const abilitySearchGame = (
  source: string,
  library: Array<{ name: string; subtypes: string[] }>,
  otherLands = 0,
) => {
  const server = createServerGame(
    commanderRules,
    {
      first: 'p1',
      battlefield: {
        p1: [
          { ...forest(), name: source, supertypes: [] },
          ...Array.from({ length: otherLands }, (_, index) => ({
            ...forest(),
            name: `Land ${index + 1}`,
          })),
        ],
      },
      libraries: {
        p1: library.map(({ name, subtypes }) => ({
          ...forest(),
          name,
          subtypes,
          supertypes: ['Basic'],
        })),
      },
    },
    { random: () => 0.5, cardPlugins: [librarySearch] },
  )
  const initial = structuredClone(server.state)
  initial.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 }
  const sourceId = initial.zoneOrder.p1.battlefield[0]
  const kernel = handleFor(server.rules, initial)
  const activated = kernel.dispatch({
    type: 'activateAbility',
    abilityId: SEARCH_FETCH,
    seat: 'p1',
    objectId: sourceId,
  })
  if (!activated.ok) throw new Error(activated.error)
  const lobby = createLobby()
  lobby.phase = 'play'
  return { kernel, lobby, sourceId }
}

describe('kernel host journal', () => {
  test('cumulative upkeep choice is rebuilt after restart and paid through typed UI input', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Wall of Shards', {
            types: ['Creature'],
            counters: { age: 2 },
          })],
        },
      },
      { random: () => 0.5, cardPlugins: [cumulativeUpkeep] },
    )
    const state = structuredClone(server.state)
    const wall = Object.values(state.objects).find((object) => object.name === 'Wall of Shards')!
    state.rules.push({
      instanceId: 'builtin-cumulativeUpkeep',
      pluginId: 'cumulativeUpkeep',
      sourceId: null,
      timestamp: state.nextTimestamp++,
      params: {},
    })
    state.players.p1.data[CUMULATIVE_UPKEEP_PENDING] = {
      id: 'upkeep-choice',
      objectId: wall.id,
      source: wall.name,
      seat: 'p1',
      count: 2,
      opponents: ['p2', 'p3', 'p4'],
    }

    const firstLobby = createLobby()
    expect(prepareKernelPendingChoice(handleFor(server.rules, state), firstLobby)).toBe(true)
    expect(firstLobby.topdeck).toMatchObject({
      kind: 'cumulative-upkeep',
      cards: ['p2', 'p3', 'p4'],
      count: 2,
    })

    const restartedLobby = createLobby()
    const restarted = handleFor(server.rules, structuredClone(state))
    expect(prepareKernelPendingChoice(restarted, restartedLobby)).toBe(true)
    expect(restartedLobby.topdeck).toEqual(firstLobby.topdeck)
    expect(applyKernelChoice(restarted, restartedLobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'p2', destination: 'target' },
        { card: 'p3', destination: 'target' },
      ],
    })).toBe(true)
    expect(restarted.history.current().players.p2.life).toBe(41)
    expect(restarted.history.current().players.p3.life).toBe(41)
    expect(restarted.history.current().players.p1.data[CUMULATIVE_UPKEEP_PENDING])
      .toBeUndefined()
  })

  test('an agent cannot pass through an actionable human turn', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [forest()] } },
      { random: () => 0.5, cardPlugins: [] },
    )
    const initial = structuredClone(server.state)
    initial.step = 'precombatMain'
    initial.active = 'p1'
    initial.priority = 'p1'
    const kernel = handleFor(server.rules, initial)
    const candidate = recordAccepted(kernel.journal, {
      type: 'passPriority',
      seat: 'p1',
    })

    expect(() =>
      assertAgentKernelBoundary(kernel, candidate, 'p4', 'p1')
    ).toThrow('crossed an actionable p1 turn')
    expect(() =>
      assertAgentKernelBoundary(kernel, candidate, 'p1', 'p1')
    ).not.toThrow()
  })

  test('an agent cannot pass the human response window inside another seat’s line', () => {
    const server = createServerGame(
      commanderRules,
      {
        first: 'p3',
        hands: { p1: [cardTemplate("Dovin's Veto", {
          types: ['Instant'],
          manaCost: '{W}{U}',
          oracleText: 'Counter target noncreature spell.',
        })] },
        battlefield: {
          p1: [
            { ...forest(), name: 'Adarkar Wastes', subtypes: [], supertypes: [] },
            cardTemplate('Phial of Galadriel', {
              types: ['Artifact'],
              oracleText: '{T}: Add one mana of any color.',
            }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [] },
    )
    const initial = structuredClone(server.state)
    initial.objects[initial.zoneOrder.p1.battlefield[0]].oracleText =
      '{T}: Add {C}.\n{T}: Add {W} or {U}. This land deals 1 damage to you.'
    initial.step = 'precombatMain'
    initial.active = 'p3'
    initial.priority = 'p1'
    initial.stack = [{
      id: 'stack-1',
      kind: 'spell',
      objectId: 'reanimate',
      controller: 'p3',
      name: 'Reanimate',
      targets: [],
    }]
    const kernel = handleFor(server.rules, initial)
    const candidate = recordAccepted(kernel.journal, {
      type: 'passPriority',
      seat: 'p1',
    })

    const checked = assertAgentKernelBoundary(kernel, candidate, 'p3', 'p1')
    expect(checked.trimmed).toBe(1)
    expect(checked.journal.events).toEqual(kernel.journal.events)

    // The seat's own hold is its escape from windows it does not want.
    expect(
      assertAgentKernelBoundary(kernel, candidate, 'p3', 'p1', { held: true }).trimmed,
    ).toBe(0)
  })

  test('play start persists and restores a pass', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-host-'))
    mkdirGames(root)
    seedKernel(root)
    const lobby = createLobby()
    lobby.phase = 'play'
    const first = await openKernel('pod', root, lobby)
    expect(readFileSync(kernelPath('pod', root), 'utf8')).toContain('rules-engine/v0')

    const seat = first.history.current().priority
    expect(seat).toBeTruthy()
    const passed = first.dispatch({ type: 'passPriority', seat: seat! })
    expect(passed.ok).toBe(true)

    const restored = await openKernel('pod', root, lobby)
    expect(restored.history.current().priority).toBe(first.history.current().priority)
    const priority = kernelPriority(restored.history.current())
    expect(priority).toBeTruthy()
    if (priority) {
      expect(kernelActions(restored.history.current())[priority]).toEqual(['plan', 'pass', 'act'])
    }
  })

  test('does not publish a blank kernel over a turn-zero replay', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-host-'))
    mkdirGames(root)
    writeFileSync(
      join(root, 'table-games', 'pod.json'),
      JSON.stringify({ events: [{ id: 0, turn: 0 }] }),
    )
    const lobby = createLobby()
    lobby.phase = 'play'

    await expect(openKernel('pod', root, lobby)).rejects.toThrow('reach turn one')
    expect(existsSync(kernelPath('pod', root))).toBe(false)
  })

  test('does not invent an empty game without setup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-host-'))
    mkdirGames(root)
    const lobby = createLobby()
    lobby.phase = 'play'

    await expect(openKernel('pod', root, lobby)).rejects.toThrow('waits for game setup')
    expect(existsSync(kernelPath('pod', root))).toBe(false)
  })

  test('loads generated card handlers from the current worktree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-plugins-'))
    mkdirSync(join(root, 'rules-engine', 'src', 'cardPlugins'), { recursive: true })
    writeCardRules(root, ['testHandler'])
    const handlerPath = join(
      root,
      'rules-engine',
      'src',
      'cardPlugins',
      'testHandler.ts',
    )
    writeFileSync(handlerPath, "export const testHandler = { id: 'testHandler', version: 1 }\n")

    const first = await loadHostCardPlugins(root)
    expect(first.map((plugin) => plugin.id)).toEqual(['testHandler'])
    expect((first[0] as typeof first[0] & { version: number }).version).toBe(1)

    writeFileSync(handlerPath, "export const testHandler = { id: 'testHandler', version: 2 }\n")
    const reloaded = await loadHostCardPlugins(root)
    expect((reloaded[0] as typeof reloaded[0] & { version: number }).version).toBe(2)
  })

  test('loads only handlers the table cards need', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-plugins-filter-'))
    mkdirSync(join(root, 'rules-engine', 'src', 'cardPlugins'), { recursive: true })
    writeFileSync(
      join(root, 'rules-engine', 'src', 'cardPlugins', 'cardRules.ts'),
      [
        'export const allHandlerIds = () => ["testHandler"]',
        'export const handlerIdsForNames = (names) => names.includes("Test Card") ? ["testHandler"] : []',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(root, 'rules-engine', 'src', 'cardPlugins', 'testHandler.ts'),
      "export const testHandler = { id: 'testHandler' }\n",
    )

    expect(await loadHostCardPlugins(root, ['Forest'])).toEqual([])
    expect((await loadHostCardPlugins(root, ['Test Card'])).map((plugin) => plugin.id))
      .toEqual(['testHandler'])
  })

  test('installs dynamically loaded handlers into an existing journal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-active-plugin-'))
    mkdirGames(root)
    mkdirSync(join(root, 'rules-engine', 'src', 'cardPlugins'), { recursive: true })
    writeCardRules(root, ['testHandler'])
    writeFileSync(
      join(root, 'rules-engine', 'src', 'cardPlugins', 'testHandler.ts'),
      "export const testHandler = { id: 'testHandler' }\n",
    )
    seedKernel(root)

    const kernel = await openKernel('pod', root, createLobby())
    expect(kernel.journal.initial.rules.some(
      (rule) => rule.pluginId === 'testHandler',
    )).toBe(true)
  })

  test('does not install a handler twice when the journal already adds it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-recorded-plugin-'))
    mkdirGames(root)
    mkdirSync(join(root, 'rules-engine', 'src', 'cardPlugins'), { recursive: true })
    writeCardRules(root, ['testHandler'])
    writeFileSync(
      join(root, 'rules-engine', 'src', 'cardPlugins', 'testHandler.ts'),
      "export const testHandler = { id: 'testHandler' }\n",
    )
    seedKernel(root)
    const path = kernelPath('pod', root)
    const journal = JSON.parse(readFileSync(path, 'utf8'))
    journal.events.push({
      type: 'addRule',
      pluginId: 'testHandler',
      sourceId: null,
    })
    writeFileSync(path, JSON.stringify(journal))

    const kernel = await openKernel('pod', root, createLobby())
    const installed = [
      ...kernel.journal.initial.rules,
      ...kernel.history.current().rules,
    ].filter((rule) => rule.pluginId === 'testHandler')

    expect(kernel.journal.initial.rules.some(
      (rule) => rule.pluginId === 'testHandler',
    )).toBe(false)
    expect(installed).toHaveLength(1)
  })

  test('a held seat is passed for until its own turn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-hold-'))
    mkdirGames(root)
    seedKernel(root, 'pod', undefined, true)
    const lobby = createLobby()
    lobby.phase = 'play'
    lobby.occupants.p2 = { name: 'Crab', deck: 'deck' }
    const kernel = await openKernel('pod', root, lobby)
    lobby.holds = { p2: true, p3: true, p4: true }

    expect(kernel.dispatch({ type: 'passPriority', seat: 'p1' }).ok).toBe(true)
    expect(settleKernelHolds(kernel, lobby)).toBe(true)

    const current = kernel.history.current()
    expect(current.active).toBe('p2')
    expect(current.priority).toBe('p2')
    expect(current.step).toBe('precombatMain')
    expect(lobby.actions).toEqual(kernelActions(current))
  })

  test('a restored private choice survives a host restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-choice-restart-'))
    mkdirGames(root)
    seedKernel(root)
    const lobby = createLobby()
    lobby.topdeck = {
      seat: 'p1',
      kind: 'scry',
      cards: ['Island'],
      destinations: ['top', 'bottom'],
      kernel: {
        sourceId: 'spell',
        stage: 'scry',
        resumePassSeat: 'p1',
      },
    }
    const kernel = await openKernel('pod', root, lobby)
    const before = kernel.journal.events.length

    expect(settleKernelPriority(kernel, lobby)).toBe(false)
    expect(kernel.journal.events.length).toBe(before)
    expect(lobby.topdeck?.kind).toBe('scry')
  })

  test('a host restart rebuilds an open dredge replacement choice', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Life from the Loam', { types: ['Sorcery'] })] },
        libraries: {
          p1: ['One', 'Two', 'Three'].map((name) =>
            cardTemplate(name, { types: ['Sorcery'] })),
        },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [dredge] },
    )
    const loam = server.state.zoneOrder.p1.hand[0]
    const kernel = handleFor(server.rules, server.state)
    expect(kernel.dispatch({ type: 'move', objectId: loam, to: 'graveyard' }).ok).toBe(true)
    expect(kernel.dispatch({ type: 'draw', seat: 'p1' }).ok).toBe(true)

    const firstLobby = createLobby()
    firstLobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, firstLobby)).toBe(true)
    expect(firstLobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose',
      cards: ['Life from the Loam'],
      destinations: ['skip', 'target'],
    })

    const restartedKernel = handleFor(
      server.rules,
      restoreJournal(kernel.journal, server.rules).current(),
    )
    const restartedLobby = createLobby()
    restartedLobby.phase = 'play'
    expect(prepareKernelPendingChoice(restartedKernel, restartedLobby)).toBe(true)
    expect(restartedLobby.topdeck).toEqual(firstLobby.topdeck)
    expect(applyKernelChoice(restartedKernel, restartedLobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Life from the Loam', destination: 'target' }],
    })).toBe(true)
    expect(restartedKernel.history.current().objects[loam].zone).toBe('hand')
  })

  test('a host restart rebuilds and resumes an Abundance draw choice', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Abundance', { types: ['Enchantment'] })],
        },
        libraries: {
          p1: [cardTemplate('Drawn Card', { types: ['Sorcery'] })],
        },
      },
      { random: () => 0.5, cardPlugins: [abundance] },
    )
    const kernel = handleFor(server.rules, server.state)
    expect(kernel.dispatch({ type: 'draw', seat: 'p1' }).ok).toBe(true)
    const firstLobby = createLobby()
    expect(prepareKernelPendingChoice(kernel, firstLobby)).toBe(true)

    const restarted = handleFor(
      server.rules,
      restoreJournal(kernel.journal, server.rules).current(),
    )
    const restartedLobby = createLobby()
    expect(prepareKernelPendingChoice(restarted, restartedLobby)).toBe(true)
    expect(restartedLobby.topdeck).toEqual(firstLobby.topdeck)
    expect(applyKernelChoice(restarted, restartedLobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'Draw normally', destination: 'target' },
        { card: 'Land', destination: 'skip' },
        { card: 'Nonland', destination: 'skip' },
      ],
    })).toBe(true)
    expect(restarted.history.current().zoneOrder.p1.hand).toHaveLength(1)
    expect(pendingOptionSelection(restarted.history.current())).toBeUndefined()
  })

  test('a host restart preserves the hidden Hostile Negotiations pile choice', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: {
          p1: [cardTemplate('Hostile Negotiations', {
            types: ['Instant'],
            manaCost: '{3}{B}',
          })],
        },
        libraries: {
          p1: Array.from({ length: 6 }, (_, index) =>
            cardTemplate(`Secret ${index + 1}`, { types: ['Sorcery'] })),
        },
      },
      { random: () => 0.5, cardPlugins: [onResolve, hiddenPiles] },
    )
    const initial = structuredClone(server.state)
    initial.players.p1.mana.B = 1
    initial.players.p1.mana.C = 3
    const spell = initial.zoneOrder.p1.hand[0]
    const kernel = handleFor(server.rules, initial)
    expect(kernel.dispatch({
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
    }).ok).toBe(true)
    expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
    const firstLobby = createLobby()
    expect(prepareKernelPendingChoice(kernel, firstLobby)).toBe(true)

    const restarted = handleFor(
      server.rules,
      restoreJournal(kernel.journal, server.rules).current(),
    )
    const restartedLobby = createLobby()
    expect(prepareKernelPendingChoice(restarted, restartedLobby)).toBe(true)
    expect(restartedLobby.topdeck).toEqual(firstLobby.topdeck)
    expect(restartedLobby.topdeck?.cards.join(' ')).toContain('Secret 1')
    expect(projectForViewer(restarted.history.current(), 'p2').zoneOrder.p1.exile)
      .toHaveLength(0)
  })

  test('Cling to Dust escape cost cards round-trip through a structured live act', () => {
    const cards = [
      cardTemplate('Cling to Dust', { types: ['Instant'], manaCost: '{B}' }),
      ...Array.from({ length: 5 }, (_, index) =>
        cardTemplate(`Escape cost ${index + 1}`, { types: ['Sorcery'] })),
      cardTemplate('Escape target', { types: ['Creature'] }),
    ]
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: cards } },
      { random: () => 0.5, cardPlugins: [alternateCosts, targetedResolve] },
    )
    let state = server.state
    for (const objectId of state.zoneOrder.p1.hand.slice()) {
      const moved = server.rules(state, { type: 'move', objectId, to: 'graveyard' })
      if (!moved.ok) throw new Error(moved.error)
      state = moved.state
    }
    state = structuredClone(state)
    state.players.p1.mana.B = 1
    state.players.p1.mana.C = 3
    const cling = Object.values(state.objects).find((object) => object.name === 'Cling to Dust')!
    const target = Object.values(state.objects).find((object) => object.name === 'Escape target')!
    const costs = Object.values(state.objects)
      .filter((object) => object.name.startsWith('Escape cost'))
      .map((object) => object.id)
    const kernel = handleFor(server.rules, state)
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'castSpell',
      objectId: cling.id,
      castOption: 'escape',
      targetObjectId: target.id,
      targetObjectIds: costs,
    })).toHaveLength(1)
    const current = kernel.history.current()
    expect(costs.every((objectId) => current.objects[objectId].zone === 'exile')).toBe(true)
    expect(current.stack[0]).toMatchObject({
      objectId: cling.id,
      castOption: 'escape',
      targets: [{ kind: 'object', objectId: target.id }],
    })
  })

  test('restores an interrupted Analyze the Pollen library search', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-search-restart-'))
    mkdirGames(root)
    seedKernel(root, 'pod', (state) => {
      const spellId = 'analyze'
      state.objects[spellId] = {
        ...forest(),
        id: spellId,
        name: 'Analyze the Pollen',
        types: ['Sorcery'],
        zone: 'stack',
        owner: 'p1',
        controller: 'p1',
      }
      state.stack = [{
        id: 'stack-analyze',
        kind: 'spell',
        objectId: spellId,
        controller: 'p1',
        name: 'Analyze the Pollen',
        targets: [],
        kicked: true,
      }]
      state.players.p1.data['librarySearch.pending'] = {
        source: 'Analyze the Pollen',
        sourceId: spellId,
        via: 'spell',
        kicked: true,
      }
    }, true)
    const lobby = createLobby()
    const kernel = await openKernel('pod', root, lobby)

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'search',
      destinations: ['library', 'hand'],
      requirements: { hand: { min: 1, max: 1 } },
    })
    expect(lobby.topdeck?.cards).toHaveLength(40)
  })

  test('a hold releases when the held seat becomes active', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-hold-release-'))
    mkdirGames(root)
    seedKernel(root, 'pod', undefined, true)
    const lobby = createLobby()
    lobby.phase = 'play'
    const kernel = await openKernel('pod', root, lobby)
    lobby.holds = { p2: true, p3: true, p4: true }

    // Walk p1's turn out so that p2 becomes the active player.
    for (let guard = 0; guard < 40 && kernel.history.current().active === 'p1'; guard += 1) {
      const priority = kernelPriority(kernel.history.current())
      if (!priority) break
      kernel.dispatch({ type: 'passPriority', seat: priority })
      settleKernelHolds(kernel, lobby)
    }

    expect(kernel.history.current().active).toBe('p2')
    expect(lobby.holds.p2).toBe(false)
    expect(lobby.holds.p3).toBe(true)
  })

  test('empty priority windows settle until a real choice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-empty-actions-'))
    mkdirGames(root)
    seedKernel(root, 'pod', undefined, true)
    const lobby = createLobby()
    lobby.phase = 'play'
    const kernel = await openKernel('pod', root, lobby)

    expect(settleKernelPriority(kernel, lobby)).toBe(true)
    const current = kernel.history.current()
    expect(current.active).toBe('p2')
    expect(current.step).toBe('precombatMain')
    expect(current.priority).toBe('p2')
  })

  test('a hold pauses while something waits on the stack', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-hold-stack-'))
    mkdirGames(root)
    seedKernel(root, 'pod', undefined, true)
    const lobby = createLobby()
    lobby.phase = 'play'
    const kernel = await openKernel('pod', root, lobby)
    lobby.holds = { p2: true }

    const held = kernel.history.current()
    const stacked = {
      ...held,
      active: 'p1',
      priority: 'p2',
      stack: [{
        id: 's1',
        kind: 'spell' as const,
        objectId: 'o1',
        controller: 'p1',
        name: 'Held Spell',
        targets: [],
      }],
    }
    let dispatched = 0
    const stub = {
      ...kernel,
      history: { ...kernel.history, current: () => stacked },
      dispatch: (event: Parameters<typeof kernel.dispatch>[0]) => {
        dispatched += 1
        return kernel.dispatch(event)
      },
    }

    expect(settleKernelHolds(stub, lobby)).toBe(false)
    expect(dispatched).toBe(0)
  })

  test('bounds published history frames', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-history-'))
    mkdirGames(root)
    // Forty pass rounds outlive a seven card hand, and this test is about
    // frame bounds rather than the cleanup discard rule.
    seedKernel(
      root,
      'pod',
      (state) => {
        for (const seat of state.playerOrder) state.players[seat].data.maximumHandSize = null
      },
      true,
    )
    const lobby = createLobby()
    lobby.phase = 'play'
    const kernel = await openKernel('pod', root, lobby)

    for (let index = 0; index < 40; index += 1) {
      const priority = kernelPriority(kernel.history.current())
      expect(priority).toBeTruthy()
      if (priority) expect(kernel.dispatch({ type: 'passPriority', seat: priority }).ok).toBe(true)
    }

    expect(historyForViewer(kernel, lobby, 'p1')).toHaveLength(32)
  })

  test('every library search shares one private dialog and finishes the spell', () => {
    const { kernel, lobby, spellId } = searchGame()

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'search',
      destinations: ['library', 'battlefield'],
      requirements: { battlefield: { min: 1, max: 1 } },
    })
    expect(lobby.topdeck?.cards).toEqual(['Taiga', 'Forest'])

    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'Taiga', destination: 'battlefield' },
        { card: 'Forest', destination: 'library' },
      ],
    })).toBe(true)

    const state = kernel.history.current()
    const taiga = Object.values(state.objects).find((object) => object.name === 'Taiga')!
    expect(taiga.zone).toBe('battlefield')
    expect(state.objects[spellId].zone).toBe('graveyard')
    expect(state.stack).toHaveLength(0)
    expect(searchingSeat(state)).toBeUndefined()
    expect(lobby.topdeck).toBeUndefined()
  })

  test('Joint Exploration put-land dispatches a kernel move', () => {
    const spell = {
      ...forest(),
      name: 'Joint Exploration',
      types: ['Instant'],
      supertypes: [],
      subtypes: [],
      manaCost: '{1}{U}',
      tapProduces: undefined,
    }
    const handLand = { ...forest(), name: 'Breeding Pool', supertypes: [] }
    const server = createServerGame(
      commanderRules,
      {
        first: 'p1',
        hands: { p1: [spell, handLand] },
        libraries: { p1: [{ ...forest(), name: 'Top Card', types: ['Instant'] }] },
      },
      { random: () => 0.5, cardPlugins: [jointExploration, onResolve] },
    )
    const initial = structuredClone(server.state)
    initial.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 }
    const spellId = initial.zoneOrder.p1.hand[0]
    const kernel = handleFor(server.rules, initial)
    for (const event of [
      { type: 'castSpell', seat: 'p1', objectId: spellId, kicked: true } as const,
      { type: 'resolveTop' } as const,
    ]) {
      const result = kernel.dispatch(event)
      if (!result.ok) throw new Error(result.error)
    }
    const lobby = createLobby()
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck?.kind).toBe('scry')
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Top Card', destination: 'top' }],
    })).toBe(true)
    expect(lobby.topdeck?.kind).toBe('put-land')
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Breeding Pool', destination: 'battlefield' }],
    })).toBe(true)

    const state = kernel.history.current()
    const land = Object.values(state.objects).find((object) => object.name === 'Breeding Pool')!
    expect(land.zone).toBe('battlefield')
    expect(kernel.journal.events).toContainEqual({
      type: 'move',
      objectId: land.id,
      to: 'battlefield',
    })
  })

  test('a generic pending dialog can put several permanent cards from hand', () => {
    const cards = ['First Permanent', 'Second Permanent'].map((name) => ({
      ...forest(),
      name,
      types: ['Artifact'],
      subtypes: [],
      supertypes: [],
      tapProduces: undefined,
    }))
    const server = createServerGame(commanderRules, { hands: { p1: cards } })
    server.state.players.p1.data[PENDING_DIALOG] = {
      sourceId: 'source',
      source: 'A resolving ability',
      seat: 'p1',
      kind: 'put-permanents',
      prompt: 'Choose up to two permanents.',
      waiting: 'is choosing permanents.',
      judge: 'Waiting for permanents.',
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['hand', 'battlefield'],
      permanent: true,
      optional: true,
      requirements: { battlefield: { max: 2 } },
    }
    const kernel = handleFor(server.rules, server.state)
    const lobby = createLobby()

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      kind: 'put-permanents',
      cards: ['First Permanent', 'Second Permanent'],
    })
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'First Permanent', destination: 'battlefield' },
        { card: 'Second Permanent', destination: 'battlefield' },
      ],
    })).toBe(true)

    expect(kernel.history.current().zoneOrder.p1.battlefield).toHaveLength(2)
    expect(kernel.history.current().players.p1.data[PENDING_DIALOG]).toBeUndefined()
  })

  test('a resolved clone choice hands the seat its ordinary actions back', () => {
    const clone = { ...forest(), name: 'Clone', types: ['Creature'], tapProduces: undefined }
    const bear = { ...forest(), name: 'Bear', types: ['Creature'], tapProduces: undefined }
    // The seat keeps a land in hand: a seat with nothing to do gets its actions
    // refreshed by the pass that follows, which would hide the stall.
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [clone, bear] },
      hands: { p1: [forest()] },
    })
    server.state.players.p1.data[PENDING_DIALOG] = {
      sourceId: Object.values(server.state.objects).find((object) => object.name === 'Clone')!.id,
      source: 'Clone',
      seat: 'p1',
      kind: 'copy-creature',
      prompt: 'You may have this enter as a copy of a creature you control.',
      waiting: 'is choosing a creature to copy.',
      judge: 'Waiting for an optional clone.',
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['skip', 'target'],
      types: ['Creature'],
      optional: true,
      requirements: { target: { max: 1 } },
    }
    const kernel = handleFor(server.rules, server.state)
    const lobby = createLobby()

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.actions).toEqual({ p1: ['topdeck'] })
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Bear', destination: 'target' }],
    })).toBe(true)

    expect(lobby.topdeck).toBeUndefined()
    expect(lobby.actions.p1).not.toContain('topdeck')
    expect(lobby.actions).toEqual(kernelActions(kernel.history.current()))
  })

  test('a look-top dialog moves one card to hand and orders the rest on bottom', () => {
    const server = createServerGame(commanderRules, {
      libraries: {
        p1: ['First', 'Second', 'Third', 'Fourth'].map((name) => ({
          ...forest(),
          name,
        })),
      },
    })
    server.state.players.p1.data[PENDING_DIALOG] = {
      sourceId: 'teferi',
      source: 'Teferi, Who Slows the Sunset',
      seat: 'p1',
      kind: 'look-top',
      prompt: 'Choose one for your hand.',
      waiting: 'is choosing.',
      judge: 'Waiting.',
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['bottom', 'hand'],
      count: 3,
      requirements: { hand: { min: 1, max: 1 } },
    }
    const kernel = handleFor(server.rules, server.state)
    const lobby = createLobby()

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck?.cards).toEqual(['First', 'Second', 'Third'])
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'First', destination: 'bottom' },
        { card: 'Second', destination: 'hand' },
        { card: 'Third', destination: 'bottom' },
      ],
    })).toBe(true)

    const state = kernel.history.current()
    expect(state.zoneOrder.p1.hand.map((id) => state.objects[id].name)).toEqual(['Second'])
    expect(state.zoneOrder.p1.library.slice(-2).map((id) => state.objects[id].name))
      .toEqual(['First', 'Third'])
  })

  test('Homer target choices survive in kernel state and mill the selected players', () => {
    const homerCard = {
      ...forest(),
      name: HOMER_NAME,
      types: ['Creature'],
      subtypes: ['Crab', 'Druid'],
      supertypes: ['Legendary'],
      power: 0,
      toughness: 9,
      tapProduces: undefined,
    }
    const crab = {
      ...forest(),
      name: 'Crab',
      types: ['Creature'],
      subtypes: ['Crab'],
      supertypes: [],
      power: 1,
      toughness: 1,
      tapProduces: undefined,
    }
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [forest()] },
        battlefield: { p1: [homerCard, crab] },
        libraries: {
          p1: Array.from({ length: 6 }, forest),
          p2: Array.from({ length: 6 }, forest),
          p3: Array.from({ length: 6 }, forest),
          p4: Array.from({ length: 6 }, forest),
        },
      },
      { random: () => 0.5, cardPlugins: [homer] },
    )
    const kernel = handleFor(server.rules, server.state)
    const lobby = createLobby()
    lobby.phase = 'play'
    const landId = server.state.zoneOrder.p1.hand[0]
    expect(kernel.dispatch({ type: 'playLand', seat: 'p1', objectId: landId }).ok).toBe(true)

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'target-players',
      cards: ['p1', 'p2', 'p3', 'p4'],
      destinations: ['skip', 'target'],
    })
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'p1', destination: 'skip' },
        { card: 'p2', destination: 'target' },
        { card: 'p3', destination: 'skip' },
        { card: 'p4', destination: 'target' },
      ],
    })).toBe(true)

    const state = kernel.history.current()
    expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(state.zoneOrder.p2.graveyard).toHaveLength(4)
    expect(state.zoneOrder.p3.graveyard).toHaveLength(0)
    expect(state.zoneOrder.p4.graveyard).toHaveLength(4)
    expect(lobby.topdeck).toBeUndefined()
  })

  test('typed life-exchange player choices round-trip through the live host', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Mister Negative', {
            types: ['Creature'],
            manaCost: '{5}{W}{B}',
          })],
        },
        libraries: {
          p1: Array.from({ length: 30 }, (_, index) =>
            cardTemplate(`Draw ${index + 1}`, { types: ['Instant'] })),
        },
      },
      { random: () => 0.5 },
    )
    const initial = structuredClone(server.state)
    initial.players.p2.life = 10
    const kernel = handleFor(server.rules, initial)
    const lobby = createLobby()
    lobby.phase = 'play'
    const mister = initial.zoneOrder.p1.hand[0]
    expect(kernel.dispatch({ type: 'move', objectId: mister, to: 'battlefield' }).ok).toBe(true)

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'target-players',
      cards: ['p2', 'p3', 'p4'],
      destinations: ['skip', 'target'],
      kernel: { stage: 'select-players' },
    })
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'p2', destination: 'target' },
        { card: 'p3', destination: 'skip' },
        { card: 'p4', destination: 'skip' },
      ],
    })).toBe(true)

    let state = kernel.history.current()
    if (state.stack.length > 0) {
      expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
    }
    prepareKernelPendingChoice(kernel, lobby)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      cards: ['p2'],
      requirements: { target: { min: 0, max: 1 } },
      kernel: { stage: 'select-players' },
    })
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'p2', destination: 'target' }],
    })).toBe(true)

    state = kernel.history.current()
    expect([state.players.p1.life, state.players.p2.life]).toEqual([10, 40])
    expect(state.zoneOrder.p1.hand).toHaveLength(30)
  })

  test('a saved dialog that no longer matches the kernel is rebuilt', () => {
    const { kernel, lobby } = searchGame()
    prepareKernelPendingChoice(kernel, lobby)

    // What an older host published before basics carried their Basic supertype.
    lobby.topdeck = { ...lobby.topdeck!, cards: [] }
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck?.cards).toEqual(['Taiga', 'Forest'])
  })

  test('Scapeshift sacrifices lands as it resolves, then opens its search', () => {
    const server = createServerGame(
      commanderRules,
      {
        first: 'p1',
        hands: {
          p1: [cardTemplate('Scapeshift', {
            types: ['Sorcery'],
            manaCost: '{2}{G}{G}',
          })],
        },
        battlefield: {
          p1: [
            { ...forest(), name: 'First Forest' },
            { ...forest(), name: 'Second Forest' },
          ],
        },
        libraries: { p1: [{ ...forest(), name: 'Library Forest' }] },
      },
      { random: () => 0.5, cardPlugins: [librarySearch, pendingDialogLock] },
    )
    const initial = structuredClone(server.state)
    initial.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 }
    const spellId = initial.zoneOrder.p1.hand[0]
    const kernel = handleFor(server.rules, initial)
    const cast = kernel.dispatch({ type: 'castSpell', seat: 'p1', objectId: spellId })
    if (!cast.ok) throw new Error(cast.error)
    const lobby = createLobby()
    lobby.phase = 'play'

    // Nothing is chosen while the spell is castable; it waits on the stack.
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(false)
    const resolving = kernel.dispatch({ type: 'resolveTop' })
    if (!resolving.ok) throw new Error(resolving.error)

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      kind: 'sacrifice-lands',
      cards: ['First Forest', 'Second Forest'],
      destinations: ['battlefield', 'sacrifice'],
    })
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'First Forest', destination: 'sacrifice' },
        { card: 'Second Forest', destination: 'battlefield' },
      ],
    })).toBe(true)

    const state = kernel.history.current()
    const sacrificed = Object.values(state.objects).find(
      (object) => object.name === 'First Forest',
    )!
    expect(state.objects[sacrificed.id].zone).toBe('graveyard')
    expect(pendingSearch(state, 'p1')).toMatchObject({ source: 'Scapeshift', max: 1 })
    expect(lobby.topdeck).toMatchObject({ kind: 'search', cards: ['Library Forest'] })
  })

  test('a search reads the whole library, not only the cards it may take', () => {
    const { kernel, lobby } = searchGame({ library: ['Taiga', 'Mountain'] })
    prepareKernelPendingChoice(kernel, lobby)

    // Only Taiga has a Forest type, but looking at the library is free.
    expect(lobby.topdeck?.cards).toEqual(['Taiga'])
    expect(lobby.topdeck?.library).toEqual(['Mountain', 'Taiga'])
  })

  test('the searching seat is the only viewer who sees the candidates', () => {
    const { kernel, lobby } = searchGame()
    prepareKernelPendingChoice(kernel, lobby)

    const state = kernel.history.current()
    const snapshotFor = (viewer: SeatId) => liveSnapshotFromState({
      state: projectForViewer(state, viewer),
      lobby,
      viewer,
    })

    expect(projectForViewer(state, 'p2').zoneOrder.p1.library).toEqual([])
    expect(snapshotFor('p2').topdeck).toBeUndefined()
    expect(JSON.stringify(snapshotFor('p2'))).not.toContain('Taiga')
    expect(snapshotFor('p1').topdeck?.cards).toEqual(['Taiga', 'Forest'])
  })

  test('a restarted host rebuilds the open search instead of resolving past it', () => {
    const { kernel, lobby } = searchGame()
    prepareKernelPendingChoice(kernel, lobby)
    const events = kernel.journal.events.length

    // A restart keeps the kernel journal but forgets the lobby dialog.
    const restarted = createLobby()
    restarted.phase = 'play'
    expect(settleKernelPriority(kernel, restarted)).toBe(true)
    expect(restarted.topdeck).toMatchObject({ seat: 'p1', kind: 'search' })
    expect(kernel.journal.events.length).toBe(events)
  })

  test('a search with nothing to find fails to find and resolves the spell', () => {
    const { kernel, lobby, spellId } = searchGame({ library: ['Mountain'] })

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(false)
    expect(lobby.topdeck).toBeUndefined()
    const state = kernel.history.current()
    expect(state.objects[spellId].zone).toBe('graveyard')
    expect(searchingSeat(state)).toBeUndefined()
  })

  test('a choice outside the search requirements is rejected', () => {
    const { kernel, lobby } = searchGame()
    prepareKernelPendingChoice(kernel, lobby)

    expect(() => applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'Taiga', destination: 'battlefield' },
        { card: 'Forest', destination: 'battlefield' },
      ],
    })).toThrow('Choose 1 card(s)')
    expect(searchingSeat(kernel.history.current())).toBe('p1')
  })

  test('Fabled Passage untaps its find once the fourth land enters', () => {
    const { kernel, lobby, sourceId } = abilitySearchGame(
      'Fabled Passage',
      [{ name: 'Forest', subtypes: ['Forest'] }],
      3,
    )
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Forest', destination: 'battlefield' }],
    })).toBe(true)

    const state = kernel.history.current()
    const found = Object.values(state.objects).find(
      (object) => object.name === 'Forest',
    )!
    expect(found.zone).toBe('battlefield')
    expect(found.tapped).toBe(false)
    expect(state.objects[sourceId].zone).toBe('graveyard')
  })

  test('Myriad Landscape rejects basics that do not share a land type', () => {
    const { kernel, lobby } = abilitySearchGame(
      'Myriad Landscape',
      [
        { name: 'Forest', subtypes: ['Forest'] },
        { name: 'Island', subtypes: ['Island'] },
      ],
    )
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(() => applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'Forest', destination: 'battlefield' },
        { card: 'Island', destination: 'battlefield' },
      ],
    })).toThrow('must share a land type')
    expect(searchingSeat(kernel.history.current())).toBe('p1')
  })

  test('advances a coarse phase through the kernel without a judge round', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-advance-'))
    mkdirGames(root)
    const server = createServerGame(
      commanderRules,
      { first: 'p1' },
      { random: () => 0.5, cardPlugins: [] },
    )
    const journal = createJournal(server.state)
    journal.initial.step = 'precombatMain'
    writeFileSync(kernelPath('pod', root), JSON.stringify(journal))
    const lobby = createLobby()
    lobby.phase = 'play'
    lobby.occupants.p1 = { name: 'Active player', deck: 'deck' }
    const kernel = await openKernel('pod', root, lobby)

    expect(kernelActions(kernel.history.current()).p1).toContain('advance')
    expect(applyKernelAdvance(kernel, lobby, 'p1')).toBe(true)
    expect(kernel.history.current().step).toBe('beginCombat')
    expect(kernel.journal.events.at(-1)).toEqual({ type: 'advanceStep' })
    expect(lobby.actions.p1).toContain('advance')
    expect(applyKernelAdvance(kernel, lobby, 'p1')).toBe(true)
    expect(kernel.history.current().step).toBe('declareAttackers')
  })

  test('plays a land from a structured act without a judge round', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-act-'))
    mkdirGames(root)
    seedKernel(root, 'pod', (state) => {
      const land = forest()
      const id = 'land-1'
      state.objects[id] = {
        ...land,
        id,
        owner: 'p1',
        controller: 'p1',
        zone: 'hand',
      }
      state.zoneOrder.p1.hand = [id]
      state.zoneCounts.p1.hand = 1
      state.step = 'precombatMain'
      state.active = 'p1'
      state.priority = 'p1'
    })
    const lobby = createLobby()
    lobby.phase = 'play'
    lobby.occupants.p1 = { name: 'Active player', deck: 'deck' }
    const kernel = await openKernel('pod', root, lobby)

    applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'playLand',
      objectId: 'land-1',
    })
    expect(kernel.history.current().objects['land-1'].zone).toBe('battlefield')
    expect(kernel.journal.events.at(-1)).toEqual({
      type: 'playLand',
      seat: 'p1',
      objectId: 'land-1',
    })
  })

  test('casts one Room half and later unlocks the other from structured acts', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Funeral Room // Awakening Hall', {
            roomDoors: [
              roomDoor('Funeral Room', '{2}{B}'),
              roomDoor('Awakening Hall', '{6}{B}{B}'),
            ],
          })],
        },
      },
      { random: () => 0.5, cardPlugins: [] },
    )
    const initial = structuredClone(server.state)
    initial.step = 'precombatMain'
    initial.active = 'p1'
    initial.priority = 'p1'
    initial.players.p1.mana = { W: 0, U: 0, B: 4, R: 0, G: 0, C: 12 }
    const objectId = initial.zoneOrder.p1.hand[0]
    const kernel = handleFor(server.rules, initial)
    const lobby = createLobby()
    lobby.phase = 'play'

    applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'castSpell',
      objectId,
      door: 'left',
    })
    expect(kernel.journal.events.at(-1)).toMatchObject({
      type: 'castSpell',
      objectId,
      door: 'left',
    })
    for (const seat of ['p1', 'p2', 'p3', 'p4'] as const) {
      expect(kernel.dispatch({ type: 'passPriority', seat }).ok).toBe(true)
    }
    expect(kernel.history.current().objects[objectId]).toMatchObject({
      zone: 'battlefield',
      name: 'Funeral Room',
      unlockedDoors: ['left'],
    })

    applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'unlockDoor',
      objectId,
      door: 'right',
    })
    expect(kernel.journal.events.at(-1)).toMatchObject({
      type: 'unlockDoor',
      objectId,
      door: 'right',
    })
    expect(kernel.history.current().objects[objectId]).toMatchObject({
      name: 'Funeral Room // Awakening Hall',
      unlockedDoors: ['left', 'right'],
    })
  })

  test('activates Teferi +1 with submitted targets and opens priority', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            planeswalker('Teferi, Who Slows the Sunset', 4),
            cardTemplate('Mana Rock', { types: ['Artifact'], tapped: true }),
            forest(),
          ],
          p2: [cardTemplate('Target Creature', {
            types: ['Creature'],
            power: 2,
            toughness: 2,
          })],
        },
      },
      { random: () => 0.5, cardPlugins: [planeswalkerPlugin] },
    )
    const initial = structuredClone(server.state)
    initial.step = 'precombatMain'
    initial.active = 'p1'
    initial.priority = 'p1'
    const byName = (name: string) =>
      Object.values(initial.objects).find((object) => object.name === name)!
    const teferi = byName('Teferi, Who Slows the Sunset')
    const rock = byName('Mana Rock')
    const creature = byName('Target Creature')
    const land = byName('Forest')
    const kernel = handleFor(server.rules, initial)
    const lobby = createLobby()
    lobby.phase = 'play'

    applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'activateAbility',
      objectId: teferi.id,
      abilityId: 'teferi.plus-one',
      text: 'teferi.plus-one',
      targetObjectIds: [rock.id, creature.id, land.id],
    })

    const current = kernel.history.current()
    expect(current.objects[teferi.id].counters.loyalty).toBe(5)
    expect(current.stack[0]).toMatchObject({
      kind: 'ability',
      abilityId: 'teferi.plus-one',
      targets: [
        { kind: 'object', objectId: rock.id },
        { kind: 'object', objectId: creature.id },
        { kind: 'object', objectId: land.id },
      ],
    })
    expect(current.priority).toBe('p1')
    expect(current.objects[rock.id].tapped).toBe(true)
    expect(current.objects[creature.id].tapped).toBe(false)

    for (const seat of ['p1', 'p2', 'p3', 'p4'] as const) {
      const passed = kernel.dispatch({ type: 'passPriority', seat })
      expect(passed.ok).toBe(true)
    }
    const resolved = kernel.history.current()
    expect(resolved.stack).toHaveLength(0)
    expect(resolved.objects[rock.id].tapped).toBe(false)
    expect(resolved.objects[creature.id].tapped).toBe(true)
    expect(resolved.players.p1.life).toBe(42)
  })

  test('sends submitted activation-cost cards as choices, not targets', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [forest()] },
        battlefield: {
          p1: [cardTemplate('Trade Routes', { types: ['Enchantment'] })],
        },
      },
      { random: () => 0.5, cardPlugins: [activatedPlugin] },
    )
    const initial = structuredClone(server.state)
    initial.players.p1.mana.C = 1
    const routes = Object.values(initial.objects)
      .find((object) => object.name === 'Trade Routes')!
    const land = Object.values(initial.objects)
      .find((object) => object.name === 'Forest')!
    const kernel = handleFor(server.rules, initial)
    const lobby = createLobby()
    lobby.phase = 'play'

    applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'activateAbility',
      objectId: routes.id,
      abilityId: 'tradeRoutes.draw',
      text: 'tradeRoutes.draw',
      targetObjectIds: [land.id],
    })

    expect(kernel.history.current().objects[land.id].zone).toBe('graveyard')
    expect(kernel.journal.events.at(-1)).toMatchObject({
      type: 'activateAbility',
      objectId: routes.id,
      choices: [land.id],
      targets: [],
    })
  })

  test('preserves two activation-cost groups in printed order', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Discard Me', { types: ['Instant'] })],
        },
        battlefield: {
          p1: [
            cardTemplate('Dreamscape Artist', { types: ['Creature'] }),
            forest(),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [librarySearch] },
    )
    const initial = structuredClone(server.state)
    initial.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 2 }
    const artist = Object.values(initial.objects)
      .find((object) => object.name === 'Dreamscape Artist')!
    artist.summoningSickness = false
    const card = Object.values(initial.objects)
      .find((object) => object.name === 'Discard Me')!
    const land = Object.values(initial.objects)
      .find((object) => object.name === 'Forest')!
    const kernel = handleFor(server.rules, initial)
    const lobby = createLobby()
    lobby.phase = 'play'

    applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'activateAbility',
      objectId: artist.id,
      abilityId: SEARCH_FETCH,
      text: 'Search your library for up to two basic land cards.',
      targetObjectIds: [card.id, land.id],
    })

    const current = kernel.history.current()
    expect(current.objects[card.id].zone).toBe('graveyard')
    expect(current.objects[land.id].zone).toBe('graveyard')
    expect(kernel.journal.events.at(-1)).toMatchObject({
      type: 'activateAbility',
      objectId: artist.id,
      choices: [card.id, land.id],
      targets: [],
    })
  })

  test('declares selected attackers against players and planeswalkers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-attack-'))
    mkdirGames(root)
    seedKernel(root, 'pod', (state) => {
      state.objects.attacker = {
        ...cardTemplate('Grizzly Bears', {
          types: ['Creature'],
          power: 2,
          toughness: 2,
        }),
        id: 'attacker',
        owner: 'p1',
        controller: 'p1',
        zone: 'battlefield',
        summoningSickness: false,
      }
      state.objects.walker = {
        ...cardTemplate('Test Walker', {
          types: ['Planeswalker'],
          power: null,
          toughness: null,
        }),
        id: 'walker',
        owner: 'p2',
        controller: 'p2',
        zone: 'battlefield',
      }
      state.zoneOrder.p1.battlefield = ['attacker']
      state.zoneOrder.p2.battlefield = ['walker']
      state.step = 'declareAttackers'
      state.active = 'p1'
      state.priority = 'p1'
    })
    const lobby = createLobby()
    lobby.phase = 'play'
    lobby.occupants.p1 = { name: 'Active player', deck: 'deck' }
    const kernel = await openKernel('pod', root, lobby)

    applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'declareAttackers',
      attackers: [{ objectId: 'attacker', defenderId: 'walker' }],
    })

    expect(kernel.history.current().objects.attacker).toMatchObject({
      tapped: true,
      attacking: { kind: 'object', objectId: 'walker' },
    })
    expect(kernel.journal.events.at(-1)).toEqual({
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{
        objectId: 'attacker',
        defender: { kind: 'object', objectId: 'walker' },
      }],
    })
  })

  test('declares and pays for taxed blocks without judge fallback', async () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Archangel of Tithes', {
            types: ['Creature'],
            power: 3,
            toughness: 5,
          })],
          p2: [
            cardTemplate('Blocker', {
              types: ['Creature'],
              power: 2,
              toughness: 2,
            }),
            {
              ...forest(),
              name: 'Plains',
              oracleText: '{T}: Add {W}.',
              tapProduces: { W: 1 },
            },
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [combatTax] },
    )
    const state = structuredClone(server.state)
    const archangel = Object.values(state.objects).find(
      (object) => object.name === 'Archangel of Tithes',
    )!
    const blocker = Object.values(state.objects).find((object) => object.name === 'Blocker')!
    const plains = Object.values(state.objects).find((object) => object.name === 'Plains')!
    archangel.tapped = true
    archangel.summoningSickness = false
    archangel.attacking = { kind: 'player', player: 'p2' }
    blocker.summoningSickness = false
    state.step = 'declareBlockers'
    state.active = 'p1'
    state.priority = 'p2'
    const kernel = handleFor(server.rules, state)
    const lobby = createLobby()
    lobby.phase = 'play'
    lobby.occupants.p2 = { name: 'Defender', deck: 'deck' }
    expect(kernel.history.current().rules.some((rule) => rule.pluginId === 'combatTax')).toBe(true)

    const events = applyKernelAct(kernel, lobby, 'p2', {
      type: 'act',
      kind: 'declareBlockers',
      blockers: [{ blockerId: blocker.id, attackerId: archangel.id }],
    })

    expect(events).toEqual([{
      type: 'declareBlockers',
      seat: 'p2',
      blockers: [{ blockerId: blocker.id, attackerId: archangel.id }],
      payment: [{ objectId: plains.id }],
    }])
    expect(kernel.history.current().objects[blocker.id].blocking).toBe(archangel.id)
    expect(kernel.history.current().objects[plains.id].tapped).toBe(true)
    expect(kernel.history.current().players.p2.mana.W).toBe(0)
    expect(kernel.journal.events.some((event) => event.type === 'judgeFallback')).toBe(false)
  })

  test('Rankle publishes its modes, then a sacrifice choice per player', () => {
    const body = (name: string) => ({
      ...forest(),
      name,
      types: ['Creature'],
      subtypes: ['Faerie'],
      supertypes: [],
      power: 3,
      toughness: 3,
      tapProduces: undefined,
    })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [body('Rankle, Master of Pranks')],
          p2: [{ ...body('Lone Hydra'), grantedRules: [] }],
        },
      },
      { random: () => 0.5, cardPlugins: [modalSpell, choiceEffects] },
    )
    const kernel = handleFor(server.rules, server.state)
    const lobby = createLobby()
    lobby.phase = 'play'
    const source = Object.values(server.state.objects)
      .find((object) => object.name === 'Rankle, Master of Pranks')!
    expect(kernel.dispatch({
      type: 'combatDamage',
      sourceId: source.id,
      target: { kind: 'player', player: 'p2' },
      amount: 3,
    }).ok).toBe(true)

    expect(kernel.history.current().stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Rankle, Master of Pranks',
    })
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(false)

    expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose-modes',
      cards: [RANKLE_MODES.discard, RANKLE_MODES.drain, RANKLE_MODES.sacrifice],
    })

    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: RANKLE_MODES.discard, destination: 'skip' },
        { card: RANKLE_MODES.drain, destination: 'skip' },
        { card: RANKLE_MODES.sacrifice, destination: 'target' },
      ],
    })).toBe(true)
    prepareKernelPendingChoice(kernel, lobby)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'sacrifice',
      cards: ['Rankle, Master of Pranks'],
      destinations: ['battlefield', 'sacrifice'],
    })

    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Rankle, Master of Pranks', destination: 'sacrifice' }],
    })).toBe(true)
    expect(kernel.history.current().objects[source.id].zone).toBe('graveyard')
    prepareKernelPendingChoice(kernel, lobby)
    expect(lobby.topdeck).toMatchObject({ seat: 'p2', kind: 'sacrifice' })
  })

  test('publishes and applies a Roaming Throne creature-type choice', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Homer, the Hermit', {
            types: ['Creature'],
            subtypes: ['Crab', 'Druid'],
          })],
        },
        hands: {
          p1: [cardTemplate('Roaming Throne', {
            types: ['Artifact', 'Creature'],
            subtypes: ['Golem'],
          })],
        },
      },
      { random: () => 0.5, cardPlugins: [creatureTypeChoice] },
    )
    const kernel = handleFor(server.rules, server.state)
    const lobby = createLobby()
    lobby.phase = 'play'
    const throne = Object.values(server.state.objects)
      .find((object) => object.name === 'Roaming Throne')!
    expect(kernel.dispatch({
      type: 'move',
      objectId: throne.id,
      to: 'battlefield',
    }).ok).toBe(true)
    expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose-creature-type',
      cards: ['Crab', 'Druid', 'Golem', 'Other (no current creature)'],
    })
    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'Crab', destination: 'target' },
        { card: 'Druid', destination: 'skip' },
        { card: 'Golem', destination: 'skip' },
        { card: 'Other (no current creature)', destination: 'skip' },
      ],
    })).toBe(true)
    expect(kernel.history.current().objects[throne.id]).toMatchObject({
      chosenType: 'Crab',
      subtypes: ['Golem', 'Crab'],
    })
  })

  test('Portal publishes and resumes a typed graveyard reanimation choice', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [cardTemplate('Portal to Phyrexia', { types: ['Artifact'], manaCost: '{9}' })],
      },
      hands: {
        p2: [cardTemplate('Borrowed Body', {
          types: ['Creature'],
          subtypes: ['Beast'],
          power: 4,
          toughness: 4,
        })],
      },
    })
    const body = server.state.zoneOrder.p2.hand[0]
    let state = server.rules(server.state, {
      type: 'move',
      objectId: body,
      to: 'graveyard',
    })
    if (!state.ok) throw new Error(state.error)
    const kernel = handleFor(server.rules, {
      ...state.state,
      step: 'untap',
      active: 'p1',
      priority: 'p1',
    })
    const lobby = createLobby()
    lobby.phase = 'play'

    expect(kernel.dispatch({ type: 'advanceStep' }).ok).toBe(true)
    expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose',
      cards: ['Borrowed Body'],
      destinations: ['target'],
    })

    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Borrowed Body', destination: 'target' }],
    })).toBe(true)
    expect(kernel.history.current().objects[body]).toMatchObject({
      zone: 'battlefield',
      controller: 'p1',
    })
  })

  test('Settle publishes and restores its private basic-land search', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Settle the Wreckage', {
            types: ['Instant'],
            manaCost: '{2}{W}{W}',
          })],
        },
        battlefield: {
          p2: [cardTemplate('Attacker', {
            types: ['Creature'],
            power: 3,
            toughness: 3,
          })],
        },
        libraries: {
          p2: [
            cardTemplate('Plains', {
              types: ['Land'],
              supertypes: ['Basic'],
              subtypes: ['Plains'],
            }),
            cardTemplate('Guildgate', { types: ['Land'] }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [combatPreventionCards] },
    )
    const initial = structuredClone(server.state)
    initial.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 2 }
    const attacker = Object.values(initial.objects).find((object) => object.name === 'Attacker')!
    attacker.attacking = { kind: 'player', player: 'p1' }
    const settle = Object.values(initial.objects)
      .find((object) => object.name === 'Settle the Wreckage')!
    const kernel = handleFor(server.rules, initial)
    expect(kernel.dispatch({
      type: 'castSpell',
      seat: 'p1',
      objectId: settle.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }).ok).toBe(true)
    expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)

    const restored = handleFor(
      server.rules,
      restoreJournal(kernel.journal, server.rules).current(),
    )
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(restored, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p2',
      kind: 'choose',
      cards: ['Plains'],
      destinations: ['library', 'battlefield'],
      requirements: { battlefield: { min: 0, max: 1 } },
    })
    expect(applyKernelChoice(restored, lobby, 'p2', {
      type: 'topdeck',
      choices: [{ card: 'Plains', destination: 'battlefield' }],
    })).toBe(true)
    const plains = Object.values(restored.history.current().objects)
      .find((object) => object.name === 'Plains')!
    expect(plains.zone).toBe('battlefield')
  })

  test('pauses on a waiting stack discard and resumes with continueAction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-stack-discard-'))
    mkdirGames(root)
    const handId = 'hand-card'
    seedKernel(root, 'pod', (state) => {
      state.objects[handId] = {
        ...forest(),
        id: handId,
        name: 'Victim Card',
        types: ['Instant'],
        owner: 'p2',
        controller: 'p2',
        zone: 'hand',
      }
      state.zoneOrder.p2.hand = [handId]
      state.zoneCounts.p2.hand = 1
      state.stack = [{
        id: 'discard-action',
        kind: 'action',
        actionId: 'discard',
        objectId: 'cry',
        controller: 'p2',
        name: 'Discard',
        targets: [],
        waiting: 'choice',
        payload: { seat: 'p2', count: 1, chooser: 'p2' },
      }]
      state.priority = 'p2'
      state.passedInRow = []
    }, true)
    const lobby = createLobby()
    lobby.phase = 'play'
    const kernel = await openKernel('pod', root, lobby)
    const beforeEvents = kernel.journal.events.length

    expect(settleKernelPriority(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p2',
      kind: 'discard-card',
      cards: ['Victim Card'],
      kernel: { stage: 'waiting-discard', stackId: 'discard-action' },
    })
    expect(kernel.journal.events.length - beforeEvents).toBeLessThan(20)
    expect(lobby.topdeck).toBeDefined()
    expect(kernel.history.current().stack[0]?.waiting).toBe('choice')

    expect(applyKernelChoice(kernel, lobby, 'p2', {
      type: 'topdeck',
      choices: [{ card: 'Victim Card', destination: 'graveyard' }],
    })).toBe(true)
    expect(kernel.journal.events.some((event) =>
      event.type === 'continueAction'
      && event.stackId === 'discard-action'
      && event.seat === 'p2')).toBe(true)
    expect(kernel.history.current().stack).toHaveLength(0)
    expect(kernel.history.current().objects[handId].zone).toBe('graveyard')
  })

  test('publishes and applies the defeated Siege casting choice', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: {
        p1: [cardTemplate('Test Siege // Test Victor', {
          types: ['Battle'],
          subtypes: ['Siege'],
          frontFace: {
            types: ['Battle'],
            subtypes: ['Siege'],
            supertypes: [],
            manaCost: '{2}{G}',
            manaValue: 3,
            colors: ['G'],
            printedDefense: 3,
          },
          backFace: {
            types: ['Creature'],
            subtypes: ['Warrior'],
            supertypes: [],
            manaCost: '',
            manaValue: 0,
            colors: ['G'],
            power: 4,
            toughness: 4,
          },
        })],
      },
    })
    const objectId = server.state.zoneOrder.p1.hand[0]
    server.state.objects[objectId].zone = 'exile'
    server.state.zoneOrder.p1.hand = []
    server.state.zoneOrder.p1.exile = [objectId]
    server.state.zoneCounts.p1.hand = 0
    server.state.zoneCounts.p1.exile = 1
    server.state.stack = [{
      id: 'battle-cast',
      kind: 'action',
      actionId: 'cast-battle-transformed',
      objectId,
      controller: 'p1',
      name: 'Cast Test Siege transformed',
      targets: [],
      waiting: 'choice',
      payload: { chooser: 'p1' },
    }]
    server.state.priority = 'p1'

    const kernel = handleFor(server.rules, server.state)
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'may',
      cards: ['Yes'],
      destinations: ['target', 'skip'],
      kernel: { stage: 'battle-cast-transformed', stackId: 'battle-cast' },
    })

    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [{ card: 'Yes', destination: 'target' }],
    })).toBe(true)
    expect(kernel.journal.events).toContainEqual({
      type: 'continueAction',
      stackId: 'battle-cast',
      seat: 'p1',
      payload: { cast: true },
    })
    expect(kernel.history.current().objects[objectId].types).toEqual(['Creature'])
    expect(kernel.history.current().objects[objectId].zone).toBe('battlefield')
  })

  test('after illegal continueAction rollback shows state before the rejected choice', () => {
    const server = createServerGame(commanderRules, {
      hands: { p2: [{ ...forest(), name: 'Victim Card' }] },
      players: 4,
    })
    const handId = server.state.zoneOrder.p2.hand[0]
    const waiting = {
      ...server.state,
      stack: [{
        id: 'discard-action',
        kind: 'action' as const,
        actionId: 'discard',
        objectId: 'cry',
        controller: 'p2' as const,
        name: 'Discard',
        targets: [],
        waiting: 'choice' as const,
        payload: { seat: 'p2', count: 1, chooser: 'p2' },
      }],
      priority: 'p2',
      passedInRow: [],
    }
    const kernel = handleFor(server.rules, waiting)
    const rejected = kernel.dispatch({
      type: 'continueAction',
      stackId: 'discard-action',
      seat: 'p2',
      payload: { objectIds: ['missing-card'] },
    })

    expect(rejected.ok).toBe(false)
    const rolled = rollbackState(kernel)
    expect(rolled.stack[0]).toMatchObject({
      id: 'discard-action',
      waiting: 'choice',
    })
    expect(rolled.objects[handId].zone).toBe('hand')
    expect(kernel.history.current().objects[handId].zone).toBe('hand')
    expect(kernel.journal.events).toHaveLength(0)
  })

  test('a typed player target choice is rebuilt after a lobby restart', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [cardTemplate('Queza, Augur of Agonies', { types: ['Creature'] })],
      },
      players: 4,
    }, { random: () => 0.5 })
    const queza = Object.values(server.state.objects)[0]
    const selection: PendingPlayerSelection = {
      id: 'player-selection-1',
      seat: 'p1',
      candidates: ['p2', 'p3', 'p4'],
      min: 1,
      max: 1,
      sourceId: queza.id,
      source: queza.name,
      prompt: 'Choose target opponent for Queza.',
      action: {
        kind: 'putTriggeredAbility',
        abilityId: 'queza.drain',
        triggeringPlayer: 'p1',
        instructions: [
          { kind: 'gainLife', count: 1 },
          { kind: 'loseLifeTargetPlayer', amount: 1 },
        ],
      },
    }
    server.state.players.p1.data[PENDING_PLAYER_SELECTION] = [selection]
    server.state.priority = 'p1'
    const kernel = handleFor(server.rules, server.state)

    const firstLobby = createLobby()
    firstLobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, firstLobby)).toBe(true)
    expect(firstLobby.topdeck).toMatchObject({
      kind: 'target-players',
      cards: ['p2', 'p3', 'p4'],
      kernel: { stage: 'select-players', selectionId: selection.id },
    })

    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, restarted)).toBe(true)
    expect(applyKernelChoice(kernel, restarted, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'p2', destination: 'target' },
        { card: 'p3', destination: 'skip' },
        { card: 'p4', destination: 'skip' },
      ],
    })).toBe(true)
    expect(kernel.journal.events).toContainEqual({
      type: 'selectPlayers',
      selectionId: selection.id,
      seat: 'p1',
      players: ['p2'],
    })
  })
})

describe('extort live choice', () => {
  test('publishes the persisted typed payment and applies the selected mana', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Crypt Ghast', { types: ['Creature'] })],
        },
        hands: {
          p1: [cardTemplate('Test Instant', {
            types: ['Instant'],
            manaCost: '{1}',
          })],
        },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [extort] },
    )
    server.state.players.p1.mana = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 1 }
    const spellId = Object.values(server.state.objects)
      .find((object) => object.name === 'Test Instant')!.id
    const cast = server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellId,
    })
    if (!cast.ok) throw new Error(cast.error)
    const choosing = server.rules(cast.state, { type: 'resolveTop' })
    if (!choosing.ok) throw new Error(choosing.error)
    const kernel = handleFor(server.rules, choosing.state)
    const lobby = createLobby()

    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'extort-payment',
      cards: ['Decline', 'Pay {W}'],
    })

    expect(applyKernelChoice(kernel, lobby, 'p1', {
      type: 'topdeck',
      choices: [
        { card: 'Decline', destination: 'skip' },
        { card: 'Pay {W}', destination: 'target' },
      ],
    })).toBe(true)
    expect(kernel.history.current().players.p1).toMatchObject({
      life: 41,
      mana: { W: 0 },
    })
    expect(kernel.history.current().players.p2.life).toBe(39)
    expect(lobby.topdeck).toBeUndefined()
  })
})
