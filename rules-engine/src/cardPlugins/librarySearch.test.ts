import { describe, expect, test } from 'bun:test'
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
import { pendingSelectionFor } from '../rules/selectCards'
import { choiceEffects } from './choiceEffects'
import { entersTapped } from './entersTapped'
import {
  SEARCH_CHOSEN,
  SEARCH_FETCH,
  librarySearch,
  pendingSearch,
  searchCandidates,
  searchSpecFor,
  searchingSeat,
} from './librarySearch'
import {
  basicLand,
  bounceSelf,
  delay,
  searchAbility,
} from './effects'

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

    expect(asking.players.p1.life).toBe(41)
    expect(pendingSearch(asking, 'p1')?.source).toBe('Riveteers Overlook')

    const resolved = ok(server.rules(asking, { type: 'resolveTop' }))

    expect(resolved.objects[spell.id].zone).toBe('graveyard')
    expect(pendingSearch(resolved, 'p1')?.source).toBe('Riveteers Overlook')
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
      { type: 'resolveTop' },
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
      .toEqual(['activateAbility', 'payLife', 'loseLife', 'tap', 'sacrifice', 'move'])
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
    expect(rejected.ok === false && rejected.error).toContain('not enough mana')

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

  test('a seat may pay its final life to crack a fetchland', () => {
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
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.players.p1.life).toBe(0)
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
      { type: 'resolveTop' },
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
    const resolved = ok(server.rules(opened, { type: 'resolveTop' }))
    expect(pendingDialog(resolved)).toMatchObject({
      kind: 'may-search',
      source: 'Farhaven Elf',
    })
    const declined = ok(server.rules(resolved, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: false },
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

    let state = { ...searched, step: 'end' as const }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.objects[sourceId].zone).toBe('battlefield')
    expect(state.stack[0]).toMatchObject({ kind: 'ability', name: 'Test Cleanup Fetch' })
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[sourceId].zone).toBe('hand')
    expect(state.objects[found].zone).toBe('battlefield')
  })
})
