import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { hasKeyword } from '../keywords'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { activated } from './activated'
import { effectsFor } from './cardRules'
import { deckCard, fixtureCreature, combatGame, named } from './cirdanCreatureCards'
import { ability } from './effects'
import { cardPluginEntry } from './index'
import { ward } from './ward'

describe('Sire of Seven Deaths', () => {
  test('registers only the Ward-pay-7-life stamp the Oracle parser cannot read', () => {
    expect(effectsFor('Sire of Seven Deaths')).toEqual([
      { op: 'static', ward: { life: 7 } },
    ])
    expect(cardPluginEntry('Sire of Seven Deaths')).toMatchObject({
      pluginIds: [],
      handlerIds: ['ward'],
    })
  })

  test('every printed keyword comes from the Oracle text', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [deckCard('Sire of Seven Deaths')] },
    })
    const sire = named(server.state, 'Sire of Seven Deaths')
    for (const keyword of ['reach', 'first strike', 'vigilance', 'menace', 'trample', 'lifelink']) {
      expect(hasKeyword(sire, keyword, server.state)).toBe(true)
    }
    for (const keyword of ['flying', 'deathtouch', 'indestructible', 'hexproof']) {
      expect(hasKeyword(sire, keyword, server.state)).toBe(false)
    }
    expect([sire.power, sire.toughness]).toEqual([7, 7])
  })

  describe('ward', () => {
    const bolt = () => cardTemplate('Lightning Bolt', { types: ['Instant'], manaCost: '{R}' })
    const poker = () => cardTemplate('Fixture Poker', {
      types: ['Creature'],
      effects: [ability({ id: 'poker.poke', targets: 'creature' }, {}, { kind: 'gainLife', count: 1 })],
    })

    const wardGame = (life = 40) => {
      const server = createServerGame(commanderRules, {
        hands: { p1: [bolt()] },
        battlefield: {
          p1: [poker(), deckCard('Sire of Seven Deaths', { name: 'Own Sire' })],
          p2: [deckCard('Sire of Seven Deaths')],
        },
      }, { random: () => 0.5, cardPlugins: [ward, activated] })
      const ready = structuredClone(server.state)
      ready.players.p1.life = life
      ready.players.p1.mana.R = 1
      ready.priority = 'p1'
      return { server, ready }
    }

    const boltEvent = (state: GameState, target = 'Sire of Seven Deaths'): GameEvent => ({
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Lightning Bolt').id,
      targets: [{ kind: 'object', objectId: named(state, target).id }],
    })

    const answer = (
      server: ReturnType<typeof createServerGame>,
      state: GameState,
      optionId: string,
    ) => server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pendingOptionSelection(state, 'p1')!.id,
      optionId,
    })

    test('targeting it asks only the caster whether to pay 7 life; paying lets the spell resolve', () => {
      const { server, ready } = wardGame()
      const warded = ok(server.rules(ready, boltEvent(ready)))
      expect(warded.stack).toHaveLength(0)
      expect(pendingOptionSelection(warded, 'p1')).toMatchObject({
        source: 'Sire of Seven Deaths',
        options: [{ id: 'pay' }, { id: 'decline' }],
        action: { kind: 'ward-life', life: 7 },
      })
      expect(pendingOptionSelection(projectForViewer(warded, 'p1'), 'p1')).toBeDefined()
      for (const viewer of ['p2', 'p3'] as const) {
        expect(pendingOptionSelection(projectForViewer(warded, viewer), 'p1')).toBeUndefined()
      }

      const paid = ok(answer(server, warded, 'pay'))
      expect(paid.players.p1.life).toBe(33)
      expect(paid.stack[0]).toMatchObject({ kind: 'spell', objectId: named(paid, 'Lightning Bolt').id })
      expect(pendingOptionSelection(paid, 'p1')).toBeUndefined()
    })

    test('declining counters the spell and costs no life', () => {
      const { server, ready } = wardGame()
      const declined = ok(answer(server, ok(server.rules(ready, boltEvent(ready))), 'decline'))
      expect(declined.players.p1.life).toBe(40)
      expect(declined.stack).toHaveLength(0)
      expect(named(declined, 'Lightning Bolt').zone).not.toBe('stack')
      expect(declined.log.some((line) => line.includes('countered by Ward'))).toBe(true)
    })

    test('a caster at 6 life cannot pay seven and the spell is countered with no choice', () => {
      const { server, ready } = wardGame(6)
      const state = ok(server.rules(ready, boltEvent(ready)))
      expect(pendingOptionSelection(state, 'p1')).toBeUndefined()
      expect(state.stack).toHaveLength(0)
      expect(state.players.p1.life).toBe(6)
    })

    test('rejects other seats, unknown options, and moving on while the choice is open', () => {
      const { server, ready } = wardGame()
      const warded = ok(server.rules(ready, boltEvent(ready)))
      expect(answer(server, warded, 'bogus').ok).toBe(false)
      expect(server.rules(warded, {
        type: 'selectOption',
        seat: 'p2',
        selectionId: pendingOptionSelection(warded, 'p1')!.id,
        optionId: 'pay',
      }).ok).toBe(false)
      expect(server.rules(warded, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
    })

    test('a host restart restores the open choice and the replayed answer resolves the spell', () => {
      const { server, ready } = wardGame()
      const event = boltEvent(ready)
      const warded = ok(server.rules(ready, event))
      const selection = pendingOptionSelection(warded, 'p1')!

      let journal = createJournal(ready)
      journal = recordAccepted(journal, event)
      const restored = restoreJournal(journal, server.rules).current()
      expect(pendingOptionSelection(restored, 'p1')).toEqual(selection)

      const paid = ok(answer(server, restored, 'pay'))
      expect(paid.players.p1.life).toBe(33)
      expect(paid.stack).toHaveLength(1)
    })

    test('its own controller is never warded against, and an activated ability is warded too', () => {
      const { server, ready } = wardGame()
      const own = ok(server.rules(ready, boltEvent(ready, 'Own Sire')))
      expect(pendingOptionSelection(own, 'p1')).toBeUndefined()
      expect(own.stack).toHaveLength(1)

      const poke: GameEvent = {
        type: 'activateAbility',
        abilityId: 'poker.poke',
        seat: 'p1',
        objectId: named(ready, 'Fixture Poker').id,
        targets: [{ kind: 'object', objectId: ready.zoneOrder.p2.battlefield[0] }],
      }
      const warded = ok(server.rules(ready, poke))
      expect(pendingOptionSelection(warded, 'p1')).toBeDefined()
      expect(warded.stack).toHaveLength(0)
      const paid = ok(answer(server, warded, 'pay'))
      expect(paid.players.p1.life).toBe(33)
      expect(paid.stack[0]).toMatchObject({ kind: 'ability', abilityId: 'poker.poke' })
    })
  })

  describe('combat keywords', () => {
    const sire = () => deckCard('Sire of Seven Deaths')

    test('vigilance: attacking does not tap it', () => {
      const game = combatGame([sire()])
      const state = game.attackWith(game.ready, 'Sire of Seven Deaths')
      expect(named(state, 'Sire of Seven Deaths').tapped).toBe(false)
    })

    test('lifelink: unblocked it gains its controller seven life', () => {
      const game = combatGame([sire()])
      const state = game.advance(game.advance(game.toBlockers('Sire of Seven Deaths')))
      expect(state.players.p2.life).toBe(33)
      expect(state.players.p1.life).toBe(47)
    })

    test('first strike: it kills two big blockers before they deal damage', () => {
      const game = combatGame([sire()], [
        fixtureCreature('Brick A', { power: 20, toughness: 3 }),
        fixtureCreature('Brick B', { power: 20, toughness: 3 }),
      ])
      let state = game.blockWith(
        game.toBlockers('Sire of Seven Deaths'),
        ['Brick A', 'Sire of Seven Deaths'],
        ['Brick B', 'Sire of Seven Deaths'],
      )
      state = game.advance(state)
      expect(named(state, 'Brick A').zone).toBe('graveyard')
      expect(named(state, 'Brick B').zone).toBe('graveyard')
      expect(named(state, 'Sire of Seven Deaths')).toMatchObject({ zone: 'battlefield', damageMarked: 0 })
      // Lifelink counts all seven damage, and the one point past six toughness tramples over.
      expect(state.players.p1.life).toBe(47)
      expect(state.players.p2.life).toBe(39)
    })

    test('menace: a single blocker is rejected and two are accepted', () => {
      const game = combatGame([sire()], [fixtureCreature('Bear A'), fixtureCreature('Bear B')])
      const state = game.toBlockers('Sire of Seven Deaths')
      expect(game.blockError(state, ['Bear A', 'Sire of Seven Deaths'])).toContain('menace')
      expect(game.blockError(
        state,
        ['Bear A', 'Sire of Seven Deaths'],
        ['Bear B', 'Sire of Seven Deaths'],
      )).toBeUndefined()
    })

    test('trample: the excess over a chump blocker reaches the defending player', () => {
      const game = combatGame([sire()], [
        fixtureCreature('Bear A'),
        fixtureCreature('Bear B'),
      ])
      let state = game.toBlockers('Sire of Seven Deaths')
      state = game.blockWith(
        state,
        ['Bear A', 'Sire of Seven Deaths'],
        ['Bear B', 'Sire of Seven Deaths'],
      )
      state = game.advance(state)
      expect(named(state, 'Bear A').zone).toBe('graveyard')
      expect(named(state, 'Bear B').zone).toBe('graveyard')
      // Lethal to each 2/2 is two, so three of the seven tramples through.
      expect(state.players.p2.life).toBe(37)
    })

    test('reach: it can block a flying attacker', () => {
      const game = combatGame(
        [fixtureCreature('Drake', { oracleText: 'Flying' })],
        [deckCard('Sire of Seven Deaths')],
      )
      expect(game.blockError(game.toBlockers('Drake'), ['Sire of Seven Deaths', 'Drake'])).toBeUndefined()
    })
  })
})

describe('Void Winnower', () => {
  const winnowerCard = () => deckCard('Void Winnower')

  test('registers one static cast and one static block restriction on even mana values', () => {
    expect(effectsFor('Void Winnower')).toEqual([
      { op: 'static', opponentsCantCast: { parity: 'even' } },
      { op: 'static', opponentsCantBlock: { parity: 'even' } },
    ])
    expect(cardPluginEntry('Void Winnower')).toMatchObject({ pluginIds: [], handlerIds: [] })
  })

  describe('casting', () => {
    const spell = (name: string, manaCost: string, manaValue: number, types = ['Artifact']) =>
      cardTemplate(name, { types, manaCost, manaValue })

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
  })

  describe('blocking', () => {
    const withValue = (name: string, manaValue: number, extra: Parameters<typeof fixtureCreature>[1] = {}) =>
      fixtureCreature(name, { manaValue, ...extra })

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
})
