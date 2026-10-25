import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { ward as wardPlugin } from './ward'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, Plugin } from '../types'
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
import { handlerIdsForNames } from './cardRules'

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
    expect(selection).toMatchObject({ kind: 'choose', count: 2 })
    const pick = (ids: string[]) => ({
      type: 'selectCards' as const,
      seat: 'p1' as const,
      selectionId: selection.id,
      kind: 'choose' as const,
      count: selection.count,
      objectIds: ids,
    })
    const restored = JSON.parse(JSON.stringify(looking))
    expect(server.rules(looking, pick([selection.candidates[0]!])).ok).toBe(false)
    expect(server.rules(looking, pick(selection.candidates.slice(0, 3))).ok).toBe(false)
    expect(server.rules(looking, { ...pick([selection.candidates[2]!, selection.candidates[5]!]), seat: 'p2' }).ok)
      .toBe(false)
    const done = ok(server.rules(restored, pick([selection.candidates[2]!, selection.candidates[5]!])))
    expect(ok(server.rules(JSON.parse(JSON.stringify(looking)), pick([selection.candidates[2]!, selection.candidates[5]!]))))
      .toEqual(done)
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
    expect(names(done, done.zoneOrder.p1.hand).toSorted()).toEqual(['Top 3', 'Top 6'])
    expect(names(done, done.zoneOrder.p1.library)).toEqual([
      'Rest A', 'Rest B', 'Top 1', 'Top 2', 'Top 4', 'Top 5', 'Top 7',
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

const creature = (name: string, extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

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
          cardTemplate('Counterspell'),
        ],
        p3: [costed('P3 Trick', ['Instant'], 0)],
      },
      battlefield: { p1: onBattlefield ? [real('Nezahal, Primal Tide')] : [] },
      libraries: { p1: filler('Lib', 6), p2: filler('Opp Lib', 3), p3: filler('P3 Lib', 3) },
    }, { random: () => 0.5, cardPlugins: plugins })
    return { server, state: server.state }
  }

  test('discarding three cards exiles it and returns it tapped at the next end step, through a live act', async () => {
    const { server, state } = await setup()
    const ready = mainPhase(state)
    const nezahal = named(ready, 'Nezahal, Primal Tide')
    const offer = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'activateAbility' && action.abilityId === '$.abilities[2]')
    if (!offer || offer.kind !== 'activateAbility') throw new Error('discard ability not offered')
    const kernel = handleFor(server.rules, ready)
    const lobby = playLobby()
    const picks = ['Held 1', 'Held 3', 'Held 5'].map((name) => named(ready, name).id)
    const act = (targetObjectIds: string[]) => applyKernelAct(kernel, lobby, 'p1', {
      type: 'act',
      kind: 'activateAbility',
      objectId: nezahal.id,
      abilityId: offer.abilityId,
      text: offer.text,
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
    expect(cost.stack[0]).toMatchObject({ kind: 'ability', abilityId: '$.abilities[2]' })
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
