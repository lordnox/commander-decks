import { describe, expect, test } from 'bun:test'
import { opponentsCantCast } from '../cardPlugins/effectBuilders'
import { serializableEffects } from '../cardPlugins/effects'
import type { ManaValuePredicate } from '../cardPlugins/effectDefinitions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { manaValueMatches } from './opponentRestrictions'

import { combatGame, deckCard, fixtureCreature, named } from '../cardPlugins/cirdanCreatureCards'
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

describe('relocated from cirdanEldrazi.test.ts → opponentRestrictions.test.ts', () => {
  const withValue = (name: string, manaValue: number, extra: Parameters<typeof fixtureCreature>[1] = {}) =>
    fixtureCreature(name, { manaValue, ...extra })

  const spell = (name: string, manaCost: string, manaValue: number, types = ['Artifact']) =>
    cardTemplate(name, { types, manaCost, manaValue })

  const winnowerCard = () => deckCard('Void Winnower')

      const castGame = (players: 2 | 3 | 4 = 3) => {
        const server = createServerGame(commanderRules, {
          players,
          battlefield: { p1: [winnowerCard()] },
          hands: {
            p1: [spell('Mine Two', '{2}', 2)],
            p2: [
              spell('Free Rock', '', 0),
              spell('Two Rock', '{2}', 2),
              spell('Three Rock', '{3}', 3),
              spell('Four Flash', '{4}', 4, ['Creature']),
              cardTemplate('Test Forest', { types: ['Land'], manaValue: 0 }),
            ],
            p3: [spell('P3 Two Rock', '{2}', 2), spell('P3 Five Rock', '{5}', 5)],
          },
        })
        const ready = structuredClone(server.state)
        ready.step = 'precombatMain'
        const cast = (seat: 'p1' | 'p2' | 'p3', name: string) => {
          const current = structuredClone(ready)
          current.active = seat
          current.priority = seat
          current.players[seat].mana.C = 6
          return server.rules(current, {
            type: 'castSpell',
            seat,
            objectId: named(current, name).id,
          })
        }
        return { server, ready, cast }
      }

      test('every opponent is stopped from casting even mana values, zero included', () => {
        const game = castGame()
        for (const [seat, name] of [
          ['p2', 'Free Rock'],
          ['p2', 'Two Rock'],
          ['p2', 'Four Flash'],
          ['p3', 'P3 Two Rock'],
        ] as const) {
          const result = game.cast(seat, name)
          expect(result.ok).toBe(false)
          if (!result.ok) expect(result.error).toContain('mana value')
        }
      })

      test('odd mana values and the controller own spells are unaffected', () => {
        const game = castGame()
        expect(ok(game.cast('p2', 'Three Rock')).stack).toHaveLength(1)
        expect(ok(game.cast('p3', 'P3 Five Rock')).stack).toHaveLength(1)
        expect(ok(game.cast('p1', 'Mine Two')).stack).toHaveLength(1)
      })

      test('lands are not spells and can still be played', () => {
        const game = castGame()
        const current = structuredClone(game.ready)
        current.active = 'p2'
        current.priority = 'p2'
        const played = game.server.rules(current, {
          type: 'move',
          objectId: named(current, 'Test Forest').id,
          to: 'battlefield',
        })
        expect(played.ok).toBe(true)
      })

      test('the restriction ends the moment Void Winnower leaves the battlefield', () => {
        const game = castGame()
        const gone = ok(game.server.rules(game.ready, {
          type: 'move',
          objectId: named(game.ready, 'Void Winnower').id,
          to: 'graveyard',
        }))
        const current = structuredClone(gone)
        current.active = 'p2'
        current.priority = 'p2'
        current.players.p2.mana.C = 6
        expect(game.server.rules(current, {
          type: 'castSpell',
          seat: 'p2',
          objectId: named(current, 'Two Rock').id,
        }).ok).toBe(true)
      })

      test('two Void Winnowers on opposite sides each restrict only the other player', () => {
        const server = createServerGame(commanderRules, {
          players: 2,
          battlefield: {
            p1: [winnowerCard()],
            p2: [deckCard('Void Winnower', { name: 'Void Winnower' })],
          },
          hands: {
            p1: [spell('P1 Two Rock', '{2}', 2), spell('P1 Three Rock', '{3}', 3)],
            p2: [spell('P2 Two Rock', '{2}', 2)],
          },
        })
        const ready = structuredClone(server.state)
        ready.step = 'precombatMain'
        const cast = (seat: 'p1' | 'p2', name: string) => {
          const current = structuredClone(ready)
          current.active = seat
          current.priority = seat
          current.players[seat].mana.C = 6
          return server.rules(current, { type: 'castSpell', seat, objectId: named(current, name).id })
        }
        expect(cast('p1', 'P1 Two Rock').ok).toBe(false)
        expect(cast('p1', 'P1 Three Rock').ok).toBe(true)
        expect(cast('p2', 'P2 Two Rock').ok).toBe(false)
      })

      test('opponents cannot block with even-valued creatures, including zero and tokens', () => {
        const game = combatGame(
          [winnowerCard(), fixtureCreature('Runner')],
          [withValue('Zero Bear', 0), withValue('Two Bear', 2), withValue('Token Bear', 0, { token: true })],
        )
        const state = game.toBlockers('Runner')
        for (const blocker of ['Zero Bear', 'Two Bear', 'Token Bear']) {
          expect(game.blockError(state, [blocker, 'Runner'])).toContain("can't block")
        }
      })

      test('odd-valued creatures still block, alone or together', () => {
        const game = combatGame(
          [winnowerCard(), fixtureCreature('Runner')],
          [withValue('Three Bear', 3), withValue('Five Bear', 5), withValue('Two Bear', 2)],
        )
        const state = game.toBlockers('Runner')
        expect(game.blockError(state, ['Three Bear', 'Runner'])).toBeUndefined()
        expect(game.blockError(state, ['Three Bear', 'Runner'], ['Five Bear', 'Runner'])).toBeUndefined()
        expect(game.blockError(state, ['Three Bear', 'Runner'], ['Two Bear', 'Runner'])).toContain("can't block")
      })

      test('Void Winnower itself (mana value nine) is odd, and its controller blocks freely', () => {
        const game = combatGame(
          [withValue('Attacker', 4)],
          [winnowerCard(), withValue('Even Bear', 2)],
        )
        const state = game.toBlockers('Attacker')
        expect(game.blockError(state, ['Void Winnower', 'Attacker'])).toBeUndefined()
        expect(game.blockError(state, ['Even Bear', 'Attacker'])).toBeUndefined()
      })

      test('only the defending opponents are restricted in a multiplayer table', () => {
        const game = combatGame(
          [winnowerCard(), fixtureCreature('Runner')],
          [withValue('Two Bear', 2)],
          { players: 4 },
        )
        const state = game.toBlockers('Runner')
        expect(game.blockError(state, ['Two Bear', 'Runner'])).toContain("can't block")
      })

      test('the restriction ends once Void Winnower is gone', () => {
        const game = combatGame(
          [winnowerCard(), fixtureCreature('Runner')],
          [withValue('Two Bear', 2)],
        )
        let state = game.attackWith(game.ready, 'Runner')
        state = game.send(state, {
          type: 'move',
          objectId: named(state, 'Void Winnower').id,
          to: 'graveyard',
        })
        state = game.advance(state)
        expect(game.blockError(state, ['Two Bear', 'Runner'])).toBeUndefined()
      })
})
