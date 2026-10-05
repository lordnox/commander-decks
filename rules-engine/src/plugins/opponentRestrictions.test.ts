import { describe, expect, test } from 'bun:test'
import { opponentsCantCast } from '../cardPlugins/effectBuilders'
import { serializableEffects } from '../cardPlugins/effects'
import type { ManaValuePredicate } from '../cardPlugins/effectDefinitions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { manaValueMatches } from './opponentRestrictions'

const artifact = (name: string, manaCost: string, manaValue: number) =>
  cardTemplate(name, { types: ['Artifact'], manaCost, manaValue })

const gameWith = (predicate: ManaValuePredicate) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Fixture Winnower', {
        types: ['Creature'],
        power: 1,
        toughness: 1,
        effects: serializableEffects([opponentsCantCast(predicate)]),
      })],
    },
    hands: {
      p1: [artifact('Mine Two', '{2}', 2)],
      p2: [
        artifact('Free', '', 0),
        artifact('Two', '{2}', 2),
        artifact('Three', '{3}', 3),
        cardTemplate('X Rock', { types: ['Artifact'], manaCost: '{X}', manaValue: 0 }),
      ],
    },
  })
  const state = structuredClone(server.state)
  state.step = 'precombatMain'
  const cast = (seat: 'p1' | 'p2', name: string, x?: number) => {
    const current = structuredClone(state)
    current.active = seat
    current.priority = seat
    current.players[seat].mana.C = 6
    const objectId = Object.values(current.objects).find((object) => object.name === name)!.id
    return server.rules(current, { type: 'castSpell', seat, objectId, ...(x === undefined ? {} : { x }) })
  }
  return { server, state, cast }
}

describe('manaValueMatches', () => {
  test('parity treats zero as even', () => {
    expect(manaValueMatches({ parity: 'even' }, 0)).toBe(true)
    expect(manaValueMatches({ parity: 'even' }, 3)).toBe(false)
    expect(manaValueMatches({ parity: 'odd' }, 0)).toBe(false)
    expect(manaValueMatches({ parity: 'odd' }, 3)).toBe(true)
  })

  test('min and max are inclusive and combine with parity', () => {
    expect(manaValueMatches({ min: 2, max: 4 }, 1)).toBe(false)
    expect(manaValueMatches({ min: 2, max: 4 }, 2)).toBe(true)
    expect(manaValueMatches({ min: 2, max: 4 }, 4)).toBe(true)
    expect(manaValueMatches({ min: 2, max: 4 }, 5)).toBe(false)
    expect(manaValueMatches({ parity: 'even', min: 3 }, 4)).toBe(true)
    expect(manaValueMatches({ parity: 'even', min: 3 }, 2)).toBe(false)
  })
})

describe('opponents can not cast spells matching a mana value predicate', () => {
  test('an opponent cannot cast an even-valued spell, zero included', () => {
    const game = gameWith({ parity: 'even' })
    const two = game.cast('p2', 'Two')
    expect(two.ok).toBe(false)
    if (!two.ok) expect(two.error).toContain('mana value 2')
    expect(game.cast('p2', 'Free').ok).toBe(false)
  })

  test('an opponent can cast an odd-valued spell', () => {
    const result = gameWith({ parity: 'even' }).cast('p2', 'Three')
    expect(ok(result).stack).toHaveLength(1)
  })

  test('the permanent controller is not restricted', () => {
    const result = gameWith({ parity: 'even' }).cast('p1', 'Mine Two')
    expect(ok(result).stack).toHaveLength(1)
  })

  test('ranges restrict only matching mana values', () => {
    const game = gameWith({ min: 3 })
    expect(game.cast('p2', 'Two').ok).toBe(true)
    expect(game.cast('p2', 'Three').ok).toBe(false)
  })

  test('X counts as the chosen value while the spell is cast', () => {
    const game = gameWith({ parity: 'even' })
    expect(game.cast('p2', 'X Rock', 2).ok).toBe(false)
    expect(game.cast('p2', 'X Rock', 3).ok).toBe(true)
  })

  test('the restriction ends when the source leaves the battlefield', () => {
    const game = gameWith({ parity: 'even' })
    const source = Object.values(game.state.objects).find((object) => object.name === 'Fixture Winnower')!
    const gone = ok(game.server.rules(game.state, { type: 'move', objectId: source.id, to: 'graveyard' }))
    const current = structuredClone(gone)
    current.active = 'p2'
    current.priority = 'p2'
    current.players.p2.mana.C = 6
    const spell = Object.values(current.objects).find((object) => object.name === 'Two')!
    expect(game.server.rules(current, {
      type: 'castSpell',
      seat: 'p2',
      objectId: spell.id,
    }).ok).toBe(true)
  })
})
