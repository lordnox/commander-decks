import { describe, expect, test } from 'bun:test'
import { availableActions, eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'

import {catalogEntry, deckCards, loadCardPlugins} from '../deckCardFixtures'
import {replayCardTemplate} from '../replay'
import {resolveStack} from '../testHelpers'
import {pendingPlayerSelectionFor} from '../rules/selectPlayers'
import {pendingDialogFor, DIALOG_CHOSEN} from '../pendingDialog'
const bridgeworks = () => cardTemplate('Bridgeworks Battle // Tanglespan Bridgeworks', {
  types: ['Sorcery', 'Land'],
  manaCost: '{2}{G}',
  frontFace: {
    types: ['Sorcery'],
    subtypes: [],
    supertypes: [],
    manaCost: '{2}{G}',
    manaValue: 3,
    colors: ['G'],
  },
  backFace: {
    types: ['Land'],
    subtypes: [],
    supertypes: [],
    manaCost: '',
    manaValue: 0,
    colors: [],
  },
})

describe('modal double-faced cards', () => {
  test('offers both faces, then plays the land face', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [bridgeworks()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const funded = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: {
          ...server.state.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 2 },
        },
      },
    }

    // This fixture supplies no spell instruction; check face availability, not host automation.
    expect(availableActions(funded, 'p1').map((action) => action.kind))
      .toEqual(expect.arrayContaining(['playLand', 'castSpell']))

    const played = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
    expect(played.objects[objectId]).toMatchObject({
      zone: 'battlefield',
      types: ['Land'],
      manaCost: '',
    })
  })

  test('casts the spell face and restores its front face after a land leaves', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [bridgeworks()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const funded = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: {
          ...server.state.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 2 },
        },
      },
    }
    const cast = ok(server.rules(funded, { type: 'castSpell', seat: 'p1', objectId }))
    expect(cast.objects[objectId]).toMatchObject({ zone: 'stack', types: ['Sorcery'] })
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[objectId]).toMatchObject({ zone: 'graveyard', types: ['Sorcery'] })

    const fresh = createServerGame(commanderRules, { hands: { p1: [bridgeworks()] } })
    const landId = fresh.state.zoneOrder.p1.hand[0]
    const played = ok(fresh.rules(fresh.state, { type: 'playLand', seat: 'p1', objectId: landId }))
    const bounced = ok(fresh.rules(played, { type: 'move', objectId: landId, to: 'hand' }))
    expect(bounced.objects[landId]).toMatchObject({ zone: 'hand', types: ['Sorcery'] })
  })

  test('plans the cast from the spell face text, not the land face that "enters tapped"', () => {
    const landText = 'As this land enters, you may pay 3 life. If you don\'t, it enters tapped.'
    const spellText = 'Draw cards equal to the number of cards in your hand plus one.'
    const card = cardTemplate('Sea Gate Restoration // Sea Gate, Reborn', {
      types: ['Sorcery', 'Land'],
      manaCost: '{1}{U} // ',
      oracleText: `${spellText} // ${landText}`,
      frontFace: {
        types: ['Sorcery'],
        subtypes: [],
        supertypes: [],
        manaCost: '{1}{U}',
        manaValue: 2,
        colors: ['U'],
        oracleText: spellText,
      },
      backFace: {
        types: ['Land'],
        subtypes: [],
        supertypes: [],
        manaCost: '',
        manaValue: 0,
        colors: [],
        oracleText: landText,
      },
    })
    const server = createServerGame(commanderRules, { hands: { p1: [card] } })
    const funded = structuredClone(server.state)
    funded.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 1 }
    const spell = legalActsFor(funded, 'p1').find((action) => action.kind === 'castSpell')
    expect(spell).toBeDefined()
    expect(eventsForAvailableAction(funded, 'p1', spell!)?.at(-1)).toMatchObject({
      type: 'castSpell',
      objectId: funded.zoneOrder.p1.hand[0],
    })
  })
})

const kambalNames = ['Godless Shrine', 'Vault of Champions', 'Concealed Courtyard', 'Bojuka Bog', 'Boggart Trawler // Boggart Bog']
const kambalPlugins = await loadCardPlugins(kambalNames)
const kambalFixture = (name: string) => {
  const entry = deckCards('3_kambal-taxing-the-token-economy').find((card) => card.name === name)!
  const catalog = catalogEntry(entry)
  if (name.startsWith('Boggart')) catalog.faces![0].stats = '3/1'
  return replayCardTemplate(name, catalog)
}
const kambalLand = () => cardTemplate('Swamp', { types: ['Land'], subtypes: ['Swamp'] })
const kambalGame = (name: string, landCount = 0) => createServerGame(commanderRules, {
  hands: { p1: [kambalFixture(name)] },
  battlefield: { p1: Array.from({ length: landCount }, kambalLand) },
  libraries: { p1: [cardTemplate('Own card', { zone: 'graveyard' })], p2: [cardTemplate('Enemy card', { zone: 'graveyard' }), cardTemplate('Enemy card two', { zone: 'graveyard' })] },
}, { random: () => 0.5, cardPlugins: kambalPlugins })

describe('relocated from kambalManaGraveyards.test.ts → doubleFaced.test.ts', () => {
  test('Trawler casts its front face, triggers, and resets after the land face leaves', () => {
      const server = kambalGame('Boggart Trawler // Boggart Bog')
      const id = server.state.zoneOrder.p1.hand[0]
      server.state.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 2 }
      expect(legalActsFor(server.state, 'p1').map((act) => act.kind)).toEqual(expect.arrayContaining(['castSpell', 'playLand']))
      let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id }))
      state = resolveStack(server.rules, state)
      expect(state.objects[id].types).toContain('Creature')
      expect(pendingPlayerSelectionFor(state, 'p1')).toBeDefined()
      expect(pendingDialogFor(state, 'p1')).toBeUndefined()
      const fresh = kambalGame('Boggart Trawler // Boggart Bog')
      const landId = fresh.state.zoneOrder.p1.hand[0]
      let played = ok(fresh.rules(fresh.state, { type: 'playLand', seat: 'p1', objectId: landId }))
      played = ok(fresh.rules(played, { type: 'custom', name: DIALOG_CHOSEN, seat: 'p1', payload: { accepted: true } }))
      played = ok(fresh.rules(played, { type: 'move', objectId: landId, to: 'hand' }))
      expect(played.objects[landId].types).toContain('Creature')
    })

})


test('catalog face rules switch to the land entry program and restore the front program after leaving', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Bala Ged Recovery')] } })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const frontDefinition = server.state.objects[objectId].ruleDefinition!
  const played = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
  expect(played.objects[objectId]).toMatchObject({ zone: 'battlefield', tapped: true, types: ['Land'] })
  expect(played.objects[objectId].ruleDefinition).toEqual(played.objects[objectId].backFace!.ruleDefinition)
  expect(played.objects[objectId].ruleDefinition!.definitionRevision).not.toBe(frontDefinition.definitionRevision)
  const restored = JSON.parse(JSON.stringify(played))
  const bounced = ok(server.rules(restored, { type: 'move', objectId, to: 'hand' }))
  expect(bounced.objects[objectId]).toMatchObject({ zone: 'hand', types: ['Sorcery'] })
  expect(bounced.objects[objectId].ruleDefinition).toEqual(frontDefinition)
})
