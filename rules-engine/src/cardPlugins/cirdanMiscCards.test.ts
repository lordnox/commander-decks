import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { hasKeyword } from '../keywords'
import { legalActsFor } from '../actions'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState, Plugin } from '../types'
import { createLobby } from '../../../live-runner/src/lobby'
import {
  applyKernelAct,
  applyKernelChoice,
  prepareKernelPendingChoice,
} from '../../../live-runner/src/kernelHost'
import type { KernelHandle } from '../../../live-runner/src/kernelHandle'
import { effectsFor, handlerIdsForNames } from './cardRules'
import {
  createTokenInstruction,
  drawGreatestPower,
  gainControlPermanent,
  mayCastFromHandWithoutPayingMana,
  onResolve,
  sagaChapters,
  tapAll,
} from './effectBuilders'
import { choiceEffects } from './choiceEffects'
import { onResolve as onResolvePlugin } from './onResolve'
import { serializableEffects } from './effectRuntime'

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
    if (state.stack.length === 0 || state.stack[0].waiting || !state.priority) return state
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
  choices: ['p2', 'p3'].map((card) => ({
    card,
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
        p2: [...board().battlefield.p2!, creature('Borrowed Ox', { owner: 'p1' } as Partial<CardTemplate>)],
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

/**
 * Kiora's Oracle chapters, composed from the Pass 1 builders. NOT registered in cardRules.ts:
 * chapter III opens a mandatory `choose` card selection whose only destination is `target`,
 * which a live seat cannot answer when several permanents qualify (see the gap test below).
 */
const kioraEffects = () => serializableEffects([sagaChapters(
  {
    numbers: [1],
    do: [createTokenInstruction({
      name: 'Kraken',
      types: ['Creature'],
      subtypes: ['Kraken'],
      colors: ['U'],
      power: 8,
      toughness: 8,
      oracleText: 'Hexproof',
    })],
  },
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
)])

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
    const kiora = real('Kiora Bests the Sea God', {
      effects: kioraEffects(),
      ...(lore === undefined ? {} : { counters: { lore } }),
    })
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: lore === undefined ? { p1: [kiora] } : {},
      battlefield: { ...permanents(), ...(lore === undefined ? {} : { p1: [island('Own Island'), kiora] }) },
      libraries: { p1: filler('A', 12), p2: filler('B', 12), p3: filler('C', 12) },
    }, { random: () => 0.5, cardPlugins: [] })
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

  test('is deliberately not registered yet', () => {
    expect(effectsFor('Kiora Bests the Sea God')).toEqual([])
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

  test('GAP: a live seat cannot answer chapter III when several permanents qualify', async () => {
    const { server, state } = await setup(2)
    const kernel = handleFor(server.rules, state)
    intoNextChapter(kernel, state)
    const lobby = playLobby()
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      kind: 'choose',
      cards: ['Foe Alpha', 'Foe Beta', 'Foe Relic', 'Foe Forest', 'Bystander'],
      destinations: ['target'],
      requirements: { target: { min: 1, max: 1 } },
    })
    const cards = lobby.topdeck!.cards as string[]
    const answer = (chosen: string[], rest?: 'skip') => ({
      type: 'topdeck' as const,
      choices: cards.flatMap((card) => chosen.includes(card)
        ? [{ card, destination: 'target' as const }]
        : rest ? [{ card, destination: rest }] : []),
    })
    // Every card defaults to the only destination, so exactly one can never be picked.
    expect(() => applyKernelChoice(kernel, lobby, 'p1', answer(cards))).toThrow('Choose exactly 1 card(s).')
    expect(() => applyKernelChoice(kernel, lobby, 'p1', answer(['Foe Alpha'], 'skip')))
      .toThrow('Invalid choose destination.')
    expect(() => applyKernelChoice(kernel, lobby, 'p1', answer(['Foe Alpha'])))
      .toThrow('The cards in this choice changed')
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

  const choose = (state: GameState, ...picked: string[]): GameEvent => ({
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
      choices: (lobby.topdeck!.cards as string[]).map((card) => ({
        card,
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

/**
 * Rishkar's Expertise from the Pass 1 builders. NOT registered in cardRules.ts: the free-cast
 * offer is evaluated before the queued draw lands, so it never opens when no card of mana value
 * 5 or less was already in hand (see the gap test below).
 */
const rishkarEffects = () => serializableEffects([
  onResolve(drawGreatestPower(), mayCastFromHandWithoutPayingMana(5)),
])

describe("Rishkar's Expertise", () => {
  const setup = async (options: {
    hand?: CardTemplate[]
    creatures?: CardTemplate[]
    libraryCount?: number
  } = {}) => {
    const plugins = [onResolvePlugin, choiceEffects]
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [real("Rishkar's Expertise", { effects: rishkarEffects() }), ...(options.hand ?? [])] },
      battlefield: {
        p1: options.creatures ?? [
          creature('Big Ally', { power: 5, toughness: 5 }),
          creature('Small Ally', { power: 1, toughness: 1 }),
        ],
        p2: [creature('Huge Foe', { power: 9, toughness: 9 })],
      },
      libraries: { p1: filler('Lib', options.libraryCount ?? 12, ['Creature'], 2) },
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

  const castFree = (state: GameState, name: string): GameEvent => ({
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, name).id,
    alternativeCost: 'withoutPayingMana',
  })

  test('is deliberately not registered yet', () => {
    expect(effectsFor("Rishkar's Expertise")).toEqual([])
    expect(real("Rishkar's Expertise")).toMatchObject({ manaCost: '{4}{G}{G}', types: ['Sorcery'] })
  })

  test('draws cards equal to your greatest power, counting only your creatures', async () => {
    const { server, state } = await setup({ hand: [costed('Held Bear', ['Creature'], 3)] })
    const resolved = resolveExpertise(server, state)
    expect(handOf(resolved)).toEqual(['Held Bear', 'Lib 1', 'Lib 2', 'Lib 3', 'Lib 4', 'Lib 5'])
    expect(resolved.zoneOrder.p1.library).toHaveLength(7)
    expect(named(resolved, "Rishkar's Expertise").zone).toBe('graveyard')
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

  test('GAP: no free cast opens when nothing castable was in hand before the draw', async () => {
    const { server, state } = await setup()
    const resolved = resolveExpertise(server, state)
    // The five drawn creatures are in hand and qualify, but the offer was never opened.
    expect(handOf(resolved)).toEqual(['Lib 1', 'Lib 2', 'Lib 3', 'Lib 4', 'Lib 5'])
    expect(legalActsFor(resolved, 'p1').some((action) => action.kind === 'declineFreeCast')).toBe(false)
    expect(server.rules(resolved, castFree(resolved, 'Lib 3')))
      .toMatchObject({ ok: false, error: 'card is not awaiting a free cast' })
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
