import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'

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

    expect(legalActsFor(funded, 'p1').map((action) => action.kind))
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
