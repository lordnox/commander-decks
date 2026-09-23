import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { activated } from './activated'
import { becomeCopyOfTarget } from './becomeCopyOfTarget'
import { cardDefinition, effectsFor } from './cardRules'
import { cycling } from './cycling'
import { entersTapped } from './entersTapped'
import { cardPluginEntry, missingCardPlugins } from './index'
import {
  librarySearch,
  SEARCH_CHOSEN,
  SEARCH_FETCH,
  pendingSearch,
  searchCandidates,
  searchSpecFor,
} from './librarySearch'
import { linkedExile } from './linkedExile'
import { onResolve } from './onResolve'

const plugins = [
  activated,
  becomeCopyOfTarget,
  cycling,
  entersTapped,
  librarySearch,
  linkedExile,
  onResolve,
]

const run = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

const passAll = (server: ReturnType<typeof createServerGame>, state: GameState) => {
  let current = state
  for (let round = 0; round < 12; round += 1) {
    if (current.stack.length === 0) break
    const top = current.stack[0]
    if (top.kind === 'action' && top.waiting === 'choice') break
    current = ok(server.rules(current, { type: 'resolveTop' }))
  }
  return current
}

const forest = () =>
  cardTemplate('Forest', {
    types: ['Land'],
    subtypes: ['Forest'],
    supertypes: ['Basic'],
    tapProduces: { G: 1 },
  })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const plains = () =>
  cardTemplate('Plains', {
    types: ['Land'],
    subtypes: ['Plains'],
    supertypes: ['Basic'],
    tapProduces: { W: 1 },
    oracleText: '({T}: Add {W}.)',
  })

const solRing = () =>
  cardTemplate('Sol Ring', {
    types: ['Artifact'],
    manaCost: '{1}',
    oracleText: '{T}: Add {C}{C}.',
    tapProduces: { C: 2 },
  })

describe('Dack Fayden part 32 — lands, rocks, maps', () => {
  test('built-in mana covers Plains and Sol Ring without cardRules entries', () => {
    expect(cardPluginEntry('Plains')).toBeUndefined()
    expect(cardPluginEntry('Sol Ring')).toBeUndefined()
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [plains(), solRing()] } },
      { random: () => 0.5 },
    )
    const ringId = named(server.state, 'Sol Ring').id
    const tapped = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: ringId,
    }))
    expect(tapped.players.p1.mana.C).toBe(2)
  })

  test('registered part-32 cards are in the card pool table', () => {
    const registered = [
      "Archaeomancer's Map",
      "Commander's Sphere",
      'Endless Sands',
      'Everflowing Chalice',
      'Expedition Map',
      'Geier Reach Sanitarium',
      'Gilded Lotus',
      'Hedron Archive',
      'High Market',
      'Mind Stone',
      'Moonsilver Key',
      'Myriad Landscape',
      'Secluded Steppe',
      'Temple of the False God',
      "Thespian's Stage",
      "Thrór's Map",
      "Urza's Cave",
      'World Map',
      'Worn Powerstone',
    ]
    expect(missingCardPlugins(registered)).toEqual([])
  })

  test('Mind Stone sacrifices for a card', () => {
    const drawn = cardTemplate('Drawn', { types: ['Instant'] })
    const stone = cardTemplate('Mind Stone', {
      types: ['Artifact'],
      oracleText: '{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.',
      tapProduces: { C: 1 },
      effects: effectsFor('Mind Stone'),
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [stone] }, libraries: { p1: [drawn] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const stoneId = named(server.state, 'Mind Stone').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 }
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'mindStone.draw',
      seat: 'p1',
      objectId: stoneId,
    }))
    const resolved = resolveStack(server.rules, activatedState)
    expect(resolved.objects[stoneId].zone).toBe('graveyard')
    expect(named(resolved, 'Drawn').zone).toBe('hand')
  })

  test('Gilded Lotus adds three of the chosen color', () => {
    const lotus = cardTemplate('Gilded Lotus', {
      types: ['Artifact'],
      oracleText: '{T}: Add three mana of any one color.',
      effects: effectsFor('Gilded Lotus'),
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [lotus] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const lotusId = named(server.state, 'Gilded Lotus').id
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'gildedLotus.mana',
      seat: 'p1',
      objectId: lotusId,
      manaAbility: true,
      choices: ['W'],
    }))
    expect(activatedState.players.p1.mana.W).toBe(3)
  })

  test("Thespian's Stage copies a land and keeps its copy ability", () => {
    const stage = cardTemplate("Thespian's Stage", {
      types: ['Land'],
      tapProduces: { C: 1 },
      effects: effectsFor("Thespian's Stage"),
    })
    const quarry = cardTemplate('Quarry', {
      types: ['Land'],
      tapProduces: { G: 1 },
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [stage, quarry] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const stageId = named(server.state, "Thespian's Stage").id
    const quarryId = named(server.state, 'Quarry').id
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana.C = 2
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'thespiansStage.copy',
      seat: 'p1',
      objectId: stageId,
    }))
    const opened = ok(server.rules(activatedState, { type: 'resolveTop' }))
    expect(pendingSelectionFor(opened, 'p1')).toBeDefined()
    const picked = ok(server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [quarryId],
    }))
    expect(picked.objects[stageId]).toMatchObject({
      name: 'Quarry',
      tapProduces: { G: 1 },
    })
    expect(picked.objects[stageId].effects?.some((effect) =>
      effect.op === 'activate' && effect.id === 'thespiansStage.copy')).toBe(true)
    picked.players.p1.mana.C = 2
    picked.objects[stageId].tapped = false
    const reactivated = ok(server.rules(picked, {
      type: 'activateAbility',
      abilityId: 'thespiansStage.copy',
      seat: 'p1',
      objectId: stageId,
    }))
    const again = ok(server.rules(reactivated, { type: 'resolveTop' }))
    expect(pendingSelectionFor(again, 'p1')?.candidates).toContain(quarryId)
  })

  test('Endless Sands exiles your creature then returns it when sacrificed', () => {
    const sands = cardTemplate('Endless Sands', {
      types: ['Land'],
      tapProduces: { C: 1 },
      effects: effectsFor('Endless Sands'),
    })
    const bear = cardTemplate('Bear', { types: ['Creature'], power: 2, toughness: 2 })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [sands, bear] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const sandsId = named(server.state, 'Endless Sands').id
    const bearId = named(server.state, 'Bear').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2
    const exileStart = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'endlessSands.exile',
      seat: 'p1',
      objectId: sandsId,
      targets: [{ kind: 'object', objectId: bearId }],
    }))
    const exiled = resolveStack(server.rules, exileStart)
    expect(exiled.objects[bearId]).toMatchObject({ zone: 'exile', exiledWith: sandsId })

    const returnReady = structuredClone(exiled)
    returnReady.players.p1.mana.C = 4
    returnReady.objects[sandsId].tapped = false
    const returnStart = ok(server.rules(returnReady, {
      type: 'activateAbility',
      abilityId: 'endlessSands.return',
      seat: 'p1',
      objectId: sandsId,
    }))
    const returned = resolveStack(server.rules, returnStart)
    expect(returned.objects[bearId].zone).toBe('battlefield')
    expect(returned.objects[sandsId].zone).toBe('graveyard')
  })

  test('Geier Reach Sanitarium draws for each player when the ability resolves', () => {
    const sanitarium = cardTemplate('Geier Reach Sanitarium', {
      types: ['Land'],
      tapProduces: { C: 1 },
      effects: effectsFor('Geier Reach Sanitarium'),
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        battlefield: { p1: [sanitarium] },
        libraries: {
          p1: [cardTemplate('L1', { types: ['Instant'] })],
          p2: [cardTemplate('L2', { types: ['Instant'] })],
          p3: [cardTemplate('L3', { types: ['Instant'] })],
          p4: [cardTemplate('L4', { types: ['Instant'] })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const sanId = named(server.state, 'Geier Reach Sanitarium').id
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana.C = 2
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'geierReach.tableLoot',
      seat: 'p1',
      objectId: sanId,
    }))
    const resolved = resolveStack(server.rules, activatedState)
    expect(resolved.zoneOrder.p1.hand).toHaveLength(1)
    expect(resolved.zoneOrder.p2.hand).toHaveLength(1)
  })

  test('Expedition Map sacrifices itself and opens a hidden library search', () => {
    const map = cardTemplate('Expedition Map', {
      types: ['Artifact'],
      effects: effectsFor('Expedition Map'),
    })
    const found = plains()
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [map] }, libraries: { p1: [found] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const mapId = named(server.state, 'Expedition Map').id
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana.C = 2
    const opened = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: mapId,
    }))
    expect(opened.objects[mapId].zone).toBe('graveyard')
    expect(pendingSearch(opened, 'p1')).toBeDefined()
    expect(projectForViewer(opened, 'p2').libraries?.p1).toBeUndefined()
  })

  test('cardDefinition lists handlers for Endless Sands and Thespian\'s Stage', () => {
    expect(cardDefinition('Endless Sands')?.handlerIds).toEqual(
      expect.arrayContaining(['linkedExile', 'activated']),
    )
    expect(cardDefinition("Thespian's Stage")?.handlerIds).toEqual(
      expect.arrayContaining(['becomeCopyOfTarget', 'activated']),
    )
  })

  test("Archaeomancer's Map ETB finds up to two Plains and puts them in hand", () => {
    const map = cardTemplate("Archaeomancer's Map", {
      types: ['Artifact'],
      manaCost: '{2}{W}',
      effects: effectsFor("Archaeomancer's Map"),
    })
    const p1 = plains()
    const p2 = cardTemplate('Plains Two', {
      types: ['Land'],
      subtypes: ['Plains'],
      supertypes: ['Basic'],
      tapProduces: { W: 1 },
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [map] }, libraries: { p1: [p1, p2, cardTemplate('Island', { types: ['Land'], subtypes: ['Island'] })] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const mapId = server.state.zoneOrder.p1.hand[0]
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 2 }
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: mapId,
    }))
    const resolved = resolveStack(server.rules, cast)
    expect(pendingSearch(resolved, 'p1')).toMatchObject({ source: "Archaeomancer's Map", via: 'enters' })
    const spec = searchSpecFor("Archaeomancer's Map")!
    expect(searchCandidates(resolved, 'p1', spec).map((object) => object.name)).toEqual(['Plains', 'Plains Two'])
    const first = named(resolved, 'Plains').id
    const second = named(resolved, 'Plains Two').id
    const finished = run(server, resolved, [
      { type: 'move', objectId: first, to: 'hand' },
      { type: 'move', objectId: second, to: 'hand' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(finished.zoneOrder.p1.hand).toHaveLength(2)
    expect(projectForViewer(finished, 'p2').libraries?.p1).toBeUndefined()
  })

  test("Archaeomancer's Map offers a land drop when an ahead opponent plays a land", () => {
    const map = cardTemplate("Archaeomancer's Map", {
      types: ['Artifact'],
      effects: effectsFor("Archaeomancer's Map"),
    })
    const oppLand = cardTemplate('Opponent Land', { types: ['Land'], tapProduces: { C: 1 } })
    const server = createServerGame(
      commanderRules,
      {
        first: 'p2',
        battlefield: {
          p1: [map, plains()],
          p2: [cardTemplate('Opp One', { types: ['Land'] }), cardTemplate('Opp Two', { types: ['Land'] })],
        },
        hands: { p1: [forest()], p2: [oppLand] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const opponentLandId = server.state.zoneOrder.p2.hand[0]
    let state = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p2',
      objectId: opponentLandId,
    }))
    expect(state.stack[0]?.name).toBe("Archaeomancer's Map")
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 1, min: 0 })
    const landId = state.zoneOrder.p1.hand.find((id) => state.objects[id]?.types.includes('Land'))!
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [landId],
    }))
    expect(state.objects[landId].zone).toBe('battlefield')
    expect(state.players.p1.landsPlayed).toBe(0)
  })

  test('Everflowing Chalice enters with charge counters from multikicker', () => {
    const chalice = cardTemplate('Everflowing Chalice', {
      types: ['Artifact'],
      manaCost: '{0}',
      oracleText: '{T}: Add {C} for each charge counter on this artifact.',
      effects: effectsFor('Everflowing Chalice'),
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [chalice] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 4 }
    const spell = ready.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      timesKicked: 2,
    }))
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.objects[spell].counters.charge).toBe(2)
  })

  test('Secluded Steppe plainscycles into hand after the search closes', () => {
    const steppe = cardTemplate('Secluded Steppe', {
      types: ['Land'],
      subtypes: ['Plains'],
      tapProduces: { W: 1 },
      effects: effectsFor('Secluded Steppe'),
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [steppe] }, libraries: { p1: [plains()] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const steppeId = named(server.state, 'Secluded Steppe').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.W = 1
    const cycled = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'cycling.secludedSteppe',
      seat: 'p1',
      objectId: steppeId,
    }))
    const opened = ok(server.rules(cycled, { type: 'resolveTop' }))
    const found = named(opened, 'Plains').id
    const finished = run(server, opened, [
      { type: 'move', objectId: found, to: 'hand' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(named(finished, 'Plains').zone).toBe('hand')
    expect(finished.objects[steppeId].zone).toBe('graveyard')
  })

  test("Urza's Cave sacrifices itself and puts a searched land onto the battlefield tapped", () => {
    const cave = cardTemplate("Urza's Cave", {
      types: ['Land'],
      tapProduces: { C: 1 },
      effects: effectsFor("Urza's Cave"),
    })
    const quarry = cardTemplate('Quarry Land', { types: ['Land'], tapProduces: { C: 1 } })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [cave] }, libraries: { p1: [quarry] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const caveId = named(server.state, "Urza's Cave").id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 3
    const opened = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: caveId,
    }))
    expect(opened.objects[caveId].zone).toBe('graveyard')
    const found = named(opened, 'Quarry Land').id
    const finished = run(server, opened, [
      { type: 'move', objectId: found, to: 'battlefield' },
      { type: 'tap', objectId: found },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(finished.objects[found].zone).toBe('battlefield')
    expect(finished.objects[found].tapped).toBe(true)
  })

  test('Worn Powerstone enters the battlefield tapped', () => {
    const stone = cardTemplate('Worn Powerstone', {
      types: ['Artifact'],
      manaCost: '{3}',
      tapProduces: { C: 2 },
      effects: effectsFor('Worn Powerstone'),
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [stone] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana.C = 3
    const spell = ready.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: spell }))
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.objects[spell].tapped).toBe(true)
  })

  test("Commander's Sphere sacrifices for a card", () => {
    const drawn = cardTemplate('Sphere Draw', { types: ['Instant'] })
    const sphere = cardTemplate("Commander's Sphere", {
      types: ['Artifact'],
      tapProduces: { C: 1 },
      effects: effectsFor("Commander's Sphere"),
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [sphere] }, libraries: { p1: [drawn] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const sphereId = named(server.state, "Commander's Sphere").id
    const tapped = structuredClone(server.state)
    tapped.objects[sphereId].tapped = true
    expect(server.rules(tapped, {
      type: 'activateAbility',
      abilityId: 'commandersSphere.draw',
      seat: 'p1',
      objectId: sphereId,
    }).ok).toBe(false)
    const activatedState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'commandersSphere.draw',
      seat: 'p1',
      objectId: sphereId,
    }))
    const resolved = resolveStack(server.rules, activatedState)
    expect(resolved.objects[sphereId].zone).toBe('graveyard')
    expect(named(resolved, 'Sphere Draw').zone).toBe('hand')
  })

  test('Hedron Archive sacrifices for two cards', () => {
    const a = cardTemplate('Archive A', { types: ['Instant'] })
    const b = cardTemplate('Archive B', { types: ['Instant'] })
    const archive = cardTemplate('Hedron Archive', {
      types: ['Artifact'],
      tapProduces: { C: 2 },
      effects: effectsFor('Hedron Archive'),
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [archive] }, libraries: { p1: [a, b] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const archiveId = named(server.state, 'Hedron Archive').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'hedronArchive.draw',
      seat: 'p1',
      objectId: archiveId,
    }))
    const resolved = resolveStack(server.rules, activatedState)
    expect(resolved.zoneOrder.p1.hand).toHaveLength(2)
    expect(resolved.objects[archiveId].zone).toBe('graveyard')
  })

  test('High Market sacrifices a creature and gains 1 life', () => {
    const market = cardTemplate('High Market', {
      types: ['Land'],
      tapProduces: { C: 1 },
      effects: effectsFor('High Market'),
    })
    const elf = cardTemplate('Elf', { types: ['Creature'], power: 1, toughness: 1 })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [market, elf] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const marketId = named(server.state, 'High Market').id
    const elfId = named(server.state, 'Elf').id
    const activatedState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'highMarket.gain',
      seat: 'p1',
      objectId: marketId,
      choices: [elfId],
    }))
    const resolved = resolveStack(server.rules, activatedState)
    expect(resolved.objects[elfId].zone).toBe('graveyard')
    expect(resolved.players.p1.life).toBe(41)
  })

  test('Moonsilver Key finds an artifact with a mana ability to hand', () => {
    const key = cardTemplate('Moonsilver Key', {
      types: ['Artifact'],
      effects: effectsFor('Moonsilver Key'),
    })
    const ring = solRing()
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [key] }, libraries: { p1: [ring] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const keyId = named(server.state, 'Moonsilver Key').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 1
    const opened = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: keyId,
    }))
    expect(opened.objects[keyId].zone).toBe('graveyard')
    const found = named(opened, 'Sol Ring').id
    const finished = run(server, opened, [
      { type: 'move', objectId: found, to: 'hand' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(named(finished, 'Sol Ring').zone).toBe('hand')
  })

  test("Thrór's Map ETB finds a basic land to hand", () => {
    const map = cardTemplate("Thrór's Map", {
      types: ['Artifact'],
      manaCost: '{2}',
      effects: effectsFor("Thrór's Map"),
    })
    const drawn = plains()
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [map] }, libraries: { p1: [drawn] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana.C = 2
    const spell = ready.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: spell }))
    const entered = resolveStack(server.rules, cast)
    const found = named(entered, 'Plains').id
    const withPlains = run(server, entered, [
      { type: 'move', objectId: found, to: 'hand' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(named(withPlains, 'Plains').zone).toBe('hand')
  })

  test("Thrór's Map loot draws then discards through continueAction", () => {
    const map = cardTemplate("Thrór's Map", {
      types: ['Artifact'],
      manaCost: '{2}',
      effects: effectsFor("Thrór's Map"),
    })
    const toDiscard = cardTemplate('To Discard', { types: ['Instant'] })
    const drawn = cardTemplate('Loot Draw', { types: ['Instant'] })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [map] },
        hands: { p1: [toDiscard] },
        libraries: { p1: [drawn] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const mapId = named(server.state, "Thrór's Map").id
    const discardId = named(server.state, 'To Discard').id
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana.C = 2
    const lootStart = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'throrsMap.loot',
      seat: 'p1',
      objectId: mapId,
    }))
    const afterAbility = passAll(server, lootStart)
    expect(named(afterAbility, 'Loot Draw').zone).toBe('hand')
    expect(afterAbility.stack[0]).toMatchObject({ actionId: 'discard' })
    const waiting = ok(server.rules(afterAbility, { type: 'resolveTop' }))
    expect(waiting.stack[0].waiting).toBe('choice')
    const finished = ok(server.rules(waiting, {
      type: 'continueAction',
      stackId: waiting.stack[0].id,
      seat: 'p1',
      payload: { objectIds: [discardId] },
    }))
    expect(finished.stack).toHaveLength(0)
    expect(finished.objects[discardId].zone).toBe('graveyard')
    expect(finished.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('Myriad Landscape sacrifices and fetches two basics that share a type', () => {
    const landscape = cardTemplate('Myriad Landscape', {
      types: ['Land'],
      tapProduces: { C: 1 },
      effects: effectsFor('Myriad Landscape'),
    })
    const forestA = cardTemplate('Forest A', {
      types: ['Land'],
      subtypes: ['Forest'],
      supertypes: ['Basic'],
      tapProduces: { G: 1 },
    })
    const forestB = cardTemplate('Forest B', {
      types: ['Land'],
      subtypes: ['Forest'],
      supertypes: ['Basic'],
      tapProduces: { G: 1 },
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [landscape] }, libraries: { p1: [forestA, forestB] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const landscapeId = named(server.state, 'Myriad Landscape').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2
    const opened = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: SEARCH_FETCH,
      seat: 'p1',
      objectId: landscapeId,
    }))
    expect(opened.objects[landscapeId].zone).toBe('graveyard')
    const spec = searchSpecFor('Myriad Landscape')!
    expect(searchCandidates(opened, 'p1', spec).map((object) => object.name)).toEqual(['Forest A', 'Forest B'])
  })
})

describe('Dack Fayden part 32 — explicit GAP checklist', () => {
  test('Emergence Zone and Northampton Farm have no CARD_RULES entry', () => {
    expect(cardPluginEntry('Emergence Zone')).toBeUndefined()
    expect(cardPluginEntry('Northampton Farm')).toBeUndefined()
  })

  test.each([
    [
      'Emergence Zone',
      'Sacrifice-for-flash and {1},{T} timing are not composable from existing plugins; only basic tap-for-{C} is modeled without CARD_RULES.',
    ],
    [
      'Northampton Farm',
      'Exile a creature you own, then return one exiled creature to the battlefield and other exiled cards to hand is not composable from linkedExile like Endless Sands.',
    ],
    [
      'Everflowing Chalice (tap mana)',
      'Multikicker charge counters on ETB are wired; {T}: Add {C} for each charge counter has no generic mana-capability.',
    ],
    [
      "Archaeomancer's Map (land enter)",
      'Second ability uses playLand + opponentHasMore, not land-enter nor comparing land counts to the triggering opponent in multiplayer.',
    ],
  ] as const)('documented GAP: %s', (_label, note) => {
    expect(note.length).toBeGreaterThan(20)
  })
})
