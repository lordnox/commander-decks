import type { CardTemplate } from '../../newGame'
import { hasKeyword } from '../../keywords'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createToken,
  draw,
  mill,
  objects,
  players,
  ref,
  saga,
  select,
  tap,
  target,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const sagaCard = (abilities: Parameters<typeof card>[0]) =>
  cardTemplate('Saga fixture', {
    types: ['Enchantment'],
    subtypes: ['Saga'],
    manaCost: '{0}',
    ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card(abilities))),
  })

const toPrecombatMain = (state: GameState) =>
  ({ ...state, step: 'draw' as const, active: 'p1' as const, priority: 'p1' as const })

test('canonical saga chapters fire on entry and precombat main, then the saga is sacrificed', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [sagaCard([saga({ chapters: [
      { numbers: [1], instructions: [draw({ count: 1, targets: ref('controller') })] },
      { numbers: [2], instructions: [mill({ count: 1, targets: ref('controller') })] },
      { numbers: [3], instructions: [createToken({
        count: 1,
        targets: ref('controller'),
        token: { name: 'Kraken', types: ['Creature'], power: 1, toughness: 1 },
      })] },
    ] })])] },
    libraries: { p1: [cardTemplate('Drawn', { types: ['Instant'] }), cardTemplate('Milled', { types: ['Instant'] })] },
  }, { random: () => 0 })
  const id = named(server.state, 'Saga fixture').id
  let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(state.objects[id].counters.lore).toBe(1)
  state = resolveStack(server.rules, state)
  expect(named(state, 'Drawn').zone).toBe('hand')
  state = ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' }))
  expect(state.objects[id].counters.lore).toBe(2)
  state = resolveStack(server.rules, state)
  expect(named(state, 'Milled').zone).toBe('graveyard')
  state = ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' }))
  expect(state.objects[id].counters.lore).toBe(3)
  expect(state.objects[id].zone).toBe('battlefield')
  state = resolveStack(server.rules, state)
  expect(Object.values(state.objects).some(object => object.token && object.name === 'Kraken')).toBe(true)
  expect(state.objects[id].zone).toBe('graveyard')
})

test('a canonical chapter waits on its player target and skipNextUntap through the next untap', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [sagaCard([saga({ chapters: [
      { numbers: [1], instructions: [] },
      { numbers: [2], decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] }, instructions: [
        tap(objects({ zone: 'battlefield', controller: { kind: 'targetRef', clauseIndex: 0 }, not: { type: 'Land' } }), { skipNextUntap: true }),
      ] },
    ] })])] },
    battlefield: {
      p2: [cardTemplate('Foe', { types: ['Creature'] }), cardTemplate('Foe Land', { types: ['Land'] })],
    },
  }, { random: () => 0 })
  const id = named(server.state, 'Saga fixture').id
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id })))
  state = ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' }))
  const selection = pendingPlayerSelectionFor(state, 'p1')!
  expect(selection.candidates).toEqual(['p2'])
  expect(state.objects[id].zone).toBe('battlefield')
  const restored = JSON.parse(JSON.stringify(state))
  state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: selection.id, players: ['p2'] }))
  expect(ok(server.rules(restored, { type: 'selectPlayers', seat: 'p1', selectionId: pendingPlayerSelectionFor(restored, 'p1')!.id, players: ['p2'] }))).toEqual(state)
  state = resolveStack(server.rules, state)
  expect(named(state, 'Foe')).toMatchObject({ tapped: true, skipNextUntap: true })
  expect(named(state, 'Foe Land').tapped).toBe(false)
  state = ok(server.rules({ ...state, step: 'cleanup', active: state.active, priority: null }, { type: 'advanceStep' }))
  expect(named(state, 'Foe')).toMatchObject({ tapped: true })
  expect(named(state, 'Foe').skipNextUntap).toBeUndefined()
})

test('a canonical chapter keeps the saga on the battlefield while its object target is still open', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [sagaCard([saga({ chapters: [
      { numbers: [1], instructions: [] },
      { numbers: [2], instructions: [] },
      { numbers: [3], decisions: { targets: [select({ filter: objects({ zone: 'battlefield', controller: 'opponent' }), count: 1 })] }, instructions: [
        tap(target(0)),
      ] },
    ] })])] },
    battlefield: {
      p2: [cardTemplate('Relic', { types: ['Artifact'] })],
    },
  }, { random: () => 0 })
  const id = named(server.state, 'Saga fixture').id
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id })))
  state = resolveStack(server.rules, ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' })))
  state = ok(server.rules(toPrecombatMain(state), { type: 'advanceStep' }))
  const pick = pendingSelectionFor(state, 'p1')!
  expect(pick.candidates).toEqual([named(state, 'Relic').id])
  expect(state.objects[id].zone).toBe('battlefield')
  state = ok(server.rules(state, {
    type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [named(state, 'Relic').id],
  }))
  expect(state.stack[0]).toMatchObject({ payload: { sagaChapter: 3 } })
  state = resolveStack(server.rules, state)
  expect(named(state, 'Relic').tapped).toBe(true)
  expect(state.objects[id].zone).toBe('graveyard')
})

describe('catalog saga chapter sequencing and token lifetime', () => {
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

  const setup = () => {
    const kiora = cardTemplate('Kiora Bests the Sea God')
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: { p1: [kiora] },
      battlefield: permanents(),
      libraries: { p1: filler('A', 12), p2: filler('B', 12), p3: filler('C', 12) },
    }, { random: () => 0.5 })
    return { server, state: server.state }
  }

  const creature = (name: string, extra: Partial<CardTemplate> = {}) =>
    cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })
  const filler = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => cardTemplate(`${prefix} ${i}`, { types: ['Sorcery'] }))
  const mainPhase = (state: GameState) => {
    const ready = structuredClone(state)
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.step = 'precombatMain'
    return ready
  }
  const pool = (state: GameState, mana: Partial<GameState['players'][string]['mana']>) => {
    Object.assign(state.players.p1.mana, mana)
    return state
  }

  const island = (name: string) => cardTemplate(name, { types: ['Land'] })
  const names = (state: GameState, ids: string[]) => ids.map(id => state.objects[id].name)

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

  test('the Kraken is a token, so it ceases to exist rather than reaching a graveyard (CR 704.5d)', () => {
    const { server, state } = setup()
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

  test('casting it makes an 8/8 blue hexproof Kraken, then chapters II and III follow on later turns', () => {
    const { server, state } = setup()
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
      colors: 'U',
      types: ['Creature'],
      subtypes: ['Kraken'],
    })
    expect(hasKeyword(kraken, 'hexproof')).toBe(true)

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

test('catalog Summon: Leviathan chapter II draws when a sea creature attacks', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Summon: Leviathan')] },
    battlefield: { p1: [cardTemplate('Sin', { types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Avatar', 'Leviathan'], power: 7, toughness: 7 })] },
    libraries: { p1: [cardTemplate('Top Card', { types: ['Instant'] })] },
  }, { random: () => 0.5 })
  let state = structuredClone(server.state)
  state.players.p1.mana = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 4 }
  const leviathan = named(state, 'Summon: Leviathan').id
  state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: leviathan }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(state.objects[leviathan].counters.lore).toBe(1)
  state = ok(server.rules(state, { type: 'resolveTop' }))
  state = { ...state, step: 'draw', active: 'p1', priority: 'p1' }
  state = ok(server.rules(state, { type: 'advanceStep' }))
  expect(state.objects[leviathan].counters.lore).toBe(2)
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(state.delayedTriggers).toHaveLength(1)
  state.step = 'declareAttackers'
  state.priority = 'p1'
  state = ok(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: named(state, 'Sin').id, defender: 'p2' }] }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(named(state, 'Top Card').zone).toBe('hand')
})
