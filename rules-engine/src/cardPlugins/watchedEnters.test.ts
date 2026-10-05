import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { conditionHolds, draw, gainLife, permanentEnters, triggeringCreatureNameUnique } from './effects'

const guardian = () => cardTemplate('Test Guardian Project', {
  types: ['Enchantment'],
  effects: [permanentEnters(
    { type: 'Creature', controller: 'you', nontoken: true },
    { if: triggeringCreatureNameUnique(), do: [draw(1)] },
  )],
})

const creature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], ...extra })

const game = (zones: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(
    commanderRules,
    {
      players: 2,
      libraries: {
        p1: ['Draw 1', 'Draw 2', 'Draw 3'].map((name) => cardTemplate(name, { types: ['Instant'] })),
      },
      ...zones,
    },
    { random: () => 0.5 },
  )

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const enter = (server: ReturnType<typeof game>, state: GameState, name: string) =>
  ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to: 'battlefield' }))

const handSize = (state: GameState) => state.zoneOrder.p1.hand.length

const cardsDrawn = (state: GameState) => 3 - state.zoneOrder.p1.library.length

describe('permanentEnters with a unique-name intervening if', () => {
  test('the first creature with a name draws, and a second with that name does not', () => {
    const server = game({
      battlefield: { p1: [guardian()] },
      hands: { p1: [creature('Bear'), creature('Bear')] },
    })
    const first = enter(server, server.state, 'Bear')
    expect(first.stack).toHaveLength(1)
    expect(first.stack[0]).toMatchObject({ name: 'Test Guardian Project' })
    const drawn = resolveStack(server.rules, first)
    expect(handSize(drawn)).toBe(2)

    const second = Object.values(drawn.objects).find((object) =>
      object.name === 'Bear' && object.zone === 'hand')!
    const again = ok(server.rules(drawn, { type: 'move', objectId: second.id, to: 'battlefield' }))
    expect(again.stack).toEqual([])
  })

  test('a name already in your graveyard, as a token you control, or as a copy blocks the draw', () => {
    const server = game({
      battlefield: {
        p1: [
          guardian(),
          creature('Token Bear', { token: true }),
          creature('Bear', { printedName: 'Clone' }),
        ],
      },
      hands: {
        p1: [
          creature('Dead Bear', { zone: 'graveyard' }),
          creature('Dead Bear'),
          creature('Token Bear'),
          creature('Bear'),
          creature('Fresh Bear'),
        ],
      },
    })
    const deadBear = Object.values(server.state.objects).find((object) =>
      object.name === 'Dead Bear' && object.zone === 'hand')!
    expect(ok(server.rules(server.state, {
      type: 'move',
      objectId: deadBear.id,
      to: 'battlefield',
    })).stack).toEqual([])
    const tokenNamed = Object.values(server.state.objects).find((object) =>
      object.name === 'Token Bear' && object.zone === 'hand')!
    expect(ok(server.rules(server.state, {
      type: 'move',
      objectId: tokenNamed.id,
      to: 'battlefield',
    })).stack).toEqual([])
    const copied = Object.values(server.state.objects).find((object) =>
      object.name === 'Bear' && object.zone === 'hand')!
    expect(ok(server.rules(server.state, {
      type: 'move',
      objectId: copied.id,
      to: 'battlefield',
    })).stack).toEqual([])
    expect(enter(server, server.state, 'Fresh Bear').stack).toHaveLength(1)
  })

  test('double-faced names compare by front face, not as two different strings', () => {
    const server = game({
      battlefield: { p1: [guardian()] },
      hands: {
        p1: [
          creature('Delver of Secrets // Insectile Aberration'),
          creature('Delver of Secrets // Insectile Aberration', { zone: 'graveyard' }),
          creature('Fireside Hunter // Hunter Pack'),
          creature('Delver of Secrets', { zone: 'graveyard' }),
        ],
      },
    })
    const hand = Object.values(server.state.objects).filter((object) => object.zone === 'hand')
    const delver = hand.find((object) => object.name.startsWith('Delver'))!
    expect(ok(server.rules(server.state, {
      type: 'move',
      objectId: delver.id,
      to: 'battlefield',
    })).stack).toEqual([])
    const other = hand.find((object) => object.name.startsWith('Fireside'))!
    expect(ok(server.rules(server.state, {
      type: 'move',
      objectId: other.id,
      to: 'battlefield',
    })).stack).toHaveLength(1)
  })

  test('tokens, opponent creatures, and noncreature permanents never trigger it', () => {
    const server = game({
      battlefield: { p1: [guardian()] },
      hands: {
        p1: [creature('Bear Token', { token: true }), cardTemplate('Rock', { types: ['Artifact'] })],
        p2: [creature('Enemy Bear')],
      },
    })
    expect(enter(server, server.state, 'Bear Token').stack).toEqual([])
    expect(enter(server, server.state, 'Rock').stack).toEqual([])
    expect(enter(server, server.state, 'Enemy Bear').stack).toEqual([])
  })

  test('an opponent creature with the same name does not stop the draw', () => {
    const server = game({
      battlefield: { p1: [guardian()], p2: [creature('Bear')] },
      hands: { p1: [creature('Bear')] },
    })
    const mine = Object.values(server.state.objects).find((object) =>
      object.name === 'Bear' && object.zone === 'hand')!
    const state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: mine.id,
      to: 'battlefield',
    })))
    expect(handSize(state)).toBe(1)
  })

  test('a creature entering as a spell result or land drop path is watched like a move', () => {
    const server = game({
      battlefield: { p1: [guardian()] },
      hands: { p1: [creature('Spell Bear', { manaCost: '{0}' })] },
    })
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Spell Bear').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.stack).toHaveLength(1)
    expect(handSize(resolveStack(server.rules, resolved))).toBe(1)
  })

  test('the condition is checked again on resolution', () => {
    const server = game({
      battlefield: { p1: [guardian()] },
      hands: {
        p1: [
          creature('Bear'),
          creature('Late Bear', { name: 'Bear' }),
        ],
      },
    })
    const entered = enter(server, server.state, 'Bear')
    expect(entered.stack).toHaveLength(1)

    // A same-named creature card reaches the graveyard in response.
    const late = Object.values(entered.objects).find((object) =>
      object.name === 'Bear' && object.zone === 'hand')!
    const buried = ok(server.rules(entered, { type: 'move', objectId: late.id, to: 'graveyard' }))
    expect(cardsDrawn(resolveStack(server.rules, buried))).toBe(0)

    // The creature itself dies in response, so its card in the graveyard has its name.
    const dies = ok(server.rules(entered, {
      type: 'move',
      objectId: named(entered, 'Bear').id,
      to: 'graveyard',
    }))
    expect(cardsDrawn(resolveStack(server.rules, dies))).toBe(0)

    // Leaving for exile leaves nothing with that name behind, so the draw still happens.
    const exiled = ok(server.rules(entered, {
      type: 'move',
      objectId: Object.values(entered.objects).find((object) =>
        object.name === 'Bear' && object.zone === 'battlefield')!.id,
      to: 'exile',
    }))
    expect(cardsDrawn(resolveStack(server.rules, exiled))).toBe(1)
  })

  test('two creatures with the same name entering one after the other draw only once', () => {
    const server = game({
      battlefield: { p1: [guardian()] },
      hands: { p1: [creature('Twin'), creature('Twin')] },
    })
    const ids = Object.values(server.state.objects)
      .filter((object) => object.name === 'Twin')
      .map((object) => object.id)
    let state = server.state
    for (const objectId of ids) {
      state = resolveStack(server.rules, ok(server.rules(state, {
        type: 'move',
        objectId,
        to: 'battlefield',
      })))
    }
    expect(handSize(state)).toBe(1)
  })

  test('the condition cannot be satisfied without a triggering creature', () => {
    const server = game({ battlefield: { p1: [guardian()] } })
    const source = named(server.state, 'Test Guardian Project')
    expect(conditionHolds(triggeringCreatureNameUnique(), server.state, source)).toBe(false)
  })
})

describe('permanentEnters watchers', () => {
  const watcher = (other: boolean) => creature('Test Watcher', {
    effects: [permanentEnters(
      { type: 'Creature', controller: 'you', ...(other ? { other: true } : {}) },
      { do: [gainLife(1)] },
    )],
  })

  test('a creature watching creatures you control also sees itself unless the filter says other', () => {
    for (const other of [false, true]) {
      const server = game({
        hands: { p1: [watcher(other), creature('Bear')] },
      })
      const selfEntered = resolveStack(server.rules, enter(server, server.state, 'Test Watcher'))
      expect(selfEntered.players.p1.life).toBe(other ? 40 : 41)
      const bearEntered = resolveStack(server.rules, enter(server, selfEntered, 'Bear'))
      expect(bearEntered.players.p1.life).toBe(other ? 41 : 42)
    }
  })
})
