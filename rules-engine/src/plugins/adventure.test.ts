import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'

const fictionalAdventure = () => cardTemplate('Trail Scout // Scout Trail', {
  types: ['Creature'],
  subtypes: ['Elf', 'Scout'],
  manaCost: '{1}{G}',
  manaValue: 2,
  colors: ['G'],
  power: 2,
  toughness: 2,
  oracleText: 'Vigilance',
  frontFace: {
    types: ['Creature'],
    subtypes: ['Elf', 'Scout'],
    supertypes: [],
    manaCost: '{1}{G}',
    manaValue: 2,
    colors: ['G'],
    power: '2',
    toughness: '2',
    oracleText: 'Vigilance',
  },
  backFace: {
    types: ['Sorcery'],
    subtypes: ['Adventure'],
    supertypes: [],
    manaCost: '{G}',
    manaValue: 1,
    colors: ['G'],
    oracleText: 'Draw a card.',
  },
})

const funded = (state: ReturnType<typeof createServerGame>['state']) => ({
  ...state,
  players: {
    ...state.players,
    p1: {
      ...state.players.p1,
      mana: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
    },
  },
})

describe('Adventure spells', () => {
  test('hand offers creature and adventure casts', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [fictionalAdventure()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const actions = legalActsFor(funded(server.state), 'p1')
      .filter((action) => action.kind === 'castSpell' && action.objectId === objectId)
    expect(actions.map((action) => action.adventureCast)).toEqual(
      expect.arrayContaining([undefined, true]),
    )
    expect(actions.some((action) => action.castLabel === 'Scout Trail')).toBe(true)
  })

  test('adventure resolves to exile and can cast the permanent face', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [fictionalAdventure()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const ready = funded(server.state)
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
      adventureCast: true,
    }))
    expect(cast.objects[objectId]).toMatchObject({ zone: 'stack', types: ['Sorcery'] })

    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[objectId]).toMatchObject({
      zone: 'exile',
      adventured: true,
      types: ['Creature'],
    })

    const exileCasts = legalActsFor({
      ...resolved,
      players: {
        ...resolved.players,
        p1: {
          ...resolved.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
        },
      },
    }, 'p1').filter((action) => action.kind === 'castSpell' && action.objectId === objectId)
    expect(exileCasts.some((action) => action.adventureCast)).toBe(false)
    expect(exileCasts.length).toBeGreaterThan(0)

    const creature = ok(server.rules({
      ...resolved,
      players: {
        ...resolved.players,
        p1: {
          ...resolved.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
        },
      },
    }, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
    }))
    const onStack = ok(server.rules(creature, { type: 'resolveTop' }))
    expect(onStack.objects[objectId]).toMatchObject({ zone: 'battlefield', types: ['Creature'] })
    expect(onStack.objects[objectId].adventured).toBeUndefined()
  })

  test('cannot cast the adventure from exile', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [fictionalAdventure()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    let state = ok(server.rules(funded(server.state), {
      type: 'castSpell',
      seat: 'p1',
      objectId,
      adventureCast: true,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
      adventureCast: true,
    }).ok).toBe(false)
  })

  test('eventsForAvailableAction carries adventureCast', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [fictionalAdventure()] } })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const action = legalActsFor(funded(server.state), 'p1').find(
      (candidate) => candidate.kind === 'castSpell'
        && candidate.objectId === objectId
        && candidate.adventureCast,
    )
    expect(eventsForAvailableAction(funded(server.state), 'p1', action!)).toEqual([
      {
        type: 'castSpell',
        seat: 'p1',
        objectId,
        adventureCast: true,
      },
    ])
  })
})
