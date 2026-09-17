import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import { DIALOG_CHOSEN, pendingDialog, pendingDialogLock } from '../pendingDialog'
import {
  SEARCH_CHOSEN,
  SEARCH_FETCH,
  librarySearch,
  pendingSearch,
  searchCandidates,
  searchSpecFor,
  searchingSeat,
} from './librarySearch'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, power: null, toughness: null, ...extra })

const forest = (name = 'Forest') =>
  card(name, ['Land'], { subtypes: ['Forest'], supertypes: ['Basic'], tapProduces: { G: 1 } })

const island = () =>
  card('Island', ['Land'], { subtypes: ['Island'], supertypes: ['Basic'], tapProduces: { U: 1 } })

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
  test('Scapeshift chooses and sacrifices lands before it is cast', () => {
    const server = game({
      hand: [card('Scapeshift', ['Sorcery'], { manaCost: '{2}{G}{G}' })],
      battlefield: [forest('First Forest'), forest('Second Forest')],
      library: [forest(), island()],
    })
    const spell = named(server.state, 'Scapeshift')
    const funded = withMana(server.state)
    funded.players.p1.mana.G = 4
    const choosing = ok(server.rules(funded, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
    }))

    expect(pendingDialog(choosing)).toMatchObject({
      kind: 'sacrifice-lands',
      source: 'Scapeshift',
    })
    expect(choosing.objects[spell.id].zone).toBe('hand')
    expect(choosing.players.p1.mana.G).toBe(4)

    const sacrificed = named(choosing, 'First Forest')
    const cast = run(server, choosing, [
      { type: 'castSpell', seat: 'p1', objectId: spell.id, sacrifice: [sacrificed.id] },
      { type: 'custom', name: DIALOG_CHOSEN, seat: 'p1' },
    ])
    expect(cast.objects[sacrificed.id].zone).toBe('graveyard')
    expect(cast.stack[0]).toMatchObject({ name: 'Scapeshift', sacrificed: 1 })

    const searching = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(pendingSearch(searching, 'p1')).toMatchObject({
      source: 'Scapeshift',
      max: 1,
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
      { type: 'resolveTop' },
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

  test("Nature's Lore stops resolution and records whose choice is open", () => {
    const server = game({
      hand: [card("Nature's Lore", ['Sorcery'], { manaCost: '{1}{G}' })],
      library: [forest('Wooded Foothills'), card('Not a land', ['Instant'])],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])

    expect(state.stack).toHaveLength(1)
    expect(searchingSeat(state)).toBe('p1')
    expect(pendingSearch(state, 'p1')?.source).toBe("Nature's Lore")
    expect(searchCandidates(state, 'p1', searchSpecFor("Nature's Lore")!).map((o) => o.name))
      .toEqual(['Wooded Foothills'])
  })

  test('nobody may pass priority while a search is open', () => {
    const server = game({
      hand: [card("Nature's Lore", ['Sorcery'], { manaCost: '{1}{G}' })],
      library: [forest()],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    const passed = server.rules(state, { type: 'passPriority', seat: 'p1' })
    expect(passed.ok).toBe(false)
    expect(passed.ok === false && passed.error).toContain('searching their library')
  })

  test('a repeated resolveTop cannot skip the open choice', () => {
    const server = game({
      hand: [card("Nature's Lore", ['Sorcery'], { manaCost: '{1}{G}' })],
      library: [forest()],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
      { type: 'resolveTop' },
    ])
    expect(state.stack).toHaveLength(1)
    expect(state.objects[spell].zone).toBe('stack')
    expect(searchingSeat(state)).toBe('p1')
  })

  test('the chosen card resolves the whole spell and clears the marker', () => {
    const server = game({
      hand: [card("Nature's Lore", ['Sorcery'], { manaCost: '{1}{G}' })],
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
      { type: 'resolveTop' },
    ])

    expect(state.objects[found].zone).toBe('battlefield')
    expect(state.objects[found].tapped).toBe(false)
    expect(state.objects[spell].zone).toBe('graveyard')
    expect(state.stack).toHaveLength(0)
    expect(searchingSeat(state)).toBeUndefined()
    expect(state.players.p1.data['librarySearch.done']).toBeUndefined()
  })

  test('Farseek only finds nonbasic-typed duals and basics it names', () => {
    const spec = searchSpecFor('Farseek')!
    const server = game({
      library: [
        forest(),
        island(),
        card('Watery Grave', ['Land'], { subtypes: ['Island', 'Swamp'] }),
      ],
    })
    expect(searchCandidates(server.state, 'p1', spec).map((object) => object.name))
      .toEqual(['Island', 'Watery Grave'])
    expect(spec.tapped).toBe(true)
  })

  test('a fetchland pays its life, sacrifices itself, and opens the search', () => {
    const server = game({
      battlefield: [card('Misty Rainforest', ['Land'])],
      library: [forest('Wooded Foothills'), card('Mountain', ['Land'], { subtypes: ['Mountain'] })],
    })
    const fetch = server.state.zoneOrder.p1.battlefield[0]
    const activation = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: fetch,
    })
    const state = ok(activation)

    expect(state.players.p1.life).toBe(39)
    expect(state.objects[fetch].zone).toBe('graveyard')
    expect(activation.trace.map(({ event }) => event.type))
      .toEqual(['activateAbility', 'loseLife', 'tap', 'move'])
    expect(pendingSearch(state, 'p1')?.via).toBe('ability')
    expect(searchCandidates(state, 'p1', searchSpecFor('Misty Rainforest')!).map((o) => o.name))
      .toEqual(['Wooded Foothills'])
  })

  test('an ability search needs no resolveTop to finish', () => {
    const server = game({
      battlefield: [card('Prismatic Vista', ['Land'])],
      library: [forest()],
    })
    const fetch = server.state.zoneOrder.p1.battlefield[0]
    const opened = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: fetch,
    }))
    const found = named(opened, 'Forest').id
    const state = run(server, opened, [
      { type: 'move', objectId: found, to: 'battlefield' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(state.objects[found].zone).toBe('battlefield')
    expect(searchingSeat(state)).toBeUndefined()
    expect(ok(server.rules(state, { type: 'passPriority', seat: 'p1' }))).toBeTruthy()
  })

  test('Evolving Wilds opens the same search without charging life', () => {
    const server = game({
      battlefield: [card('Evolving Wilds', ['Land'])],
      library: [forest()],
    })
    const fetch = server.state.zoneOrder.p1.battlefield[0]
    const state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: fetch,
    }))

    expect(state.players.p1.life).toBe(40)
    expect(state.objects[fetch].zone).toBe('graveyard')
    expect(pendingSearch(state, 'p1')?.source).toBe('Evolving Wilds')
    expect(searchSpecFor('Evolving Wilds')?.tapped).toBe(true)
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
    const opened = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: hideout,
    }))

    expect(opened.objects[hideout].zone).toBe('graveyard')
    expect(opened.players.p1.life).toBe(41)
    expect(pendingSearch(opened, 'p1')).toMatchObject({
      source: 'Brokers Hideout',
      via: 'enters',
    })
    expect(searchCandidates(
      opened,
      'p1',
      searchSpecFor('Brokers Hideout')!,
    ).map((object) => object.name)).toEqual(['Forest', 'Island'])

    const found = named(opened, 'Forest').id
    const resolved = run(server, opened, [
      { type: 'move', objectId: found, to: 'battlefield' },
      { type: 'tap', objectId: found },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(resolved.objects[found].zone).toBe('battlefield')
    expect(resolved.objects[found].tapped).toBe(true)
    expect(searchingSeat(resolved)).toBeUndefined()
  })

  test('a Hideout search does not expose library identities to another seat', () => {
    const server = game({
      hand: [card('Obscura Storefront', ['Land'])],
      library: [island()],
    })
    const opened = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.hand[0],
    }))
    const projected = server.project(opened, 'p2')

    expect(projected.zoneOrder.p1.library).toEqual([])
    expect(Object.values(projected.objects).some((object) => object.name === 'Island')).toBe(false)
    expect(pendingSearch(projected, 'p1')?.source).toBe('Obscura Storefront')
  })

  test('Blighted Woodland requires and pays four mana', () => {
    const server = game({
      battlefield: [card('Blighted Woodland', ['Land'])],
      library: [forest(), island()],
    })
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const rejected = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: sourceId,
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.ok === false && rejected.error).toContain('cannot pay {3}{G}')

    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 }
    const opened = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: sourceId,
    }))
    expect(opened.players.p1.mana.G).toBe(0)
    expect(opened.objects[sourceId].zone).toBe('graveyard')
    expect(searchSpecFor('Blighted Woodland')).toMatchObject({ min: 0, max: 2 })
  })

  test('a tapped fetchland cannot be activated', () => {
    const server = game({
      battlefield: [card('Polluted Delta', ['Land'], { tapped: true })],
      library: [island()],
    })
    const result = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.battlefield[0],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('already tapped')
  })

  test('a seat that cannot pay the life cannot crack the fetchland', () => {
    const server = game({
      battlefield: [card('Verdant Catacombs', ['Land'])],
      library: [forest()],
    })
    const dying = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, life: 1 },
      },
    }
    const result = server.rules(dying, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.battlefield[0],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('cannot pay 1 life')
  })

  test('a second search cannot open while one is still unanswered', () => {
    const server = game({
      battlefield: [
        card('Misty Rainforest', ['Land']),
        card('Polluted Delta', ['Land']),
      ],
      library: [forest(), island()],
    })
    const [first, second] = server.state.zoneOrder.p1.battlefield
    const opened = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: first,
    }))
    const result = server.rules(opened, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: second,
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('another library search is still open')
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
})
