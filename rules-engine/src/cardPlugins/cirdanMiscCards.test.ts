import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { ward as wardPlugin } from './ward'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
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

const filler = (prefix: string, count: number, types = ['Sorcery'], manaValue?: number) =>
  Array.from({ length: count }, (_, index) => cardTemplate(`${prefix} ${index + 1}`, {
    types,
    ...(manaValue === undefined ? {} : { manaCost: `{${manaValue}}`, manaValue }),
  }))

const playerBallot = (targets: string[]) => ({
  type: 'topdeck' as const,
  choices: ['p2', 'p3'].map((card, slot) => ({
    card,
    slot,
    destination: (targets.includes(card) ? 'target' : 'skip') as 'target' | 'skip',
  })),
})

const creature = (name: string, extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

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
    const kiora = real('Kiora Bests the Sea God', lore === undefined ? {} : { counters: { lore } })
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: lore === undefined ? { p1: [kiora] } : {},
      battlefield: { ...permanents(), ...(lore === undefined ? {} : { p1: [island('Own Island'), kiora] }) },
      libraries: { p1: filler('A', 12), p2: filler('B', 12), p3: filler('C', 12) },
    }, { random: () => 0.5 })
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
    }, { random: () => 0.5, cardPlugins: [wardPlugin] })
    const kernel = handleFor(wardedGame.rules, wardedGame.state)
    intoNextChapter(kernel, wardedGame.state)
    const stacked = chooseSteal(wardedGame, kernel.history.current(), 'Warded Foe')
    const done = resolveStack(wardedGame.rules, stacked)
    expect(named(done, 'Warded Foe').controller).toBe('p1')
  })

})

