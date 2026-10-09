import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { PENDING_SELECTION, pendingSelectionFor } from '../rules/selectCards'
import { DIALOG_CHOSEN, pendingDialogLock } from '../pendingDialog'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { createLobby } from '../../../live-runner/src/lobby'
import {
  applyKernelChoice,
  prepareKernelPendingChoice,
} from '../../../live-runner/src/kernelHost'
import type { KernelHandle } from '../../../live-runner/src/kernelHandle'
import {
  annihilator,
  permanentSacrificed,
  putTriggeringCardOntoBattlefield,
  shuffleIntoLibraryInstead as shuffleEffect,
} from './effects'
import { alternateCosts } from './alternateCosts'
import { librarySearch, SEARCH_CHOSEN } from './librarySearch'
import { shuffleIntoLibraryInstead } from './shuffleIntoLibraryInstead'
import { targetedResolve } from './targetedResolve'

const eldrazi = (name = 'Test Betrayer') => cardTemplate(name, {
  types: ['Creature'],
  subtypes: ['Eldrazi'],
  power: 10,
  toughness: 10,
  effects: [
    annihilator(2),
    permanentSacrificed(
      { controller: 'opponent', nontoken: true },
      putTriggeringCardOntoBattlefield(),
    ),
  ],
})

const artifact = (name: string) => cardTemplate(name, { types: ['Artifact'], manaCost: '{2}' })
const land = (name: string) => cardTemplate(name, { types: ['Land'] })
const token = (name: string) => cardTemplate(name, { types: ['Artifact'], token: true })

const game = (zones: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(
    commanderRules,
    { players: 3, ...zones },
    { random: () => 0.5, cardPlugins: [shuffleIntoLibraryInstead] },
  )

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const attackReady = (state: GameState, objectId: string) => {
  const next = structuredClone(state)
  next.step = 'declareAttackers'
  next.active = 'p1'
  next.priority = 'p1'
  next.objects[objectId].summoningSickness = false
  return next
}

const attack = (
  server: ReturnType<typeof game>,
  state: GameState,
  defender: 'p2' | 'p3' = 'p2',
) => {
  const id = named(state, 'Test Betrayer').id
  return ok(server.rules(attackReady(state, id), {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: id, defender: { kind: 'player', player: defender } }],
  }))
}

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

const p2Board = () => ({
  battlefield: {
    p1: [eldrazi()],
    p2: [artifact('P2 Rock'), land('P2 Swamp'), token('P2 Treasure')],
    p3: [artifact('P3 Rock')],
  },
  libraries: { p2: [cardTemplate('P2 Draw')] },
})

describe('annihilator', () => {
  test('the attack trigger names the defending player, per attacker and per attacked permanent', () => {
    const server = game({
      battlefield: {
        p1: [eldrazi(), eldrazi('Second Betrayer')],
        p2: [cardTemplate('P2 Walker', { types: ['Planeswalker'], printedLoyalty: 4 })],
        p3: [artifact('P3 Rock')],
      },
    })
    const first = named(server.state, 'Test Betrayer').id
    const second = named(server.state, 'Second Betrayer').id
    const walker = named(server.state, 'P2 Walker').id
    const ready = attackReady(server.state, first)
    ready.objects[second].summoningSickness = false
    const declared = ok(server.rules(ready, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [
        { objectId: first, defender: { kind: 'object', objectId: walker } },
        { objectId: second, defender: { kind: 'player', player: 'p3' } },
      ],
    }))
    expect(declared.stack.map((item) => [item.name, item.payload?.defendingPlayer]).sort())
      .toEqual([
        ['Second Betrayer', 'p3'],
        ['Test Betrayer', 'p2'],
      ])
  })

  test('only the defending player chooses, sees the choice, and picks from their own permanents', () => {
    const server = game(p2Board())
    const declared = attack(server, server.state)
    expect(declared.stack).toHaveLength(1)

    const choosing = ok(server.rules(declared, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p2')!
    expect(selection).toMatchObject({
      kind: 'sacrifice',
      count: 2,
      seat: 'p2',
      fromSeat: 'p2',
      source: 'Test Betrayer',
    })
    expect(selection.candidates.map((id) => choosing.objects[id].name).sort())
      .toEqual(['P2 Rock', 'P2 Swamp', 'P2 Treasure'])

    expect(projectForViewer(choosing, 'p2').players.p2.data[PENDING_SELECTION]).toBeDefined()
    expect(projectForViewer(choosing, 'p1').players.p2.data[PENDING_SELECTION]).toBeUndefined()
    expect(projectForViewer(choosing, 'p3').players.p2.data[PENDING_SELECTION]).toBeUndefined()

    const rock = named(choosing, 'P2 Rock').id
    const swamp = named(choosing, 'P2 Swamp').id
    const select = (seat: 'p1' | 'p2', objectIds: string[]) => server.rules(choosing, {
      type: 'selectCards',
      seat,
      kind: 'sacrifice',
      count: 2,
      objectIds,
    })
    expect(select('p1', [rock, swamp]).ok).toBe(false)
    expect(select('p2', [rock]).ok).toBe(false)
    expect(select('p2', [rock, rock]).ok).toBe(false)
    expect(select('p2', [rock, named(choosing, 'P3 Rock').id]).ok).toBe(false)
    expect(select('p2', [rock, named(choosing, 'Test Betrayer').id]).ok).toBe(false)
    expect(server.rules(choosing, { type: 'passPriority', seat: 'p2' }).ok).toBe(false)
  })

  test('sacrificed nontoken permanents are put onto the battlefield under the attacker control', () => {
    const server = game(p2Board())
    const choosing = ok(server.rules(attack(server, server.state), { type: 'resolveTop' }))
    const rock = named(choosing, 'P2 Rock').id
    const swamp = named(choosing, 'P2 Swamp').id
    const sacrificed = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'sacrifice',
      count: 2,
      objectIds: [rock, swamp],
    }))
    expect(pendingSelectionFor(sacrificed, 'p2')).toBeUndefined()
    expect(sacrificed.stack.map((item) => item.name)).toEqual(['Test Betrayer', 'Test Betrayer'])
    expect(sacrificed.stack.map((item) => item.payload?.triggeringPlayer))
      .toEqual(['p2', 'p2'])

    const stolen = resolveStack(server.rules, sacrificed)
    for (const id of [rock, swamp]) {
      expect(stolen.objects[id]).toMatchObject({ zone: 'battlefield', controller: 'p1', owner: 'p2' })
    }
    expect(stolen.zoneOrder.p2.graveyard).toEqual([])
    expect(named(stolen, 'P3 Rock').controller).toBe('p3')
  })

  test('a token is sacrificed for good and never stolen', () => {
    const server = game(p2Board())
    const choosing = ok(server.rules(attack(server, server.state), { type: 'resolveTop' }))
    const treasure = named(choosing, 'P2 Treasure').id
    const rock = named(choosing, 'P2 Rock').id
    const sacrificed = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'sacrifice',
      count: 2,
      objectIds: [treasure, rock],
    }))
    expect(sacrificed.stack).toHaveLength(1)
    const stolen = resolveStack(server.rules, sacrificed)
    expect(stolen.objects[treasure]).toBeUndefined()
    expect(stolen.objects[rock]).toMatchObject({ zone: 'battlefield', controller: 'p1' })
  })

  test('a defender with fewer permanents sacrifices all of them, and one with none sacrifices nothing', () => {
    const server = game({
      battlefield: { p1: [eldrazi()], p2: [artifact('P2 Rock')], p3: [] },
    })
    const choosing = ok(server.rules(attack(server, server.state), { type: 'resolveTop' }))
    expect(pendingSelectionFor(choosing, 'p2')).toMatchObject({ count: 1 })

    const empty = attack(server, server.state, 'p3')
    const resolved = ok(server.rules(empty, { type: 'resolveTop' }))
    expect(pendingSelectionFor(resolved, 'p3')).toBeUndefined()
    expect(resolved.stack).toEqual([])
  })

  test('a Blightsteel-style card is shuffled away instead of being stolen', () => {
    const server = game({
      battlefield: {
        p1: [eldrazi()],
        p2: [cardTemplate('P2 Colossus', {
          types: ['Artifact', 'Creature'],
          effects: [shuffleEffect()],
        })],
      },
    })
    const choosing = ok(server.rules(attack(server, server.state), { type: 'resolveTop' }))
    const colossus = named(choosing, 'P2 Colossus').id
    const sacrificed = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'sacrifice',
      count: 1,
      objectIds: [colossus],
    }))
    expect(sacrificed.stack).toHaveLength(1)
    const settled = resolveStack(server.rules, sacrificed)
    expect(settled.objects[colossus].zone).toBe('library')
    expect(settled.objects[colossus].controller).toBe('p2')
  })

  test('a host restart restores the open sacrifice choice, then the live host steals the card', () => {
    const server = game(p2Board())
    const choosing = ok(server.rules(attack(server, server.state), { type: 'resolveTop' }))
    const kernel = handleFor(server.rules, choosing)
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({ seat: 'p2', kind: 'sacrifice' })
    expect([...lobby.topdeck!.cards].sort()).toEqual(['P2 Rock', 'P2 Swamp', 'P2 Treasure'])
    const selectionId = pendingSelectionFor(kernel.history.current(), 'p2')!.id

    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, restarted)).toBe(true)
    expect(restarted.topdeck?.kernel?.selectionId).toBe(selectionId)

    const slot = (card: string) => restarted.topdeck!.cards.indexOf(card)
    expect(() => applyKernelChoice(kernel, restarted, 'p2', {
      type: 'topdeck',
      choices: [{ card: 'P2 Rock', slot: slot('P2 Rock'), destination: 'sacrifice' }],
    })).toThrow()
    expect(applyKernelChoice(kernel, restarted, 'p2', {
      type: 'topdeck',
      choices: [
        { card: 'P2 Rock', slot: slot('P2 Rock'), destination: 'sacrifice' },
        { card: 'P2 Treasure', slot: slot('P2 Treasure'), destination: 'sacrifice' },
        { card: 'P2 Swamp', slot: slot('P2 Swamp'), destination: 'battlefield' },
      ],
    })).toBe(true)
    const settled = resolveStack(kernel.rules, kernel.history.current())
    expect(named(settled, 'P2 Rock')).toMatchObject({ zone: 'battlefield', controller: 'p1' })
    expect(Object.values(settled.objects).some((object) => object.name === 'P2 Treasure')).toBe(false)
    expect(named(settled, 'P2 Swamp')).toMatchObject({ zone: 'battlefield', controller: 'p2' })
  })
})

describe('permanentSacrificed', () => {
  const sacrificeRules = () => game({
    battlefield: {
      p1: [eldrazi(), artifact('P1 Rock')],
      p2: [artifact('P2 Rock'), token('P2 Treasure')],
    },
    hands: { p2: [artifact('P2 Hand Rock')] },
  })

  test('an opponent sacrificing a nontoken permanent triggers it, once, with that player', () => {
    const server = sacrificeRules()
    const rock = named(server.state, 'P2 Rock').id
    const state = ok(server.rules(server.state, { type: 'sacrifice', objectId: rock }))
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0].payload).toMatchObject({
      triggeringObjectId: rock,
      triggeringPlayer: 'p2',
    })
    const stolen = resolveStack(server.rules, state)
    expect(stolen.objects[rock]).toMatchObject({ zone: 'battlefield', controller: 'p1' })
  })

  test('its controller, tokens, and permanents that are not on the battlefield do not trigger it', () => {
    const server = sacrificeRules()
    const own = ok(server.rules(server.state, {
      type: 'sacrifice',
      objectId: named(server.state, 'P1 Rock').id,
    }))
    expect(own.stack).toEqual([])
    const tokenSacrificed = ok(server.rules(server.state, {
      type: 'sacrifice',
      objectId: named(server.state, 'P2 Treasure').id,
    }))
    expect(tokenSacrificed.stack).toEqual([])
    const fromHand = ok(server.rules(server.state, {
      type: 'sacrifice',
      objectId: named(server.state, 'P2 Hand Rock').id,
    }))
    expect(fromHand.stack).toEqual([])
    expect(named(fromHand, 'P2 Hand Rock').zone).toBe('hand')
  })

  test('the card stays put when something else moved it before the ability resolved', () => {
    const server = sacrificeRules()
    const rock = named(server.state, 'P2 Rock').id
    const state = ok(server.rules(server.state, { type: 'sacrifice', objectId: rock }))
    const exiled = ok(server.rules(state, { type: 'move', objectId: rock, to: 'exile' }))
    const settled = resolveStack(server.rules, exiled)
    expect(settled.objects[rock].zone).toBe('exile')
  })

  test('the watcher must be on the battlefield and not phased out', () => {
    const server = sacrificeRules()
    const rock = named(server.state, 'P2 Rock').id
    const phased = structuredClone(server.state)
    phased.objects[named(phased, 'Test Betrayer').id].phasedOut = true
    expect(ok(server.rules(phased, { type: 'sacrifice', objectId: rock })).stack).toEqual([])

    const banished = ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Test Betrayer').id,
      to: 'exile',
    }))
    expect(ok(server.rules(banished, { type: 'sacrifice', objectId: rock })).stack).toEqual([])
  })
})

const asP2 = (state: GameState) => {
  const next = structuredClone(state)
  next.active = 'p2'
  next.priority = 'p2'
  return next
}

const creature = (name: string) => cardTemplate(name, { types: ['Creature'] })

const forest = (name: string) => cardTemplate(name, {
  types: ['Land'],
  subtypes: ['Forest'],
  supertypes: ['Basic'],
  tapProduces: { G: 1 },
})

describe('permanentSacrificed from other sacrifice paths', () => {
  test('a sacrifice paid as a spell cost triggers it for each permanent', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        battlefield: {
          p1: [eldrazi()],
          p2: [creature('One'), creature('Two'), creature('Three')],
        },
        hands: {
          p2: [
            cardTemplate('Dread Return', { types: ['Sorcery'], manaCost: '{2}{B}{B}', zone: 'graveyard' }),
            creature('Reanimation Target'),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [alternateCosts, targetedResolve] },
    )
    const ready = asP2(server.state)
    const target = named(ready, 'Reanimation Target')
    ready.objects[target.id].zone = 'graveyard'
    ready.zoneOrder.p2.hand = ready.zoneOrder.p2.hand.filter((id) => id !== target.id)
    ready.zoneOrder.p2.graveyard.push(target.id)
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(ready, 'Dread Return').id,
      castOption: 'flashback',
      sacrifice: ['One', 'Two', 'Three'].map((name) => named(ready, name).id),
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    expect(cast.stack.filter((item) => item.name === 'Test Betrayer')).toHaveLength(3)
    const settled = resolveStack(server.rules, cast)
    for (const name of ['One', 'Two', 'Three']) {
      expect(named(settled, name)).toMatchObject({ zone: 'battlefield', controller: 'p1' })
    }
  })

  test('lands sacrificed while a search spell resolves trigger it', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        battlefield: { p1: [eldrazi()], p2: [forest('First Forest')] },
        hands: { p2: [cardTemplate('Scapeshift', { types: ['Sorcery'], manaCost: '{2}{G}{G}' })] },
      },
      { random: () => 0.5, cardPlugins: [librarySearch, pendingDialogLock] },
    )
    const ready = asP2(server.state)
    ready.players.p2.mana.G = 4
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(ready, 'Scapeshift').id,
    }))
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    let sacrificed = ok(server.rules(choosing, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p2',
      payload: { objectIds: [named(choosing, 'First Forest').id] },
    }))
    expect(sacrificed.pendingTriggers?.[0]).toMatchObject({
      source: { name: 'Test Betrayer' },
    })
    sacrificed = ok(server.rules(sacrificed, {
      type: 'custom',
      name: SEARCH_CHOSEN,
      seat: 'p2',
    }))
    expect(sacrificed.stack.filter((item) => item.name === 'Test Betrayer')).toHaveLength(1)
  })
})
