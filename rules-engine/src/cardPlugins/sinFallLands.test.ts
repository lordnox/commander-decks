import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const card = (
  name: string,
  types: string[],
  extra: Parameters<typeof cardTemplate>[1] = {},
) => cardTemplate(name, { types, ...extra })

describe('Sin-fall lands and alternate casting', () => {
  test('Cavern chooses privately as it enters and its restricted mana only protects the matching creature', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [card('Cavern of Souls', ['Land'])] } },
      { random: () => 0.5 },
    )
    const cavern = named(server.state, 'Cavern of Souls')
    let state = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: cavern.id,
    }))
    const pick = pendingOptionSelection(state, 'p1')!
    expect(pick.options.some(option => option.id === 'Wizard')).toBe(true)
    expect(pendingOptionSelection(server.project(state, 'p2'), 'p1')).toBeUndefined()

    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pick.id,
      optionId: 'Wizard',
    }))
    expect(named(state, 'Cavern of Souls')).toMatchObject({ zone: 'battlefield', chosenType: 'Wizard' })

    const table = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [card('Cavern of Souls', ['Land'], { chosenType: 'Wizard' })],
        },
        hands: {
          p1: [
            card('Matching Wizard', ['Creature'], { subtypes: ['Wizard'], manaCost: '{U}' }),
            card('Wrong Bear', ['Creature'], { subtypes: ['Bear'], manaCost: '{U}' }),
          ],
        },
      },
      { random: () => 0.5 },
    )
    const source = named(table.state, 'Cavern of Souls')
    state = ok(table.rules(table.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: source.id,
      mana: 'U',
    }))
    expect(state.players.p1.mana.U).toBe(0)
    expect(state.players.p1.restrictedMana).toMatchObject([
      { mana: 'U', creatureType: 'Wizard', uncounterable: true },
    ])

    const illegal = table.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Wrong Bear').id,
    })
    expect(illegal.ok).toBe(false)

    const cast = ok(table.rules(state, {
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
            card('Found Island', ['Land'], { supertypes: ['Basic'], subtypes: ['Island'] }),
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
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: boseiju.id,
      targets: [{ kind: 'object', objectId: basic.id }],
    }).ok).toBe(false)

    const utility = named(state, 'Utility Land')
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: boseiju.id,
      targets: [{ kind: 'object', objectId: utility.id }],
    }))
    expect(state.objects[boseiju.id].zone).toBe('graveyard')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[utility.id].zone).toBe('graveyard')
    const search = pendingSelectionFor(state, 'p2')!
    const found = named(state, 'Found Island')
    expect(search).toMatchObject({ kind: 'choose', min: 0, viewLibrary: true, candidates: [found.id] })
    expect(server.project(state, 'p1').players.p2.data['kernel.pendingSelection'])
      .toBeUndefined()
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [found.id],
    }))
    expect(state.objects[found.id].zone).toBe('battlefield')

    const otawara = named(state, 'Otawara, Soaring City')
    const creature = named(state, 'Bounce Me')
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: otawara.id,
      targets: [{ kind: 'object', objectId: creature.id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[creature.id].zone).toBe('hand')
  })

})
