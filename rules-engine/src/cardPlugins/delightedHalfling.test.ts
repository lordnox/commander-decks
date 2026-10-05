import { describe, expect, test } from 'bun:test'
import { deckCardTemplate, loadCardPlugins } from '../deckCardFixtures'
import { emptyMana } from '../draft'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'

/** Delighted Halfling: the any-color mana pays only for legendary spells, which then can't be countered. */

const PLUGINS = await loadCardPlugins(['Delighted Halfling'])

const game = () =>
  createServerGame(
    commanderRules,
    {
      players: 2,
      battlefield: { p1: [deckCardTemplate('Delighted Halfling')] },
      hands: {
        p1: [
          cardTemplate('Legend', {
            types: ['Creature'],
            supertypes: ['Legendary'],
            manaCost: '{G}',
            manaValue: 1,
          }),
          cardTemplate('Commoner', { types: ['Creature'], manaCost: '{G}', manaValue: 1 }),
          cardTemplate('Colorless Commoner', { types: ['Creature'], manaCost: '{1}', manaValue: 1 }),
        ],
      },
    },
    { random: () => 0.5, cardPlugins: PLUGINS },
  )

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const tap = (state: GameState, mana?: 'C' | 'G') => {
  const server = game()
  return ok(server.rules(state, {
    type: 'tapForMana',
    seat: 'p1',
    objectId: named(state, 'Delighted Halfling').id,
    ...(mana ? { mana } : {}),
  }))
}

const cast = (state: GameState, name: string) =>
  game().rules(state, { type: 'castSpell', seat: 'p1', objectId: named(state, name).id })

describe('Delighted Halfling', () => {
  test('{T}: Add {C} is unrestricted and pays for anything', () => {
    const tapped = tap(game().state, 'C')
    expect(tapped.players.p1.mana).toEqual({ ...emptyMana(), C: 1 })
    expect(tapped.players.p1.restrictedMana ?? []).toEqual([])
    const bare = tap(game().state)
    expect(bare.players.p1.mana).toEqual({ ...emptyMana(), C: 1 })
    const spell = ok(cast(tapped, 'Colorless Commoner'))
    expect(spell.stack[0].uncounterable).toBeUndefined()
  })

  test('the colored mana is kept apart and pays only for a legendary spell, which becomes uncounterable', () => {
    const tapped = tap(game().state, 'G')
    expect(tapped.players.p1.mana).toEqual(emptyMana())
    expect(tapped.players.p1.restrictedMana).toMatchObject([
      { mana: 'G', legendary: true, uncounterable: true },
    ])
    expect(cast(tapped, 'Commoner').ok).toBe(false)
    const legend = ok(cast(tapped, 'Legend'))
    expect(legend.stack[0]).toMatchObject({ name: 'Legend', uncounterable: true })
    expect(legend.players.p1.restrictedMana).toEqual([])
  })

  test('the restricted mana is lost when the step ends', () => {
    const tapped = tap(game().state, 'G')
    const next = ok(game().rules({ ...tapped, step: 'precombatMain' }, { type: 'advanceStep' }))
    expect(next.players.p1.restrictedMana ?? []).toEqual([])
  })

  test('a summoning-sick Halfling cannot tap, and a tapped one cannot tap again', () => {
    const sick = structuredClone(game().state)
    sick.objects[named(sick, 'Delighted Halfling').id].summoningSickness = true
    expect(game().rules(sick, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: named(sick, 'Delighted Halfling').id,
      mana: 'G',
    }).ok).toBe(false)
    const tapped = tap(game().state, 'G')
    expect(game().rules(tapped, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: named(tapped, 'Delighted Halfling').id,
      mana: 'G',
    }).ok).toBe(false)
  })
})
