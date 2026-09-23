import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { becomeCopyOfTarget } from './becomeCopyOfTarget'
import { cardDefinition, effectsFor } from './cardRules'
import { cycling } from './cycling'
import { entersTapped } from './entersTapped'
import { cardPluginEntry, missingCardPlugins } from './index'
import {
  librarySearch,
  SEARCH_FETCH,
  pendingSearch,
} from './librarySearch'
import { linkedExile } from './linkedExile'

const plugins = [activated, becomeCopyOfTarget, cycling, entersTapped, librarySearch, linkedExile]

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
    expect(picked.objects[stageId].tapProduces).toEqual({ G: 1 })
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
})
