import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingDialogFor } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { CardTemplate } from '../newGame'
import type { GameState, PlayerId } from '../types'
import { castModal, casts, draw, gainLife, type CardEffect } from './effects'
import { castTriggers } from './castTriggers'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const spell = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, manaCost: '{0}', manaValue: 0, ...extra })

const watcher = (name: string, effect: CardEffect) =>
  cardTemplate(name, { types: ['Enchantment'], effects: [effect] })

const game = (permanents: CardTemplate[]) =>
  createServerGame(
    commanderRules,
    {
      players: 3,
      battlefield: { p1: permanents },
      hands: {
        p1: [spell('P1 Trick', ['Instant']), spell('P1 Bear', ['Creature'])],
        p2: [spell('P2 Trick', ['Instant']), spell('P2 Bear', ['Creature'])],
        p3: [spell('P3 Trick', ['Instant'])],
      },
      libraries: {
        p1: ['Lib A', 'Lib B', 'Lib C'].map((name) => cardTemplate(name, { types: ['Sorcery'] })),
      },
    },
    { random: () => 0.5, cardPlugins: [castTriggers] },
  )

const cast = (server: ReturnType<typeof game>, seat: PlayerId, name: string, state = server.state) =>
  ok(server.rules({ ...structuredClone(state), active: seat, priority: seat }, {
    type: 'castSpell',
    seat,
    objectId: named(state, name).id,
  }))

const handNames = (state: GameState, seat: PlayerId) =>
  state.zoneOrder[seat].hand.map((id) => state.objects[id].name)

const OPPONENT_NONCREATURE = casts(draw(1), { castBy: 'opponent', noncreatureOnly: true })

describe('cast triggers with seat and spell-type filters', () => {
  test('casts() is clone-safe and keeps its instructions apart from its filters', () => {
    const effect = casts(draw(1), gainLife(2), { castBy: 'opponent', noncreatureOnly: true })
    expect(structuredClone(effect)).toEqual(effect)
    expect(effect).toEqual({
      op: 'trigger',
      on: 'cast',
      do: [draw(1), gainLife(2)],
      castBy: 'opponent',
      noncreatureOnly: true,
    })
  })

  test('an opponent casting a noncreature spell draws the watcher controller a card', () => {
    const server = game([watcher('Nezahal Stand-in', OPPONENT_NONCREATURE)])
    const afterP2 = cast(server, 'p2', 'P2 Trick')
    expect(handNames(afterP2, 'p1')).toContain('Lib A')
    expect(handNames(afterP2, 'p2')).not.toContain('Lib A')

    const afterP3 = cast(server, 'p3', 'P3 Trick', afterP2)
    expect(handNames(afterP3, 'p1')).toEqual(expect.arrayContaining(['Lib A', 'Lib B']))
  })

  test('an opponent casting a creature spell does not trigger it', () => {
    const server = game([watcher('Nezahal Stand-in', OPPONENT_NONCREATURE)])
    const state = cast(server, 'p2', 'P2 Bear')
    expect(handNames(state, 'p1')).not.toContain('Lib A')
  })

  test('the controller casting a noncreature spell does not trigger an opponent watcher', () => {
    const server = game([watcher('Nezahal Stand-in', OPPONENT_NONCREATURE)])
    const state = cast(server, 'p1', 'P1 Trick')
    expect(handNames(state, 'p1')).not.toContain('Lib A')
  })

  test('a watcher that has left the battlefield no longer triggers', () => {
    const server = game([watcher('Nezahal Stand-in', OPPONENT_NONCREATURE)])
    const removed = ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Nezahal Stand-in').id,
      to: 'graveyard',
    }))
    expect(handNames(cast(server, 'p2', 'P2 Trick', removed), 'p1')).not.toContain('Lib A')
  })

  test('without a castBy filter only the controller casts fire, as before', () => {
    const server = game([watcher('Own Creature Watcher', casts(draw(1), { creatureOnly: true }))])
    expect(handNames(cast(server, 'p1', 'P1 Bear'), 'p1')).toContain('Lib A')
    expect(handNames(cast(server, 'p1', 'P1 Trick'), 'p1')).not.toContain('Lib A')
    expect(handNames(cast(server, 'p2', 'P2 Bear'), 'p1')).not.toContain('Lib A')
  })

  test('the noncreature filter also works on the controller\'s own casts', () => {
    const server = game([watcher('Own Spell Watcher', casts(draw(1), { noncreatureOnly: true }))])
    expect(handNames(cast(server, 'p1', 'P1 Trick'), 'p1')).toContain('Lib A')
    expect(handNames(cast(server, 'p1', 'P1 Bear'), 'p1')).not.toContain('Lib A')
    expect(handNames(cast(server, 'p2', 'P2 Trick'), 'p1')).not.toContain('Lib A')
  })

  test('two watchers each trigger once, and a modal opponent trigger asks its controller', () => {
    const modal = castModal({
      choose: 'one',
      modes: [{ id: 'draw', label: 'Draw a card.', do: [draw(1)] }],
    }, { castBy: 'opponent' })
    const server = game([
      watcher('Nezahal Stand-in', OPPONENT_NONCREATURE),
      watcher('Second Watcher', OPPONENT_NONCREATURE),
      cardTemplate('Modal Watcher', { types: ['Enchantment'], effects: [modal] }),
    ])
    const state = cast(server, 'p2', 'P2 Trick')

    expect(handNames(state, 'p1')).toEqual(expect.arrayContaining(['Lib A', 'Lib B']))
    expect(pendingDialogFor(state, 'p1')).toMatchObject({ kind: 'choose-modes', seat: 'p1' })
    expect(pendingDialogFor(state, 'p2')).toBeUndefined()
  })
})
