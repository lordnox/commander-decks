import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok } from '../testHelpers'
import type { FaceCharacteristics, GameState } from '../types'
import { activated } from './activated'
import { alternateCosts } from './alternateCosts'
import { creatureTypeChoice } from './creatureTypeChoice'
import { entersTapped } from './entersTapped'
import { onResolve } from './onResolve'
import { phasing } from './phasing'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const card = (
  name: string,
  types: string[],
  extra: Parameters<typeof cardTemplate>[1] = {},
) => cardTemplate(name, { types, ...extra })

describe('Sin-fall lands and alternate casting', () => {
  test('Cavern chooses privately and its restricted mana only protects the matching creature', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [card('Wizard', ['Creature'], { subtypes: ['Wizard'] })],
        },
        hands: {
          p1: [
            card('Cavern of Souls', ['Land'], {
              oracleText: 'As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can\'t be countered.',
            }),
            card('Matching Wizard', ['Creature'], {
              subtypes: ['Wizard'],
              manaCost: '{U}',
            }),
            card('Wrong Bear', ['Creature'], {
              subtypes: ['Bear'],
              manaCost: '{U}',
            }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [creatureTypeChoice, onResolve] },
    )
    const cavern = named(server.state, 'Cavern of Souls')
    let state = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: cavern.id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(pendingDialog(state)).toMatchObject({
      kind: 'choose-creature-type',
      seat: 'p1',
    })
    expect(server.project(state, 'p2').players.p1.data['kernel.pendingDialog'])
      .toBeUndefined()

    state = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { modes: ['Wizard'] },
    }))
    state = ok(server.rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: cavern.id,
      mana: 'U',
    }))
    expect(state.players.p1.mana.U).toBe(0)
    expect(state.players.p1.restrictedMana).toMatchObject([
      { mana: 'U', creatureType: 'Wizard', uncounterable: true },
    ])

    const illegal = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Wrong Bear').id,
    })
    expect(illegal.ok).toBe(false)

    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Matching Wizard').id,
    }))
    expect(cast.stack[0]).toMatchObject({ uncounterable: true })
    expect(cast.players.p1.restrictedMana).toEqual([])
  })

  test('channel pays the legendary discount, validates targets, and completes Boseiju search', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            card('Legend One', ['Creature'], { supertypes: ['Legendary'] }),
            card('Legend Two', ['Creature'], { supertypes: ['Legendary'] }),
          ],
          p2: [
            card('Basic Forest', ['Land'], {
              supertypes: ['Basic'],
              subtypes: ['Forest'],
            }),
            card('Utility Land', ['Land']),
            card('Bounce Me', ['Creature']),
          ],
        },
        hands: {
          p1: [
            card('Boseiju, Who Endures', ['Land']),
            card('Otawara, Soaring City', ['Land']),
          ],
        },
        libraries: {
          p2: [
            card('Breeding Pool', ['Land'], { subtypes: ['Forest', 'Island'] }),
            card('No Type Land', ['Land']),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 1, C: 1 }
    const boseiju = named(state, 'Boseiju, Who Endures')
    const basic = named(state, 'Basic Forest')
    expect(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'channel.boseiju',
      seat: 'p1',
      objectId: boseiju.id,
      targets: [{ kind: 'object', objectId: basic.id }],
    }).ok).toBe(false)

    const utility = named(state, 'Utility Land')
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'channel.boseiju',
      seat: 'p1',
      objectId: boseiju.id,
      targets: [{ kind: 'object', objectId: utility.id }],
    }))
    expect(state.objects[boseiju.id].zone).toBe('graveyard')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[utility.id].zone).toBe('graveyard')
    const search = pendingSelectionFor(state, 'p2')!
    expect(search).toMatchObject({ min: 0, after: ['shuffleLibrary'] })
    expect(server.project(state, 'p1').players.p2.data['kernel.pendingSelection'])
      .toBeUndefined()
    const breedingPool = named(state, 'Breeding Pool')
    expect(search.candidates).toEqual([breedingPool.id])
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [breedingPool.id],
    }))
    expect(state.objects[breedingPool.id].zone).toBe('battlefield')

    const otawara = named(state, 'Otawara, Soaring City')
    const creature = named(state, 'Bounce Me')
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'channel.otawara',
      seat: 'p1',
      objectId: otawara.id,
      targets: [{ kind: 'object', objectId: creature.id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[creature.id].zone).toBe('hand')
  })

  test('Talon enters from hand, phases an optional target, and it phases in before untap', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p2: [card('Target Creature', ['Creature'])] },
        hands: { p1: [card('Talon Gates of Madara', ['Land'])] },
      },
      { random: () => 0.5, cardPlugins: [activated, phasing] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana.C = 4
    const talon = named(state, 'Talon Gates of Madara')
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'talon.put',
      seat: 'p1',
      objectId: talon.id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const choice = pendingSelectionFor(state, 'p1')!
    const target = named(state, 'Target Creature')
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [target.id],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[target.id].phasedOut).toBe(true)

    const nextTurn = structuredClone(state)
    nextTurn.active = 'p1'
    nextTurn.step = 'cleanup'
    nextTurn.priority = 'p1'
    nextTurn.stack = []
    const p2Turn = ok(server.rules(nextTurn, { type: 'advanceStep' }))
    expect(p2Turn.active).toBe('p2')
    expect(p2Turn.objects[target.id].phasedOut).toBe(false)
  })

  test('Lasting Fayth creates the scaled Hero, exiles itself, then permits the land play', () => {
    const landFace: FaceCharacteristics = {
      types: ['Land'],
      subtypes: ['Town'],
      supertypes: [],
      manaCost: '',
      manaValue: 0,
      colors: [],
      oracleText: 'This land enters tapped.\n{T}: Add {G}.',
    }
    const adventureFace: FaceCharacteristics = {
      types: ['Sorcery'],
      subtypes: ['Adventure'],
      supertypes: [],
      manaCost: '{4}{G}{G}',
      manaValue: 6,
      colors: ['G'],
      oracleText: 'Create a 1/1 colorless Hero creature token.',
    }
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [forest(), forest('Island')] },
        hands: {
          p1: [card('Zanarkand, Ancient Metropolis // Lasting Fayth', ['Land'], {
            frontFace: landFace,
            backFace: adventureFace,
          })],
        },
      },
      {
        random: () => 0.5,
        cardPlugins: [alternateCosts, entersTapped, onResolve],
      },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 4 }
    const zanarkand = named(state, 'Zanarkand, Ancient Metropolis // Lasting Fayth')
    expect(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: zanarkand.id,
    }).ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: zanarkand.id,
      castOption: 'adventure',
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const hero = named(state, 'Hero')
    expect(hero.counters['+1/+1']).toBe(2)
    expect(state.objects[zanarkand.id]).toMatchObject({
      zone: 'exile',
      adventureReady: true,
    })
    state = ok(server.rules(state, {
      type: 'playLand',
      seat: 'p1',
      objectId: zanarkand.id,
    }))
    expect(state.objects[zanarkand.id]).toMatchObject({
      zone: 'battlefield',
      tapped: true,
      types: ['Land'],
    })
  })
})
