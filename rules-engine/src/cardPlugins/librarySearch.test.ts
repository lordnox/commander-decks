import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
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
import { CARD_RULES } from './cardRules'
import { entersTapped } from './entersTapped'
import {
  SEARCH_CHOSEN,
  SEARCH_FETCH,
  librarySearch,
  pendingSearch,
  searchCandidates,
  searchSpecFor,
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

import {exiledWith} from './exiledWith'
import {onResolve} from './onResolve'
import {castCosts} from './castCosts'
import {ward} from './ward'
const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, power: null, toughness: null, ...extra })

const forest = (name = 'Forest') =>
  card(name, ['Land'], { subtypes: ['Forest'], supertypes: ['Basic'], tapProduces: { G: 1 } })

const island = () =>
  card('Island', ['Land'], { subtypes: ['Island'], supertypes: ['Basic'], tapProduces: { U: 1 } })

const legacyForestSearchSpell = () => card('Legacy search fixture', ['Sorcery'], {
  manaCost: '{1}{G}',
})

const LEGACY_SEARCH_FIXTURE = 'Legacy search fixture'
const LEGACY_SEARCH_SPEC = {
  prompt: 'Search your library for a Forest card and put it onto the battlefield.',
  match: hasSubtype('Forest'),
  destination: 'battlefield' as const,
  min: 1,
  max: 1,
}
let previousLegacyFixtureRules: typeof CARD_RULES[string] | undefined

beforeAll(() => {
  previousLegacyFixtureRules = CARD_RULES[LEGACY_SEARCH_FIXTURE]
  CARD_RULES[LEGACY_SEARCH_FIXTURE] = [searchSpell(LEGACY_SEARCH_SPEC)]
})

afterAll(() => {
  if (previousLegacyFixtureRules) CARD_RULES[LEGACY_SEARCH_FIXTURE] = previousLegacyFixtureRules
  else delete CARD_RULES[LEGACY_SEARCH_FIXTURE]
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
  test('Scapeshift cannot find an MDFC whose front face is not a land', () => {
    const mdfc = card('Bala Ged Recovery', ['Sorcery', 'Land'], {
      frontFace: {
        types: ['Sorcery'],
        subtypes: [],
        supertypes: [],
        manaCost: '{2}{G}',
        manaValue: 3,
        colors: ['G'],
      },
    })
    const server = game({ library: [forest(), mdfc] })

    expect(searchCandidates(
      server.state,
      'p1',
      searchSpecFor('Scapeshift')!,
    ).map((object) => object.name)).toEqual(['Forest'])
  })

  // Scapeshift sacrifices as it resolves, so the spell is already on the stack
  // and countering it means no land is lost.
  test('Scapeshift sacrifices while it resolves, then searches for that many lands', () => {
    const server = game({
      hand: [card('Scapeshift', ['Sorcery'], { manaCost: '{2}{G}{G}' })],
      battlefield: [forest('First Forest'), forest('Second Forest')],
      library: [forest(), island()],
    })
    const spell = named(server.state, 'Scapeshift')
    const funded = withMana(server.state)
    funded.players.p1.mana.G = 4
    const cast = ok(server.rules(funded, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
    }))

    expect(pendingDialog(cast)).toBeUndefined()
    expect(cast.objects[spell.id].zone).toBe('stack')
    expect(named(cast, 'First Forest').zone).toBe('battlefield')

    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(pendingDialog(choosing)).toMatchObject({
      kind: 'sacrifice-lands',
      source: 'Scapeshift',
    })
    expect(choosing.objects[spell.id].zone).toBe('stack')

    const sacrificed = named(choosing, 'First Forest')
    const searching = ok(server.rules(choosing, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { objectIds: [sacrificed.id] },
    }))

    expect(searching.objects[sacrificed.id].zone).toBe('graveyard')
    expect(pendingSearch(searching, 'p1')).toMatchObject({
      source: 'Scapeshift',
      max: 1,
    })
  })

  test('Scapeshift that sacrifices nothing finds nothing and finishes resolving', () => {
    const server = game({
      hand: [card('Scapeshift', ['Sorcery'], { manaCost: '{2}{G}{G}' })],
      battlefield: [forest('First Forest')],
      library: [forest(), island()],
    })
    const spell = named(server.state, 'Scapeshift')
    const funded = withMana(server.state)
    funded.players.p1.mana.G = 4
    const done = run(server, funded, [
      { type: 'castSpell', seat: 'p1', objectId: spell.id },
      { type: 'resolveTop' },
      { type: 'custom', name: DIALOG_CHOSEN, seat: 'p1', payload: { objectIds: [] } },
    ])
    expect(named(done, 'First Forest').zone).toBe('battlefield')
    expect(pendingSearch(done, 'p1')).toBeUndefined()
    expect(done.objects[spell.id].zone).toBe('graveyard')
  })

  test('a land fetched by Scapeshift keeps its own search', () => {
    const server = game({
      hand: [card('Scapeshift', ['Sorcery'], { manaCost: '{2}{G}{G}' })],
      battlefield: [forest()],
      library: [
        card('Riveteers Overlook', ['Land']),
        card('Mountain', ['Land'], { subtypes: ['Mountain'], supertypes: ['Basic'] }),
      ],
    })
    const spell = named(server.state, 'Scapeshift')
    const sacrificed = named(server.state, 'Forest')
    const hideout = named(server.state, 'Riveteers Overlook')
    const funded = withMana(server.state)
    funded.players.p1.mana.G = 4
    const asking = run(server, ok(server.rules(funded, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
    })), [
      { type: 'resolveTop' },
      {
        type: 'custom',
        name: DIALOG_CHOSEN,
        seat: 'p1',
        payload: { objectIds: [sacrificed.id] },
      },
      // The host moves the found land, then reports the search answered.
      { type: 'move', objectId: hideout.id, to: 'battlefield' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])

    expect(asking.objects[spell.id].zone).toBe('graveyard')
    const searching = resolveStack(server.rules, asking)
    const mountain = named(searching, 'Mountain').id
    const selection = pendingSelectionFor(searching, 'p1')!
    expect(selection.candidates).toEqual([mountain])
    const resolved = ok(server.rules(searching, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1, objectIds: [mountain] }))
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.objects[mountain]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(resolved.resolution).toBeUndefined()
  })

  test('a surveil land fetched by Scapeshift keeps its trigger', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Scapeshift', ['Sorcery'], { manaCost: '{2}{G}{G}' })] },
        battlefield: { p1: [forest()] },
        libraries: { p1: [card('Undercity Sewers', ['Land']), island()] },
      },
      {
        random: () => 0.5,
        cardPlugins: [
          librarySearch,
          pendingDialogLock,
          choiceEffects,
          entersTapped,
        ],
      },
    )
    const spell = named(server.state, 'Scapeshift')
    const sacrificed = named(server.state, 'Forest')
    const sewers = named(server.state, 'Undercity Sewers')
    const funded = withMana(server.state)
    funded.players.p1.mana.G = 4
    const resolved = run(server, ok(server.rules(funded, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
    })), [
      { type: 'resolveTop' },
      {
        type: 'custom',
        name: DIALOG_CHOSEN,
        seat: 'p1',
        payload: { objectIds: [sacrificed.id] },
      },
      { type: 'move', objectId: sewers.id, to: 'battlefield' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
      { type: 'resolveTop' },
    ])

    expect(resolved.objects[spell.id].zone).toBe('graveyard')
    expect(pendingSelectionFor(resolved, 'p1')).toMatchObject({
      kind: 'surveil',
      source: 'Undercity Sewers',
    })
  })

  test('Analyze the Pollen uses the shared kicked search and reveal flow', () => {
    const server = game({
      hand: [card('Analyze the Pollen', ['Sorcery'], { manaCost: '{G}' })],
      library: [
        card('Oracle of Mul Daya', ['Creature']),
        card('Wastes', ['Land'], { supertypes: ['Basic'] }),
      ],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const opened = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell, kicked: true },
      { type: 'resolveTop' },
    ])

    expect(pendingSearch(opened, 'p1')).toMatchObject({
      source: 'Analyze the Pollen',
      kicked: true,
    })
    expect(searchCandidates(
      opened,
      'p1',
      searchSpecFor('Analyze the Pollen')!,
      true,
    ).map((object) => object.name)).toEqual(['Oracle of Mul Daya', 'Wastes'])

    const choice = named(opened, 'Oracle of Mul Daya').id
    const resolved = run(server, opened, [
      { type: 'reveal', seat: 'p1', objectIds: [choice], source: 'Analyze the Pollen' },
      { type: 'move', objectId: choice, to: 'hand' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])

    expect(resolved.objects[choice].zone).toBe('hand')
    expect(resolved.objects[spell].zone).toBe('graveyard')
    expect(pendingSearch(resolved, 'p1')).toBeUndefined()
    expect(resolved.log).toContain('p1 reveals Oracle of Mul Daya for Analyze the Pollen')
  })

  test('unkicked Analyze the Pollen only finds basic lands', () => {
    const spec = searchSpecFor('Analyze the Pollen')!
    const server = game({
      library: [
        forest(),
        card('Dryad Arbor', ['Land', 'Creature']),
        card('Llanowar Elves', ['Creature']),
      ],
    })

    expect(searchCandidates(server.state, 'p1', spec).map((object) => object.name))
      .toEqual(['Forest'])
  })

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
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: artist,
    }).ok).toBe(false)

    const opened = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: artist,
      choices: [discarded, landId],
    }))
    expect(opened.objects[artist]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(opened.objects[discarded].zone).toBe('graveyard')
    expect(opened.objects[landId].zone).toBe('graveyard')
    expect(pendingSearch(opened, 'p1')?.source).toBe('Dreamscape Artist')
  })









  test('Cultivate splits one basic to the battlefield tapped and one to hand', () => {
    const server = game({
      hand: [card('Cultivate', ['Sorcery'], { manaCost: '{2}{G}' })],
      library: [
        forest('Alpha Forest'),
        forest('Beta Forest'),
        card('Island', ['Land'], { subtypes: ['Island'], supertypes: ['Basic'] }),
      ],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const funded = withMana(server.state)
    funded.players.p1.mana.G = 3
    const opened = run(server, funded, [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    expect(pendingSearch(opened, 'p1')?.source).toBe('Cultivate')
    expect(searchSpecFor('Cultivate')?.split).toBeTruthy()

    const alpha = named(opened, 'Alpha Forest').id
    const beta = named(opened, 'Beta Forest').id
    const resolved = run(server, opened, [
      { type: 'move', objectId: alpha, to: 'battlefield' },
      { type: 'tap', objectId: alpha },
      { type: 'move', objectId: beta, to: 'hand' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(resolved.objects[alpha].zone).toBe('battlefield')
    expect(resolved.objects[alpha].tapped).toBe(true)
    expect(resolved.objects[beta].zone).toBe('hand')
    expect(resolved.objects[spell].zone).toBe('graveyard')
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

  const finisherPlugins = [
    onResolve,
    choiceEffects,
    librarySearch,
    castCosts,
    ward,
    exiledWith,
    pendingDialogLock,
  ]

  test('Finale of Devastation finds a graveyard creature without shuffling', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Finale of Devastation', { types: ['Sorcery'], manaCost: '{X}{G}{G}' })] },
          libraries: { p1: [forest()] },
        },
        { random: () => 0.5, cardPlugins: finisherPlugins },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 }
      const pet = creature('Graveyard Pet', '{1}{G}')
      const petId = server.state.nextId
      ready.objects[`o${petId}`] = {
        ...pet,
        id: `o${petId}`,
        owner: 'p1',
        controller: 'p1',
        zone: 'graveyard',
      }
      ready.zoneOrder.p1.graveyard.push(`o${petId}`)
      ready.zoneCounts.p1.graveyard += 1
      ready.nextId = petId + 1
      const libraryBefore = [...ready.zoneOrder.p1.library]
      const spell = named(ready, 'Finale of Devastation')

      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: spell.id,
        x: 3,
      }))
      const searching = run(server, cast, [{ type: 'resolveTop' }])

      expect(searchingSeat(searching)).toBe('p1')
      expect(pendingSearch(searching, 'p1')?.x).toBe(3)

      const petObject = named(searching, 'Graveyard Pet')
      const done = run(server, searching, [
        { type: 'move', objectId: petObject.id, to: 'battlefield' },
        { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
      ])

      expect(named(done, 'Graveyard Pet').zone).toBe('battlefield')
      expect(done.zoneOrder.p1.library).toEqual(libraryBefore)
      expect(done.objects[spell.id].zone).toBe('graveyard')
    })

  test('Finale of Devastation shuffles after a library find and pumps at X ≥ 10', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Finale of Devastation', { types: ['Sorcery'], manaCost: '{X}{G}{G}' })] },
          battlefield: { p1: [creature('Team Mate', '{2}{G}')] },
          libraries: { p1: [creature('Library Pet', '{2}{G}')] },
        },
        { random: () => 0.5, cardPlugins: finisherPlugins },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 12, C: 0 }
      ready.step = 'precombatMain'
      const spell = named(ready, 'Finale of Devastation')
      const pet = named(ready, 'Library Pet')
      const mate = named(ready, 'Team Mate')

      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: spell.id,
        x: 10,
      }))
      const searching = run(server, cast, [{ type: 'resolveTop' }])
      const done = run(server, searching, [
        { type: 'move', objectId: pet.id, to: 'battlefield' },
        { type: 'shuffleLibrary', seat: 'p1' },
        { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
      ])

      expect(named(done, 'Library Pet').zone).toBe('battlefield')
      expect(done.objects[mate.id]).toMatchObject({ power: 12, toughness: 12 })
      expect(done.objects[mate.id].oracleText.toLowerCase()).toContain('haste')
    })

})
