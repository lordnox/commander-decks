import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import { abilityTokens } from '../keywords'
import type { GameState } from '../types'
import { activated } from './activated'
import { effectsFor } from './cardRules'
import { cycling } from './cycling'
import { linkedExile } from './linkedExile'
import {
  SEARCH_CHOSEN,
  librarySearch,
  pendingSearch,
} from './librarySearch'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'
import { unearth as unearthPlugin } from './unearth'
import { energy } from '../plugins/energy'

const deckCardsPath = join(
  import.meta.dir,
  '../../../decks/2+_dack-faydens-party/cards.json',
)

const oracleFor = (name: string) => {
  const deck = JSON.parse(readFileSync(deckCardsPath, 'utf8')) as {
    cards: { name: string, card: { oracle_text: string } }[]
  }
  const entry = deck.cards.find((card) => card.name === name)
  if (!entry?.card.oracle_text) throw new Error(`missing oracle for ${name}`)
  return entry.card.oracle_text
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const deckCreature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, {
    types: ['Creature'],
    oracleText: oracleFor(name),
    ...extra,
  })

const fixtureCreature = (
  name: string,
  extra: Parameters<typeof cardTemplate>[1] = {},
) => cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

const plains = () =>
  cardTemplate('Plains', {
    types: ['Land'],
    subtypes: ['Plains'],
    supertypes: ['Basic'],
    tapProduces: { W: 1 },
  })

describe('plug Dack part 36 creatures', () => {
  test('Alabaster Host Intercessor exiles an opponent creature until it leaves', () => {
    expect(effectsFor('Alabaster Host Intercessor').length).toBeGreaterThan(0)
    expect(oracleFor('Alabaster Host Intercessor')).toContain('Plainscycling {2}')

    const intercessor = deckCreature('Alabaster Host Intercessor', { manaCost: '{5}{W}' })
    const foe = fixtureCreature('Fixture Hostage', { controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: { p1: [intercessor] },
        battlefield: { p2: [foe] },
      },
      { random: () => 0.5, cardPlugins: [linkedExile] },
    )
    let state = structuredClone(server.state)
    const intercessorId = named(state, 'Alabaster Host Intercessor').id
    const foeId = named(state, 'Fixture Hostage').id

    state = ok(server.rules(state, {
      type: 'move',
      objectId: intercessorId,
      to: 'battlefield',
    }))
    state = resolveStack(server.rules, state)
    expect(pendingSelectionFor(state, 'p1')).toBeDefined()
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [foeId],
    }))
    state = resolveStack(server.rules, state)
    expect(state.objects[foeId]).toMatchObject({ zone: 'exile', exiledWith: intercessorId })
  })

  test('Alabaster Host Intercessor plainscycles from hand through library search', () => {
    const intercessor = deckCreature('Alabaster Host Intercessor', { manaCost: '{5}{W}' })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [intercessor] },
        libraries: { p1: [plains()] },
      },
      { random: () => 0.5, cardPlugins: [activated, cycling, librarySearch] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana.C = 2
    const intercessorId = named(state, 'Alabaster Host Intercessor').id
    const cycled = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'plainscycling.alabasterHostIntercessor',
      seat: 'p1',
      objectId: intercessorId,
    }))
    const opened = ok(server.rules(cycled, { type: 'resolveTop' }))
    const search = pendingSearch(opened, 'p1')!
    const found = named(opened, 'Plains').id
    state = ok(server.rules(opened, {
      type: 'move',
      objectId: found,
      to: 'hand',
    }))
    state = ok(server.rules(state, { type: 'shuffleLibrary', seat: 'p1' }))
    state = ok(server.rules(state, { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' }))
    expect(named(state, 'Plains').zone).toBe('hand')
  })

  test('Curious Colossus chooses an opponent then shrinks their board', () => {
    expect(oracleFor('Curious Colossus')).toContain('Coward')
    const colossus = deckCreature('Curious Colossus', { manaCost: '{4}{W}' })
    const bear = fixtureCreature('Fixture Curious Bear', { controller: 'p2', power: 4, toughness: 4 })
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        hands: { p1: [colossus] },
        battlefield: { p2: [bear] },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana.W = 4
    state.players.p1.mana.C = 1
    const colossusId = named(state, 'Curious Colossus').id
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: colossusId,
    }))
    state = resolveStack(server.rules, state)
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    const restarted = structuredClone(state)
    expect(pendingPlayerSelectionFor(restarted, 'p1')?.id).toBe(choice.id)
    expect(projectForViewer(restarted, 'p2').pendingPlayerSelection).toBeUndefined()

    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    expect(named(state, 'Fixture Curious Bear')).toMatchObject({
      power: 1,
      toughness: 1,
      subtypes: expect.arrayContaining(['Coward']),
    })
    expect(named(state, 'Fixture Curious Bear').effects).toEqual([])
  })

  test('Githzerai Monk taps every creature you do not control on ETB', () => {
    expect(oracleFor('Githzerai Monk')).toContain('tap all creatures you don\'t control')
    const monk = deckCreature('Githzerai Monk', { manaCost: '{2}{W}{U}' })
    const ally = fixtureCreature('Fixture Ally', { controller: 'p1' })
    const foe = fixtureCreature('Fixture Foe', { controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [monk] },
        battlefield: { p1: [ally], p2: [foe] },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 2, U: 1, B: 0, R: 0, G: 0, C: 0 }
    state = ok(server.rules(state, {
      type: 'move',
      objectId: named(state, 'Githzerai Monk').id,
      to: 'battlefield',
    }))
    state = resolveStack(server.rules, state)
    expect(named(state, 'Fixture Ally').tapped).toBe(false)
    expect(named(state, 'Githzerai Monk').tapped).toBe(false)
    expect(named(state, 'Fixture Foe').tapped).toBe(true)
  })

  test('Meteor Golem destroys an opponent nonland on ETB', () => {
    expect(oracleFor('Meteor Golem')).toContain('destroy target nonland permanent an opponent controls')
    const golem = deckCreature('Meteor Golem', { manaCost: '{8}' })
    const rock = cardTemplate('Fixture Rock', {
      types: ['Artifact'],
      controller: 'p2',
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [golem] },
        battlefield: { p2: [rock] },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana.C = 8
    const rockId = named(state, 'Fixture Rock').id
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Meteor Golem').id,
      targets: [{ kind: 'object', objectId: rockId }],
    }))
    state = resolveStack(server.rules, state)
    expect(state.objects[rockId].zone).toBe('graveyard')
  })

  test('Salvation Colossus pumps on attack and unearths for eight energy', () => {
    expect(oracleFor('Salvation Colossus')).toContain('Pay eight {E}')
    const colossus = deckCreature('Salvation Colossus', {
      manaCost: '{5}{W}{W}',
      power: 9,
      toughness: 9,
    })
    const ally = fixtureCreature('Fixture Colossus Ally', { controller: 'p1', power: 2, toughness: 2 })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [colossus] },
        battlefield: { p1: [ally] },
        graveyards: { p1: [] },
      },
      { random: () => 0.5, cardPlugins: [activated, unearthPlugin, energy, onResolve] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 5, U: 0, B: 0, R: 0, G: 0, C: 0 }
    const colossusId = named(state, 'Salvation Colossus').id
    state = ok(server.rules(state, {
      type: 'move',
      objectId: colossusId,
      to: 'battlefield',
    }))
    state = resolveStack(server.rules, state)
    state.objects[colossusId].summoningSickness = false

    state = structuredClone(state)
    state.step = 'declareAttackers'
    state.active = 'p1'
    state.priority = 'p1'
    state = ok(server.rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: colossusId, defender: 'p2' }],
    }))
    state = resolveStack(server.rules, state)
    while (state.stack.length > 0) {
      state = ok(server.rules(state, { type: 'resolveTop' }))
    }
    const allyObject = named(state, 'Fixture Colossus Ally')
    expect(allyObject.power).toBe(4)
    expect(abilityTokens(allyObject.oracleText).includes('indestructible')).toBe(true)

    state = ok(server.rules(state, { type: 'move', objectId: colossusId, to: 'graveyard' }))
    state = ok(server.rules(state, { type: 'addEnergy', seat: 'p1', amount: 8 }))
    state.step = 'precombatMain'
    state.phase = 'main'
    state.active = 'p1'
    state.priority = 'p1'
    const stacked = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'unearth',
      seat: 'p1',
      objectId: colossusId,
    }))
    const unearthed = resolveStack(server.rules, stacked)
    expect(unearthed.objects[colossusId].zone).toBe('battlefield')
    expect(unearthed.players.p1.energy).toBe(0)
  })

  test('kernel-only creatures stay off cardRules', () => {
    expect(effectsFor('Akroma, Angel of Wrath')).toEqual([])
    expect(effectsFor('Darksteel Colossus')).toEqual([])
  })
})
