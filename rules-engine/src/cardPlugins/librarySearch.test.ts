import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import {
  DIALOG_CHOSEN,
  PENDING_DIALOG,
  pendingDialog,
  pendingDialogLock,
} from '../pendingDialog'
import { pendingOptionSelection } from '../rules/selectOptions'
import { resolveStack } from '../testHelpers'
import { pendingSelectionFor } from '../rules/selectCards'
import { choiceEffects } from './choiceEffects'
import {
  SEARCH_CHOSEN,
  SEARCH_FETCH,
  librarySearch,
  pendingSearch,
  searchCandidates,
  searchSpecForPending,
  searchingSeat,
} from './librarySearch'
import {
  basicLand,
  bounceSelf,
  delay,
  hasSubtype,
  searchAbility,
  searchSpell,
} from './effects'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, power: null, toughness: null, ...extra })

const forest = (name = 'Forest') =>
  card(name, ['Land'], { subtypes: ['Forest'], supertypes: ['Basic'], tapProduces: { G: 1 } })

const island = () =>
  card('Island', ['Land'], { subtypes: ['Island'], supertypes: ['Basic'], tapProduces: { U: 1 } })

const LEGACY_SEARCH_FIXTURE = 'Legacy search fixture'
// Game state drops function matchers from explicit effects; the stamped search falls back to basic lands.
const LEGACY_SEARCH_SPEC = {
  prompt: 'Search your library for a Forest card and put it onto the battlefield.',
  match: hasSubtype('Forest'),
  destination: 'battlefield' as const,
  min: 1,
  max: 1,
}

const legacyForestSearchSpell = () => card(LEGACY_SEARCH_FIXTURE, ['Sorcery'], {
  manaCost: '{1}{G}',
  effects: [searchSpell(LEGACY_SEARCH_SPEC)],
})

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = (options: {
  hand?: CardTemplate[]
  battlefield?: CardTemplate[]
  library?: CardTemplate[]
}) =>
  createServerGame(
    commanderRules,
    {
      hands: { p1: options.hand ?? [] },
      battlefield: { p1: options.battlefield ?? [] },
      libraries: { p1: options.library ?? [] },
    },
    { random: () => 0.5, cardPlugins: [librarySearch, pendingDialogLock] },
  )

const run = (
  server: ReturnType<typeof game>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

const withMana = (state: GameState) => ({
  ...state,
  players: {
    ...state.players,
    p1: { ...state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 } },
  },
})

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('librarySearch', () => {
  test('a legacy search spell stops resolution and records whose choice is open', () => {
    const server = game({
      hand: [legacyForestSearchSpell()],
      library: [forest('Wooded Foothills'), card('Not a land', ['Instant'])],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])

    expect(state.stack).toHaveLength(1)
    expect(searchingSeat(state)).toBe('p1')
    const pending = pendingSearch(state, 'p1')!
    expect(pending.source).toBe(LEGACY_SEARCH_FIXTURE)
    expect(searchCandidates(state, 'p1', searchSpecForPending(state, pending)!).map((o) => o.name))
      .toEqual(['Wooded Foothills'])
  })

  test('nobody may pass priority while a search is open', () => {
    const server = game({
      hand: [legacyForestSearchSpell()],
      library: [forest()],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    const passed = server.rules(state, { type: 'passPriority', seat: 'p1' })
    expect(passed.ok).toBe(false)
    expect(passed.ok === false && passed.error).toContain('resolution is waiting for input')
  })

  // A journal that already carries the finished search rebuilds the dialog the
  // spell posted while resolving. Nobody can answer it once the spell is gone.
  test('a sacrifice choice dies with the spell that asked for it', () => {
    const server = game({
      hand: [card('Scapeshift', ['Sorcery'], { manaCost: '{2}{G}{G}' })],
      battlefield: [forest()],
    })
    const spell = named(server.state, 'Scapeshift')
    const stranded = structuredClone(server.state)
    stranded.objects[spell.id].zone = 'graveyard'
    stranded.zoneOrder.p1.hand = []
    stranded.zoneOrder.p1.graveyard = [spell.id]
    stranded.players.p1.data[PENDING_DIALOG] = {
      sourceId: spell.id,
      source: 'Scapeshift',
      seat: 'p1',
      kind: 'sacrifice-lands',
      prompt: 'Sacrifice any number of lands.',
      waiting: 'is choosing lands to sacrifice.',
      judge: 'Scapeshift is resolving.',
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['battlefield', 'sacrifice'],
    }

    const passed = ok(server.rules(stranded, { type: 'passPriority', seat: 'p1' }))
    expect(pendingDialog(passed)).toBeUndefined()
  })

  test('a repeated resolveTop cannot skip the open choice', () => {
    const server = game({
      hand: [legacyForestSearchSpell()],
      library: [forest()],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    const repeated = server.rules(state, { type: 'resolveTop' })
    expect(repeated.ok).toBe(false)
    expect(repeated.state).toEqual(state)
    expect(state.stack).toHaveLength(1)
    expect(state.objects[spell].zone).toBe('stack')
    expect(searchingSeat(state)).toBe('p1')
  })

  test('the chosen card resolves the whole spell and clears the marker', () => {
    const server = game({
      hand: [legacyForestSearchSpell()],
      library: [forest('Wooded Foothills'), island()],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const opened = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    const found = named(opened, 'Wooded Foothills').id
    const state = run(server, opened, [
      { type: 'move', objectId: found, to: 'battlefield' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])

    expect(state.objects[found].zone).toBe('battlefield')
    expect(state.objects[found].tapped).toBe(false)
    expect(state.objects[spell].zone).toBe('graveyard')
    expect(state.stack).toHaveLength(0)
    expect(searchingSeat(state)).toBeUndefined()
    expect(state.players.p1.data['librarySearch.done']).toBeUndefined()
  })







  test('a Hideout sacrifices itself, gains life, and completes its typed basic search', () => {
    const server = game({
      hand: [card('Brokers Hideout', ['Land'])],
      library: [
        forest(),
        island(),
        card('Wastes', ['Land'], { supertypes: ['Basic'] }),
      ],
    })
    const hideout = server.state.zoneOrder.p1.hand[0]
    const opened = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'playLand', seat: 'p1', objectId: hideout,
    })))
    expect(opened.objects[hideout].zone).toBe('graveyard')
    expect(opened.players.p1.life).toBe(40)
    const selection = pendingSelectionFor(opened, 'p1')!
    expect(selection.candidates.map(id => opened.objects[id].name)).toEqual(['Forest', 'Island'])
    const found = named(opened, 'Forest').id
    const resolved = ok(server.rules(opened, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1, objectIds: [found] }))
    expect(resolved.objects[found]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.resolution).toBeUndefined()
  })

  test('a Hideout search does not expose library identities to another seat', () => {
    const server = game({
      hand: [card('Obscura Storefront', ['Land'])],
      library: [island()],
    })
    const opened = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'playLand', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    })))
    const projected = server.project(opened, 'p2')
    expect(projected.zoneOrder.p1.library).toEqual([])
    expect(Object.values(projected.objects).some((object) => object.name === 'Island')).toBe(false)
    expect(pendingSelectionFor(projected, 'p1')).toBeUndefined()
  })

  test('Dreamscape Artist discards a card and sacrifices a land to search', () => {
    const server = game({
      battlefield: [
        card('Dreamscape Artist', ['Creature']),
        forest(),
      ],
      hand: [card('Idle Thoughts', ['Instant'])],
      library: [forest('Dryad Arbor'), island()],
    })
    const artist = named(server.state, 'Dreamscape Artist').id
    const landId = named(server.state, 'Forest').id
    const discarded = named(server.state, 'Idle Thoughts').id
    const ready = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 2 } },
      },
    }

    expect(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: artist,
    }).ok).toBe(false)

    const opened = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: artist,
      choices: [discarded, landId],
    }))
    expect(opened.objects[artist]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(opened.objects[discarded].zone).toBe('graveyard')
    expect(opened.objects[landId].zone).toBe('graveyard')
    const searching = resolveStack(server.rules, opened)
    const selection = pendingSelectionFor(searching, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', min: 0, count: 2 })
    const finished = ok(server.rules(searching, { type: 'selectCards', seat: 'p1', kind: 'choose', count: 2, objectIds: selection.candidates }))
    for (const id of selection.candidates) expect(finished.objects[id]).toMatchObject({ zone: 'battlefield', tapped: false })
  })









  test('Farhaven Elf optional search can be declined', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Farhaven Elf', ['Creature'], { manaCost: '{2}{G}', power: 1, toughness: 1 })] },
        libraries: { p1: [forest()] },
      },
      {
        random: () => 0.5,
        cardPlugins: [librarySearch, pendingDialogLock, choiceEffects],
      },
    )
    const elf = server.state.zoneOrder.p1.hand[0]
    const opened = ok(server.rules({
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 } },
      },
    }, { type: 'castSpell', seat: 'p1', objectId: elf }))
    const resolved = resolveStack(server.rules, opened)
    const choice = pendingOptionSelection(resolved, 'p1')!
    expect(choice.options.map(option => option.label)).toEqual(['Accept', 'Decline'])
    const declined = ok(server.rules(resolved, {
      type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: choice.options[1].id,
    }))
    expect(pendingSearch(declined, 'p1')).toBeUndefined()
    expect(declined.objects[elf].zone).toBe('battlefield')
  })

  test('a card with no search ability cannot borrow the fetch ability', () => {
    const server = game({ battlefield: [forest()], library: [forest()] })
    const result = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.battlefield[0],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('no library-search ability')
  })

  test('search after registers delayed bounce at cleanup, not immediately', () => {
    const glacier = card('Test Cleanup Fetch', ['Land'], {
      effects: [searchAbility({
        prompt: 'Search your library for a basic land card. It enters tapped.',
        match: basicLand,
        destination: 'battlefield',
        tapped: true,
        min: 0,
        max: 1,
        sacrificeSource: false,
        after: [delay({ kind: 'step', step: 'cleanup' }, bounceSelf())],
      }, { tap: true, mana: '{1}' })],
    })
    const server = game({
      battlefield: [glacier],
      library: [forest()],
    })
    const sourceId = named(server.state, 'Test Cleanup Fetch').id
    const found = named(server.state, 'Forest').id
    const ready = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: {
          ...server.state.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
        },
      },
    }
    const opened = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: sourceId,
    }))
    expect(opened.objects[sourceId]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(opened.delayedTriggers).toHaveLength(0)

    const searched = run(server, opened, [
      { type: 'move', objectId: found, to: 'battlefield' },
      { type: 'tap', objectId: found },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(searched.objects[sourceId]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(searched.objects[found].zone).toBe('battlefield')
    expect(searched.delayedTriggers).toHaveLength(1)
    expect(searched.delayedTriggers[0].condition).toEqual({ kind: 'step', step: 'cleanup' })

    let state: GameState = { ...searched, step: 'end' as const }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.objects[sourceId].zone).toBe('battlefield')
    expect(state.stack[0]).toMatchObject({ kind: 'ability', name: 'Test Cleanup Fetch' })
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[sourceId].zone).toBe('hand')
    expect(state.objects[found].zone).toBe('battlefield')
  })
})

describe('relocated from sinFallFinishers.test.ts → librarySearch.test.ts', () => {
  const creature = (name: string, manaCost = '{2}{G}', extra: Partial<CardTemplate> = {}) =>
    cardTemplate(name, { types: ['Creature'], manaCost, power: 2, toughness: 2, ...extra })

  const forest = (name = 'Forest') =>
    cardTemplate(name, {
      types: ['Land'],
      subtypes: ['Forest'],
      supertypes: ['Basic'],
      tapProduces: { G: 1 },
    })

  const run = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    events: GameEvent[],
  ) => events.reduce((current, event) => ok(server.rules(current, event)), state)

  const named = (state: GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('Finale of Devastation finds a graveyard creature without shuffling', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: {
            p1: [
              cardTemplate('Finale of Devastation'),
              creature('Graveyard Pet', '{1}{G}', { zone: 'graveyard' }),
            ],
          },
          libraries: { p1: [forest()] },
        },
        { random: () => 0.5 },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 }
      const libraryBefore = [...ready.zoneOrder.p1.library]
      const spell = named(ready, 'Finale of Devastation')
      const searching = run(server, ready, [
        { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 3 },
        { type: 'resolveTop' },
      ])
      const pick = pendingSelectionFor(searching, 'p1')!
      expect(pick.viewLibrary).toBe(true)
      const done = ok(server.rules(searching, {
        type: 'selectCards',
        seat: 'p1',
        selectionId: pick.id,
        kind: 'choose',
        count: 1,
        objectIds: [named(searching, 'Graveyard Pet').id],
      }))
      expect(named(done, 'Graveyard Pet').zone).toBe('battlefield')
      expect(done.zoneOrder.p1.library).toEqual(libraryBefore)
      expect(done.log.filter(line => line === 'p1 shuffles')).toHaveLength(0)
      expect(done.objects[spell.id].zone).toBe('graveyard')
    })

  test('Finale of Devastation shuffles after a library find and pumps at X ≥ 10', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Finale of Devastation')] },
          battlefield: { p1: [creature('Team Mate', '{2}{G}')] },
          libraries: { p1: [creature('Library Pet', '{2}{G}')] },
        },
        { random: () => 0.5 },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 12, C: 0 }
      ready.step = 'precombatMain'
      const spell = named(ready, 'Finale of Devastation')
      const pet = named(ready, 'Library Pet')
      const mate = named(ready, 'Team Mate')
      const searching = run(server, ready, [
        { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 10 },
        { type: 'resolveTop' },
      ])
      const pick = pendingSelectionFor(searching, 'p1')!
      const done = ok(server.rules(searching, {
        type: 'selectCards',
        seat: 'p1',
        selectionId: pick.id,
        kind: 'choose',
        count: 1,
        objectIds: [pet.id],
      }))
      expect(named(done, 'Library Pet').zone).toBe('battlefield')
      expect(done.log.filter(line => line === 'p1 shuffles')).toHaveLength(1)
      expect(done.objects[mate.id]).toMatchObject({ power: 12, toughness: 12 })
      expect(hasKeyword(done.objects[mate.id], 'haste')).toBe(true)
    })

})
