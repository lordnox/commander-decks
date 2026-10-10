import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { hasKeyword } from '../keywords'
import { legalActsFor } from '../actions'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { ward as wardPlugin } from './ward'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState, Plugin } from '../types'
import { createLobby } from '../../../live-runner/src/lobby'
import {
  applyKernelAct,
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
import { effectsFor, handlerIdsForNames } from './cardRules'
import {
  drawGreatestPower,
  mayCastFromHandWithoutPayingMana,
  onResolve,
} from './effectBuilders'

const ROOT = new URL('../../../', import.meta.url).pathname
const NAMES = JSON.parse(readFileSync(`${ROOT}cards/index.json`, 'utf8')).names as Record<string, string>

type ScryfallCard = {
  name: string
  mana_cost: string
  cmc: number
  type_line: string
  oracle_text: string
  power?: string
  toughness?: string
  colors?: string[]
}

/** The stored Scryfall card, so the tests run the exact printed Oracle text and cost. */
const scryfall = (name: string) =>
  JSON.parse(readFileSync(`${ROOT}cards/${NAMES[name.toLowerCase()]}.json`, 'utf8')) as ScryfallCard

/** A card built from its stored Oracle data; its rules come from the card table by name. */
const real = (name: string, extra: Partial<CardTemplate> = {}): CardTemplate => {
  const card = scryfall(name)
  const [front, back = ''] = card.type_line.split(' — ')
  const words = front.split(' ')
  const supertypes = words.filter((word) => ['Legendary', 'Basic', 'Snow'].includes(word))
  return cardTemplate(card.name, {
    types: words.filter((word) => !supertypes.includes(word)),
    supertypes,
    subtypes: back ? back.split(' ') : [],
    manaCost: card.mana_cost,
    manaValue: card.cmc,
    colors: card.colors ?? [],
    oracleText: card.oracle_text,
    ...(card.power === undefined ? {} : { power: Number(card.power) }),
    ...(card.toughness === undefined ? {} : { toughness: Number(card.toughness) }),
    ...extra,
  })
}

const island = (name = 'Island') => cardTemplate(name, {
  types: ['Land'],
  subtypes: ['Island'],
  supertypes: ['Basic'],
  tapProduces: { U: 1 },
  oracleText: '{T}: Add {U}.',
})

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const names = (state: GameState, ids: string[]) => ids.map((id) => state.objects[id].name)

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

const playLobby = () => {
  const lobby = createLobby()
  lobby.phase = 'play'
  return lobby
}

/** Every seat passes in turn until the top of the stack resolves (or a choice opens). */
const passUntilResolved = (kernel: KernelHandle) => {
  for (let guard = 0; guard < 12; guard += 1) {
    const state = kernel.history.current()
    if (
      state.stack.length === 0
      || state.stack[0].waiting
      || state.resolution?.phase === 'waiting'
      || !state.priority
    ) return state
    const result = kernel.dispatch({ type: 'passPriority', seat: state.priority })
    if (!result.ok) throw new Error(result.error)
  }
  throw new Error('stack did not resolve')
}

const knownPlugins = async (cardNames: string[]) =>
  Promise.all(handlerIdsForNames(cardNames).map(async (id) => {
    const module = await import(`./${id}`) as Record<string, unknown>
    const plugin = Object.values(module).find((value): value is Plugin =>
      typeof value === 'object' && value !== null && (value as Plugin).id === id)
    if (!plugin) throw new Error(`no plugin ${id}`)
    return plugin
  }))

describe('Dig Through Time', () => {
  const TOP = ['Top 1', 'Top 2', 'Top 3', 'Top 4', 'Top 5', 'Top 6', 'Top 7']
  const GRAVE = ['Grave 1', 'Grave 2', 'Grave 3', 'Grave 4', 'Grave 5', 'Grave 6', 'Grave 7']

  const setup = async () => {
    const plugins = await knownPlugins(['Dig Through Time'])
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [real('Dig Through Time'), ...GRAVE.map((name) => cardTemplate(name, { types: ['Sorcery'] }))],
      },
      battlefield: { p1: [island('Island A'), island('Island B'), island('Island C')] },
      libraries: {
        p1: [...TOP, 'Rest A', 'Rest B'].map((name) => cardTemplate(name, { types: ['Sorcery'] })),
        p2: [cardTemplate('Opposing Secret', { types: ['Sorcery'] })],
      },
    }, { random: () => 0.5, cardPlugins: plugins })
    let state = server.state
    for (const name of GRAVE) {
      state = ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to: 'graveyard' }))
    }
    return { server, state, plugins }
  }

  test('is registered with its handler ids', () => {
    expect(handlerIdsForNames(['Dig Through Time']).toSorted()).toEqual(['castCosts', 'onResolve'])
    expect(scryfall('Dig Through Time').oracle_text).toContain('Look at the top seven cards')
  })

  test('a human delves six cards, taps two Islands, and picks two cards through a restart', async () => {
    const { server, state } = await setup()
    const kernel = handleFor(server.rules, state)
    const lobby = playLobby()
    const spell = named(state, 'Dig Through Time')
    const six = GRAVE.slice(0, 6).map((name) => named(state, name).id)

    // Too few delved cards leaves more generic mana than two Islands can pay.
    expect(() => applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'castSpell',
      objectId: spell.id,
      targetObjectIds: six.slice(0, 3),
    })).toThrow()
    expect(kernel.history.current().stack).toHaveLength(0)

    const events = applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'castSpell',
      objectId: spell.id,
      targetObjectIds: six,
    })
    expect(events.map((event) => event.type)).toEqual(['tapForMana', 'tapForMana', 'castSpell'])
    const cast = kernel.history.current()
    expect(six.every((id) => cast.objects[id].zone === 'exile')).toBe(true)
    expect(cast.objects[named(state, 'Grave 7').id].zone).toBe('graveyard')
    expect(['Island A', 'Island B', 'Island C'].filter((name) => named(cast, name).tapped))
      .toHaveLength(2)
    expect(cast.stack[0]).toMatchObject({ kind: 'spell', name: 'Dig Through Time' })

    const looking = passUntilResolved(kernel)
    const selection = pendingSelectionFor(looking, 'p1')!
    expect(names(looking, selection.candidates)).toEqual(TOP)
    expect(selection).toMatchObject({ kind: 'scry', count: 7, handQuota: 2 })
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'look-top',
      cards: TOP,
      destinations: ['bottom', 'hand'],
      requirements: { hand: { min: 2, max: 2 } },
    })

    const restartedKernel = handleFor(server.rules, state, kernel.journal)
    expect(restartedKernel.history.current()).toEqual(kernel.history.current())
    const restarted = playLobby()
    expect(prepareKernelPendingChoice(restartedKernel, restarted)).toBe(true)
    expect(restarted.topdeck?.cards).toEqual(TOP)

    const answer = (hand: string[]) => ({
      type: 'topdeck' as const,
      choices: TOP.toReversed().map((card) => ({
        card,
        slot: TOP.indexOf(card),
        destination: (hand.includes(card) ? 'hand' : 'bottom') as 'hand' | 'bottom',
      })),
    })
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', answer(['Top 1']))).toThrow()
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', answer(['Top 1', 'Top 2', 'Top 3'])))
      .toThrow()
    expect(pendingSelectionFor(restartedKernel.history.current(), 'p1')).toBeDefined()
    // Another seat cannot answer for the chooser.
    expect(applyKernelChoice(restartedKernel, restarted, 'p2', answer(['Top 3', 'Top 6']))).toBe(false)

    expect(applyKernelChoice(restartedKernel, restarted, 'p1', answer(['Top 3', 'Top 6']))).toBe(true)
    const done = restartedKernel.history.current()
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(names(done, done.zoneOrder.p1.hand).toSorted()).toEqual(['Top 3', 'Top 6'])
    // The rest go to the bottom in the order the human assigned them (7 to 1).
    expect(names(done, done.zoneOrder.p1.library)).toEqual([
      'Rest A', 'Rest B', 'Top 7', 'Top 5', 'Top 4', 'Top 2', 'Top 1',
    ])
    expect(named(done, 'Dig Through Time').zone).toBe('graveyard')
    expect(done.stack).toHaveLength(0)
  })

  test('only the caster sees the seven cards, and the opponent never learns the picks', async () => {
    const { server, state } = await setup()
    const ready = structuredClone(state)
    ready.players.p1.mana.U = 2
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Dig Through Time').id,
      delve: GRAVE.slice(0, 6).map((name) => named(ready, name).id),
    }))
    const looking = ok(server.rules(cast, { type: 'resolveTop' }))
    const opponent = JSON.stringify(projectForViewer(looking, 'p2'))
    for (const name of [...TOP, 'Rest A']) expect(opponent).not.toContain(name)
    expect(pendingSelectionFor(projectForViewer(looking, 'p2'), 'p1')).toBeUndefined()
    expect(TOP.every((name) =>
      Object.values(projectForViewer(looking, 'p1').objects).some((object) => object.name === name)))
      .toBe(true)
  })

  test('delve is capped at the generic cost and cannot pay the blue mana', async () => {
    const { server, state } = await setup()
    const spell = named(state, 'Dig Through Time').id
    const seven = GRAVE.map((name) => named(state, name).id)
    const withMana = structuredClone(state)
    withMana.players.p1.mana.U = 2
    withMana.players.p1.mana.C = 1
    expect(server.rules(withMana, { type: 'castSpell', seat: 'p1', objectId: spell, delve: seven }))
      .toMatchObject({ ok: false, error: 'delve exceeds the generic mana cost' })
    const dry = structuredClone(state)
    expect(server.rules(dry, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      delve: seven.slice(0, 6),
    })).toMatchObject({ ok: false, error: 'not enough mana' })
  })
})

const handOf = (state: GameState, seat = 'p1') =>
  state.zoneOrder[seat].hand.map((id) => state.objects[id].name)

const filler = (prefix: string, count: number, types = ['Sorcery'], manaValue?: number) =>
  Array.from({ length: count }, (_, index) => cardTemplate(`${prefix} ${index + 1}`, {
    types,
    ...(manaValue === undefined ? {} : { manaCost: `{${manaValue}}`, manaValue }),
  }))

const costed = (name: string, types: string[], manaValue: number, extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, manaCost: `{${manaValue}}`, manaValue, ...extra })

const playerBallot = (targets: string[]) => ({
  type: 'topdeck' as const,
  choices: ['p2', 'p3'].map((card, slot) => ({
    card,
    slot,
    destination: (targets.includes(card) ? 'target' : 'skip') as 'target' | 'skip',
  })),
})

const mainPhase = (state: GameState, seat = 'p1') => {
  const ready = structuredClone(state)
  ready.active = seat
  ready.priority = seat
  ready.step = 'precombatMain'
  return ready
}

const pool = (state: GameState, mana: Partial<GameState['players'][string]['mana']>, seat = 'p1') => {
  Object.assign(state.players[seat].mana, mana)
  return state
}

const advanceTo = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  step: GameState['step'],
) => {
  let current = state
  for (let guard = 0; guard < 24 && current.step !== step; guard += 1) {
    current = resolveStack(server.rules, ok(server.rules(current, { type: 'advanceStep' })))
  }
  return current
}

const creature = (name: string, extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

describe('Kederekt Leviathan', () => {
  const board = (): Pick<Parameters<typeof createServerGame>[1] & object, 'battlefield'> => ({
    battlefield: {
      p1: [
        island('Own Island'),
        creature('Own Bear'),
        cardTemplate('Own Relic', { types: ['Artifact'] }),
      ],
      p2: [
        cardTemplate('Their Forest', { types: ['Land'], subtypes: ['Forest'] }),
        creature('Their Bear'),
        cardTemplate('Their Banner', { types: ['Enchantment'] }),
      ],
    },
  })

  const setup = async (extra: Parameters<typeof createServerGame>[1] = {}) => {
    const plugins = await knownPlugins(['Kederekt Leviathan'])
    const server = createServerGame(commanderRules, {
      players: 2,
      ...board(),
      ...extra,
    }, { random: () => 0.5, cardPlugins: plugins })
    return { server, state: server.state }
  }

  test('is registered with unearth and its handler ids', () => {
    expect(handlerIdsForNames(['Kederekt Leviathan']).toSorted()).toEqual(['activated', 'unearth'])
    expect(real('Kederekt Leviathan')).toMatchObject({ manaCost: '{6}{U}{U}', power: 5, toughness: 5 })
  })

  test('entering returns every other nonland permanent to its owner', async () => {
    const { server } = await setup({
      hands: { p1: [real('Kederekt Leviathan')] },
      battlefield: {
        ...board().battlefield,
        p2: [...board().battlefield!.p2!, creature('Borrowed Ox', { owner: 'p1' } as Partial<CardTemplate>)],
      },
    })
    let state = mainPhase(server.state)
    // A permanent p2 controls but p1 owns returns to p1's hand.
    const ox = named(state, 'Borrowed Ox')
    ox.owner = 'p1'
    ox.controller = 'p2'
    state = pool(state, { U: 2, C: 6 })
    state = resolveStack(server.rules, ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Kederekt Leviathan').id,
    })))

    expect(named(state, 'Kederekt Leviathan')).toMatchObject({ zone: 'battlefield', controller: 'p1' })
    for (const name of ['Own Island', 'Their Forest']) expect(named(state, name).zone).toBe('battlefield')
    for (const name of ['Own Bear', 'Own Relic']) {
      expect(named(state, name).zone).toBe('hand')
      expect(named(state, name).owner).toBe('p1')
    }
    for (const name of ['Their Bear', 'Their Banner']) {
      expect(named(state, name)).toMatchObject({ zone: 'hand', owner: 'p2' })
    }
    expect(named(state, 'Borrowed Ox')).toMatchObject({ zone: 'hand', owner: 'p1' })
    expect(state.zoneOrder.p1.hand.map((id) => state.objects[id].name)).toContain('Borrowed Ox')
    expect(state.stack).toHaveLength(0)
  })

  test('unearth returns it with haste, bounces again, and exiles it at the next end step', async () => {
    const { server } = await setup({ libraries: { p1: [real('Kederekt Leviathan')] } })
    let state = mainPhase(server.state)
    const leviathan = named(state, 'Kederekt Leviathan')
    state = ok(server.rules(state, { type: 'move', objectId: leviathan.id, to: 'graveyard' }))
    state = pool(state, { U: 1, C: 6 })

    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: leviathan.id,
      abilityId: 'unearth',
    }))
    expect(state.stack[0]).toMatchObject({ kind: 'ability', abilityId: 'unearth' })
    expect(state.players.p1.mana).toMatchObject({ U: 0, C: 0 })
    state = resolveStack(server.rules, state)

    expect(state.objects[leviathan.id]).toMatchObject({ zone: 'battlefield', summoningSickness: true })
    expect(hasKeyword(state.objects[leviathan.id], 'haste', state)).toBe(true)
    for (const name of ['Own Bear', 'Own Relic', 'Their Bear', 'Their Banner']) {
      expect(named(state, name).zone).toBe('hand')
    }
    expect(named(state, 'Their Forest').zone).toBe('battlefield')

    const ending = advanceTo(server, state, 'end')
    expect(ending.objects[leviathan.id].zone).toBe('exile')
    expect(ending.delayedTriggers).toHaveLength(0)
  })

  test('unearth is sorcery speed, needs {6}{U}, and leaving replaces to exile', async () => {
    const { server } = await setup({ libraries: { p1: [real('Kederekt Leviathan')] } })
    let state = mainPhase(server.state)
    const leviathan = named(state, 'Kederekt Leviathan')
    state = ok(server.rules(state, { type: 'move', objectId: leviathan.id, to: 'graveyard' }))
    const activate = (current: GameState) => server.rules(current, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: leviathan.id,
      abilityId: 'unearth',
    })

    expect(activate(pool(structuredClone(state), { U: 0, C: 7 })).ok).toBe(false)
    expect(activate(pool(structuredClone(state), { U: 1, C: 5 })).ok).toBe(false)
    const theirTurn = pool(structuredClone(state), { U: 1, C: 6 })
    theirTurn.active = 'p2'
    expect(activate(theirTurn).ok).toBe(false)

    const unearthed = resolveStack(server.rules, ok(activate(pool(structuredClone(state), { U: 1, C: 6 }))))
    expect(unearthed.objects[leviathan.id].zone).toBe('battlefield')
    for (const to of ['hand', 'graveyard', 'library'] as const) {
      const gone = ok(server.rules(unearthed, { type: 'move', objectId: leviathan.id, to }))
      expect(gone.objects[leviathan.id].zone).toBe('exile')
    }
  })
})

/** Advance steps (resolving whatever trigger lands) until `stop` holds or a choice opens. */
const advanceUntil = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  stop: (state: GameState) => boolean,
) => {
  let current = state
  for (let guard = 0; guard < 80 && !stop(current); guard += 1) {
    const choosing = current.playerOrder.some((seat) =>
      pendingSelectionFor(current, seat) || pendingPlayerSelectionFor(current, seat))
    if (choosing) break
    current = resolveStack(server.rules, ok(server.rules(current, { type: 'advanceStep' })))
  }
  return current
}

/** The kernel choice for chapter III, answered by offered position with exactly the picked cards as targets. */
const stealAnswer = (cards: string[], picked: string[]) => ({
  type: 'topdeck' as const,
  choices: cards.map((card, slot) => ({
    card,
    slot,
    destination: (picked.includes(card) ? 'target' : 'skip') as 'target' | 'skip',
  })),
})

describe('Kiora Bests the Sea God', () => {
  const permanents = () => ({
    p1: [island('Own Island')],
    p2: [
      creature('Foe Alpha'),
      creature('Foe Beta'),
      cardTemplate('Foe Relic', { types: ['Artifact'] }),
      cardTemplate('Foe Forest', { types: ['Land'], subtypes: ['Forest'], tapProduces: { G: 1 } }),
    ],
    p3: [
      creature('Bystander'),
      creature('Shrouded Mage', { oracleText: 'Hexproof' }),
    ],
  })

  const setup = async (lore?: number) => {
    const plugins = await knownPlugins(['Kiora Bests the Sea God'])
    const kiora = real('Kiora Bests the Sea God', lore === undefined ? {} : { counters: { lore } })
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: lore === undefined ? { p1: [kiora] } : {},
      battlefield: { ...permanents(), ...(lore === undefined ? {} : { p1: [island('Own Island'), kiora] }) },
      libraries: { p1: filler('A', 12), p2: filler('B', 12), p3: filler('C', 12) },
    }, { random: () => 0.5, cardPlugins: plugins })
    return { server, state: server.state }
  }

  const intoNextChapter = (kernel: KernelHandle, state: GameState) => {
    const result = kernel.dispatch({
      type: 'putCounters',
      objectId: named(state, 'Kiora Bests the Sea God').id,
      counter: 'lore',
      count: 1,
    })
    if (!result.ok) throw new Error(result.error)
  }

  test('is registered as a saga with its three chapters', () => {
    expect(scryfall('Kiora Bests the Sea God').oracle_text).toContain('Gain control of target permanent an opponent controls. Untap it.')
    const [saga] = effectsFor('Kiora Bests the Sea God')
    expect(saga).toMatchObject({ op: 'saga' })
    expect((saga as { chapters: Array<{ numbers: number[] }> }).chapters.map((chapter) => chapter.numbers))
      .toEqual([[1], [2], [3]])
    expect(real('Kiora Bests the Sea God')).toMatchObject({
      manaCost: '{5}{U}{U}',
      types: ['Enchantment'],
      subtypes: ['Saga'],
    })
  })

  test('chapter II survives a host restart, refuses bad answers, and hides the choice from others', async () => {
    const { server, state } = await setup(1)
    const kernel = handleFor(server.rules, state)
    intoNextChapter(kernel, state)
    const lobby = playLobby()
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({ seat: 'p1', kind: 'target-players', cards: ['p2', 'p3'] })
    const open = kernel.history.current()
    expect(projectForViewer(open, 'p2').players.p1.data['kernel.pendingPlayerSelection']).toBeUndefined()
    expect(kernel.dispatch({ type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    const restartedKernel = handleFor(server.rules, state, kernel.journal)
    const restarted = playLobby()
    expect(prepareKernelPendingChoice(restartedKernel, restarted)).toBe(true)
    expect(restarted.topdeck).toEqual(lobby.topdeck)

    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', playerBallot([]))).toThrow()
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', playerBallot(['p2', 'p3']))).toThrow()
    expect(applyKernelChoice(restartedKernel, restarted, 'p2', playerBallot(['p3']))).toBe(false)
    expect(pendingPlayerSelectionFor(restartedKernel.history.current(), 'p1')).toBeDefined()

    expect(applyKernelChoice(restartedKernel, restarted, 'p1', playerBallot(['p3']))).toBe(true)
    const done = passUntilResolved(restartedKernel)
    expect(pendingPlayerSelectionFor(done, 'p1')).toBeUndefined()
    expect(named(done, 'Bystander').tapped).toBe(true)
    expect(named(done, 'Shrouded Mage')).toMatchObject({ tapped: true, skipNextUntap: true })
    expect(named(done, 'Foe Alpha').tapped).toBe(false)
  })

  /** Answer the open chapter III choice with the engine, leaving the chapter ability on the stack. */
  const chooseSteal = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    name: string,
  ) => {
    const stacked = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(state, name).id],
    }))
    expect(stacked.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Kiora Bests the Sea God',
      payload: { sagaChapter: 3 },
    })
    expect(stacked.stack[0].payload?.targetFilter).toMatchObject({ controller: 'opponent' })
    return structuredClone(stacked)
  }

  test('chapter III with several qualifying permanents offers exactly one target pick, live and across a restart', async () => {
    const { server, state } = await setup(2)
    const kernel = handleFor(server.rules, state)
    intoNextChapter(kernel, state)
    const lobby = playLobby()
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    // Hexproof Shrouded Mage and the saga controller's own Island are not legal targets.
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose',
      cards: ['Foe Alpha', 'Foe Beta', 'Foe Relic', 'Foe Forest', 'Bystander'],
      destinations: ['skip', 'target'],
      requirements: { target: { min: 1, max: 1 } },
    })
    const cards = lobby.topdeck!.cards as string[]
    const open = kernel.history.current()
    expect(kernel.dispatch({ type: 'passPriority', seat: 'p1' }).ok).toBe(false)
    // The Saga waits for its chapter ability, so it is not sacrificed while the choice is open.
    expect(named(open, 'Kiora Bests the Sea God').zone).toBe('battlefield')

    const restartedKernel = handleFor(server.rules, state, kernel.journal)
    const restarted = playLobby()
    expect(prepareKernelPendingChoice(restartedKernel, restarted)).toBe(true)
    expect(restarted.topdeck).toEqual(lobby.topdeck)

    // Every card defaulting to the target destination, none, or two cards are all refused.
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', stealAnswer(cards, cards)))
      .toThrow('Choose exactly 1 card(s).')
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', stealAnswer(cards, [])))
      .toThrow('Choose exactly 1 card(s).')
    expect(() => applyKernelChoice(restartedKernel, restarted, 'p1', stealAnswer(cards, ['Foe Alpha', 'Foe Beta'])))
      .toThrow('Choose exactly 1 card(s).')
    expect(applyKernelChoice(restartedKernel, restarted, 'p2', stealAnswer(cards, ['Foe Alpha']))).toBe(false)
    expect(pendingSelectionFor(restartedKernel.history.current(), 'p1')).toBeDefined()

    expect(applyKernelChoice(restartedKernel, restarted, 'p1', stealAnswer(cards, ['Foe Relic']))).toBe(true)
    // The live host settles the stack once nobody can respond, so the chapter ability has resolved.
    const done = passUntilResolved(restartedKernel)
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(done.stack).toHaveLength(0)
    expect(named(done, 'Foe Relic')).toMatchObject({ controller: 'p1', owner: 'p2', zone: 'battlefield' })
    for (const name of ['Foe Alpha', 'Foe Beta', 'Foe Forest', 'Bystander']) {
      expect(named(done, name).controller).not.toBe('p1')
    }
    // Only after the chapter ability resolved is the Saga sacrificed (CR 714.4).
    expect(named(done, 'Kiora Bests the Sea God').zone).toBe('graveyard')
  })

  test('chapter III cannot be answered with a permanent that is not a candidate', async () => {
    const { server, state } = await setup(2)
    const kernel = handleFor(server.rules, state)
    intoNextChapter(kernel, state)
    const selection = pendingSelectionFor(kernel.history.current(), 'p1')!
    for (const name of ['Shrouded Mage', 'Own Island']) {
      const objectId = named(state, name).id
      expect(selection.candidates).not.toContain(objectId)
      expect(kernel.dispatch({
        type: 'selectCards',
        seat: 'p1',
        kind: 'choose',
        count: 1,
        objectIds: [objectId],
      }).ok).toBe(false)
    }
    expect(pendingSelectionFor(kernel.history.current(), 'p1')).toBeDefined()
  })

  test('chapter III with a single legal permanent still takes it, and sacrifices the Saga when none qualifies', async () => {
    const { server, state } = await setup(2)
    const lone = structuredClone(state)
    for (const name of ['Foe Alpha', 'Foe Beta', 'Foe Forest', 'Bystander']) {
      delete lone.objects[named(lone, name).id]
    }
    for (const seat of ['p2', 'p3']) {
      lone.zoneOrder[seat].battlefield = lone.zoneOrder[seat].battlefield.filter((id) => lone.objects[id])
    }
    const kernel = handleFor(server.rules, lone)
    intoNextChapter(kernel, lone)
    const lobby = playLobby()
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({ kind: 'choose', cards: ['Foe Relic'] })
    expect(applyKernelChoice(kernel, lobby, 'p1', stealAnswer(['Foe Relic'], ['Foe Relic']))).toBe(true)
    const done = passUntilResolved(kernel)
    expect(named(done, 'Foe Relic').controller).toBe('p1')
    expect(named(done, 'Kiora Bests the Sea God').zone).toBe('graveyard')

    // Nothing but hexproof and own permanents left: no choice opens and the Saga is just sacrificed.
    const none = structuredClone(lone)
    delete none.objects[named(none, 'Foe Relic').id]
    none.zoneOrder.p2.battlefield = none.zoneOrder.p2.battlefield.filter((id) => none.objects[id])
    const emptyKernel = handleFor(server.rules, none)
    intoNextChapter(emptyKernel, none)
    const emptied = resolveStack(server.rules, emptyKernel.history.current())
    expect(pendingSelectionFor(emptied, 'p1')).toBeUndefined()
    expect(emptied.stack).toHaveLength(0)
    expect(named(emptied, 'Kiora Bests the Sea God').zone).toBe('graveyard')
  })

  test('a chapter III target that gains hexproof in response is not stolen, and the Saga is still sacrificed', async () => {
    const { server, state } = await setup(2)
    const kernel = handleFor(server.rules, state)
    intoNextChapter(kernel, state)
    const stacked = chooseSteal(server, kernel.history.current(), 'Foe Alpha')
    expect(named(stacked, 'Kiora Bests the Sea God').zone).toBe('battlefield')
    named(stacked, 'Foe Alpha').oracleText = 'Hexproof'
    const done = resolveStack(server.rules, stacked)
    expect(named(done, 'Foe Alpha')).toMatchObject({ controller: 'p2', zone: 'battlefield' })
    expect(named(done, 'Kiora Bests the Sea God').zone).toBe('graveyard')
  })

  test('a chapter III target that left the battlefield in response fizzles and nothing is stolen', async () => {
    const { server, state } = await setup(2)
    const kernel = handleFor(server.rules, state)
    intoNextChapter(kernel, state)
    const stacked = chooseSteal(server, kernel.history.current(), 'Foe Beta')
    const gone = ok(server.rules(stacked, { type: 'move', objectId: named(stacked, 'Foe Beta').id, to: 'graveyard' }))
    const done = resolveStack(server.rules, gone)
    expect(named(done, 'Foe Beta')).toMatchObject({ zone: 'graveyard', controller: 'p2' })
    expect(Object.values(done.objects)
      .filter((object) => object.controller === 'p1' && object.zone === 'battlefield')
      .map((object) => object.name)).toEqual(['Own Island'])
    expect(named(done, 'Kiora Bests the Sea God').zone).toBe('graveyard')
  })

  test('the Kraken is a token, so it ceases to exist rather than reaching a graveyard (CR 704.5d)', async () => {
    const { server, state } = await setup()
    let current = pool(mainPhase(state), { U: 2, C: 5 })
    current = resolveStack(server.rules, ok(server.rules(current, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(current, 'Kiora Bests the Sea God').id,
    })))
    const krakenId = named(current, 'Kraken').id
    const dead = resolveStack(server.rules, ok(server.rules(current, { type: 'move', objectId: krakenId, to: 'graveyard' })))
    expect(dead.objects[krakenId]).toBeUndefined()
    for (const zone of ['battlefield', 'graveyard', 'exile', 'hand', 'library'] as const) {
      expect(dead.zoneOrder.p1[zone]).not.toContain(krakenId)
    }
    // Chapter III can still take a permanent without the Kraken, and the Saga is unaffected by its death.
    expect(named(dead, 'Kiora Bests the Sea God').zone).toBe('battlefield')
  })

  test('GAP: ward is not enforced when a chapter ability targets a warded permanent', async () => {
    // The ward plugin only reacts to cast spells and activated abilities, so a chapter
    // ability that targets a Ward permanent takes it without the ward cost being asked.
    const wardedGame = createServerGame(commanderRules, {
      players: 3,
      battlefield: {
        p1: [real('Kiora Bests the Sea God', { counters: { lore: 2 } })],
        p2: [creature('Warded Foe', { oracleText: 'Ward {5}' })],
      },
      libraries: { p1: filler('A', 12), p2: filler('B', 12), p3: filler('C', 12) },
    }, { random: () => 0.5, cardPlugins: [...await knownPlugins(['Kiora Bests the Sea God']), wardPlugin] })
    const kernel = handleFor(wardedGame.rules, wardedGame.state)
    intoNextChapter(kernel, wardedGame.state)
    const stacked = chooseSteal(wardedGame, kernel.history.current(), 'Warded Foe')
    const done = resolveStack(wardedGame.rules, stacked)
    expect(named(done, 'Warded Foe').controller).toBe('p1')
  })

  test('casting it makes an 8/8 blue hexproof Kraken, then chapters II and III follow on later turns', async () => {
    const { server, state } = await setup()
    let current = pool(mainPhase(state), { U: 2, C: 5 })
    current = resolveStack(server.rules, ok(server.rules(current, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(current, 'Kiora Bests the Sea God').id,
    })))

    const saga = named(current, 'Kiora Bests the Sea God')
    expect(saga).toMatchObject({ zone: 'battlefield', counters: { lore: 1 } })
    const kraken = named(current, 'Kraken')
    expect(kraken).toMatchObject({
      zone: 'battlefield',
      controller: 'p1',
      token: true,
      power: 8,
      toughness: 8,
      colors: ['U'],
      types: ['Creature'],
      subtypes: ['Kraken'],
    })
    expect(hasKeyword(kraken, 'hexproof', current)).toBe(true)

    // Chapter II on p1's next turn: choose an opponent, then they are tapped down.
    const tapDown = advanceUntil(server, current, (next) =>
      pendingPlayerSelectionFor(next, 'p1') !== undefined)
    const selection = pendingPlayerSelectionFor(tapDown, 'p1')!
    expect(tapDown.active).toBe('p1')
    expect(tapDown.objects[saga.id].counters.lore).toBe(2)
    expect(selection.candidates).toEqual(['p2', 'p3'])
    const afterII = resolveStack(server.rules, ok(server.rules(tapDown, {
      type: 'selectPlayers',
      selectionId: selection.id,
      seat: 'p1',
      players: ['p2'],
    })))
    for (const name of ['Foe Alpha', 'Foe Beta', 'Foe Relic']) {
      expect(named(afterII, name)).toMatchObject({ tapped: true, skipNextUntap: true })
    }
    expect(named(afterII, 'Foe Forest').tapped).toBe(false)
    for (const name of ['Bystander', 'Shrouded Mage', 'Kraken']) expect(named(afterII, name).tapped).toBe(false)

    // They skip exactly one untap step.
    const firstUntap = advanceUntil(server, afterII, (next) => next.active === 'p2' && next.step === 'upkeep')
    for (const name of ['Foe Alpha', 'Foe Beta', 'Foe Relic']) {
      expect(named(firstUntap, name).tapped).toBe(true)
    }
    // Chapter III on p1's next turn: steal a permanent and untap it.
    const stealing = advanceUntil(server, firstUntap, (next) =>
      pendingSelectionFor(next, 'p1') !== undefined)
    expect(stealing.objects[saga.id].counters.lore).toBe(3)
    const pick = pendingSelectionFor(stealing, 'p1')!
    expect(names(stealing, pick.candidates).toSorted()).toEqual([
      'Bystander', 'Foe Alpha', 'Foe Beta', 'Foe Forest', 'Foe Relic',
    ])
    const tappedForest = structuredClone(stealing)
    named(tappedForest, 'Foe Forest').tapped = true
    const done = resolveStack(server.rules, ok(server.rules(tappedForest, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(tappedForest, 'Foe Forest').id],
    })))
    expect(named(done, 'Foe Forest')).toMatchObject({ controller: 'p1', owner: 'p2', tapped: false })
    expect(done.objects[saga.id].zone).toBe('graveyard')
    expect(named(done, 'Kraken').zone).toBe('battlefield')

    // The skipped untap was used up: p2's next untap step untaps what they still control.
    const nextUntap = advanceUntil(server, done, (next) => next.active === 'p2' && next.step === 'upkeep')
    expect(nextUntap.turn).toBeGreaterThan(done.turn)
    for (const name of ['Foe Alpha', 'Foe Beta', 'Foe Relic']) {
      expect(named(nextUntap, name).tapped).toBe(false)
    }
  })
})

describe('Nezahal, Primal Tide', () => {
  const HELD = ['Held 1', 'Held 2', 'Held 3', 'Held 4', 'Held 5']
  const setup = async (onBattlefield = true) => {
    const plugins = await knownPlugins(['Nezahal, Primal Tide', 'Counterspell'])
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: {
        p1: [
          ...HELD.map((name) => cardTemplate(name, { types: ['Sorcery'] })),
          ...(onBattlefield ? [] : [real('Nezahal, Primal Tide')]),
        ],
        p2: [
          costed('Opp Trick', ['Instant'], 0),
          costed('Opp Bear', ['Creature'], 0),
          cardTemplate('Counterspell', { types: ['Instant'], manaCost: '{U}{U}', manaValue: 2 }),
        ],
        p3: [costed('P3 Trick', ['Instant'], 0)],
      },
      battlefield: { p1: onBattlefield ? [real('Nezahal, Primal Tide')] : [] },
      libraries: { p1: filler('Lib', 6), p2: filler('Opp Lib', 3), p3: filler('P3 Lib', 3) },
    }, { random: () => 0.5, cardPlugins: plugins })
    return { server, state: server.state }
  }

  const castBy = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    seat: string,
    name: string,
    extra: Partial<Extract<GameEvent, { type: 'castSpell' }>> = {},
  ) => {
    const next = structuredClone(state)
    next.priority = seat
    return ok(server.rules(next, { type: 'castSpell', seat, objectId: named(next, name).id, ...extra }))
  }

  const toHand = (state: GameState, name: string) => {
    const card = named(state, name)
    state.zoneOrder.p1[card.zone] = state.zoneOrder.p1[card.zone].filter((id) => id !== card.id)
    state.zoneCounts.p1[card.zone] -= 1
    state.zoneOrder.p1.hand.push(card.id)
    state.zoneCounts.p1.hand += 1
    card.zone = 'hand'
  }

  test('is registered with its handler ids and static grant', () => {
    expect(handlerIdsForNames(['Nezahal, Primal Tide']).toSorted())
      .toEqual(['activated', 'blink', 'castTriggers', 'noMaxHand'])
    expect(effectsFor('Nezahal, Primal Tide')).toContainEqual({ op: 'spellTrait', uncounterable: true })
    expect(real('Nezahal, Primal Tide')).toMatchObject({
      manaCost: '{5}{U}{U}',
      supertypes: ['Legendary'],
      subtypes: ['Elder', 'Dinosaur'],
      power: 7,
      toughness: 7,
    })
  })

  test('the spell cannot be countered', async () => {
    const { server, state } = await setup(false)
    let current = pool(mainPhase(state), { U: 2, C: 5 })
    current = castBy(server, current, 'p1', 'Nezahal, Primal Tide')
    expect(current.stack[0]).toMatchObject({ kind: 'spell', name: 'Nezahal, Primal Tide', uncounterable: true })
    pool(current, { U: 2 }, 'p2')
    current = castBy(server, current, 'p2', 'Counterspell', {
      targets: [{ kind: 'object', objectId: named(current, 'Nezahal, Primal Tide').id }],
    })
    current = resolveStack(server.rules, current)
    expect(named(current, 'Nezahal, Primal Tide')).toMatchObject({ zone: 'battlefield', controller: 'p1' })
    expect(named(current, 'Counterspell').zone).toBe('graveyard')
  })

  test('an opponent casting a noncreature spell draws you a card; creatures and your own spells do not', async () => {
    const { server, state } = await setup()
    let current = castBy(server, mainPhase(state, 'p2'), 'p2', 'Opp Bear')
    current = resolveStack(server.rules, current)
    expect(handOf(current)).toEqual(HELD)

    current = castBy(server, current, 'p2', 'Opp Trick')
    current = resolveStack(server.rules, current)
    expect(handOf(current)).toEqual([...HELD, 'Lib 1'])
    expect(handOf(current, 'p2')).not.toContain('Lib 1')

    current = castBy(server, current, 'p3', 'P3 Trick')
    current = resolveStack(server.rules, current)
    expect(handOf(current)).toEqual([...HELD, 'Lib 1', 'Lib 2'])

    // Casting your own noncreature spell does not trigger it.
    const own = structuredClone(current)
    own.players.p1.mana.C = 0
    toHand(own, 'Lib 3')
    const sorcery = named(own, 'Lib 3')
    sorcery.manaCost = '{0}'
    sorcery.manaValue = 0
    const before = handOf(own).length
    const cast = resolveStack(server.rules, castBy(server, mainPhase(own), 'p1', 'Lib 3'))
    expect(handOf(cast).length).toBe(before - 1)
  })

  test('you have no maximum hand size while it is on the battlefield', async () => {
    const { server, state } = await setup()
    const big = structuredClone(state)
    for (const name of ['Lib 1', 'Lib 2', 'Lib 3', 'Lib 4']) toHand(big, name)
    // Refresh the static grant the way a battlefield change would.
    const nezahal = named(big, 'Nezahal, Primal Tide')
    const entered = ok(server.rules(
      ok(server.rules(big, { type: 'move', objectId: nezahal.id, to: 'hand' })),
      { type: 'move', objectId: nezahal.id, to: 'battlefield' },
    ))
    expect(entered.players.p1.data.maximumHandSize).toBeNull()
    const cleanup = { ...entered, step: 'cleanup' as const, active: 'p1', priority: 'p1' }
    expect(ok(server.rules(cleanup, { type: 'advanceStep' })).step).toBe('untap')

    const gone = ok(server.rules(entered, { type: 'move', objectId: nezahal.id, to: 'graveyard' }))
    expect(gone.players.p1.data.maximumHandSize).toBeUndefined()
    expect(server.rules({ ...gone, step: 'cleanup' as const, active: 'p1', priority: 'p1' }, { type: 'advanceStep' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('must discard 2') })
  })

  test('discarding three cards exiles it and returns it tapped at the next end step, through a live act', async () => {
    const { server, state } = await setup()
    const ready = mainPhase(state)
    const nezahal = named(ready, 'Nezahal, Primal Tide')
    const kernel = handleFor(server.rules, ready)
    const lobby = playLobby()
    const picks = ['Held 1', 'Held 3', 'Held 5'].map((name) => named(ready, name).id)
    const act = (targetObjectIds: string[]) => applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'activateAbility',
      objectId: nezahal.id,
      abilityId: 'nezahal.reset',
      text: 'nezahal.reset',
      targetObjectIds,
    })

    expect(() => act(picks.slice(0, 2))).toThrow()
    expect(() => act([...picks.slice(0, 2), named(ready, 'Lib 1').id])).toThrow()
    expect(() => act([picks[0], picks[0], picks[1]])).toThrow()
    expect(kernel.history.current().stack).toHaveLength(0)
    expect(act(picks)).toHaveLength(1)

    const cost = kernel.history.current()
    expect(picks.every((id) => cost.objects[id].zone === 'graveyard')).toBe(true)
    expect(handOf(cost).toSorted()).toEqual(['Held 2', 'Held 4'])
    expect(cost.stack[0]).toMatchObject({ kind: 'ability', abilityId: 'nezahal.reset' })
    expect(cost.objects[nezahal.id].zone).toBe('battlefield')

    const exiled = passUntilResolved(kernel)
    expect(exiled.objects[nezahal.id].zone).toBe('exile')
    expect(exiled.delayedTriggers).toHaveLength(1)

    // A restart mid-turn keeps the pending return.
    const restarted = handleFor(server.rules, ready, kernel.journal).history.current()
    expect(restarted.delayedTriggers).toHaveLength(1)
    const back = advanceUntil(server, restarted, (next) => next.step === 'end' && next.stack.length === 0)
    expect(back.objects[nezahal.id]).toMatchObject({ zone: 'battlefield', tapped: true, controller: 'p1', owner: 'p1' })
    expect(back.delayedTriggers).toHaveLength(0)
  })

  test('the discard ability is not offered with fewer than three cards in hand', async () => {
    const { server, state } = await setup()
    const poor = mainPhase(state)
    for (const name of ['Held 1', 'Held 2', 'Held 3']) {
      const card = named(poor, name)
      poor.zoneOrder.p1.hand = poor.zoneOrder.p1.hand.filter((id) => id !== card.id)
      poor.zoneCounts.p1.hand -= 1
      poor.zoneOrder.p1.graveyard.push(card.id)
      poor.zoneCounts.p1.graveyard += 1
      card.zone = 'graveyard'
    }
    expect(legalActsFor(poor, 'p1').some((action) =>
      action.kind === 'activateAbility' && action.abilityId === 'nezahal.reset')).toBe(false)
    expect(server.rules(poor, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: named(poor, 'Nezahal, Primal Tide').id,
      abilityId: 'nezahal.reset',
      choices: [named(poor, 'Held 4').id, named(poor, 'Held 5').id],
    }).ok).toBe(false)
  })
})

describe('Phyrexian Ingester', () => {
  const setup = async () => {
    const plugins = await knownPlugins(['Phyrexian Ingester'])
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: { p1: [real('Phyrexian Ingester')] },
      battlefield: {
        p1: [
          creature('Own Bear', { power: 2, toughness: 2 }),
        ],
        p2: [
          creature('Big Foe', { power: 4, toughness: 6 }),
          creature('Foe Token', { token: true, power: 9, toughness: 9 }),
          cardTemplate('Foe Relic', { types: ['Artifact'] }),
        ],
        p3: [creature('Shrouded Foe', { oracleText: 'Hexproof', power: 5, toughness: 5 })],
      },
    }, { random: () => 0.5, cardPlugins: plugins })
    return { server, state: server.state }
  }

  const cast = (server: ReturnType<typeof createServerGame>, state: GameState) => {
    const ready = pool(mainPhase(state), { U: 1, C: 6 })
    return ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Phyrexian Ingester').id,
    }))
  }

  const choose = (state: GameState, ...picked: string[]): Extract<GameEvent, { type: 'selectCards' }> => ({
    type: 'selectCards',
    seat: 'p1',
    kind: 'choose',
    count: 1,
    objectIds: picked.map((name) => named(state, name).id),
  })

  const entering = async () => {
    const { server, state } = await setup()
    return { server, state, open: ok(server.rules(cast(server, state), { type: 'resolveTop' })) }
  }

  const stats = (state: GameState, name: string) => [named(state, name).power, named(state, name).toughness]

  test('is registered as an imprint with its handler ids', () => {
    expect(handlerIdsForNames(['Phyrexian Ingester']).toSorted())
      .toEqual(['choiceEffects', 'exilePayoffs', 'linkedExile'])
    expect(real('Phyrexian Ingester')).toMatchObject({ manaCost: '{6}{U}', power: 3, toughness: 3 })
  })

  test('offers every nontoken creature, including its own, but no tokens, noncreatures, or hexproof creatures', async () => {
    const { open } = await entering()
    const selection = pendingSelectionFor(open, 'p1')!
    expect(names(open, selection.candidates).toSorted()).toEqual(['Big Foe', 'Own Bear', 'Phyrexian Ingester'])
    expect(selection).toMatchObject({ kind: 'choose', min: 0, count: 1, destinations: ['skip', 'target'] })
  })

  test('exiling a creature gives +X/+Y from its printed power and toughness, and the exile is permanent', async () => {
    const { server, open } = await entering()
    const target = named(open, 'Big Foe')
    const stacked = ok(server.rules(open, choose(open, 'Big Foe')))
    expect(stacked.stack[0]).toMatchObject({ kind: 'ability', targets: [{ kind: 'object', objectId: target.id }] })
    const done = resolveStack(server.rules, stacked)

    expect(done.objects[target.id].zone).toBe('exile')
    expect(stats(done, 'Phyrexian Ingester')).toEqual([7, 9])
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()

    // It keeps the imprint as long as it stays, and the exiled card stays exiled when it leaves.
    const gone = resolveStack(server.rules, ok(server.rules(done, {
      type: 'move',
      objectId: named(done, 'Phyrexian Ingester').id,
      to: 'graveyard',
    })))
    expect(gone.objects[target.id].zone).toBe('exile')
  })

  const imprinted = async () => {
    const { server, open } = await entering()
    const done = resolveStack(server.rules, ok(server.rules(open, choose(open, 'Big Foe'))))
    expect(stats(done, 'Phyrexian Ingester')).toEqual([7, 9])
    return { server, done }
  }

  const reenter = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    via: 'hand' | 'graveyard',
  ) => {
    const id = named(state, 'Phyrexian Ingester').id
    const left = resolveStack(server.rules, ok(server.rules(state, { type: 'move', objectId: id, to: via })))
    expect(left.objects[id].exiledCards ?? []).toEqual([])
    expect(left.objects[named(left, 'Big Foe').id].exiledWith).toBeUndefined()
    return resolveStack(server.rules, ok(server.rules(left, { type: 'move', objectId: id, to: 'battlefield' })))
  }

  test('a bounced Ingester comes back with no imprint, and declining the new one leaves it 3/3', async () => {
    const { server, done } = await imprinted()
    const back = reenter(server, done, 'hand')
    expect(pendingSelectionFor(back, 'p1')).toBeDefined()
    const declined = resolveStack(server.rules, ok(server.rules(back, choose(back))))
    expect(stats(declined, 'Phyrexian Ingester')).toEqual([3, 3])
    expect(named(declined, 'Phyrexian Ingester').exiledCards ?? []).toEqual([])
    expect(named(declined, 'Big Foe').zone).toBe('exile')
  })

  test('a second imprint after re-entering counts only the new exiled creature', async () => {
    const { server, done } = await imprinted()
    const back = reenter(server, done, 'hand')
    const second = resolveStack(server.rules, ok(server.rules(back, choose(back, 'Own Bear'))))
    expect(named(second, 'Own Bear').zone).toBe('exile')
    expect(named(second, 'Phyrexian Ingester').exiledCards).toEqual([named(second, 'Own Bear').id])
    expect(stats(second, 'Phyrexian Ingester')).toEqual([5, 5])
  })

  test('an Ingester that died and was reanimated is a fresh object with no imprint', async () => {
    const { server, done } = await imprinted()
    const back = reenter(server, done, 'graveyard')
    const declined = resolveStack(server.rules, ok(server.rules(back, choose(back))))
    expect(stats(declined, 'Phyrexian Ingester')).toEqual([3, 3])
    expect(named(declined, 'Big Foe').zone).toBe('exile')
  })

  test('exiling your own creature or the Ingester itself is allowed', async () => {
    const { server, open } = await entering()
    const own = resolveStack(server.rules, ok(server.rules(open, choose(open, 'Own Bear'))))
    expect(named(own, 'Own Bear').zone).toBe('exile')
    expect(stats(own, 'Phyrexian Ingester')).toEqual([5, 5])

    const self = resolveStack(server.rules, ok(server.rules(open, choose(open, 'Phyrexian Ingester'))))
    expect(named(self, 'Phyrexian Ingester').zone).toBe('exile')
  })

  test('declining exiles nothing and asks nothing further', async () => {
    const { server, open } = await entering()
    const declined = resolveStack(server.rules, ok(server.rules(open, choose(open))))
    expect(pendingSelectionFor(declined, 'p1')).toBeUndefined()
    expect(declined.stack).toHaveLength(0)
    for (const name of ['Own Bear', 'Big Foe', 'Foe Token', 'Shrouded Foe']) {
      expect(named(declined, name).zone).toBe('battlefield')
    }
    expect(stats(declined, 'Phyrexian Ingester')).toEqual([3, 3])
  })

  test('rejects tokens, noncreatures, hexproof creatures, and two targets', async () => {
    const { server, open } = await entering()
    for (const picked of [['Foe Token'], ['Foe Relic'], ['Shrouded Foe'], ['Own Bear', 'Big Foe']]) {
      expect(server.rules(open, choose(open, ...picked)).ok).toBe(false)
    }
    expect(server.rules(open, { ...choose(open, 'Big Foe'), seat: 'p2' }).ok).toBe(false)
    expect(server.rules(open, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
  })

  test('a target that left the battlefield before resolution is not exiled and nothing else is offered', async () => {
    const { server, open } = await entering()
    const stacked = ok(server.rules(open, choose(open, 'Big Foe')))
    const response = ok(server.rules(stacked, { type: 'move', objectId: named(stacked, 'Big Foe').id, to: 'graveyard' }))
    const done = resolveStack(server.rules, response)
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(named(done, 'Big Foe').zone).toBe('graveyard')
    expect(named(done, 'Own Bear').zone).toBe('battlefield')
    expect(stats(done, 'Phyrexian Ingester')).toEqual([3, 3])
  })

  test('the choice is private, survives a host restart, and finishes through the live host', async () => {
    const { server, state } = await setup()
    const ready = pool(mainPhase(state), { U: 1, C: 6 })
    const kernel = handleFor(server.rules, ready)
    // The fast act path hands any creature whose text says "enters" to the judge, so the cast
    // arrives as the judge's plain castSpell event; everything after it is the live kernel.
    expect(kernel.dispatch({
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Phyrexian Ingester').id,
    }).ok).toBe(true)
    passUntilResolved(kernel)

    const lobby = playLobby()
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      seat: 'p1',
      kind: 'choose',
      cards: ['Phyrexian Ingester', 'Own Bear', 'Big Foe'],
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
      choices: (lobby.topdeck!.cards as string[]).map((card, slot) => ({
        card,
        slot,
        destination: (picked.includes(card) ? 'target' : 'skip') as 'target' | 'skip',
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
})

describe("Rishkar's Expertise", () => {
  const setup = async (options: {
    hand?: CardTemplate[]
    creatures?: CardTemplate[]
    libraryCount?: number
    library?: CardTemplate[]
  } = {}) => {
    const plugins = await knownPlugins(["Rishkar's Expertise"])
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [real("Rishkar's Expertise"), ...(options.hand ?? [])] },
      battlefield: {
        p1: options.creatures ?? [
          creature('Big Ally', { power: 5, toughness: 5 }),
          creature('Small Ally', { power: 1, toughness: 1 }),
        ],
        p2: [creature('Huge Foe', { power: 9, toughness: 9 })],
      },
      libraries: { p1: options.library ?? filler('Lib', options.libraryCount ?? 12, ['Creature'], 2) },
    }, { random: () => 0.5, cardPlugins: plugins })
    return { server, state: server.state }
  }

  const resolveExpertise = (server: ReturnType<typeof createServerGame>, state: GameState) => {
    const ready = pool(mainPhase(state), { G: 2, C: 4 })
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, "Rishkar's Expertise").id,
    }))
    return ok(server.rules(cast, { type: 'resolveTop' }))
  }

  const castFree = (state: GameState, name: string): Extract<GameEvent, { type: 'castSpell' }> => ({
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, name).id,
    alternativeCost: 'withoutPayingMana',
  })

  test('is registered: draw by greatest power, then the free cast as the last instruction', () => {
    expect(scryfall("Rishkar's Expertise").oracle_text).toBe(
      'Draw cards equal to the greatest power among creatures you control.\n'
      + 'You may cast a spell with mana value 5 or less from your hand without paying its mana cost.',
    )
    expect(effectsFor("Rishkar's Expertise")).toEqual([
      onResolve(drawGreatestPower(), mayCastFromHandWithoutPayingMana(5)),
    ])
    expect(real("Rishkar's Expertise")).toMatchObject({ manaCost: '{4}{G}{G}', types: ['Sorcery'] })
  })

  test('draws cards equal to your greatest power, counting only your creatures', async () => {
    const { server, state } = await setup({ hand: [costed('Held Bear', ['Creature'], 3)] })
    const resolved = resolveExpertise(server, state)
    expect(handOf(resolved)).toEqual(['Held Bear', 'Lib 1', 'Lib 2', 'Lib 3', 'Lib 4', 'Lib 5'])
    expect(resolved.zoneOrder.p1.library).toHaveLength(7)
    expect(named(resolved, "Rishkar's Expertise").zone).toBe('stack')
  })

  test('with no creature it draws nothing and still offers the free cast', async () => {
    const { server, state } = await setup({ creatures: [], hand: [costed('Held Bear', ['Creature'], 3)] })
    const resolved = resolveExpertise(server, state)
    expect(handOf(resolved)).toEqual(['Held Bear'])
    expect(legalActsFor(resolved, 'p1').map((action) => action.kind).toSorted())
      .toEqual(['castSpell', 'declineFreeCast'])
  })

  test('the free cast is offered after the draw, for held and drawn cards of mana value 5 or less', async () => {
    const { server, state } = await setup({
      hand: [costed('Held Five', ['Creature'], 5), costed('Held Six', ['Creature'], 6), cardTemplate('Held Land', { types: ['Land'] })],
    })
    const resolved = resolveExpertise(server, state)
    const offered = legalActsFor(resolved, 'p1').filter((action) => action.kind === 'castSpell')
    expect(offered.map((action) => 'name' in action && action.name).toSorted()).toEqual([
      'Held Five', 'Lib 1', 'Lib 2', 'Lib 3', 'Lib 4', 'Lib 5',
    ])
    expect(legalActsFor(resolved, 'p1').filter((action) => action.kind === 'declineFreeCast')).toHaveLength(1)

    for (const name of ['Held Six', 'Held Land']) {
      expect(server.rules(resolved, castFree(resolved, name)))
        .toMatchObject({ ok: false, error: 'card is not awaiting a free cast' })
    }
    expect(server.rules(resolved, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
    expect(server.rules(resolved, { ...castFree(resolved, 'Held Five'), seat: 'p2' }).ok).toBe(false)
  })

  test('the offer opens for cards the Expertise itself drew, even with nothing castable held before', async () => {
    const { server, state } = await setup()
    const resolved = resolveExpertise(server, state)
    expect(handOf(resolved)).toEqual(['Lib 1', 'Lib 2', 'Lib 3', 'Lib 4', 'Lib 5'])
    expect(legalActsFor(resolved, 'p1').filter((action) => action.kind === 'declineFreeCast')).toHaveLength(1)
    expect(legalActsFor(resolved, 'p1').filter((action) => action.kind === 'castSpell')).toHaveLength(5)
    const cast = ok(server.rules(resolved, castFree(resolved, 'Lib 3')))
    expect(cast.stack[0]).toMatchObject({ name: 'Lib 3', castFrom: 'hand' })
    expect(cast.players.p1.mana).toEqual(resolved.players.p1.mana)
    expect(handOf(cast)).not.toContain('Lib 3')
  })

  test('only the drawn card of mana value 5 or less is offered; drawn lands and bigger spells are not', async () => {
    const { server, state } = await setup({
      creatures: [creature('Big Ally', { power: 3, toughness: 3 })],
      library: [
        costed('Drawn Five', ['Creature'], 5),
        cardTemplate('Drawn Land', { types: ['Land'] }),
        costed('Drawn Eight', ['Sorcery'], 8),
        costed('Undrawn Two', ['Creature'], 2),
      ],
    })
    const resolved = resolveExpertise(server, state)
    expect(handOf(resolved)).toEqual(['Drawn Five', 'Drawn Land', 'Drawn Eight'])
    const offered = legalActsFor(resolved, 'p1').filter((action) => action.kind === 'castSpell')
    expect(offered.map((action) => 'name' in action && action.name)).toEqual(['Drawn Five'])
    for (const name of ['Drawn Land', 'Drawn Eight']) {
      expect(server.rules(resolved, castFree(resolved, name)))
        .toMatchObject({ ok: false, error: 'card is not awaiting a free cast' })
    }
  })

  test('with nothing castable drawn or held no offer opens and priority carries on', async () => {
    const { server, state } = await setup({
      hand: [cardTemplate('Held Land', { types: ['Land'] }), costed('Held Six', ['Creature'], 6)],
      library: [costed('Drawn Seven', ['Creature'], 7), ...filler('Deep', 10)],
      creatures: [creature('Big Ally', { power: 1, toughness: 1 })],
    })
    const resolved = resolveExpertise(server, state)
    expect(legalActsFor(resolved, 'p1').some((action) => action.kind === 'declineFreeCast')).toBe(false)
    expect(server.rules(resolved, { type: 'passPriority', seat: 'p1' }).ok).toBe(true)
  })

  test('a spell with X in its cost is castable for free with X equal to 0', async () => {
    const { server, state } = await setup({
      hand: [costed('Fixture Hydra', ['Creature'], 1, { manaCost: '{X}{G}', power: 0, toughness: 0 })],
    })
    const resolved = resolveExpertise(server, state)
    const offered = legalActsFor(resolved, 'p1').filter((action) => action.kind === 'castSpell')
    expect(offered.map((action) => 'name' in action && action.name)).toContain('Fixture Hydra')
    const cast = ok(server.rules(resolved, castFree(resolved, 'Fixture Hydra')))
    expect(cast.stack[0]).toMatchObject({ name: 'Fixture Hydra', castFrom: 'hand' })
    expect(cast.stack[0].x ?? 0).toBe(0)
    expect(cast.players.p1.mana).toEqual(resolved.players.p1.mana)
  })

  test('declining ends the offer and keeps every card in hand', async () => {
    const { server, state } = await setup({ hand: [costed('Held Five', ['Creature'], 5)] })
    const resolved = resolveExpertise(server, state)
    const declined = ok(server.rules(resolved, {
      type: 'declineFreeCast',
      seat: 'p1',
      objectId: named(resolved, "Rishkar's Expertise").id,
    }))
    expect(handOf(declined)).toContain('Held Five')
    expect(server.rules(declined, castFree(declined, 'Held Five')).ok).toBe(false)
    expect(server.rules(declined, { type: 'passPriority', seat: 'p1' }).ok).toBe(true)
  })

  test('the offer is private, survives a host restart, and is answered with live acts', async () => {
    const { server, state } = await setup({ hand: [costed('Held Five', ['Creature'], 5)] })
    const ready = pool(mainPhase(state), { G: 2, C: 4 })
    const kernel = handleFor(server.rules, ready)
    expect(kernel.dispatch({
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, "Rishkar's Expertise").id,
    }).ok).toBe(true)
    expect(kernel.dispatch({ type: 'resolveTop' }).ok).toBe(true)

    const open = kernel.history.current()
    const opponent = JSON.stringify(projectForViewer(open, 'p2'))
    for (const name of ['Held Five', 'Lib 1']) expect(opponent).not.toContain(name)
    expect(legalActsFor(open, 'p2').some((action) => action.kind === 'castSpell')).toBe(false)

    const restartedKernel = handleFor(server.rules, ready, kernel.journal)
    expect(restartedKernel.history.current()).toEqual(open)
    const lobby = playLobby()
    expect(() => applyKernelAct(restartedKernel, lobby, 'p1', {
      type: 'act',
      kind: 'castSpell',
      objectId: named(open, 'Held Five').id,
    })).toThrow()
    expect(applyKernelAct(restartedKernel, lobby, 'p1', {
      type: 'act',
      kind: 'castSpell',
      objectId: named(open, 'Held Five').id,
      alternativeCost: 'withoutPayingMana',
    })).toHaveLength(1)
    const cast = restartedKernel.history.current()
    expect(cast.stack[0]).toMatchObject({ name: 'Held Five', castFrom: 'hand' })
    expect(cast.players.p1.mana).toEqual(open.players.p1.mana)
    const done = passUntilResolved(restartedKernel)
    expect(named(done, 'Held Five').zone).toBe('battlefield')

    const declineKernel = handleFor(server.rules, ready, kernel.journal)
    applyKernelAct(declineKernel, playLobby(), 'p1', {
      type: 'act',
      kind: 'declineFreeCast',
      objectId: named(open, "Rishkar's Expertise").id,
    })
    expect(named(declineKernel.history.current(), 'Held Five').zone).toBe('hand')
  })
}
)

describe('Spearbreaker Behemoth', () => {
  const ABILITY = 'spearbreaker.indestructible'

  const setup = async () => {
    const plugins = await knownPlugins(['Spearbreaker Behemoth', 'Drag to the Roots'])
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [real('Drag to the Roots')] },
      battlefield: {
        p1: [
          real('Spearbreaker Behemoth'),
          creature('Own Giant', { power: 5, toughness: 5 }),
          creature('Own Runt', { power: 4, toughness: 4 }),
        ],
        p2: [
          creature('Foe Giant', { power: 6, toughness: 6 }),
          creature('Foe Shrouded', { power: 7, toughness: 7, oracleText: 'Hexproof' }),
        ],
      },
      libraries: { p1: filler('A', 12), p2: filler('B', 12) },
    }, { random: () => 0.5, cardPlugins: plugins })
    const ready = pool(mainPhase(server.state), { B: 2, G: 2, C: 8 })
    return { server, ready }
  }

  const activate = (state: GameState, targetName: string, seat = 'p1'): Extract<GameEvent, { type: 'activateAbility' }> => ({
    type: 'activateAbility',
    abilityId: ABILITY,
    seat,
    objectId: named(state, 'Spearbreaker Behemoth').id,
    targets: [{ kind: 'object', objectId: named(state, targetName).id }],
  })

  const indestructible = (state: GameState, name: string) =>
    hasKeyword(named(state, name), 'indestructible', state)

  const lethalDamage = (server: ReturnType<typeof createServerGame>, state: GameState, name: string) =>
    ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: named(state, 'Foe Giant').id,
      target: { kind: 'object', objectId: named(state, name).id },
      amount: 20,
    }))

  const dragTo = (server: ReturnType<typeof createServerGame>, state: GameState, name: string) =>
    resolveStack(server.rules, ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Drag to the Roots').id,
      targets: [{ kind: 'object', objectId: named(state, name).id }],
    })))

  test('is registered from its exact Oracle text and is indestructible itself', async () => {
    expect(scryfall('Spearbreaker Behemoth').oracle_text)
      .toBe('Indestructible\n{1}: Target creature with power 5 or greater gains indestructible until end of turn.')
    expect(effectsFor('Spearbreaker Behemoth')).toEqual([{
      op: 'activate',
      id: ABILITY,
      costs: { mana: '{1}' },
      targets: { filter: { zone: 'battlefield', type: 'Creature', powerAtLeast: 5 } },
      do: [{ kind: 'grantUntilEot', keywords: ['indestructible'] }],
    }])
    const { server, ready } = await setup()
    expect(indestructible(ready, 'Spearbreaker Behemoth')).toBe(true)
    const survived = lethalDamage(server, ready, 'Spearbreaker Behemoth')
    expect(named(survived, 'Spearbreaker Behemoth').zone).toBe('battlefield')
    const unharmed = dragTo(server, ready, 'Spearbreaker Behemoth')
    expect(named(unharmed, 'Spearbreaker Behemoth').zone).toBe('battlefield')
  })

  test('a legal target, even an opponent creature, survives lethal damage and destroy effects until end of turn', async () => {
    const { server, ready } = await setup()
    for (const name of ['Own Giant', 'Foe Giant', 'Spearbreaker Behemoth']) {
      const stacked = ok(server.rules(ready, activate(ready, name)))
      expect(stacked.stack[0]).toMatchObject({ kind: 'ability', abilityId: ABILITY })
      expect(stacked.players.p1.mana.C).toBe(7)
      const resolved = resolveStack(server.rules, stacked)
      expect(indestructible(resolved, name)).toBe(true)
      expect(named(lethalDamage(server, resolved, name), name).zone).toBe('battlefield')
    }
    const stacked = ok(server.rules(ready, activate(ready, 'Foe Giant')))
    const protectedGiant = resolveStack(server.rules, stacked)
    expect(named(dragTo(server, protectedGiant, 'Foe Giant'), 'Foe Giant').zone).toBe('battlefield')
    // Without the grant the same removal kills it.
    expect(named(dragTo(server, ready, 'Foe Giant'), 'Foe Giant').zone).toBe('graveyard')
    expect(named(lethalDamage(server, ready, 'Own Giant'), 'Own Giant').zone).toBe('graveyard')
  })

  test('a creature with power under 5, a non-creature, or a hexproof opponent creature cannot be targeted', async () => {
    const { server, ready } = await setup()
    for (const name of ['Own Runt', 'Foe Shrouded', 'Drag to the Roots']) {
      expect(server.rules(ready, activate(ready, name)).ok).toBe(false)
    }
    expect(server.rules(ready, { ...activate(ready, 'Own Giant'), targets: [] }).ok).toBe(false)
    expect(server.rules(ready, { ...activate(ready, 'Own Giant'), seat: 'p2' }).ok).toBe(false)
  })

  test('the controller may target its own hexproof creature', async () => {
    const { server, ready } = await setup()
    const edited = structuredClone(ready)
    named(edited, 'Own Giant').oracleText = 'Hexproof'
    const resolved = resolveStack(server.rules, ok(server.rules(edited, activate(edited, 'Own Giant'))))
    expect(indestructible(resolved, 'Own Giant')).toBe(true)
  })

  test('a target whose power drops below 5 in response is not protected', async () => {
    const { server, ready } = await setup()
    const stacked = structuredClone(ok(server.rules(ready, activate(ready, 'Own Giant'))))
    named(stacked, 'Own Giant').power = 4
    const resolved = resolveStack(server.rules, stacked)
    expect(resolved.stack).toHaveLength(0)
    expect(indestructible(resolved, 'Own Giant')).toBe(false)
    expect(named(lethalDamage(server, resolved, 'Own Giant'), 'Own Giant').zone).toBe('graveyard')
  })

  test("an opponent's creature that gains hexproof in response fizzles the ability", async () => {
    const { server, ready } = await setup()
    const stacked = structuredClone(ok(server.rules(ready, activate(ready, 'Foe Giant'))))
    named(stacked, 'Foe Giant').oracleText = 'Hexproof'
    const resolved = resolveStack(server.rules, stacked)
    expect(indestructible(resolved, 'Foe Giant')).toBe(false)
  })

  test('a target that left the battlefield in response fizzles the ability', async () => {
    const { server, ready } = await setup()
    const stacked = ok(server.rules(ready, activate(ready, 'Own Giant')))
    const gone = ok(server.rules(stacked, {
      type: 'move',
      objectId: named(stacked, 'Own Giant').id,
      to: 'exile',
    }))
    const resolved = resolveStack(server.rules, gone)
    expect(resolved.stack).toHaveLength(0)
    expect(named(resolved, 'Own Giant').zone).toBe('exile')
    expect(indestructible(resolved, 'Own Giant')).toBe(false)
  })

  test('the protection wears off at cleanup, and the ability needs its {1}', async () => {
    const { server, ready } = await setup()
    const broke = structuredClone(ready)
    broke.players.p1.mana.C = 0
    broke.players.p1.mana.B = 0
    broke.players.p1.mana.G = 0
    expect(server.rules(broke, activate(broke, 'Own Giant')).ok).toBe(false)

    const resolved = resolveStack(server.rules, ok(server.rules(ready, activate(ready, 'Own Giant'))))
    expect(indestructible(resolved, 'Own Giant')).toBe(true)
    const next = advanceTo(server, resolved, 'upkeep')
    expect(next.active).toBe('p2')
    expect(indestructible(next, 'Own Giant')).toBe(false)
    expect(named(lethalDamage(server, next, 'Own Giant'), 'Own Giant').zone).toBe('graveyard')
    // Spearbreaker's own text keeps it indestructible.
    expect(indestructible(next, 'Spearbreaker Behemoth')).toBe(true)
  })
})
