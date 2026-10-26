import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok } from '../testHelpers'
import type { GameState } from '../types'

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



})
